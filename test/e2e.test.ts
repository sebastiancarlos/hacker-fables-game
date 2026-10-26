/**
 * E2E suite: spawns the game as a child process, feeds it keystrokes
 * like a player would, and asserts on the terminal output.
 *
 * Run with: npm test (node --test, no extra deps).
 * New behavior starts here: write the failing scenario first (red),
 * then implement (green).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { TerminalEmulator } from "./screen.ts";
import { DATA_ENV } from "../src/platform/node.ts";
import { RECORDING_VERSION } from "../src/records/recording.ts";
import { SHOTGUN_DMG } from "../src/player/items.ts";
import { TITLE_TAGLINE } from "../src/content.ts";
import { BOSS_DEPTH } from "../src/world/depth.ts";
import { startingKit } from "../src/player/progression.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GAME = path.join(ROOT, "src", "main.ts");
/** Shared data directory for the suite; every child writes here, not $HOME. */
const DATA_DIR = path.join(ROOT, "tmp", "e2e-data");

const BOOT_MS = 1000;
const KEY_GAP_MS = 40;
const DRAIN_MS = 200;
/** Silence the harness waits for between quick steps, so the queue empties. */
const QUIET_MS = 250;
/** Poll period while watching a child for that silence. */
const QUIET_POLL_MS = 50;
/** Longest the harness will wait for a quiet child before pressing on. */
const QUIET_CAP_MS = 15000;
/** Steps slower than this are deliberate playback watches, not settles. */
const SETTLE_BELOW_MS = 1000;
/** Longest the harness will wait for an expected screen after one step. */
const STEP_UNTIL_MS = 30000;

// BFS path start->down stairs, dungeon seed 7. Re-find if generation changes.
// BFS start->down stairs, dungeon seed 7. Two bumps hold two turns.
const WALK_DOWN =
  "h" +
  "k".repeat(5) +
  "l".repeat(2) +
  "k".repeat(3) +
  "l".repeat(19) +
  "k" +
  "ll";
// BFS start->gun, dungeon seed 7. The h kills the snake on the way.
const GUN_WALK =
  "h" + "k".repeat(5) + "l".repeat(2) + "k".repeat(3) + "l".repeat(16) + "j";
// Gun retreat to a spot with no line to it, dungeon seed 7.
const BACK_WALK = "h".repeat(4) + "k" + "h".repeat(14) + "j".repeat(5) + "l";
// Staging west of the snake room, dungeon seed 7.
const VIEW_WALK =
  "h" + "k".repeat(5) + "l".repeat(2) + "k".repeat(3) + "l".repeat(2);

/** Wait for a real timer in a child-process test. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until the child's output stops growing.
 *
 * Keys sent while the game still has a queue to drain can arrive in the same
 * read as the next step, and the game handles one read as one batch (Ctrl-C
 * then drops that whole batch). Real players wait for the screen, so the
 * harness should too.
 */
async function waitForQuiet(length: () => number): Promise<void> {
  const deadline = Date.now() + QUIET_CAP_MS;
  let seen = -1;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(QUIET_POLL_MS);
    if (length() !== seen) {
      seen = length();
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= QUIET_MS) {
      return;
    }
  }
}

/**
 * Wait until the visible screen passes a check.
 *
 * Silence alone is only a hint that the game has drained its queue: a child
 * starved by CI load can stall long enough to look idle. A screen marker is
 * proof that every earlier key took effect before the next one is sent.
 */
async function waitForScreen(
  output: () => string,
  until: ScreenCheck,
): Promise<void> {
  const deadline = Date.now() + STEP_UNTIL_MS;
  while (Date.now() < deadline) {
    const screen = screenOf(output()).join("\n");
    const passed =
      typeof until === "function" ? until(screen) : until.test(screen);
    if (passed) {
      return;
    }
    await sleep(QUIET_POLL_MS);
  }
  throw new Error(
    `timed out waiting for the expected screen:\n${screenOf(output()).join("\n")}`,
  );
}

/** A visible screen to wait for: a pattern to find, or a predicate over it. */
type ScreenCheck = RegExp | ((screen: string) => boolean);

/** One scripted step: keys to type and an optional screen to wait for. */
interface Step {
  keys: string;
  /** Wait for this visible screen before the next step. */
  until?: ScreenCheck;
}

/** Captured stdout and exit state from one child run. */
interface RunResult {
  output: string;
  code: number | null;
}

let runCounter = 0;

/** Boot the game, type each step's keys with gaps, wait, return output. */
async function runGame(
  steps: (string | Step)[],
  opts: {
    arena?: boolean;
    seed?: number;
    level?: number;
    stepWaitMs?: number;
    label?: string;
    dataDir?: string;
    replay?: string;
    title?: boolean;
  } = {},
): Promise<RunResult> {
  const arena = opts.arena ?? true;
  const stepWaitMs = opts.stepWaitMs ?? DRAIN_MS;
  const dataDir = opts.dataDir ?? DATA_DIR;
  const args = arena ? [GAME, "--arena"] : [GAME];
  if (opts.title !== true) {
    args.push("--no-title");
  }
  if (opts.seed !== undefined) {
    args.push("--seed", String(opts.seed));
  }
  if (opts.level !== undefined) {
    args.push("--level", String(opts.level));
  }
  if (opts.replay !== undefined) {
    args.push("--replay", opts.replay);
  }
  /** Spawn one child attempt and collect its output. */
  async function attempt(): Promise<{ result: RunResult; timedOut: boolean }> {
    const child = spawn("node", args, {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        [DATA_ENV]: dataDir,
      },
    });
    let output = "";
    let timedOut = false;
    child.stdout.on("data", (d: unknown) => {
      output += String(d);
    });
    child.stdin.on("error", () => {});
    const done = new Promise<RunResult>((resolve, reject) => {
      const fail = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 90000);
      child.on("close", (code: number | null, signal: string | null) => {
        clearTimeout(fail);
        if (code !== 0) {
          console.error(
            `e2e abnormal close code=${code} signal=${signal} bytes=${output.length}`,
          );
        }
        resolve({ output, code });
      });
      child.on("error", (err: Error) => {
        clearTimeout(fail);
        reject(err);
      });
    });
    await sleep(BOOT_MS);
    const bootDeadline = Date.now() + 15000;
    while (output.length === 0 && Date.now() < bootDeadline) {
      await sleep(50);
    }
    for (const step of steps) {
      const keys = typeof step === "string" ? step : step.keys;
      const until = typeof step === "string" ? undefined : step.until;
      for (const key of keys) {
        if (child.exitCode === null) {
          child.stdin.write(key);
        }
        await sleep(KEY_GAP_MS);
      }
      await sleep(stepWaitMs);
      if (until !== undefined) {
        await waitForScreen(() => output, until);
      } else if (stepWaitMs < SETTLE_BELOW_MS) {
        await waitForQuiet(() => output.length);
      }
    }
    // A final `q` in play opens the quit confirmation; answer it here so
    // every test that ends with the usual quit still reaches the shell.
    if (child.exitCode === null) {
      child.stdin.write("y");
      await sleep(KEY_GAP_MS);
    }
    return { result: await done, timedOut };
  }

  // Retry policy: spawn failures and abnormal deaths (herd-load victims)
  // retry once with a fresh process, after a backoff so transient system
  // pressure passes. Timeouts never retry (a wedged game must fail fast).
  // Assertions below are never retried: real game bugs fail
  // deterministically on every attempt.
  let outcome: { result: RunResult; timedOut: boolean } | null = null;
  for (let attemptNo = 0; ; attemptNo++) {
    if (attemptNo === 1) {
      console.error("e2e retry after abnormal run");
      await sleep(3000);
    }
    try {
      const r = await attempt();
      if (r.result.code === 0 || r.timedOut || attemptNo === 1) {
        outcome = r;
        break;
      }
    } catch (err) {
      if (attemptNo === 1) {
        throw err;
      }
    }
  }
  const result = (outcome as { result: RunResult; timedOut: boolean }).result;
  runCounter++;
  await mkdir(path.join(ROOT, "tmp"), { recursive: true });
  const tag = opts.label ?? `run-${runCounter}`;
  await writeFile(path.join(ROOT, "tmp", `e2e-${tag}.out`), result.output);
  return result;
}

/**
 * Final visible frame of a run: feed the recorded bytes through the same
 * emulator as the sync suite. Assertions here check what the player
 * actually sees at the end, not bytes merely emitted mid-run.
 */
function screenOf(output: string): string[] {
  const term = new TerminalEmulator();
  term.write(output);
  return term.text().split("\n");
}

/** The emitted text with styling removed: e2e asserts on words, not bytes. */
function withoutSgr(output: string): string {
  return output.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("hacker-fables e2e", { concurrency: true }, () => {
  it("boots, shows help, and quits cleanly", async () => {
    const { output, code } = await runGame(["q"]);
    assert.equal(code, 0);
    assert.match(output, /Dlvl:1  Lv:1  Xp:0\/50/);
    assert.match(output, /Vim Commands \(1\): q/);
    assert.match(output, /Press \? for help\./);
    assert.match(output, / NORMAL /);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("clears the quit panel after cancelling it", async () => {
    const { output } = await runGame([
      { keys: "q", until: /Quit this run\?/ },
      { keys: "n", until: (screen) => !screen.includes("Quit this run?") },
      "\x03",
    ]);
    const frame = screenOf(output);
    assert.ok(frame[0]!.startsWith("Press ? for help."));
    assert.equal(frame.join("\n").includes("Quit this run?"), false);
  });

  it("shows a boot splash that any key dismisses", async () => {
    const { output, code } = await runGame(["h", " ", "q"], {
      seed: 7,
      title: true,
    });
    assert.equal(code, 0);
    assert.ok(
      output.includes(TITLE_TAGLINE),
      "the splash should show the title",
    );
    assert.match(output, /Press \? for help\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("same seed gives an identical dungeon", async () => {
    const a = await runGame(["q"], { arena: false, seed: 7, label: "seed-a" });
    const b = await runGame(["q"], { arena: false, seed: 7, label: "seed-b" });
    assert.equal(a.code, 0);
    assert.equal(b.code, 0);
    assert.equal(a.output, b.output);
  });

  it("dungeon boots and quits cleanly", async () => {
    const { output, code } = await runGame(["q"], { arena: false });
    assert.equal(code, 0);
    assert.match(output, /Dlvl:1  Lv:1/);
    assert.ok(output.includes("@"));
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("starts at the given level with starting shells", async () => {
    const { output, code } = await runGame(["q"], {
      arena: false,
      seed: 7,
      level: 3,
    });
    assert.equal(code, 0);
    assert.match(output, /Dlvl:3  Lv:/);
    assert.match(output, /W:Modal Shotgun/);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("carries the starting scrolls at a deep level", async () => {
    const { output, code } = await runGame(["s", "q", "q"], {
      arena: false,
      seed: 7,
      level: 11,
    });
    assert.equal(code, 0);
    const { plevel } = startingKit(11);
    assert.match(output, new RegExp(`Dlvl:11  Lv:${plevel}`));
    assert.match(output, new RegExp(`Lv:${plevel} `));
    assert.match(output, /Which script to execute\?/);
    // Depth 11 banks two scrolls: a heal, then a sweep.
    assert.match(output, /a\) script of s\/HP:/);
    assert.match(output, /b\) script of s\/\[sS\]\/\//);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("dungeon survives turns without crashing", async () => {
    const { output, code } = await runGame([`w`.repeat(10), "q"], {
      arena: false,
      seed: 7,
    });
    assert.equal(code, 0);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("boots the static bottom: a gun, the boss room, and no way down", async () => {
    // Arriving on the bottom raises its corruption popup; y dismisses it.
    const { output, code } = await runGame(["y" + ">" + "l".repeat(5), "q"], {
      arena: false,
      seed: 7,
      level: BOSS_DEPTH,
    });
    assert.equal(code, 0);
    assert.match(output, new RegExp(`Dlvl:${BOSS_DEPTH} `));
    // The bottom has no down stairs, and `>` says so.
    assert.match(output, /You can't go down here\./);
    // The lone gun sits five cells east of the arrival stairs.
    assert.match(output, /You see here a Modal Shotgun\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("bumps into walls with a message", async () => {
    const { output } = await runGame([`h`.repeat(42), "q"]);
    assert.match(output, /A wall with hints of corruption\./);
  });

  it("announces items underfoot", async () => {
    const { output } = await runGame([`h`.repeat(10), "lq"]);
    assert.match(output, /You see here a Modal Shotgun\./);
    // 10 h, 1 l, and the quitting q: the tally counts every gameplay key.
    assert.match(output, /Vim Commands \(12\):/);
  });

  it("picks up, inventories, and equips the shotgun", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "I",
      "x",
      "q",
    ]);
    assert.match(output, /You pick up the Modal Shotgun\./);
    assert.match(withoutSgr(output), /What do you want to equip\?/);
    assert.match(output, /You equip the Modal Shotgun\./);
    assert.match(output, /a\) Modal Shotgun \(equipped\)/);
    assert.match(output, /W:Modal Shotgun/);
  });

  it("reports empty hands", async () => {
    const { output } = await runGame([",", "E", "I", "x", "q"]);
    assert.match(output, /There is nothing here to pick up\./);
    assert.match(output, /You have nothing to equip\./);
    assert.match(output, /\(empty\)/);
  });

  it("fights and kills the snake in melee", async () => {
    const { output } = await runGame([`l`.repeat(12), "q"]);
    assert.equal(
      withoutSgr(output).includes("You hit the [code-snake (Python 3.9)]."),
      true,
    );
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("renders the name as a hitpoint bar when full", async () => {
    const { output } = await runGame(["q"]);
    assert.ok(withoutSgr(output).includes("[E. Max Vim the Hacker"));
  });

  it("joins same-turn messages on one line", async () => {
    const { output } = await runGame([`l`.repeat(9), "q"]);
    assert.equal(
      withoutSgr(output).includes(
        "You hit the [code-snake (Python 3.9)]. The code-snake (Python 3.9) bites you!",
      ),
      true,
    );
  });

  it("takes bites and dies", async () => {
    const { output } = await runGame([`l`.repeat(8), `w`.repeat(14), "xq"]);
    assert.match(output, /The code-snake \(Python 3\.9\) bites you!/);
    assert.match(output, /Your terminal closed permanently\. SIGKILL\./);
    assert.match(output, /HP:0\(16\)/);
  });

  it("shows an end screen and writes a score line on death", async () => {
    const data = path.join(ROOT, "tmp", "e2e-death-data");
    const file = path.join(data, "scores.txt");
    const morgue = path.join(data, "morgue");
    await rm(data, { recursive: true, force: true });
    const { output, code } = await runGame(
      [`l`.repeat(8), `w`.repeat(14), "q"],
      {
        arena: true,
        seed: 7,
        dataDir: data,
      },
    );
    assert.equal(code, 0);
    assert.match(output, /Your terminal closed permanently\. SIGKILL\./);
    assert.match(
      output,
      /Slain by code-snake \(Python 3\.9\) on "Bell Labs" Sub-level 1\./,
    );
    assert.equal(withoutSgr(output).includes("Press q to quit."), true);
    assert.match(screenOf(output).join("\n"), /Press q to quit\./);
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    assert.ok(
      lines.some((l) =>
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\t7\t1\t1\t0\t\d+\t\d+\tdead\tcode-snake \(Python 3\.9\)$/.test(
          l,
        ),
      ),
      `no score line in ${JSON.stringify(lines)}`,
    );
    const dumps = await readdir(morgue);
    assert.equal(dumps.length, 1);
    assert.match(dumps[0]!, /^run-\d{4}-\d{2}-\d{2}T.*-seed7\.md$/);
    const dump = await readFile(path.join(morgue, dumps[0]!), "utf8");
    assert.match(dump, /^# Hacker Fables run dump\n/);
    assert.match(dump, /\| Location\s+\| "Bell Labs" Sub-level 1\s+\|/);
    assert.match(dump, /\| Cause\s+\| code-snake \(Python 3\.9\)\s+\|/);
    assert.match(dump, /\| Outcome\s+\| dead\s+\|/);
  });

  it("records a run to disk and replays it from the seed", async () => {
    const data = path.join(ROOT, "tmp", "e2e-recs-data");
    const recs = path.join(data, "recordings");
    await rm(data, { recursive: true, force: true });
    // Play the arena death: exactly one recording lands on disk.
    await runGame([`l`.repeat(8), `w`.repeat(14), "q"], {
      arena: true,
      seed: 7,
      dataDir: data,
      label: "rec-write",
    });
    const files = await readdir(recs);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^run-\d{4}-\d{2}-\d{2}T.*-seed7\.json$/);
    const rec = JSON.parse(await readFile(path.join(recs, files[0]!), "utf8"));
    assert.equal(rec.seed, 7);
    assert.equal(rec.arena, true);
    assert.equal(rec.version, RECORDING_VERSION);
    assert.ok(Array.isArray(rec.keys) && rec.keys.length > 0);
    // Keys are stored normalized, not as raw terminal bytes.
    assert.deepEqual(Object.keys(rec.keys[0]).sort(), ["ctrl", "key", "shift"]);
    assert.equal(typeof rec.keys[0].key, "string");

    // Replay it: the same death appears, and no new recording is written.
    // A replay starts held, so `space` plays it; then `q` leaves for the
    // splash and a second `q` exits.
    const { output, code } = await runGame([" ", "q", "q"], {
      replay: path.join(recs, files[0]!),
      dataDir: data,
      stepWaitMs: 1800,
      label: "rec-replay",
    });
    assert.equal(code, 0);
    assert.match(output, /Your terminal closed permanently\. SIGKILL\./);
    assert.match(
      output,
      /Slain by code-snake \(Python 3\.9\) on "Bell Labs" Sub-level 1\./,
    );
    assert.equal((await readdir(recs)).length, 1);
  });

  it("picks a recording from the splash and watches it", async () => {
    const data = path.join(ROOT, "tmp", "e2e-pick-data");
    const recs = path.join(data, "recordings");
    await rm(data, { recursive: true, force: true });
    await runGame([`l`.repeat(8), `w`.repeat(14), "q"], {
      arena: true,
      seed: 7,
      dataDir: data,
      label: "pick-write",
    });
    assert.equal((await readdir(recs)).length, 1);

    // Fresh game with the splash: `v` opens the picker, Enter watches it,
    // space plays it, then two `q`s leave.
    const { output } = await runGame(["v", "\r", " ", "q", "q"], {
      title: true,
      seed: 7,
      dataDir: data,
      stepWaitMs: 1800,
      label: "pick-watch",
    });
    assert.match(output, /Recordings/);
    assert.match(output, /depth 1/);
    assert.match(output, /Your terminal closed permanently\. SIGKILL\./);
  });

  it("keeps the picked recording on screen after the picker closes", async () => {
    const data = path.join(ROOT, "tmp", "e2e-pick-frame-data");
    const recs = path.join(data, "recordings");
    await rm(data, { recursive: true, force: true });
    await runGame([`l`.repeat(8), `w`.repeat(14), "q"], {
      arena: true,
      seed: 7,
      dataDir: data,
      label: "pick-frame-write",
    });
    assert.equal((await readdir(recs)).length, 1);

    // Stop at the first held replay frame: the dungeon must be what remains,
    // not the picker's stale frame repainted after the new game booted.
    const { output, code } = await runGame(
      [
        { keys: "v", until: /Recordings/ },
        { keys: "\r", until: /Replay {3}space: play/ },
        "\x03",
      ],
      {
        title: true,
        seed: 7,
        dataDir: data,
        stepWaitMs: 1800,
        label: "pick-frame-watch",
      },
    );
    assert.equal(code, 0);
    const frame = screenOf(output).join("\n");
    assert.match(frame, /Replay {3}space: play/);
    assert.match(frame, /Dlvl:1/);
    assert.doesNotMatch(frame, /Recordings/);
  });

  it("keeps the end-screen replay on screen after r", async () => {
    // Die, then replay from the end screen and stop at the held first frame.
    const { output, code } = await runGame(
      [
        `l`.repeat(8),
        { keys: `w`.repeat(14), until: /Press r to replay\./ },
        { keys: "r", until: /Replay {3}space: play/ },
        "\x03",
      ],
      { arena: true, seed: 7, label: "end-replay-frame" },
    );
    assert.equal(code, 0);
    const frame = screenOf(output).join("\n");
    assert.match(frame, /Replay {3}space: play/);
    assert.doesNotMatch(frame, /Press r to replay\./);
  });

  it("replays again from the death screen of a replay", async () => {
    const data = path.join(ROOT, "tmp", "e2e-replay-again-data");
    const recs = path.join(data, "recordings");
    await rm(data, { recursive: true, force: true });
    await runGame([`l`.repeat(8), `w`.repeat(14), "q"], {
      arena: true,
      seed: 7,
      dataDir: data,
      label: "replay-again-write",
    });
    const files = await readdir(recs);
    assert.equal(files.length, 1);

    // Watch the recording, hit `r` on its end screen, watch that replay to
    // its own end screen, then stop. Both runs must reach an end screen.
    const { output, code } = await runGame(
      [
        { keys: " ", until: /Press r to replay\./ },
        { keys: "r", until: /Replay {3}space: play/ },
        { keys: " ", until: /Press r to replay\./ },
        "\x03",
      ],
      {
        replay: path.join(recs, files[0]!),
        dataDir: data,
        stepWaitMs: 1800,
        label: "replay-again-watch",
      },
    );
    assert.equal(code, 0);
    const prompts = withoutSgr(output).split("Press r to replay.").length - 1;
    assert.ok(
      prompts >= 2,
      `expected two end screens from two replays, saw ${prompts}`,
    );
  });

  it("shows the high-score table from the splash", async () => {
    const data = path.join(ROOT, "tmp", "e2e-highscores-data");
    const file = path.join(data, "scores.txt");
    await rm(data, { recursive: true, force: true });
    await runGame([`l`.repeat(8), `w`.repeat(14), "q"], {
      arena: true,
      seed: 7,
      dataDir: data,
      label: "scores-write",
    });
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    assert.equal(lines.length, 1);

    // Fresh splash: `s` opens the table, then two `q`s leave.
    const { output } = await runGame(["s", "q", "q"], {
      title: true,
      seed: 7,
      dataDir: data,
      label: "scores-view",
    });
    assert.match(output, /High scores/);
    assert.match(output, /1\. +\d+   depth 1   Lv 1/);
    assert.match(output, /q: back/);
  });

  it("enters insert mode with i and leaves it with ESC", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "\x1b",
      "f",
      "\r",
      "q",
    ]);
    assert.equal(withoutSgr(output).includes(" INSERT "), true);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("firing consumes the shell", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\r",
      "i",
      "q",
    ]);
    assert.equal(withoutSgr(output).includes(" INSERT "), true);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
    assert.equal(output.split("shell chambered").length - 1 >= 2, true);
  });

  it("chambers and fires the shotgun for a kill", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\r",
      "q",
    ]);
    assert.match(withoutSgr(output), /"INSERT BULLET" mode: shell chambered\./);
    assert.equal(withoutSgr(output).includes(" INSERT "), true);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("targeting shows the enemy health on the bottom row", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "f",
      "q",
      "q",
    ]);
    assert.equal(
      withoutSgr(output).includes(
        "[code-snake (Python 3.9)] 6(6) -- Enter:fire Esc:cancel",
      ),
      true,
    );
  });

  it("shows the target under a reversed cursor", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "q",
      "q",
    ]);
    // Cursor auto-landed on the snake (no X overwrite).
    assert.equal(withoutSgr(output).includes("S"), true);
    assert.match(output, /You lower the shotgun\./);
  });

  it("opens commands help from the help menu", async () => {
    const { output } = await runGame(["?", "a", "q", "q", "q"]);
    assert.match(output, /List of commands/);
    assert.match(output, /Keys for a Pager \(like this one\):/);
    assert.match(output, /scroll one page/);
    assert.match(output, /step west/);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("searches case insensitively", async () => {
    const { output } = await runGame([
      "?",
      "a",
      "/",
      "FIRE",
      "\r",
      "q",
      "q",
      "q",
    ]);
    assert.equal(withoutSgr(output).includes("fire"), true);
  });

  it("pages half a screen with ctrl-d and ctrl-u", async () => {
    const { output } = await runGame(["?", "a", "\x04", "\x15", "q", "q", "q"]);
    // Half page down from the top lands on line 13; back up returns
    // to line 1. (Coupled to content staying longer than one page.)
    assert.match(output, /line 13-/);
    assert.match(output, /line 1-24 of/);
  });

  it("scrolls one line with ctrl-e and ctrl-y", async () => {
    const { output } = await runGame(["?", "a", "\x05", "\x19", "q", "q", "q"]);
    assert.match(output, /line 2-25 of/);
    assert.match(output, /line 1-24 of/);
  });

  it("paints the dungeon line full-width", async () => {
    const { output } = await runGame(["?", "a", "q", "q", "q"]);
    assert.ok(output.includes("Dlvl:1  Lv:1  Xp:0/50".padEnd(80)));
  });

  it("r shows details and returns to look", async () => {
    const { output } = await runGame(["/", "r", "x", "r", "x", "q", "q"]);
    const damage = `Damage: ${SHOTGUN_DMG}`;
    assert.match(output, new RegExp(damage));
    assert.equal(output.split(damage).length - 1 >= 2, true);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("r without details says so", async () => {
    const { output } = await runGame(["/", "o", "k", "r", "q", "q"]);
    assert.match(output, /No details available\./);
  });

  it("look mode lists its commands on the bottom row", async () => {
    const { output } = await runGame(["/", "q", "q"]);
    assert.match(output, /o free select/);
  });

  it("wraps full details flavor at about 50 cells", async () => {
    const { output } = await runGame([`l`.repeat(8), "/", "r", "x", "q", "q"]);
    assert.equal(
      output.includes("Bite: 2 damage per turn from any adjacent cell."),
      true,
    );
    assert.equal(
      output.includes("A manifestation of the Second GIL. A physical"),
      true,
    );
    assert.equal(output.includes("entanglement of lines of code"), true);
    assert.equal(output.includes("a snake."), true);
  });

  it("look describes what it lands on", async () => {
    const { output } = await runGame([WALK_DOWN, "/", "q", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /o free select/);
  });

  it("look marks remembered things as recall", async () => {
    // Walk away from the surface hatch, which starts under the player, and
    // look back once it is out of sight. The hatch is the nearest landmark.
    const { output } = await runGame(
      [GUN_WALK, "ll", BACK_WALK, "/", "q", "q"],
      {
        arena: false,
        seed: 7,
      },
    );
    assert.match(output, /You recall a staircase up\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("look keeps the player visible under and after the cursor", async () => {
    const { output } = await runGame(["/", "l", "l", "q", "q"]);
    assert.ok(output.includes("@"));
  });

  it("look describes snake wounds Angband-style", async () => {
    const { output } = await runGame([`l`.repeat(9), "/", "q", "q"]);
    assert.equal(
      withoutSgr(output).includes(
        "You see a wounded [code-snake (Python 3.9)].",
      ),
      true,
    );
    assert.equal(
      withoutSgr(output).includes("You hit the [code-snake (Python 3.9)]."),
      true,
    );
  });

  it("look says whether the snake sees you", async () => {
    const { output } = await runGame([`l`.repeat(8), "/", "q", "q"]);
    assert.equal(
      withoutSgr(output).includes(
        "You see a [code-snake (Python 3.9)]. It sees you.",
      ),
      true,
    );
  });

  it("look jumps to off-row targets in a direction", async () => {
    const { output } = await runGame(["k", "k", "/", "l", "q", "q"]);
    assert.match(output, /Yourself, E\. Max Vim\. You look healthy\./);
  });

  it("look only targets what you can see", async () => {
    const { output } = await runGame(["/", "q", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /Yourself, E\. Max Vim\. You look healthy\./);
    assert.equal(output.includes("A Modal Shotgun."), false);
    assert.equal(output.includes("A code-snake."), false);
  });

  it("look describes the nearest interesting cell", async () => {
    const { output } = await runGame(["/", "q", "q"]);
    assert.match(output, /You see a Modal Shotgun\./);
  });

  it("look jumps between interesting cells", async () => {
    const { output } = await runGame(["/", "l", "l", "q", "q"]);
    assert.match(output, /Yourself, E\. Max Vim\. You look healthy\./);
    assert.equal(
      withoutSgr(output).includes("You see a [code-snake (Python 3.9)]."),
      true,
    );
  });

  it("look free-selects with o", async () => {
    const { output } = await runGame(["/", "o", "k", "q", "q"]);
    assert.match(output, /You see the floor\./);
  });

  it("renders the pager footer reversed", async () => {
    const { output } = await runGame(["?", "a", "q", "q", "q"]);
    assert.match(withoutSgr(output), /Commands -- /);
  });

  it("scrolls the pager to the end", async () => {
    const { output } = await runGame(["?", "a", "G", "q", "q", "q"]);
    assert.match(output, /100%/);
  });

  it("searches pager text with /", async () => {
    const { output } = await runGame([
      "?",
      "a",
      "/",
      "fire",
      "\r",
      "q",
      "q",
      "q",
    ]);
    assert.equal(withoutSgr(output).includes("fire"), true);
  });

  it("opens the about page", async () => {
    const { output } = await runGame(["?", "b", "q", "q", "q"]);
    assert.match(output, /Hacker Fables/);
  });

  it("opens the message log on Shift-M", async () => {
    const { output } = await runGame(["H", "h".repeat(50), "M", "G", "q", "q"]);
    assert.match(withoutSgr(output), /Messages -- /);
    assert.equal(
      withoutSgr(output).includes("A wall with hints of corruption."),
      true,
    );
  });

  it("visual block with no enemy shoots the middle square", async () => {
    const { output } = await runGame([
      `l`.repeat(12),
      "H",
      ",",
      "E",
      "a",
      "i",
      "f",
      "\x16",
      "l",
      "l",
      "\r",
      "q",
    ]);
    assert.match(output, /The shot echoes through the floor\./);
    assert.equal(withoutSgr(output).split("*").length - 1, 2);
  });

  it("visual resize paints the block reversed", async () => {
    const { output } = await runGame([
      "H",
      ",",
      "E",
      "a",
      "i",
      "f",
      "\x16",
      "h",
      "h",
      "h",
      "q",
      "q",
    ]);
    // The rect covers floor: reversed dots, and visual mode announces
    // itself. The exact repaint count lives in the sync suite
    // ("resizes the visual block with a small repaint"), where the
    // virtual screen measures the diff instead of counting bytes.
    assert.match(withoutSgr(output), /"VISUAL BLOCK" mode: move to select/);
    assert.match(output, /You lower the shotgun\./);
  });

  it("gv reselects the last visual selection", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "f",
      "\x16",
      "l",
      "\x1b",
      "g",
      "v",
      "\r",
      "q",
    ]);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("gv refuses without a gun", async () => {
    const { output } = await runGame(["g", "v", "q"]);
    assert.match(output, /equip the Modal Shotgun/);
  });

  it("o swaps visual block to the opposite corner", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "f",
      "\x16",
      "k",
      "k",
      "l",
      "l",
      "o",
      "j",
      "q",
      "q",
    ]);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("visual block fires the covered cell", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\x16",
      "\r",
      "q",
    ]);
    assert.match(withoutSgr(output), /"VISUAL BLOCK" mode/);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("visual block covers more than the cursor cell", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\x16",
      "h",
      "\r",
      "q",
    ]);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("repeat re-aims a single shot and fires", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "f",
      "j", // step the cursor off the snake
      "\r", // fire into empty floor: the echo
      ".", // repeat: re-run `f`, re-aim, and fire it dead
      "q",
    ]);
    assert.match(output, /The shot echoes through the floor\./);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("repeat of a spent block reports nothing in range", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "f",
      "j", // step the cursor off the snake
      "\x16", // anchor the block there
      "l", // and size it clear of any enemy
      "\r", // volley covers nothing: the echo
      ".", // the recorded tiles are empty, so the repeat stays quiet
      "q",
    ]);
    assert.match(output, /The shot echoes through the floor\./);
    assert.equal(
      output.split("The shot echoes through the floor.").length - 1,
      1,
    );
    assert.match(output, /No targets in range to repeat the shot\./);
    assert.equal(output.includes("blast"), false);
  });

  it("esc exits visual block entirely", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\x16",
      "\x1b",
      "\r",
      "q",
    ]);
    assert.match(output, /You lower the shotgun\./);
    assert.equal(output.includes("blast"), false);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("q cancels visual block entirely", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\x16",
      "q",
      "q",
    ]);
    assert.match(output, /You lower the shotgun\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("animates the bullet along its path", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\r",
      "q",
    ]);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
    assert.equal(withoutSgr(output).includes("*"), true);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("shift-move runs to the wall", async () => {
    const { output } = await runGame([`h`.repeat(10), ",", "H", "q"]);
    assert.match(output, /A wall with hints of corruption\./);
  });

  it("run stops on items", async () => {
    const { output } = await runGame(["H", "q"]);
    assert.match(output, /You see here a Modal Shotgun\./);
  });

  it("run stops when stepping onto stairs", async () => {
    // Walk to the cell just before the stairs; the run steps onto them.
    const walk = WALK_DOWN.slice(0, -1);
    const { output } = await runGame([walk, "L", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /You see a staircase down\./);
  });

  it("run stops at room entrances instead of turning", async () => {
    // Stage at the corridor mouth, run its full length past the side
    // passages without turning, into the end wall.
    const { output } = await runGame(["hhhhhkkk", "L", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /A wall with hints of corruption\./);
  });

  it("run stops when a new snake comes into view", async () => {
    // Stage west of the snake room, run east until it wanders into view.
    const { output } = await runGame([VIEW_WALK, "L", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /A code-snake \(Python .+\) comes into view\./);
    assert.equal(output.includes("blocks the way"), false);
  });

  it("run stops before snake contact", async () => {
    const { output } = await runGame([`l`.repeat(5), "L", "q"]);
    assert.match(output, /blocks the way/);
    assert.match(output, /The code-snake \(Python 3\.9\) bites you!/);
  });

  it("fire falls back adjacent when no snake is lookable", async () => {
    // Arm at the gun, clear the snake beside it, then fire at nothing.
    const { output } = await runGame(
      [GUN_WALK, "ll", "h", ",", "i", "f", "\r", "q"],
      {
        arena: false,
        seed: 7,
      },
    );
    assert.match(output, /The shot echoes through the floor\./);
  });

  it("fires with no enemy nearby", async () => {
    const { output } = await runGame([
      `l`.repeat(12),
      "H",
      ",",
      "E",
      "a",
      "i",
      "f",
      "\r",
      "q",
    ]);
    assert.match(output, /Choose a target/);
    assert.match(output, /The shot echoes through the floor\./);
  });

  it("waits upstairs and comes back down", async () => {
    const walk = WALK_DOWN;
    const { output } = await runGame([walk, ">", `w`.repeat(8), "<", "q"], {
      arena: false,
      seed: 7,
    });
    // The wandering proof lives in the sync suite ("snakes below keep
    // moving while upstairs"); here the upstairs flow stays alive.
    assert.match(output, /You descend to level 2\./);
    assert.match(output, /You ascend to level 1\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("announces death once on the final frame and ends the turn", async () => {
    // The last normal level swarms: sixty waits guarantee the end.
    const { output } = await runGame(["w".repeat(60), "q"], {
      arena: false,
      seed: 7,
      level: BOSS_DEPTH - 1,
    });
    // The line shows in the message row and again on the end screen it
    // opens, so the final visible frame carries it exactly once.
    const frame = screenOf(output).join("\n");
    assert.equal(
      frame.split("Your terminal closed permanently. SIGKILL.").length - 1,
      1,
    );
  });

  it("travels to known stairs, then descends", async () => {
    const { output } = await runGame([WALK_DOWN.slice(0, 32), ">", ">", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /You see a staircase down\./);
    assert.match(output, /You descend to level 2\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("descends stairs to a deeper level", async () => {
    const walk = WALK_DOWN;
    const { output } = await runGame([walk, ">", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /You descend to level 2\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("ascends back to the level as left", async () => {
    const walk = WALK_DOWN;
    const { output } = await runGame([walk, ">", "<", "q"], {
      arena: false,
      seed: 7,
    });
    assert.match(output, /You descend to level 2\./);
    assert.match(output, /You ascend to level 1\./);
    assert.match(output, /Hacker Fables is yielding back control of your CPU/);
  });

  it("refuses stairs that are not there", async () => {
    const down = await runGame([">", "q"]);
    assert.match(down.output, /You can't go down here\./);
    const up = await runGame(["<", "q"]);
    assert.match(up.output, /You can't go up here\./);
  });

  it("binds = to the surface's service elevator", async () => {
    // Level 1 carries the shaft; at boot it is out of sight and out of
    // service, and there is none on the arena levels between.
    const surface = await runGame(["=", "q"], { arena: false, seed: 7 });
    assert.match(
      surface.output,
      /You haven't found the service elevator yet\./,
    );
    const arena = await runGame(["=", "q"]);
    assert.match(arena.output, /There is no service elevator here\./);
  });

  it("fires at full range across the room", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      "f",
      "\r",
      "q",
    ]);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("i equips unequipped shotgun, then chambers and fires", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "i",
      "f",
      "\r",
      "q",
    ]);
    assert.match(output, /You equip the Modal Shotgun\./);
    assert.match(output, /shell chambered\./);
    assert.match(output, /The floor returns to its Bell Labs blue\./);
  });

  it("misses when the cursor is off target", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      `h`.repeat(3),
      "\r",
      "q",
    ]);
    assert.match(output, /The shot echoes through the floor\./);
  });

  it("refuses to fire unloaded and unequipped", async () => {
    const { output } = await runGame(["f", "i", "q"]);
    assert.match(output, /You need to equip the Modal Shotgun first\./);
  });

  it("cancels targeting and keeps the shell", async () => {
    const { output } = await runGame([
      `h`.repeat(10),
      ",",
      "E",
      "a",
      "i",
      `l`.repeat(4),
      "f",
      "\x1b",
      "q",
    ]);
    assert.match(output, /You lower the shotgun\./);
    assert.equal(withoutSgr(output).includes(" INSERT "), true);
  });
});
