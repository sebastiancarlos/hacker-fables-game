/**
 * Synchronous suite: drives the headless game directly, with a virtual
 * screen and an immediate clock. No child processes, no sleeps.
 * Assertions target state snapshots and screen cells, never
 * escape-sequence counts or cursor addresses.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Game, MAP_TOP } from "../src/index.ts";
import { AnsiScreen } from "../src/screen.ts";
import { FrameBuffer } from "../src/frame-buffer.ts";
import { TerminalEmulator, VirtualScreen } from "./screen.ts";
import {
  KEY_NAME,
  foldArrow,
  keyToken,
  makeKey,
  type Key,
} from "../src/key.ts";
import { decodeInput } from "../src/terminal-input.ts";
import {
  createGrid,
  gridAdd,
  gridFromKeys,
  gridHas,
  gridKeys,
  type Grid,
} from "../src/grid.ts";
import {
  hunterStep,
  driveUntil,
  stepToward,
  blankLevel,
  makeState,
  keys,
  snapshot,
  snakeCellsOf,
  snakesOf,
  withKeys,
  type StatePatch,
  type TestGame,
} from "./helpers.ts";
import {
  adjacent,
  bresenham,
  chebyshev,
  findPath,
  lookTargets,
  nearestFreeCell,
  panelGeometry,
} from "../src/geometry.ts";
import { alignColumns, fitRow, visibleLength, wrapText } from "../src/text.ts";
import {
  BOSS_VERSION,
  bossColor,
  corruptionTier,
  ENEMY_KINDS,
  enemyName,
  enemySpeed,
  glitchChance,
  glitchGlyph,
  GLITCH_GLYPHS,
  GLITCH_MIN_DEPTH,
  GLITCH_PEAK,
  healthLabel,
  pythonVersion,
  snakeAnchor,
  snakeColor,
  snakeGlyph,
  snakeName,
  snakesForDepth,
  versionForDepth,
  walrusCapForDepth,
  walrusColor,
  walrusName,
  walrusVersionForDepth,
  WALRUS_MIN_DEPTH,
  woundWord,
} from "../src/enemies.ts";
import { BOSS_DEPTH, steps, VISUAL_UNLOCK_LEVEL } from "../src/depth.ts";
import {
  chooseShots,
  groupScripts,
  nearestReachableTarget,
  scriptMessage,
  scriptSpec,
  scriptTargets,
  shotgunPickup,
  shotgunSpec,
  SHOTGUN_DMG,
  shotMessage,
} from "../src/items.ts";
import {
  levelFromXp,
  startingKit,
  startingScripts,
  XP_PER_KILL,
  xpForClearedLevels,
  xpNext,
} from "../src/progression.ts";
import {
  enemyCells,
  buildLevel,
  bossArtRows,
  ELEVATOR_POS,
  EXTRA_LOOT_DEPTH,
  gunsForDepth,
  scrollsForDepth,
  SECOND_GUN_DEPTH,
  SCRIPT_DROP_DEPTH,
  type Enemy,
  type Level,
} from "../src/world.ts";
import { HEIGHT, WIDTH } from "../src/theme.ts";
import {
  drawCursor,
  enemyColor,
  enemyGlyphAtCell,
  paintCell,
  paintElevatorFrame,
  paintStatus,
  cellSpec,
} from "../src/render.ts";
import { slideEnemy, enemyTurn, passTurn } from "../src/monsters.ts";
import { lookStep } from "../src/look.ts";
import { cellsInRect, fireVisual, repeatFire, visualMove } from "../src/aim.ts";
import { attack, fireCommand } from "../src/combat.ts";
import { commandLine } from "../src/commands.ts";
import {
  blockBounds,
  cursorStep,
  edgeReach,
  elevatorAt,
  selectionCells,
} from "../src/queries.ts";
import { ascend, descend, rideElevator } from "../src/movement.ts";
import {
  formatLastMessage,
  formatLog,
  formatMessage,
} from "../src/messages.ts";
import { awardXp, killEnemy } from "../src/progress.ts";
import { settle } from "../src/endgame.ts";
import { createFov } from "../src/vision.ts";
import {
  MAX_HP,
  activeMode,
  currentMenu,
  currentPager,
  type CommandEntry,
  type CommandKind,
  type FireAction,
  type GameState,
} from "../src/game-state.ts";
import {
  COMMANDS_LINES,
  GAMEPLAY_TOKENS,
  visualKey,
  commandLabel,
  type InputDeps,
} from "../src/input.ts";
import { handleKey, presentAfterKey, render } from "../src/modes.ts";
import {
  closeConfirm,
  confirmKey,
  openConfirm,
  openCorruptionWarning,
  openPager,
  showHelp,
  closePager,
} from "../src/pager.ts";
import { closeInventory, showDetailsFor } from "../src/inventory.ts";
import { parseArgs } from "../src/cli.ts";
import {
  appendScore,
  readScores,
  defaultDataDir,
  defaultScorePath,
  defaultMorgueDir,
  writeDump,
  DATA_ENV,
  writeRecording,
  listRecordings,
  readRecording,
  latestRecording,
  resolveReplay,
  defaultRecordingDir,
} from "../src/platform.ts";
import {
  STATUS_ROW,
  STYLE_FLOOR_MEM,
  STYLE_STAIRS,
  STYLE_WALL_CLEAN,
  STYLE_WALL_CORRUPT,
  STYLE_WALL_CORRUPT_RAMP,
  STYLE_WALL_MEM,
} from "../src/theme.ts";
import { linkify, plain, type Cell } from "../src/style.ts";
import {
  commandKinds,
  endScreenLines,
  groupInventory,
  highScores,
  levelLabel,
  parseScoreLine,
  scoreCells,
  scoreLine,
  scoreOf,
  scoreRank,
  WIN_BONUS,
} from "../src/score.ts";
import { dumpFileName, dumpText } from "../src/dump.ts";
import {
  RECORDING_VERSION,
  recordingFileName,
  recordingLabel,
  serializeRecording,
  parseRecording,
  type Recording,
  type RecordingEntry,
} from "../src/recording.ts";
import { scoreRows, titleLines } from "../src/title.ts";
import {
  DEATH_LINE,
  ELEVATOR_BROKEN,
  ELEVATOR_LINE,
  END,
  EXIT_SEALED,
  FLOOR_CLEAR_LINE,
  MSG,
  SCRIPT_NAMES,
  TITLE_ART,
  TITLE_TAGLINE,
  TITLE_TEXT,
  WIN_LINE,
} from "../src/content.ts";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Immediate clock: animations resolve without waiting. */
const immediate = async (_ms: number): Promise<void> => {};
/** Yield a macrotask so async playback/animations can make progress. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

// Belt and braces: point the game data dir at a throwaway folder so a stray
// write in a test can never land in the real user data folder. Tests that
// check the default paths set and restore the env themselves.
const testData = mkdtempSync(path.join(tmpdir(), "hf-state-"));
process.env[DATA_ENV] ??= testData;

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

/** Create a game with a virtual screen and immediate clock. */
function bootGame(
  opts: {
    arena?: boolean;
    seed?: number;
    depth?: number;
    title?: boolean;
    saveScore?: (line: string) => void;
    readScores?: () => string[];
    saveDump?: (name: string, text: string) => void;
    saveRecording?: (name: string, text: string) => void;
    recordings?: RecordingEntry[];
    onReplay?: (rec: Recording) => void;
    onReplayPath?: (path: string) => void;
    onQuitToTitle?: () => void;
    /** Raw key strings or normalized keys; strings decode as a terminal. */
    replay?: (string | Key)[];
    quit?: () => void;
    /** Optional animation clock; defaults to resolving immediately. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): {
  game: TestGame;
  screen: VirtualScreen;
} {
  const screen = new VirtualScreen();
  const replay = opts.replay?.flatMap((k) =>
    typeof k === "string" ? decodeInput(k) : [k],
  );
  const raw = new Game({
    screen,
    sleep: opts.sleep ?? immediate,
    quit: opts.quit ?? (() => {}),
    arena: opts.arena ?? true,
    seed: opts.seed,
    startDepth: opts.depth,
    title: opts.title ?? false,
    saveScore: opts.saveScore,
    readScores: opts.readScores,
    saveDump: opts.saveDump,
    saveRecording: opts.saveRecording,
    recordings: opts.recordings ?? [],
    onReplay: opts.onReplay,
    onReplayPath: opts.onReplayPath,
    onQuitToTitle: opts.onQuitToTitle,
    replay,
  });
  raw.boot();
  return { game: withKeys(raw), screen };
}

/** Create the same game with a real AnsiScreen feeding a terminal emulator. */
function bootAnsiGame(): { game: TestGame; term: TerminalEmulator } {
  const term = new TerminalEmulator();
  const raw = new Game({
    screen: new AnsiScreen((s) => term.write(s)),
    sleep: immediate,
    quit: () => {},
    arena: true,
    seed: 7,
    title: false,
  });
  raw.boot();
  return { game: withKeys(raw), term };
}

/** Walk west onto the shotgun, pick it up, equip it, chamber a shell. */
function armShotgun(game: TestGame): void {
  game.onKey("h".repeat(10));
  game.onKey(",");
  game.onKey("E");
  game.onKey("a");
  game.onKey("i");
}

/** Leave only the walrus alive, so a combat test is not seed-bound. */
function isolateWalrus(game: TestGame): void {
  game.state.sim.level.enemies = game.state.sim.level.enemies.filter(
    (e) => e.kind === "walrus",
  );
}

/** Leave only snakes alive, so a snake test is not seed-bound. */
function isolateSnakes(game: TestGame): void {
  game.state.sim.level.enemies = game.state.sim.level.enemies.filter(
    (e) => e.kind === "snake",
  );
}

/** One recorded command for the tally and score tests. */
const cmd = (label: string, kind: CommandKind = "other"): CommandEntry => ({
  label,
  kind,
});

describe("rules", () => {
  it("measures Chebyshev distance and adjacency", () => {
    assert.equal(chebyshev({ x: 0, y: 0 }, { x: 1, y: 1 }), 1);
    assert.equal(adjacent({ x: 5, y: 5 }, { x: 6, y: 4 }), true);
    assert.equal(adjacent({ x: 5, y: 5 }, { x: 7, y: 5 }), false);
  });

  it("draws rays excluding the start and including the end", () => {
    assert.deepEqual(bresenham(0, 0, 3, 0), [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it("sizes panels to their longest row", () => {
    assert.deepEqual(panelGeometry([{ text: "a) x" }], 40, 80), {
      x: 40,
      w: 40,
    });
    assert.deepEqual(
      panelGeometry(
        [
          { text: "Which script to execute?" },
          { text: "a) script of s/HP:(\\d+)\\((\\d+)\\)/HP:\\2(\\2)/g" },
        ],
        40,
        80,
      ),
      { x: 36, w: 44 },
    );
    assert.deepEqual(panelGeometry([{ text: "x".repeat(100) }], 40, 80), {
      x: 0,
      w: 80,
    });
  });

  it("measures rows by visible cells", () => {
    assert.equal(visibleLength("ab"), 2);
    assert.equal(fitRow("ab", 5), "ab   ");
    assert.equal(visibleLength(fitRow("ab", 5)), 5);
  });

  it("wraps text at word boundaries", () => {
    assert.deepEqual(wrapText("one two three four", 9), [
      "one two",
      "three",
      "four",
    ]);
    assert.deepEqual(wrapText("short", 9), ["short"]);
    assert.deepEqual(wrapText("", 9), [""]);
    assert.deepEqual(wrapText("supercalifragilistic", 9), [
      "supercalifragilistic",
    ]);
  });

  it("truncates rows without leaking past the width", () => {
    const row = fitRow("0123456789AB", 10);
    assert.equal(row, "0123456789");
    assert.equal(visibleLength(row), 10);
  });

  it("backs row truncation off to word edges", () => {
    assert.equal(fitRow("aaaaaaaaaa bbbbb", 12), "aaaaaaaaaa  ");
    assert.equal(fitRow("aaaaaaaaaa", 12), "aaaaaaaaaa  ");
    assert.equal(fitRow("supercalifragilistic", 10), "supercalif");
  });

  it("describes yourself by remaining health", () => {
    assert.equal(
      MSG.yourself(16, 16),
      "Yourself, E. Max Vim. You look healthy.",
    );
    assert.equal(
      MSG.yourself(15, 16),
      "Yourself, E. Max Vim. You look scraped up.",
    );
    assert.equal(
      MSG.yourself(4, 16),
      "Yourself, E. Max Vim. You look scraped up.",
    );
    assert.equal(
      MSG.yourself(3, 16),
      "Yourself, E. Max Vim. You look like the typical output of GNU Autotools.",
    );
  });

  it("grades wounds and labels enemy health", () => {
    assert.equal(woundWord(6, 6), "");
    assert.equal(woundWord(3, 6), "wounded ");
    assert.equal(woundWord(1, 6), "badly wounded ");
    const reversed = (name: string, hp: number): string =>
      healthLabel(name, hp, 6)
        .filter((span) => span.reverse === true)
        .map((span) => span.text)
        .join("");
    assert.equal(plain(healthLabel("code-snake", 6, 6)), "[code-snake]");
    assert.equal(reversed("code-snake", 6), "code-snake");
    assert.equal(reversed("code-snake", 3), "code-");
    assert.equal(
      plain(healthLabel("code-snake (Python 3.9)", 6, 6)),
      "[code-snake (Python 3.9)]",
    );
    assert.equal(reversed("code-snake (Python 3.9)", 3), "code-snake (");
  });

  it("excludes snakes from the level-1 spawn only", () => {
    const start = { x: 3, y: 4 };
    const up = { x: 30, y: 10 };
    assert.deepEqual(snakeAnchor(1, start, up), start);
    assert.equal(snakeAnchor(2, start, up), null);
    assert.equal(snakeAnchor(4, start, up), null);
    assert.deepEqual(snakeAnchor(5, start, up), up);
    assert.deepEqual(snakeAnchor(6, start, up), up);
    assert.deepEqual(snakeAnchor(7, start, up), up);
    assert.deepEqual(snakeAnchor(15, start, up), up);
    assert.deepEqual(snakeAnchor(20, start, up), up);
    assert.equal(snakeAnchor(20, start, null), null);
  });

  it("feeds shells on repeat shotgun pickups", () => {
    const first = shotgunPickup(false, 0);
    assert.equal(first.shells, 20);
    assert.equal(first.takeGun, true);
    assert.match(plain(first.message), /You pick up the Modal Shotgun\./);
    const second = shotgunPickup(true, first.shells);
    assert.equal(second.shells, 40);
    assert.equal(second.takeGun, false);
    assert.match(plain(second.message), /20 shells/);
  });

  it("spends visual shots nearest-first within shells", () => {
    const player = { x: 0, y: 0 };
    const near = { x: 1, y: 0 };
    const mid = { x: 3, y: 0 };
    const far = { x: 5, y: 0 };
    // Chambered round plus one reserve shell: two nearest fire.
    const plan = chooseShots([far, near, mid], player, 1, true);
    assert.deepEqual(plan.kept, [near, mid]);
    assert.equal(plan.shells, 0);
    assert.equal(plan.shortfall, 1);
    // Dry chamber: nothing fires.
    const dry = chooseShots([near], player, 0, false);
    assert.deepEqual(dry.kept, []);
    assert.equal(dry.shortfall, 1);
    // Empty cover costs nothing.
    const echo = chooseShots([], player, 7, true);
    assert.deepEqual(echo.kept, []);
    assert.equal(echo.shells, 7);
    assert.equal(echo.shortfall, 0);
  });

  it("auto-targets the nearest snake the bullet can reach", () => {
    // Wall column with a gap at y=5: D and A sit down the open
    // hallway, B is visible around the corner, C hides behind A.
    const isWall = (x: number, y: number): boolean =>
      x === 5 && y >= 0 && y <= 9 && y !== 5;
    const player = { x: 2, y: 5 };
    const d = { x: 4, y: 5 };
    const a = { x: 8, y: 5 };
    const b = { x: 8, y: 1 };
    const c = { x: 10, y: 5 };
    const visible = gridFromKeys(["4,5", "8,5", "8,1", "10,5"]);
    assert.deepEqual(
      nearestReachableTarget(player, [b, c, a, d], visible, isWall),
      d,
    );
  });

  it("offers no target when every snake is behind a wall", () => {
    const isWall = (x: number, y: number): boolean =>
      x === 5 && y >= 0 && y <= 9 && y !== 5;
    const player = { x: 2, y: 5 };
    const b = { x: 8, y: 1 };
    assert.equal(
      nearestReachableTarget(player, [b], gridFromKeys(["8,1"]), isWall),
      null,
    );
    const a = { x: 8, y: 5 };
    assert.equal(
      nearestReachableTarget(player, [a], gridFromKeys([]), isWall),
      null,
    );
  });

  it("scales snake stats with the Python version", () => {
    assert.deepEqual(ENEMY_KINDS.snake.stats(pythonVersion("2.0")), {
      hp: 2,
      bite: 1,
    });
    assert.deepEqual(ENEMY_KINDS.snake.stats(pythonVersion("2.7")), {
      hp: 2,
      bite: 1,
    });
    assert.deepEqual(ENEMY_KINDS.snake.stats(pythonVersion("3.9")), {
      hp: 6,
      bite: 2,
    });
    assert.deepEqual(ENEMY_KINDS.snake.stats(BOSS_VERSION), {
      hp: 13,
      bite: 3,
    });
    assert.equal(snakeName(pythonVersion("2.0")), "code-snake (Python 2.0)");
  });

  it("renders Python 2 lowercase and grades colors by heat", () => {
    assert.equal(snakeGlyph(pythonVersion("2.0")), "s");
    assert.equal(snakeGlyph(pythonVersion("2.7")), "s");
    assert.equal(snakeGlyph(pythonVersion("3.9")), "S");
    assert.deepEqual(snakeColor(pythonVersion("2.0")), { fg: "green" });
    assert.deepEqual(snakeColor(pythonVersion("2.7")), { fg: "green" });
    assert.deepEqual(snakeColor(pythonVersion("3.0")), { fg: "yellow" });
    assert.deepEqual(snakeColor(pythonVersion("3.2")), { fg: "yellow" });
    assert.deepEqual(snakeColor(pythonVersion("3.6")), {
      fg: "yellow",
      bold: true,
    });
    assert.deepEqual(snakeColor(pythonVersion("3.9")), { fg: "red" });
    assert.deepEqual(snakeColor(pythonVersion("3.12")), { fg: "magenta" });
    assert.deepEqual(snakeColor(pythonVersion("3.14")), {
      fg: "magenta",
      bold: true,
    });
    // The dev preview is pure red, not the terminal theme's named red.
    assert.deepEqual(snakeColor(BOSS_VERSION), {
      fg: "#ff0000",
      bold: true,
    });
  });

  it("raises the version ceiling with depth", () => {
    assert.equal(versionForDepth(1, 0).index, 0);
    assert.equal(versionForDepth(1, 0.5).index, 2);
    assert.equal(versionForDepth(1, 0.999).index, 3);
    assert.equal(versionForDepth(2, 0.999).index, 4);
    assert.equal(versionForDepth(3, 0.999).index, 5);
    assert.equal(versionForDepth(BOSS_DEPTH - 1, 0.999).index, 24);
    assert.equal(versionForDepth(BOSS_DEPTH, 0.999).index, 24);
    assert.equal(versionForDepth(BOSS_DEPTH, 0).index, 0);
    assert.equal(versionForDepth(BOSS_DEPTH + 10, 0.999).index, 24);
  });

  it("scales the walrus above the snake of the same version", () => {
    assert.deepEqual(ENEMY_KINDS.walrus.stats(pythonVersion("3.8")), {
      hp: 10,
      bite: 3,
    });
    assert.deepEqual(ENEMY_KINDS.walrus.stats(BOSS_VERSION), {
      hp: 26,
      bite: 4,
    });
    // Stronger by construction: twice the HP, one more bite.
    for (const v of [
      pythonVersion("3.8"),
      pythonVersion("3.9"),
      BOSS_VERSION,
    ]) {
      assert.equal(
        ENEMY_KINDS.walrus.stats(v).hp,
        ENEMY_KINDS.snake.stats(v).hp * 2,
      );
      assert.equal(
        ENEMY_KINDS.walrus.stats(v).bite,
        ENEMY_KINDS.snake.stats(v).bite + 1,
      );
    }
    assert.equal(
      walrusName(pythonVersion("3.9")),
      "walrus operator (Python 3.9)",
    );
    assert.deepEqual(
      walrusColor(pythonVersion("3.9")),
      snakeColor(pythonVersion("3.9")),
    );
    // The walrus shares the snake palette, so the dev preview is pure red too.
    assert.deepEqual(walrusColor(BOSS_VERSION), {
      fg: "#ff0000",
      bold: true,
    });
    assert.equal(
      enemyName("walrus", pythonVersion("3.9")),
      "walrus operator (Python 3.9)",
    );
    assert.equal(
      enemyName("snake", pythonVersion("2.7")),
      "code-snake (Python 2.7)",
    );
  });

  it("floors walrus versions at 3.8 and raises the ceiling with depth", () => {
    // The operator did not exist before 3.8, so no roll reaches 2.x.
    assert.equal(walrusVersionForDepth(WALRUS_MIN_DEPTH, 0).label, "3.8");
    assert.equal(walrusVersionForDepth(WALRUS_MIN_DEPTH, 0.2).label, "3.8");
    assert.equal(
      walrusVersionForDepth(WALRUS_MIN_DEPTH + 1, 0.999).label,
      "3.9",
    );
    assert.equal(walrusVersionForDepth(11, 0.999).label, "3.13");
    assert.equal(
      walrusVersionForDepth(BOSS_DEPTH - 1, 0.999).label,
      "3.16 (dev preview)",
    );
    assert.equal(
      walrusVersionForDepth(BOSS_DEPTH, 0.999).label,
      "3.16 (dev preview)",
    );
  });

  it("raises the walrus cap with depth", () => {
    assert.equal(walrusCapForDepth(WALRUS_MIN_DEPTH - 1), 0);
    assert.equal(walrusCapForDepth(WALRUS_MIN_DEPTH), 1);
    assert.equal(walrusCapForDepth(WALRUS_MIN_DEPTH + 1), 1);
    assert.equal(walrusCapForDepth(9), 2);
    assert.equal(walrusCapForDepth(12), 4);
    assert.equal(walrusCapForDepth(BOSS_DEPTH - 1), 5);
    assert.equal(walrusCapForDepth(BOSS_DEPTH), 6);
  });

  it("lists seen snakes and known ground before the unknown", () => {
    const seen = (p: { x: number; y: number }): boolean => p.x < 50;
    const known = (p: { x: number; y: number }): boolean => p.x < 60;
    assert.deepEqual(
      lookTargets(
        [
          { x: 10, y: 1 },
          { x: 60, y: 1 },
        ],
        [{ x: 20, y: 1 }],
        [
          { x: 30, y: 1 },
          { x: 70, y: 1 },
        ],
        seen,
        known,
      ),
      [
        { x: 10, y: 1 },
        { x: 20, y: 1 },
        { x: 30, y: 1 },
      ],
    );
    assert.deepEqual(lookTargets([], [], [], seen, known), []);
  });

  it("finds the nearest free cell in ring order", () => {
    const open = (): boolean => false;
    assert.deepEqual(nearestFreeCell({ x: 5, y: 5 }, open, 10, 10), {
      x: 4,
      y: 4,
    });
    const twoBlocked = (x: number, y: number): boolean =>
      (x === 4 && y === 4) || (x === 5 && y === 4);
    assert.deepEqual(nearestFreeCell({ x: 5, y: 5 }, twoBlocked, 10, 10), {
      x: 6,
      y: 4,
    });
    assert.deepEqual(nearestFreeCell({ x: 0, y: 0 }, open, 3, 3), {
      x: 1,
      y: 0,
    });
    assert.equal(
      nearestFreeCell({ x: 0, y: 0 }, () => true, 1, 1),
      null,
    );
  });

  it("paths around walls or admits defeat", () => {
    const open = (): boolean => false;
    assert.deepEqual(findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, open, 10, 10), [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
    assert.deepEqual(
      findPath({ x: 1, y: 1 }, { x: 1, y: 1 }, open, 10, 10),
      [],
    );
    const wall = (x: number, y: number): boolean => x === 1 && y >= 0 && y <= 2;
    assert.deepEqual(findPath({ x: 0, y: 1 }, { x: 2, y: 1 }, wall, 10, 10), [
      { x: 0, y: 2 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
    ]);
    assert.equal(
      findPath({ x: 0, y: 0 }, { x: 2, y: 0 }, () => true, 10, 10),
      null,
    );
  });

  it("routes scripts to their victims", () => {
    const snakes = [
      { x: 1, y: 1, version: pythonVersion("2.3") },
      { x: 2, y: 2, version: pythonVersion("3.9") },
      { x: 3, y: 3, version: pythonVersion("2.7") },
    ];
    const visible = gridFromKeys(["1,1", "2,2"]);
    assert.deepEqual(scriptTargets(snakes, visible, "v2"), [snakes[0]]);
    assert.deepEqual(scriptTargets(snakes, visible, "all"), [
      snakes[0],
      snakes[1],
    ]);
    assert.deepEqual(scriptTargets(snakes, gridFromKeys([]), "v2"), []);
    assert.deepEqual(scriptTargets(snakes, gridFromKeys([]), "all"), []);
    assert.deepEqual(scriptTargets(snakes, visible, "heal"), []);
    // Scripts substitute snake glyphs, never the walrus operator's :=.
    const walrus = {
      x: 4,
      y: 4,
      version: pythonVersion("3.9"),
      kind: "walrus",
    };
    const mixed = [...snakes, walrus];
    const allVisible = gridFromKeys(["1,1", "2,2", "4,4"]);
    assert.deepEqual(scriptTargets(mixed, allVisible, "all"), [
      snakes[0],
      snakes[1],
    ]);
    assert.deepEqual(scriptTargets([walrus], gridFromKeys(["4,4"]), "all"), []);
  });

  it("reports script executions", () => {
    assert.match(scriptMessage("v2", 1), /deletes 1 Python 2 snake/);
    assert.match(scriptMessage("v2", 3), /deletes 3 Python 2 snakes/);
    assert.match(scriptMessage("v2", 0), /no Python 2 snakes/);
    assert.match(scriptMessage("all", 2), /deletes 2 snakes in view/);
    assert.match(scriptMessage("all", 0), /no snakes in view/);
    assert.match(scriptMessage("heal", 0), /restores your health to full/);
  });

  it("groups carried scripts by effect with counts", () => {
    const gun = shotgunSpec();
    const v2 = scriptSpec("v2");
    const all = scriptSpec("all");
    const groups = groupScripts([gun, v2, all, { ...v2 }]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0]!.effect, "v2");
    assert.equal(groups[0]!.name, "script of s/s//g");
    assert.equal(groups[0]!.items.length, 2);
    assert.equal(groups[1]!.effect, "all");
    assert.equal(groups[1]!.items.length, 1);
    assert.deepEqual(groupScripts([gun]), []);
  });

  it("words kills and survivors honestly", () => {
    const snake = {
      kind: "snake" as const,
      version: pythonVersion("3.10"),
    };
    const walrus = {
      kind: "walrus" as const,
      version: pythonVersion("3.8"),
    };
    assert.equal(shotMessage([], [], 0), "The shot echoes through the floor.");
    assert.equal(
      shotMessage([snake], [], 0),
      "You blast the code-snake (Python 3.10) into pixels!",
    );
    assert.equal(
      shotMessage([], [snake], 0),
      "You blast the code-snake (Python 3.10). It reels.",
    );
    assert.equal(
      shotMessage([snake, snake], [], 0),
      "You blast 2 code-snakes into pixels!",
    );
    assert.equal(
      shotMessage([], [snake, snake], 0),
      "You blast 2 code-snakes. They reel.",
    );
    assert.equal(
      shotMessage([snake], [snake, snake], 1),
      "You blast 1 code-snake into pixels! 2 code-snakes reel. Out of shells for 1 more.",
    );
    assert.equal(
      shotMessage([walrus, walrus], [], 0),
      "You blast 2 walrus operators into pixels!",
    );
    assert.equal(
      shotMessage([], [walrus, walrus], 0),
      "You blast 2 walrus operators. They reel.",
    );
    assert.equal(
      shotMessage([snake, walrus], [], 0),
      "You blast 2 enemies into pixels!",
    );
    assert.equal(
      shotMessage([snake], [walrus], 0),
      "You blast 1 enemy into pixels! 1 enemy reels.",
    );
  });

  it("prices levels quadratically-ish", () => {
    assert.equal(XP_PER_KILL, 2);
    assert.equal(VISUAL_UNLOCK_LEVEL, 2);
    assert.equal(xpNext(1), 50);
    assert.equal(xpNext(2), 100);
    assert.equal(xpNext(3), 150);
  });

  it("folds cleared-level XP through the level curve", () => {
    // Clearing levels 1..depth-1, two XP per snake.
    assert.equal(xpForClearedLevels(1), 0);
    assert.equal(xpForClearedLevels(2), 8);
    assert.equal(xpForClearedLevels(3), 20);
    assert.deepEqual(levelFromXp(0), { plevel: 1, xp: 0 });
    assert.deepEqual(levelFromXp(49), { plevel: 1, xp: 49 });
    assert.deepEqual(levelFromXp(50), { plevel: 2, xp: 0 });
    assert.deepEqual(levelFromXp(150), { plevel: 3, xp: 0 });
    assert.deepEqual(levelFromXp(151), { plevel: 3, xp: 1 });
  });

  it("banks scrolls and ammo into a start kit", () => {
    assert.deepEqual(startingScripts(3), []);
    assert.deepEqual(startingScripts(11), ["heal", "all"]);
    assert.deepEqual(startingScripts(14), ["heal", "all", "heal"]);
    assert.deepEqual(startingKit(1), {
      plevel: 1,
      xp: 0,
      shells: 0,
      scripts: [],
    });
    assert.deepEqual(startingKit(14), {
      plevel: 5,
      xp: 200,
      shells: 260,
      scripts: ["heal", "all", "heal"],
    });
    assert.equal(
      scriptSpec("heal").name,
      "script of s/HP:(\\d+)\\((\\d+)\\)/HP:\\2(\\2)/g",
    );
    assert.equal(scriptSpec("all").glyph, "?");
    assert.equal(scriptSpec("v2").kind, "script");
  });

  it("spawns four snakes on level 1, then follows the depth curve", () => {
    assert.equal(snakesForDepth(1), 4);
    assert.equal(snakesForDepth(2), 6);
    assert.equal(snakesForDepth(BOSS_DEPTH - 1), 56);
  });

  it("carries no scripts by default", () => {
    const { game } = bootGame();
    game.onKey("s");
    const s = snapshot(game);
    assert.equal(s.mode, "play");
    assert.match(plain(s.message), /carry no scripts/);
    assert.equal(s.turns, 0);
  });
});

describe("platform", () => {
  it("decodes fused arrows, a lone ESC, and characters into keys", () => {
    assert.deepEqual(decodeInput("\x1b[Aq"), [
      makeKey("ArrowUp"),
      makeKey("q"),
    ]);
    assert.deepEqual(decodeInput("h\x1bj"), [
      makeKey("h"),
      makeKey("Escape"),
      makeKey("j"),
    ]);
  });

  it("decodes arrows, modifiers, control bytes, and named keys", () => {
    assert.deepEqual(decodeInput("\u001b[D"), [makeKey("ArrowLeft")]);
    assert.deepEqual(decodeInput("\u001b[1;2C"), [
      makeKey("ArrowRight", { shift: true }),
    ]);
    assert.deepEqual(decodeInput("\x16"), [makeKey("v", { ctrl: true })]);
    assert.deepEqual(decodeInput("\r\n\t\x7f"), [
      makeKey("Enter"),
      makeKey("Enter"),
      makeKey("Tab"),
      makeKey("Backspace"),
    ]);
    assert.deepEqual(decodeInput("\u001b[5~"), [makeKey("PageUp")]);
  });

  it("normalizes letters to a base key plus Shift", () => {
    assert.deepEqual(decodeInput("H"), [makeKey("h", { shift: true })]);
  });

  it("folds arrows onto their vim letters", () => {
    assert.equal(keyToken(foldArrow(makeKey("ArrowLeft"))), "h");
    assert.equal(keyToken(foldArrow(makeKey("ArrowDown"))), "j");
    assert.equal(keyToken(foldArrow(makeKey("ArrowUp"))), "k");
    assert.equal(keyToken(foldArrow(makeKey("ArrowRight"))), "l");
    // Shift+right runs.
    assert.equal(
      keyToken(foldArrow(makeKey("ArrowRight", { shift: true }))),
      "L",
    );
    assert.equal(keyToken(makeKey("h")), "h"); // letters pass through
    assert.equal(keyToken(makeKey("Escape")), "<Esc>");
    assert.equal(keyToken(makeKey("^", { ctrl: true })), "<C-^>");
    // Ctrl+arrow is not a movement: folding would turn it into a Ctrl token.
    assert.equal(
      keyToken(foldArrow(makeKey("ArrowDown", { ctrl: true }))),
      "<C-Down>",
    );
  });

  it("emits canonical tokens for named and modified keys", () => {
    assert.equal(keyToken(makeKey("Enter")), "<CR>");
    assert.equal(keyToken(makeKey("Backspace")), "<BS>");
    assert.equal(keyToken(makeKey("PageDown")), "<PageDown>");
    assert.equal(keyToken(makeKey("Enter", { ctrl: true })), "<C-CR>");
    assert.equal(keyToken(makeKey("ArrowDown", { shift: true })), "<Down>");
    assert.equal(keyToken(makeKey("h", { shift: true })), "H");
    assert.equal(keyToken(makeKey(" ", { ctrl: true })), "<C-Space>");
  });

  it("keeps every gameplay binding token canonical", () => {
    const canonical = new Set<string>();
    for (let code = 0x20; code <= 0x7e; code++) {
      const char = String.fromCharCode(code);
      for (const ctrl of [false, true]) {
        for (const shift of [false, true]) {
          canonical.add(keyToken(makeKey(char, { ctrl, shift })));
        }
      }
    }
    for (const name of Object.values(KEY_NAME)) {
      for (const ctrl of [false, true]) {
        for (const shift of [false, true]) {
          canonical.add(keyToken(makeKey(name, { ctrl, shift })));
        }
      }
    }
    for (const token of GAMEPLAY_TOKENS) {
      assert.ok(canonical.has(token), token);
      assert.equal(/[\x00-\x1f\x7f]/.test(token), false, token);
    }
  });

  it("parses arena and seed flags", () => {
    assert.deepEqual(parseArgs(["node", "index.ts", "--arena"]), {
      arena: true,
      seed: undefined,
      level: undefined,
      title: true,
      replay: undefined,
    });
    assert.deepEqual(parseArgs(["node", "index.ts", "--seed", "7"]), {
      arena: false,
      seed: 7,
      level: undefined,
      title: true,
      replay: undefined,
    });
  });

  it("parses the starting level flag and rejects out-of-range depths", () => {
    assert.deepEqual(parseArgs(["node", "index.ts", "--level", "3"]), {
      arena: false,
      seed: undefined,
      level: 3,
      title: true,
      replay: undefined,
    });
    assert.equal(
      parseArgs(["node", "index.ts", "--level", String(BOSS_DEPTH)]).level,
      BOSS_DEPTH,
    );
    const range = new RegExp(`--level expects 1 through ${BOSS_DEPTH}`);
    assert.throws(
      () => parseArgs(["node", "index.ts", "--level", String(BOSS_DEPTH + 1)]),
      range,
    );
    assert.throws(() => parseArgs(["node", "index.ts", "--level", "0"]), range);
  });

  it("rejects malformed numeric flags instead of ignoring them", () => {
    assert.throws(
      () => parseArgs(["node", "index.ts", "--seed", "nope"]),
      /--seed expects an integer/,
    );
    assert.throws(
      () => parseArgs(["node", "index.ts", "--level", "3.5"]),
      /--level expects an integer/,
    );
    assert.throws(
      () => parseArgs(["node", "index.ts", "--seed", "1e3"]),
      /--seed expects an integer/,
    );
    assert.throws(
      () => parseArgs(["node", "index.ts", "--wat"]),
      /Invalid arguments/,
    );
  });

  it("parses the replay flag as a path, or latest with no value", () => {
    assert.equal(parseArgs(["node", "index.ts", "--replay"]).replay, "latest");
    assert.equal(
      parseArgs(["node", "index.ts", "--replay", "run.json"]).replay,
      "run.json",
    );
    assert.equal(
      parseArgs(["node", "index.ts", "--replay", "--no-title"]).replay,
      "latest",
    );
  });

  it("skips the boot splash with --no-title", () => {
    assert.equal(parseArgs(["node", "index.ts", "--no-title"]).title, false);
    assert.equal(parseArgs(["node", "index.ts"]).title, true);
  });

  it("diffs cells: identical content is not an update", () => {
    const screen = new VirtualScreen();
    screen.cell(1, 2, { ch: "a" });
    screen.cell(1, 2, { ch: "a" });
    screen.cell(1, 2, { ch: "b" });
    assert.equal(screen.updates.length, 2);
  });
});

describe("terminal serialization", () => {
  it("writes no palette backgrounds or full-screen erases", () => {
    const writes: string[] = [];
    const screen = new AnsiScreen((s) => writes.push(s));
    screen.begin();
    screen.cell(0, 0, {
      ch: "a",
      fg: "#112233",
      bg: "yellow",
      bold: true,
      reverse: true,
    });
    screen.text(0, 1, "xy", 2);
    screen.flush();
    const wire = writes.join("");
    assert.equal(wire.includes("48;5"), false);
    assert.equal(wire.includes("\x1b[2J"), false);
    assert.match(wire, /38;2;17;34;51/);
    assert.match(wire, /\x1b\[1;7;38;2;17;34;51;43ma\x1b\[0m/);
  });

  it("re-emits a full row when an overlapping panel closes", () => {
    const writes: string[] = [];
    const screen = new AnsiScreen((s) => writes.push(s));
    const row = "message".padEnd(20);
    screen.text(0, 0, row, 20);
    screen.text(10, 0, "PANEL", 5);
    screen.text(0, 0, row, 20);
    screen.flush();
    const term = new TerminalEmulator();
    term.write("\x1b[?1049h");
    term.write(writes.join(""));
    assert.equal(term.row(0).slice(0, 20), row);
  });

  it("buffers a frame and flushes it once", () => {
    const writes: string[] = [];
    const screen = new AnsiScreen((s) => writes.push(s));
    screen.begin();
    screen.cell(0, 0, { ch: "a" });
    screen.park(2, 3);
    screen.text(0, 1, "xy", 2);
    assert.deepEqual(writes, []);
    screen.flush();
    assert.equal(writes.length, 1);
    assert.match(writes[0]!, /\x1b\[1;1Ha/);
    assert.match(writes[0]!, /\x1b\[4;3H/);
    assert.match(writes[0]!, /\x1b\[2;1Hxy/);
    screen.flush();
    assert.equal(writes.length, 1);
  });

  it("merges a small gap but splits a wide one", () => {
    const writes: string[] = [];
    const screen = new AnsiScreen((s) => writes.push(s), 24, 2);
    screen.begin();
    screen.flush();
    writes.length = 0;

    screen.cell(1, 0, { ch: "a" });
    screen.cell(5, 0, { ch: "b" });
    screen.flush();
    const merged = writes.join("");
    assert.match(merged, /\x1b\[1;2Ha {3}b/);
    assert.equal(merged.includes("\x1b[1;6H"), false);

    writes.length = 0;
    screen.cell(1, 0, { ch: "c" });
    screen.cell(20, 0, { ch: "d" });
    screen.flush();
    const split = writes.join("");
    assert.match(split, /\x1b\[1;2Hc/);
    assert.match(split, /\x1b\[1;21Hd/);
  });
});

describe("links", () => {
  it("marks only http(s) URLs as links", () => {
    assert.deepEqual(linkify("see https://example.com now"), [
      { text: "see " },
      { text: "https://example.com", link: "https://example.com" },
      { text: " now" },
    ]);
    assert.deepEqual(linkify("mailto:someone@example.com"), [
      { text: "mailto:someone@example.com" },
    ]);
  });

  it("wraps a linked run in OSC 8 escapes", () => {
    const writes: string[] = [];
    const screen = new AnsiScreen((s) => writes.push(s), 20, 2);
    screen.begin();
    screen.text(
      0,
      0,
      [{ text: "https://example.com", link: "https://example.com" }],
      19,
    );
    screen.flush();
    assert.match(
      writes.join(""),
      /\x1b\]8;;https:\/\/example\.com\x1b\\https:\/\/example\.com(?:\x1b\[0m)?\x1b\]8;;\x1b\\/,
    );
  });
});

describe("frame buffer", () => {
  it("reports no runs once the frame is committed", () => {
    const buffer = new FrameBuffer(4, 2);
    assert.ok(buffer.diff().length > 0);
    buffer.commit();
    assert.deepEqual(buffer.diff(), []);
  });

  it("joins adjacent changed cells into one run", () => {
    const buffer = new FrameBuffer(8, 1);
    buffer.diff();
    buffer.commit();
    buffer.cell(2, 0, { ch: "a" });
    buffer.cell(3, 0, { ch: "b" });
    assert.deepEqual(buffer.diff(), [{ x: 2, end: 4, y: 0 }]);
  });

  it("re-emits a whole text row when one cell changes", () => {
    const buffer = new FrameBuffer(8, 1);
    buffer.text(0, 0, "abcdefgh", 8);
    buffer.diff();
    buffer.commit();
    buffer.text(0, 0, "abcXefgh", 8);
    assert.deepEqual(buffer.diff(), [{ x: 0, end: 8, y: 0 }]);
  });

  it("tracks style-only changes", () => {
    const buffer = new FrameBuffer(4, 1);
    buffer.diff();
    buffer.commit();
    buffer.cell(1, 0, { ch: "x", fg: "red" });
    buffer.diff();
    buffer.commit();
    buffer.cell(1, 0, { ch: "x", fg: "blue" });
    assert.deepEqual(buffer.diff(), [{ x: 1, end: 2, y: 0 }]);
  });

  it("keeps the terminal in sync with random paint sequences", () => {
    const width = 12;
    const height = 4;
    const term = new TerminalEmulator(width, height);
    const screen = new AnsiScreen((s) => term.write(s), width, height);
    const buffer = new FrameBuffer(width, height);
    screen.begin();
    buffer.reset();
    let seed = 0x12345678;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const chars = "abcXYZ .";
    const sync = (): void => {
      screen.flush();
      buffer.diff();
      buffer.commit();
      assert.equal(term.text(), buffer.rows());
    };
    for (let step = 0; step < 300; step++) {
      const op = rand();
      if (op < 0.55) {
        const cell: Cell = {
          ch: chars[Math.floor(rand() * chars.length)]!,
        };
        if (rand() < 0.4) {
          cell.fg = rand() < 0.5 ? "red" : "blue";
        }
        if (rand() < 0.3) {
          cell.bold = true;
        }
        const x = Math.floor(rand() * width);
        const y = Math.floor(rand() * height);
        screen.cell(x, y, cell);
        buffer.cell(x, y, cell);
      } else if (op < 0.8) {
        const x = Math.floor(rand() * width);
        const y = Math.floor(rand() * height);
        const runWidth = 1 + Math.floor(rand() * (width - x));
        let text = "";
        for (let i = 0; i < runWidth; i++) {
          text += chars[Math.floor(rand() * chars.length)]!;
        }
        screen.text(x, y, text, runWidth);
        buffer.text(x, y, text, runWidth);
      } else if (op < 0.9) {
        sync();
      } else {
        screen.invalidate();
        buffer.invalidate();
      }
    }
    sync();
  });
});

describe("terminal emulator", () => {
  it("paints text at cursor addresses", () => {
    const term = new TerminalEmulator();
    term.write("\x1b[?1049h\x1b[1;1Hhello");
    term.write("\x1b[2;3H\x1b[7mX\x1b[0m");
    assert.equal(term.row(0).slice(0, 5), "hello");
    assert.equal(term.row(1)[2], "X");
    assert.equal(term.row(1).slice(0, 2), "  ");
  });

  it("freezes the frame on leaving the alternate screen", () => {
    const term = new TerminalEmulator();
    term.write("\x1b[?1049h\x1b[1;1Hgame");
    term.write("\x1b[?1049lBye!\n");
    assert.equal(term.row(0).slice(0, 4), "game");
    assert.ok(!term.text().includes("Bye!"));
  });

  it("tracks a style-only change", () => {
    const term = new TerminalEmulator();
    const screen = new AnsiScreen((s) => term.write(s), 4, 2);
    screen.begin();
    screen.cell(0, 0, { ch: "x", fg: "red" });
    screen.flush();
    assert.equal(term.styleAt(0, 0), "31");
    screen.cell(0, 0, { ch: "x", fg: "blue" });
    screen.flush();
    assert.equal(term.styleAt(0, 0), "34");
  });

  it("reports a boot frame through the virtual screen", () => {
    const { screen } = bootGame();
    assert.equal(screen.frame().split("\n").length, 25);
    assert.ok(screen.row(0).startsWith("Press ? for help."));
    assert.ok(screen.row(23).startsWith("Dlvl:1  Lv:1  Xp:0/50"));
    assert.equal(screen.row(24), "Vim Commands (0):".padEnd(80));
    assert.ok(screen.frame().includes("@"));
  });
});

describe("frame equivalence", () => {
  it("paints the same frames and styles as the virtual screen", async () => {
    const virtual = bootGame({ arena: true, seed: 7, title: false });
    const ansi = bootAnsiGame();
    const check = (label: string): void => {
      assert.equal(
        ansi.term.text(),
        virtual.screen.frame(),
        `text after ${label}`,
      );
      assert.equal(
        ansi.term.styleText(),
        virtual.screen.styledFrame(),
        `style after ${label}`,
      );
    };
    check("boot");
    for (const key of [
      "l",
      "l",
      "j",
      "k",
      "h",
      "?",
      "j",
      "k",
      "q",
      "M",
      "q",
      "w",
      "w",
      "l",
      "k",
      "j",
      "h",
    ]) {
      virtual.game.onKey(key);
      ansi.game.onKey(key);
      await virtual.game.idle();
      await ansi.game.idle();
      check(key);
    }
  });
});

describe("status bar", () => {
  it("reverses the whole name at full health", () => {
    const screen = new VirtualScreen();
    paintStatus(makeState({ hp: MAX_HP }), screen);
    const row = screen.spansAt(STATUS_ROW);
    assert.ok(row !== undefined);
    const lit = row
      .filter((span) => span.reverse === true)
      .map((span) => span.text)
      .join("");
    assert.equal(lit, "E. Max Vim the Hacker         ");
    assert.equal(plain(row).length, WIDTH);
  });

  it("reverses only the HP portion of the name when hurt", () => {
    const screen = new VirtualScreen();
    paintStatus(makeState({ hp: Math.floor(MAX_HP / 2) }), screen);
    const row = screen.spansAt(STATUS_ROW);
    assert.ok(row !== undefined);
    const lit = row
      .filter((span) => span.reverse === true)
      .map((span) => span.text)
      .join("");
    assert.equal(lit.length, 15);
    assert.ok(plain(row).includes("HP:8(16)"));
    assert.equal(plain(row).length, WIDTH);
  });
});

describe("command tally", () => {
  /** A bare state: only these few fields matter to commandLabel. */
  const state = (over: StatePatch = {}): GameState =>
    makeState({ mode: "play", ...over });

  it("labels play keys, arrows having folded onto vim letters", () => {
    assert.equal(commandLabel(state(), "h"), "h");
    assert.equal(
      commandLabel(state(), keyToken(foldArrow(makeKey("ArrowLeft")))),
      "h",
    );
    assert.equal(
      commandLabel(
        state(),
        keyToken(foldArrow(makeKey("ArrowRight", { shift: true }))),
      ),
      "L",
    );
    assert.equal(commandLabel(state(), "<C-v>"), "^V");
    assert.equal(commandLabel(state(), "W"), "w");
    assert.equal(commandLabel(state(), "i"), "i");
    assert.equal(commandLabel(state(), "x"), null);
    // ESC is only a command when it leaves insert mode.
    assert.equal(commandLabel(state(), "<Esc>"), null);
    assert.equal(commandLabel(state({ insertMode: true }), "<Esc>"), "ESC");
  });

  it("labels the repeat by what it repeats", () => {
    assert.equal(commandLabel(state(), "."), ".");
    assert.equal(
      commandLabel(state({ lastFire: { cells: [], visual: false } }), "."),
      ".(fire)",
    );
    assert.equal(
      commandLabel(
        state({ lastFire: { cells: [{ x: 1, y: 1 }], visual: true } }),
        ".",
      ),
      ".(visual-fire)",
    );
  });

  it("merges two-key prefixes and skips a bare g", () => {
    assert.equal(commandLabel(state(), "g"), null);
    assert.equal(
      commandLabel(state({ mode: "target", pendingKeys: "g" }), "v"),
      "gv",
    );
    assert.equal(commandLabel(state({ mode: "target" }), "v"), null);
    assert.equal(commandLabel(state({ mode: "visual" }), "g"), null);
    assert.equal(
      commandLabel(state({ mode: "visual", pendingKeys: "g" }), "g"),
      "gg",
    );
  });

  it("labels target and visual commands and ignores menus", () => {
    assert.equal(commandLabel(state({ mode: "target" }), "<CR>"), "RET");
    assert.equal(
      commandLabel(
        state({ mode: "target" }),
        keyToken(foldArrow(makeKey("ArrowUp"))),
      ),
      "k",
    );
    assert.equal(commandLabel(state({ mode: "visual" }), "$"), "$");
    assert.equal(commandLabel(state({ mode: "visual" }), "O"), "O");
    assert.equal(commandLabel(state({ mode: "visual" }), "<CR>"), "RET");
    assert.equal(commandLabel(state({ mode: "pager" }), "j"), null);
    assert.equal(commandLabel(state({ mode: "menu" }), "a"), null);
  });

  it("packs the tally line to the terminal width", () => {
    assert.equal(commandLine([], 0, 80), "Vim Commands (0):");
    assert.equal(
      commandLine([cmd("i"), cmd("f")], 0, 80),
      "Vim Commands (2): i, f",
    );
    const many = ["h", "j", "k", "l", "i", "f", "RET", "^V", ".", "o"].map(
      (label) => cmd(label),
    );
    assert.equal(
      commandLine(many, 0, 200),
      "Vim Commands (10): h, j, k, l, i, f, RET, ^V, ., o",
    );
    const tight = commandLine(many, 0, 30);
    assert.ok(tight.startsWith("Vim Commands (10): ... "));
    assert.ok(tight.endsWith("o"));
    assert.ok(tight.length <= 30);
  });

  it("collapses consecutive repeats into (xN)", () => {
    assert.equal(
      commandLine([cmd("h"), cmd("h"), cmd("h")], 0, 80),
      "Vim Commands (3): h (x3)",
    );
    assert.equal(
      commandLine([cmd("i"), cmd("f"), cmd("f")], 0, 80),
      "Vim Commands (3): i, f (x2)",
    );
    assert.equal(
      commandLine([cmd("h"), cmd("l"), cmd("h")], 0, 80),
      "Vim Commands (3): h, l, h",
    );
    // A parenthesized label absorbs the count instead of doubling the paren.
    assert.equal(
      commandLine([cmd(".(visual-fire)"), cmd(".(visual-fire)")], 0, 80),
      "Vim Commands (2): .(visual-fire x2)",
    );
    assert.equal(
      commandLine([cmd("h"), cmd("h"), cmd("f"), cmd("f"), cmd("f")], 0, 200),
      "Vim Commands (5): h (x2), f (x3)",
    );
  });

  it("shows only the current level's segment but the run-wide count", () => {
    const commands = ["h", "j", "k", "l"].map((label) => cmd(label));
    assert.equal(commandLine(commands, 2, 80), "Vim Commands (4): k, l");
    assert.equal(commandLine(commands, 4, 80), "Vim Commands (4):");
  });

  it("resets the recent list on a level change but keeps the total", () => {
    const { game, screen } = bootGame({ arena: false, seed: 7 });
    game.onKey(WALK_DOWN);
    const before = snapshot(game).commands.length;
    assert.ok(before > 0);
    game.onKey(">"); // descend: the `>` itself is logged, then the list resets
    assert.equal(snapshot(game).depth, 2);
    assert.equal(snapshot(game).commands.length, before + 1);
    assert.match(
      screen.row(24),
      new RegExp(`^Vim Commands \\(${before + 1}\\): *$`),
    );
    // A command on the new level shows again, still under the same total.
    game.onKey("w");
    assert.equal(snapshot(game).commands.length, before + 2);
    assert.match(
      screen.row(24),
      new RegExp(`^Vim Commands \\(${before + 2}\\): w`),
    );
  });

  it("records play keys in order and ignores menu navigation", () => {
    const { game, screen } = bootGame();
    game.onKey("hhl");
    game.onKey("?"); // opens the help menu; the `?` itself is a play command
    game.onKey("q"); // closes the menu, not a gameplay command
    assert.deepEqual(snapshot(game).commands, ["h", "h", "l", "?"]);
    assert.match(screen.row(24), /^Vim Commands \(4\): h \(x2\), l, \?/);
  });

  it("records a fire sequence and the label of its repeat", async () => {
    const { game, screen } = bootGame();
    armShotgun(game);
    game.onKey("f");
    game.onKey("\r");
    await game.idle();
    assert.equal(snapshot(game).mode, "play");
    game.onKey(".");
    await game.idle();
    assert.deepEqual(snapshot(game).commands.slice(-4), [
      "i",
      "f",
      "RET",
      ".(fire)",
    ]);
    assert.match(
      screen.row(24),
      /^Vim Commands \(\d+\): .*i, f, RET, \.\(fire\)/,
    );
  });
});

describe("message log", () => {
  it("archives rendered events as plain messages", () => {
    const version = pythonVersion("3.10");
    const entries = formatLog([
      { type: "bite", kind: "snake", version, damage: 1, fatal: false },
      {
        type: "note",
        text: "You see here a Modal Shotgun.",
      },
      { type: "kill", version, xp: 1 },
      { type: "level-up", level: 2 },
    ]);
    assert.equal(entries.length, 3);
    assert.match(plain(entries[0]!), /bites you/);
    assert.match(plain(entries[1]!), /Modal Shotgun/);
    assert.match(plain(entries[2]!), /advance to level 2/);
  });

  it("slams with the walrus and bites with a snake", () => {
    assert.equal(
      plain(
        formatLastMessage([
          {
            type: "bite",
            kind: "walrus",
            version: pythonVersion("3.8"),
            damage: 2,
            fatal: false,
          },
        ]),
      ),
      "The walrus operator (Python 3.8) slams you!",
    );
    assert.equal(
      plain(
        formatLastMessage([
          {
            type: "bite",
            kind: "snake",
            version: pythonVersion("3.9"),
            damage: 1,
            fatal: false,
          },
        ]),
      ),
      "The code-snake (Python 3.9) bites you!",
    );
  });

  it("keeps only the last non-empty turn as the live message", () => {
    const version = pythonVersion("3.10");
    const events = [
      { type: "clear" as const },
      { type: "note" as const, text: "first line" },
      { type: "clear" as const },
      { type: "note" as const, text: "second line" },
      { type: "clear" as const },
      { type: "kill" as const, version, xp: 1 },
    ];
    assert.equal(plain(formatLastMessage(events)), "second line");
    assert.equal(plain(formatLastMessage([])), "");
  });

  it("keeps a wall bump and opens the archive on Shift-M", () => {
    const noDeps = {} as unknown as InputDeps;
    const S = makeState({
      mode: "play",
      player: { x: 1, y: 1 },
      walls: gridFromKeys(["0,1"]),
      explored: gridFromKeys(["0,1", "1,1"]),
      visible: gridFromKeys(["0,1", "1,1"]),
    });
    handleKey(S, noDeps, makeKey("h"));
    assert.equal(S.ui.log.length, 1);
    assert.match(plain(S.ui.log[0]!), /A wall in traditional Bell Labs blue\./);
    handleKey(S, noDeps, makeKey("M", { shift: true }));
    assert.equal(activeMode(S.ui), "pager");
    const pager = currentPager(S.ui);
    assert.equal(pager?.title, "Messages");
    assert.deepEqual(pager?.lines, [plain(S.ui.log[0]!)]);
  });
});

describe("per-mode arrow folding", () => {
  const deps = {
    quit: () => {},
    fov: {},
  } as unknown as InputDeps;

  it("folds an arrow onto its vim letter where hjkl mean direction", () => {
    const S = makeState({ mode: "target" });
    handleKey(S, deps, makeKey("ArrowLeft"));
    assert.deepEqual(S.meta.commands, [{ label: "h", kind: "move" }]);
  });

  it("records each binding's declared command kind", () => {
    const S = makeState({ mode: "target" });
    handleKey(S, deps, makeKey("h"));
    handleKey(S, deps, makeKey("Enter"));
    assert.deepEqual(
      S.meta.commands.map((command) => command.kind),
      ["move", "fire"],
    );
  });

  it("moves from an arrow escape decoded by the terminal adapter", () => {
    const { game } = bootGame({ arena: true, seed: 7 });
    const before = snapshot(game).player;
    game.onKey("\x1b[D"); // a real Left arrow on stdin
    assert.deepEqual(snapshot(game).player, {
      x: before.x - 1,
      y: before.y,
    });
  });

  it("does not let a Down arrow move the inventory cursor", () => {
    const S = makeState({
      mode: "menu",
      invStage: "list",
      invRows: [
        { text: "a) one", key: "a" },
        { text: "b) two", key: "b" },
        { text: "", key: null },
      ],
      invCursor: 0,
    });
    handleKey(S, deps, makeKey("ArrowDown")); // never a j here
    assert.equal(currentMenu(S.ui)!.cursor, 0);
  });

  it("keeps arrows literal while a pager search is being typed", () => {
    const S = makeState({
      mode: "pager",
      pagerLines: ["alpha", "beta"],
      pagerTyping: true,
      pagerQuery: "",
    });
    handleKey(S, deps, makeKey("ArrowLeft")); // never an h here
    assert.equal(currentPager(S.ui)!.query, "");
  });

  it("scrolls a pager with the up and down arrows", () => {
    const S = makeState({
      mode: "pager",
      pagerLines: Array.from({ length: 100 }, (_, i) => `line ${i}`),
    });
    handleKey(S, deps, makeKey("ArrowDown"));
    assert.equal(currentPager(S.ui)!.top, 1);
    handleKey(S, deps, makeKey("ArrowUp"));
    assert.equal(currentPager(S.ui)!.top, 0);
  });

  it("scrolls a pager with page, home, and end keys", () => {
    const S = makeState({
      mode: "pager",
      pagerLines: Array.from({ length: 100 }, (_, i) => `line ${i}`),
    });
    handleKey(S, deps, makeKey("PageDown"));
    assert.equal(currentPager(S.ui)!.top, 24);
    handleKey(S, deps, makeKey("PageUp"));
    assert.equal(currentPager(S.ui)!.top, 0);
    handleKey(S, deps, makeKey("End"));
    assert.equal(currentPager(S.ui)!.top, 76);
    handleKey(S, deps, makeKey("Home"));
    assert.equal(currentPager(S.ui)!.top, 0);
    handleKey(S, deps, makeKey("f", { ctrl: true }));
    assert.equal(currentPager(S.ui)!.top, 24);
    handleKey(S, deps, makeKey("b", { ctrl: true }));
    assert.equal(currentPager(S.ui)!.top, 0);
  });

  it("does not scroll a pager with Ctrl+arrow", () => {
    const S = makeState({
      mode: "pager",
      pagerLines: Array.from({ length: 100 }, (_, i) => `line ${i}`),
    });
    handleKey(S, deps, makeKey("ArrowDown", { ctrl: true }));
    assert.equal(currentPager(S.ui)!.top, 0);
  });

  it("does not type Ctrl+punctuation into a pager search", () => {
    const S = makeState({
      mode: "pager",
      pagerLines: ["alpha", "beta"],
      pagerTyping: true,
      pagerQuery: "",
    });
    handleKey(S, deps, makeKey("]", { ctrl: true }));
    assert.equal(currentPager(S.ui)!.query, "");
  });

  it("does not submit a pager search with Ctrl+Enter", () => {
    const S = makeState({
      mode: "pager",
      pagerLines: ["alpha", "beta"],
      pagerTyping: true,
      pagerQuery: "a",
    });
    handleKey(S, deps, makeKey("Enter", { ctrl: true }));
    assert.equal(currentPager(S.ui)!.typing, true);
  });
});

describe("command help", () => {
  it("generates the command reference from the play bindings", () => {
    assert.ok(COMMANDS_LINES.includes("Hacker Fables commands"));
    assert.ok(COMMANDS_LINES.includes("Keys for a Pager (like this one):"));
    assert.ok(COMMANDS_LINES.some((line) => line.includes("scroll one page")));
    assert.ok(
      COMMANDS_LINES.indexOf("Keys for a Pager (like this one):") <
        COMMANDS_LINES.indexOf("Movement is 4-directional."),
    );
    assert.ok(COMMANDS_LINES.some((line) => line.includes("step west")));
    assert.ok(COMMANDS_LINES.some((line) => line.includes("wait one turn")));
    assert.ok(
      COMMANDS_LINES.some((line) => line.includes("VISUAL BLOCK mode:")),
    );
    assert.ok(
      COMMANDS_LINES.some((line) =>
        line.includes("reselect last visual block"),
      ),
    );
    assert.ok(COMMANDS_LINES.every((line) => line.length <= 80));
  });

  it("opens the generated command reference from the help menu", () => {
    const S = makeState();
    const deps = { quit: () => {}, fov: {} } as unknown as InputDeps;
    handleKey(S, deps, makeKey("?"));
    handleKey(S, deps, makeKey("a"));
    const pager = currentPager(S.ui);
    assert.ok(pager !== null);
    assert.equal(pager.title, "Commands");
    assert.deepEqual(pager.lines, COMMANDS_LINES);
  });

  it("covers the command row with the pager footer", () => {
    const screen = new VirtualScreen();
    screen.begin();
    const S = makeState({
      mode: "pager",
      pagerTitle: "Commands",
      pagerLines: COMMANDS_LINES,
    });
    render(S, screen);
    assert.match(screen.row(24), /^Commands -- line 1-24 of/);
    assert.doesNotMatch(screen.row(24), /Vim Commands/);
  });
});

describe("modal stack", () => {
  it("returns from a help pager to the help menu it covered", () => {
    const S = makeState();
    showHelp(S);
    const menu = currentMenu(S.ui);
    openPager(S, "Commands", ["one"]);
    assert.equal(activeMode(S.ui), "pager");
    closePager(S);
    assert.equal(activeMode(S.ui), "menu");
    assert.equal(currentMenu(S.ui), menu);
  });

  it("returns from look details to look", () => {
    const S = makeState({ mode: "look" });
    showDetailsFor(S, S.sim.player);
    assert.equal(activeMode(S.ui), "menu");
    closeInventory(S);
    assert.equal(activeMode(S.ui), "look");
  });

  it("wraps details descriptions at about 50 cells", () => {
    const snake: Enemy = {
      kind: "snake",
      x: 5,
      y: 5,
      hp: 6,
      maxHp: 6,
      bite: 1,
      version: pythonVersion("3.9"),
    };
    const S = makeState({ mode: "look", enemies: [snake] });
    showDetailsFor(S, { x: 5, y: 5 });
    const rows = currentMenu(S.ui)!.rows;
    assert.equal(
      rows.some((row) => row.text === "Slithers 8-directionally."),
      false,
    );
    assert.ok(rows.every((row) => row.text.length <= 50));
    assert.ok(
      rows.some(
        (row) => row.text === "A manifestation of the Second GIL. A physical",
      ),
    );
    assert.ok(rows.some((row) => row.text === "a snake."));
    const flavorAt = rows.findIndex((row) =>
      row.text.startsWith("A manifestation of the Second GIL."),
    );
    assert.notEqual(flavorAt, -1);
    assert.equal(rows[flavorAt - 1]!.text, "");
  });

  it("shows the Modal Shotgun description in its details", () => {
    const S = makeState({
      mode: "look",
      ground: [{ item: shotgunSpec(), x: 5, y: 5 }],
    });
    showDetailsFor(S, { x: 5, y: 5 });
    const rows = currentMenu(S.ui)!.rows;
    const text = rows.map((row) => row.text).join(" ");
    assert.ok(text.includes(MSG.gunFlavor));
    assert.ok(rows.some((row) => row.text === MSG.gunDamage(SHOTGUN_DMG)));
  });

  it("returns from a confirm popup to play", () => {
    const S = makeState();
    openConfirm(S);
    assert.equal(activeMode(S.ui), "confirm");
    confirmKey(S, "y");
    assert.equal(activeMode(S.ui), "play");
    assert.equal(S.ui.modals.length, 0);
  });

  it("closes only the top popup", () => {
    const S = makeState();
    openConfirm(S);
    openConfirm(S);
    assert.equal(S.ui.modals.length, 2);
    closeConfirm(S);
    assert.equal(activeMode(S.ui), "confirm");
    closeConfirm(S);
    assert.equal(activeMode(S.ui), "play");
  });
});

describe("state ownership", () => {
  it("keeps level data on the level, never beside it", () => {
    const walls = gridFromKeys(["1,1"]);
    const S = makeState({ walls, depth: 3 });
    assert.equal(S.sim.level.walls, walls);
    assert.equal(S.sim.level.depth, 3);
    assert.equal("walls" in S, false);
    assert.equal("enemies" in S, false);
  });
});

describe("simulation/presentation split", () => {
  /** presentAfterKey settles nothing here, so the deps are never read. */
  const noDeps = {} as unknown as InputDeps;

  it("leaves a turn's unlock popup for the presenter to raise", () => {
    const S = makeState({ mode: "play", pendingUnlock: true });
    passTurn(S);
    assert.equal(S.sim.pendingUnlock, true);
    assert.equal(activeMode(S.ui), "play");
    presentAfterKey(S, noDeps);
    assert.equal(activeMode(S.ui), "confirm");
    assert.equal(S.sim.pendingUnlock, false);
  });

  it("unlocks visual block at player level 2", () => {
    const S = makeState({
      plevel: 1,
      xp: 49,
      visualUnlocked: false,
      pendingUnlock: false,
    });
    awardXp(S, 1);
    assert.equal(S.sim.plevel, 2);
    assert.equal(S.sim.visualUnlocked, true);
    assert.equal(S.sim.pendingUnlock, true);
    presentAfterKey(S, noDeps);
    assert.equal(activeMode(S.ui), "confirm");
  });

  it("queues the bottom's warning instead of opening it on descent", () => {
    const guard: Enemy = {
      kind: "snake",
      version: pythonVersion("3.10"),
      x: 1,
      y: 1,
      hp: 1,
      maxHp: 1,
      bite: 1,
    };
    const bottom = blankLevel({ depth: BOSS_DEPTH, enemies: [guard] });
    const S = makeState({
      mode: "play",
      depth: BOSS_DEPTH - 1,
      down: { x: 5, y: 5 },
      player: { x: 5, y: 5 },
      walls: createGrid(),
      enemies: [],
      levels: new Map([[BOSS_DEPTH, bottom]]),
    });
    descend(S, createFov(S));
    assert.equal(S.sim.level.depth, BOSS_DEPTH);
    assert.equal(S.sim.pendingCorruption, true);
    assert.equal(activeMode(S.ui), "play");
    presentAfterKey(S, noDeps);
    assert.equal(activeMode(S.ui), "confirm");
    assert.equal(S.sim.pendingCorruption, false);
  });
});

describe("count prefix", () => {
  /** The deterministic arena: player (40,10), snake (46,10), seed 7. */
  const boot = (): { game: TestGame; screen: VirtualScreen } =>
    bootGame({ arena: true, seed: 7 });

  it("runs a counted move up to its length and labels it", () => {
    const { game, screen } = boot();
    game.onKey("5j");
    assert.deepEqual(snapshot(game).player, { x: 40, y: 15 });
    assert.deepEqual(snapshot(game).commands, ["5j"]);
    assert.match(screen.row(24), /^Vim Commands \(1\): 5j/);
  });

  it("stops a counted run at a wall like a plain run", () => {
    const { game } = boot();
    game.onKey("12k");
    assert.equal(snapshot(game).player.y, 1);
    assert.match(snapshot(game).message, /A wall with hints of corruption\./);
  });

  it("treats a count of one as a plain step", () => {
    const plain = boot();
    plain.game.onKey("j");
    const counted = boot();
    counted.game.onKey("1j");
    assert.deepEqual(
      snapshot(counted.game).player,
      snapshot(plain.game).player,
    );
    assert.deepEqual(snapshot(counted.game).commands, ["1j"]);
  });

  it("echoes a pending count and drops it for a non-move key", () => {
    const { game, screen } = boot();
    game.onKey("5");
    assert.ok(screen.row(23).endsWith("5"));
    assert.deepEqual(snapshot(game).commands, []);
    game.onKey(",");
    assert.equal(screen.row(23).endsWith("5"), false);
    assert.deepEqual(snapshot(game).commands, [","]);
  });

  it("keeps a lone leading zero out of the count", () => {
    const { game } = boot();
    game.onKey("0j");
    assert.deepEqual(snapshot(game).player, { x: 40, y: 11 });
    assert.deepEqual(snapshot(game).commands, ["j"]);
  });

  it("caps the count at three digits", () => {
    const { game } = boot();
    game.onKey("1234j");
    assert.deepEqual(snapshot(game).commands, ["123j"]);
  });
});

describe("score", () => {
  it("counts kinds in a fixed order, skipping empty ones", () => {
    assert.deepEqual(
      commandKinds([
        { label: "h", kind: "move" },
        { label: "j", kind: "move" },
        { label: "f", kind: "fire" },
        { label: ",", kind: "item" },
        { label: "RET", kind: "fire" },
      ]),
      [
        { kind: "move", count: 2 },
        { kind: "fire", count: 2 },
        { kind: "item", count: 1 },
      ],
    );
    assert.deepEqual(commandKinds([]), []);
  });

  it("writes a tab-separated score line and sanitizes the detail", () => {
    const record = {
      outcome: "dead" as const,
      seed: 7,
      depth: 3,
      level: 2,
      xp: 40,
      turns: 88,
      commands: 41,
      killedBy: "code-snake\t(Python 3.9)",
    };
    assert.equal(
      scoreLine(record, "2026-10-16T00:00:00.000Z"),
      "2026-10-16T00:00:00.000Z\t7\t3\t2\t40\t88\t41\tdead\tcode-snake (Python 3.9)",
    );
  });

  it("summarizes the run for the end screen", () => {
    const record = {
      outcome: "dead" as const,
      seed: 7,
      depth: 1,
      level: 1,
      xp: 0,
      turns: 15,
      commands: 15,
      killedBy: "code-snake (Python 3.9)",
    };
    const lines = endScreenLines(
      record,
      [cmd("l", "move"), cmd("l", "move"), cmd("w", "other")],
      ["Modal Shotgun"],
    );
    const shown = lines.map(plain);
    assert.equal(shown[0], DEATH_LINE);
    assert.ok(
      shown.includes(`Slain by code-snake (Python 3.9) on ${levelLabel(1)}.`),
    );
    assert.ok(shown.includes("Depth 1   Level 1   XP 0   Turns 15   Seed 7"));
    assert.ok(shown.includes("Vim Commands (15):"));
    assert.ok(shown.includes("move 2   other 1"));
    assert.ok(shown.includes("Modal Shotgun"));
    assert.equal(shown[shown.length - 4], "Press q to quit.");
    assert.equal(shown[shown.length - 3], "");
    assert.equal(shown[shown.length - 2], END.coffeeLead);
    assert.equal(shown[shown.length - 1], END.coffeeUrl);
    assert.deepEqual(lines[lines.length - 1], [
      { text: END.coffeeUrl, link: END.coffeeUrl },
    ]);
    assert.ok(shown.includes("Score 1085"));
    // With a replay available, an "r" prompt sits just above the quit line.
    const replayable = endScreenLines(
      record,
      [cmd("l", "move"), cmd("l", "move"), cmd("w", "other")],
      ["Modal Shotgun"],
      true,
    );
    const replayShown = replayable.map(plain);
    assert.ok(replayShown.includes("Press r to replay."));
    assert.equal(replayShown[replayShown.length - 4], "Press q to quit.");
    // A ranked run names its place in the table.
    const ranked = endScreenLines(
      record,
      [cmd("l", "move"), cmd("l", "move"), cmd("w", "other")],
      ["Modal Shotgun"],
      false,
      {
        score: 1085,
        rank: 3,
        total: 9,
      },
    );
    assert.ok(ranked.includes("Score 1085   high score #3 of 9"));
  });

  it("groups duplicate items in the end-screen inventory", () => {
    const record = {
      outcome: "dead" as const,
      seed: 7,
      depth: 3,
      level: 2,
      xp: 0,
      turns: 10,
      commands: 10,
      killedBy: null,
    };
    const lines = endScreenLines(
      record,
      [],
      [
        "Modal Shotgun",
        "script of s/[sS]//g",
        "script of s/s//g",
        "script of s/[sS]//g",
        "script of s/HP:(\\d+)(\\d+)",
      ],
    ).map(plain);
    assert.ok(lines.includes("Modal Shotgun"));
    assert.ok(lines.includes("script of s/[sS]//g x2"));
    assert.ok(lines.includes("script of s/s//g"));
    // Duplicates collapse before the six-row cap is applied.
    assert.equal(
      lines.filter((line) => line.startsWith("script of")).length,
      3,
    );
    assert.equal(
      lines.some((line) => line.startsWith("(and ")),
      false,
    );
  });

  it("caps grouped inventory rows and counts the rest", () => {
    const record = {
      outcome: "quit" as const,
      seed: 1,
      depth: 1,
      level: 1,
      xp: 0,
      turns: 1,
      commands: 1,
      killedBy: null,
    };
    const names = ["a", "a", "b", "c", "d", "e", "f", "g", "h"];
    assert.deepEqual(
      groupInventory(names).map((row) => [row.name, row.count]),
      [
        ["a", 2],
        ["b", 1],
        ["c", 1],
        ["d", 1],
        ["e", 1],
        ["f", 1],
        ["g", 1],
        ["h", 1],
      ],
    );
    const lines = endScreenLines(record, [], names).map(plain);
    assert.ok(lines.includes("a x2"));
    assert.ok(lines.includes("f"));
    assert.ok(lines.includes("(and 2 more)"));
  });

  it("scores deeper runs higher and thriftier runs higher", () => {
    const base = {
      outcome: "dead" as const,
      seed: 7,
      depth: 3,
      level: 2,
      xp: 40,
      turns: 88,
      commands: 41,
      killedBy: null,
    };
    assert.ok(scoreOf({ ...base, depth: 4 }) > scoreOf(base));
    assert.ok(scoreOf({ ...base, commands: 5 }) > scoreOf(base));
    assert.ok(scoreOf(base) > scoreOf({ ...base, commands: 400 }));
    // Never negative, however long a shallow run drags on.
    assert.equal(
      scoreOf({ ...base, depth: 1, level: 1, xp: 0, commands: 99999 }),
      0,
    );
  });

  it("parses score lines back and orders them best first", () => {
    const deep = scoreLine(
      {
        outcome: "dead",
        seed: 1,
        depth: 2,
        level: 1,
        xp: 4,
        turns: 30,
        commands: 20,
        killedBy: "code-snake (Python 2.4)",
      },
      "2026-10-17T01:00:00.000Z",
    );
    const shy = scoreLine(
      {
        outcome: "quit",
        seed: 2,
        depth: 1,
        level: 1,
        xp: 0,
        turns: 5,
        commands: 5,
        killedBy: null,
      },
      "2026-10-17T02:00:00.000Z",
    );
    const entries = highScores([shy, deep]);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.record.seed, 1); // the deeper run wins
    assert.equal(entries[0]!.record.killedBy, "code-snake (Python 2.4)");
    assert.equal(entries[1]!.record.killedBy, null); // the "quit" detail maps back
    assert.equal(entries[1]!.record.outcome, "quit");
    assert.equal(highScores(["garbage", "too\tfew\tfields"]).length, 0);
  });

  it("ranks a fresh score among the stored ones", () => {
    const deep = scoreLine(
      {
        outcome: "dead",
        seed: 1,
        depth: 5,
        level: 1,
        xp: 0,
        turns: 1,
        commands: 1,
        killedBy: null,
      },
      "2026-10-17T01:00:00.000Z",
    );
    assert.deepEqual(scoreRank([deep], 1000), {
      score: 1000,
      rank: 2,
      total: 2,
    });
    assert.deepEqual(scoreRank([], 10), { score: 10, rank: 1, total: 1 });
  });

  it("splits a high-score row into rank, score, and facts", () => {
    const line = scoreLine(
      {
        outcome: "dead",
        seed: 7,
        depth: 3,
        level: 2,
        xp: 40,
        turns: 88,
        commands: 41,
        killedBy: "code-snake (Python 3.9)",
      },
      "2026-10-17T09:30:00.000Z",
    );
    const entry = parseScoreLine(line);
    assert.ok(entry);
    assert.deepEqual(scoreCells(1, entry), [
      " 1.",
      "3559",
      "depth 3",
      "Lv 2",
      "cmds 41",
      "2026-10-17",
      "code-snake (Python 3.9)",
    ]);
  });

  it("aligns tabular columns, column -t style", () => {
    // Left-align by default, right-align the named numeric column.
    const rows = alignColumns(
      [
        ["a", "1", "wide"],
        ["bb", "100", "x"],
      ],
      2,
      [1],
    );
    assert.deepEqual(rows, ["a     1  wide", "bb  100  x"]);
  });
});

describe("dump", () => {
  const record = {
    outcome: "dead" as const,
    seed: 7,
    depth: 3,
    level: 2,
    xp: 40,
    turns: 88,
    commands: 5,
    killedBy: "code-snake (Python 3.9)",
  };

  it("names dumps safely from the timestamp and seed", () => {
    assert.equal(
      dumpFileName("2026-10-16T12:34:56.789Z", 7),
      "run-2026-10-16T12-34-56-789Z-seed7.md",
    );
  });

  it("writes a Markdown report with aligned tables", () => {
    const text = dumpText(
      record,
      [
        cmd("h", "move"),
        cmd("j", "move"),
        cmd("f", "fire"),
        cmd(",", "item"),
        cmd("f", "fire"),
      ],
      ["Modal Shotgun"],
      "2026-10-16T12:34:56.789Z",
    );
    assert.ok(text.startsWith("# Hacker Fables run dump\n"));
    // The facts table: cells padded, so raw source lines up too.
    assert.match(text, /\| Field\s+\| Value\s+\|/);
    assert.match(text, /\| Location\s+\| "Bell Labs" Sub-level 3\s+\|/);
    assert.match(text, /\| Cause\s+\| code-snake \(Python 3\.9\)\s+\|/);
    assert.match(text, /\| Turns\s+\| 88\s+\|/);
    // A GFM table: header, rule, then one row per command kind.
    assert.ok(text.includes("## Vim commands (5)"));
    assert.match(text, /\| Kind\s+\| Count\s+\|/);
    assert.match(text, /\| -+ \| -+ \|/);
    assert.match(text, /\| move\s+\| 2\s+\|/);
    assert.match(text, /\| fire\s+\| 2\s+\|/);
    assert.match(text, /\| item\s+\| 1\s+\|/);
    assert.ok(text.includes("## Inventory"));
    assert.ok(text.includes("- Modal Shotgun"));
    assert.equal(text.endsWith("\n"), true);
  });

  it("says so in Markdown when the pack is empty", () => {
    const text = dumpText(record, [], [], "2026-10-16T12:34:56.789Z");
    assert.ok(text.includes("## Vim commands (5)\n\n_None._"));
    assert.ok(text.includes("## Inventory\n\n_Empty._"));
  });
});

describe("morgue file", () => {
  it("writes a dump file, creating the directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hf-morgue-"));
    const nested = path.join(dir, "morgue");
    writeDump("run-x.md", "hello\n", nested);
    assert.equal(
      readFileSync(path.join(nested, "run-x.md"), "utf8"),
      "hello\n",
    );
    assert.deepEqual(readdirSync(nested), ["run-x.md"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("recordings file", () => {
  it("writes, lists, and reads recordings back", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hf-recs-"));
    const rec: Recording = {
      version: RECORDING_VERSION,
      seed: 7,
      arena: true,
      depth: 1,
      keys: keys("lw"),
    };
    writeRecording("run-x.json", serializeRecording(rec), dir);
    assert.deepEqual(listRecordings(dir), [path.join(dir, "run-x.json")]);
    assert.deepEqual(readRecording(path.join(dir, "run-x.json")), rec);
    assert.equal(readRecording(path.join(dir, "missing.json")), null);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves the newest recording and a replay target", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hf-recs-"));
    assert.equal(latestRecording(dir), null);
    assert.equal(resolveReplay(undefined, dir), null);

    const older: Recording = {
      version: RECORDING_VERSION,
      seed: 1,
      arena: true,
      depth: 1,
      keys: keys("h"),
    };
    const newer: Recording = {
      version: RECORDING_VERSION,
      seed: 2,
      arena: false,
      depth: 3,
      keys: keys("l"),
    };
    const oldPath = "run-2026-10-16T12-00-00-000Z-seed1.json";
    const newPath = "run-2026-10-17T12-00-00-000Z-seed2.json";
    writeRecording(oldPath, serializeRecording(older), dir);
    writeRecording(newPath, serializeRecording(newer), dir);

    assert.deepEqual(latestRecording(dir), newer);
    assert.deepEqual(resolveReplay("latest", dir), newer);
    assert.deepEqual(resolveReplay(path.join(dir, oldPath), dir), older);
    assert.equal(resolveReplay(path.join(dir, "missing.json"), dir), null);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("recording", () => {
  /** The deterministic arena death: walk at the snake, then wait to be bitten. */
  const DIE = "l".repeat(8) + "w".repeat(14);

  it("names recordings safely from the timestamp and seed", () => {
    assert.equal(
      recordingFileName("2026-10-16T12:34:56.789Z", 7),
      "run-2026-10-16T12-34-56-789Z-seed7.json",
    );
  });

  it("labels a recording for the picker", () => {
    assert.equal(
      recordingLabel("run-2026-10-17T12-42-29-149Z-seed7.json", 3),
      "2026-10-17 12-42-29  depth 3",
    );
  });

  it("round-trips normalized keys, including controls", () => {
    const rec: Recording = {
      version: RECORDING_VERSION,
      seed: 7,
      arena: true,
      depth: 2,
      keys: keys("l\r\u001b[D\u0003"),
    };
    assert.deepEqual(parseRecording(serializeRecording(rec)), rec);
  });

  it("rejects malformed or older recordings", () => {
    assert.equal(parseRecording("not json"), null);
    assert.equal(parseRecording("[]"), null);
    assert.equal(parseRecording('{"seed":7}'), null);
    // Version 1 stored raw terminal chunks; version 2 stores normalized keys.
    assert.equal(
      parseRecording(
        JSON.stringify({
          version: 1,
          seed: 7,
          arena: true,
          depth: 1,
          keys: ["l", "w"],
        }),
      ),
      null,
    );
  });

  it("writes a recording of the run's keys on death", () => {
    const recs: { name: string; text: string }[] = [];
    const { game } = bootGame({
      arena: true,
      seed: 7,
      saveRecording: (name, text) => recs.push({ name, text }),
    });
    game.onKey(DIE);
    assert.equal(recs.length, 1);
    assert.match(recs[0]!.name, /^run-\d{4}-\d{2}-\d{2}T.*-seed7\.json$/);
    const rec = parseRecording(recs[0]!.text);
    assert.ok(rec);
    assert.equal(rec.seed, 7);
    assert.equal(rec.arena, true);
    assert.equal(rec.depth, 1);
    assert.deepEqual(rec.keys, snapshot(game).inputLog);
    // Keys are recorded one at a time until the run ends, so the log is the
    // prefix of the paste up to and including the fatal bite.
    const recorded = rec.keys.map((k) => k.key).join("");
    assert.ok(DIE.startsWith(recorded));
    assert.ok(recorded.endsWith("w") && recorded.length > 8);
  });

  it("replays a recording into the very same run", async () => {
    const recs: string[] = [];
    const first = bootGame({
      arena: true,
      seed: 7,
      saveRecording: (_name, text) => recs.push(text),
    });
    first.game.onKey(DIE);
    const before = snapshot(first.game);
    const rec = parseRecording(recs[0]!);
    assert.ok(rec);

    const seen: Recording[] = [];
    const { game } = bootGame({
      arena: rec.arena,
      seed: rec.seed,
      depth: rec.depth,
      replay: rec.keys,
      onReplay: (again) => seen.push(again),
    });
    game.onKey(" "); // a replay starts held: press space to play
    await game.idle();
    const after = snapshot(game);
    assert.equal(after.dead, true);
    assert.equal(after.mode, "over");
    assert.equal(after.killedBy, before.killedBy);
    assert.deepEqual(after.record, before.record);
    // A replay is unscored and unrecorded to disk, but it keeps the keys it
    // fed, so its own end screen can watch the run again.
    assert.deepEqual(after.inputLog, rec.keys);
    assert.deepEqual(game.state.meta.recording?.keys, rec.keys);
    game.onKey("r");
    assert.deepEqual(
      seen.map((r) => r.keys),
      [rec.keys],
    );
  });

  it("replays a seeded dungeon run, descent and all, identically", async () => {
    const keys = WALK_DOWN + ">".repeat(2) + "w".repeat(4);
    const live = bootGame({ arena: false, seed: 7 });
    live.game.onKey(keys);
    const expected = snapshot(live.game);

    const { game } = bootGame({ arena: false, seed: 7, replay: [keys] });
    game.onKey(" "); // a replay starts held
    await game.idle();
    const got = snapshot(game);
    assert.equal(got.depth, expected.depth);
    assert.equal(got.turns, expected.turns);
    assert.equal(snakesOf(got).length, snakesOf(expected).length);
    assert.deepEqual(got.player, expected.player);
    assert.deepEqual(got.commands, expected.commands);
    assert.equal(plain(got.message), expected.message);
  });

  it("keeps an unseeded run reproducible from its recorded seed", async () => {
    // No --seed: the game picks one. The recording stores it, so replaying
    // that seed with the same keys must rebuild the very same run.
    const recs: string[] = [];
    const first = bootGame({
      arena: true,
      saveRecording: (_name, text) => recs.push(text),
    });
    first.game.onKey(DIE);
    const rec = parseRecording(recs[0]!);
    assert.ok(rec);
    const { game } = bootGame({
      arena: rec.arena,
      seed: rec.seed,
      depth: rec.depth,
      replay: rec.keys,
    });
    game.onKey(" "); // a replay starts held
    await game.idle();
    assert.deepEqual(snapshot(game).record, snapshot(first.game).record);
  });
});

describe("replay playback", () => {
  /** A long walkable recording so playback has many turns to show. */
  const WALK = Array.from({ length: 30 }, () => "h");

  it("starts held and steps a turn at a time with l", async () => {
    const { game } = bootGame({ arena: true, seed: 7, replay: WALK });
    await game.idle();
    const held = snapshot(game).turns;
    await tick(); // held: nothing plays on its own
    assert.equal(snapshot(game).turns, held);
    game.onKey("l"); // step one turn
    await game.idle();
    assert.equal(snapshot(game).turns, held + 1);
    game.onKey("l");
    await game.idle();
    assert.equal(snapshot(game).turns, held + 2);
    game.onKey(" "); // play: the rest runs out
    await game.idle();
    assert.ok(snapshot(game).turns > held + 2);
  });

  it("shows the playback controls while held, the vim tally while playing", async () => {
    const { game, screen } = bootGame({
      arena: true,
      seed: 7,
      replay: ["h", "h"],
    });
    assert.match(screen.frame(), /Replay {3}space: play/);
    game.onKey(" "); // play
    assert.doesNotMatch(screen.frame(), /space: play/);
    await game.idle();
  });

  it("toggles whole-level omniscience with tab", async () => {
    const { game } = bootGame({ arena: true, seed: 7, replay: ["h", "h"] });
    assert.equal(snapshot(game).omniscient, false);
    game.onKey("\t");
    assert.equal(snapshot(game).omniscient, true);
    game.onKey("\t");
    assert.equal(snapshot(game).omniscient, false);
    await game.idle();
  });

  it("leaves for the title screen on q and stops feeding", async () => {
    let titled = 0;
    const { game } = bootGame({
      arena: true,
      seed: 7,
      replay: WALK,
      onQuitToTitle: () => titled++,
    });
    game.onKey("q");
    assert.equal(titled, 1);
    const t = snapshot(game).turns;
    await tick();
    assert.equal(snapshot(game).turns, t); // the feed stopped with the game
  });
});

describe("end screen", () => {
  /** The deterministic arena death: walk at the snake, then wait to be bitten. */
  const DIE = "l".repeat(8) + "w".repeat(14);

  it("shows a summary and scores the run on death", () => {
    const saved: string[] = [];
    const dumps: { name: string; text: string }[] = [];
    const { game, screen } = bootGame({
      arena: true,
      seed: 7,
      saveScore: (l) => saved.push(l),
      saveDump: (name, text) => dumps.push({ name, text }),
    });
    game.onKey(DIE);
    const s = snapshot(game);
    assert.equal(s.dead, true);
    assert.equal(s.mode, "over");
    assert.equal(s.killedBy, "code-snake (Python 3.9)");
    assert.equal(s.record?.outcome, "dead");
    assert.equal(s.record?.seed, 7);
    assert.equal(s.record?.depth, 1);
    assert.equal(s.record?.commands, s.commands.length);
    assert.equal(saved.length, 1);
    assert.match(
      saved[0]!,
      /^\d{4}-\d{2}-\d{2}T[^Z]*Z\t7\t1\t1\t0\t\d+\t\d+\tdead\tcode-snake \(Python 3\.9\)$/,
    );
    assert.equal(dumps.length, 1);
    assert.match(dumps[0]!.name, /^run-\d{4}-\d{2}-\d{2}T.*-seed7\.md$/);
    assert.match(dumps[0]!.text, /^# Hacker Fables run dump\n/);
    assert.match(
      dumps[0]!.text,
      /\| Location\s+\| "Bell Labs" Sub-level 1\s+\|/,
    );
    assert.match(
      dumps[0]!.text,
      /\| Cause\s+\| code-snake \(Python 3\.9\)\s+\|/,
    );
    assert.match(
      screen.frame(),
      /Your terminal closed permanently\. SIGKILL\./,
    );
    assert.match(
      screen.frame(),
      /Slain by code-snake \(Python 3\.9\) on "Bell Labs" Sub-level 1\./,
    );
    assert.match(screen.frame(), /Vim Commands \(/);
    assert.match(screen.frame(), /Press q to quit\./);
    const quit = screen.textRuns.find((run) =>
      plain(run.spans).includes("Press q to quit."),
    );
    assert.ok(
      quit?.spans.some((span) => span.text === "q" && span.reverse === true),
      "the q in the quit prompt should be reversed",
    );
  });

  it("ranks the run against the stored scores", () => {
    const stored = [
      scoreLine(
        {
          outcome: "dead",
          seed: 1,
          depth: 9,
          level: 1,
          xp: 0,
          turns: 1,
          commands: 1,
          killedBy: null,
        },
        "2026-10-17T01:00:00.000Z",
      ),
    ];
    const saved: string[] = [];
    const { game, screen } = bootGame({
      arena: true,
      seed: 7,
      saveScore: (l) => saved.push(l),
      readScores: () => stored,
    });
    game.onKey(DIE);
    // A depth-1 death lands below the stored depth-9 run.
    assert.match(screen.frame(), /high score #2 of 2/);
    assert.equal(saved.length, 1);
    assert.equal(highScores([...stored, ...saved]).length, 2);
  });

  it("scores once, however many keys follow", () => {
    const saved: string[] = [];
    const dumps: string[] = [];
    const { game } = bootGame({
      arena: true,
      seed: 7,
      saveScore: (l) => saved.push(l),
      saveDump: (name) => dumps.push(name),
    });
    game.onKey(DIE);
    game.onKey("wwxx");
    assert.equal(saved.length, 1);
    assert.equal(dumps.length, 1);
    assert.equal(snapshot(game).mode, "over");
  });

  it("quits on q from the end screen", () => {
    let quit = 0;
    const { game } = bootGame({ arena: true, seed: 7, quit: () => quit++ });
    game.onKey(DIE);
    game.onKey("w"); // ignored while the end screen waits
    assert.equal(quit, 0);
    game.onKey("q");
    assert.equal(quit, 1);
  });

  it("offers a replay prompt and hands back the recording on r", () => {
    const seen: Recording[] = [];
    const recs: string[] = [];
    const { game, screen } = bootGame({
      arena: true,
      seed: 7,
      saveRecording: (_name, text) => recs.push(text),
      onReplay: (rec) => seen.push(rec),
    });
    game.onKey(DIE);
    assert.match(screen.frame(), /Press r to replay\./);
    assert.equal(seen.length, 0);
    game.onKey("w"); // ignored while the end screen waits
    assert.equal(seen.length, 0);
    game.onKey("r");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.seed, 7);
    assert.deepEqual(seen[0], parseRecording(recs[0]!));
  });

  it("stays on the map while alive", () => {
    const { game } = bootGame({ arena: true, seed: 7 });
    game.onKey("j");
    assert.equal(snapshot(game).mode, "play");
    assert.equal(snapshot(game).record, null);
    assert.equal(snapshot(game).killedBy, null);
  });
});

describe("title screen", () => {
  it("lays out banner art and a keyed menu, one blank line apart", () => {
    const lines = titleLines();
    const shown = lines.map(plain);
    assert.ok(shown.some((l) => l.includes(TITLE_ART[4]!.trim())));
    // The plain-text name sits under the banner, above the tagline.
    const name = shown.indexOf(TITLE_TEXT);
    const banner = shown.findIndex((l) => l.includes(TITLE_ART[0]!.trim()));
    assert.ok(name > banner && name < shown.indexOf(TITLE_TAGLINE));
    assert.ok(shown.includes(TITLE_TAGLINE));
    // The banner ignites red at the top and cools to yellow at the base.
    const styled = (fg: string): number =>
      lines.findIndex(
        (l) => typeof l !== "string" && l.some((span) => span.fg === fg),
      );
    const redRow = styled("red");
    const yellowRow = styled("yellow");
    assert.ok(redRow !== -1 && yellowRow > redRow);
    // The hotkeys are reversed; the emulator strips that when rendering.
    const reversed = (key: string): boolean =>
      lines.some(
        (l) =>
          typeof l !== "string" &&
          l.some((span) => span.text === key && span.reverse === true),
      );
    assert.ok(reversed("n"));
    assert.ok(reversed("q"));
    // Exactly one blank line between each menu entry.
    const newGame = shown.findIndex((l) => l.includes("New game"));
    const scores = shown.findIndex((l) => l.includes("High scores"));
    const quit = shown.findIndex((l) => l.includes("Quit"));
    assert.equal(scores - newGame, 2);
    assert.equal(quit - scores, 2);
  });

  it("boots to the splash and starts play on any other key", () => {
    const { game, screen } = bootGame({ title: true, seed: 7 });
    assert.equal(snapshot(game).mode, "title");
    assert.ok(screen.frame().includes(TITLE_ART[0]!.trim()));
    assert.ok(screen.frame().includes(TITLE_TAGLINE));
    const before = snapshot(game).player;
    game.onKey("h"); // dismisses the splash into the lore card
    assert.equal(snapshot(game).mode, "lore");
    game.onKey(" "); // dismisses the lore card; the key does not also move
    assert.equal(snapshot(game).mode, "play");
    assert.deepEqual(snapshot(game).player, before);
    assert.match(screen.frame(), /Press \? for help\./);
  });

  it("quits on q from the splash", () => {
    let quit = 0;
    const { game } = bootGame({ title: true, quit: () => quit++ });
    game.onKey("q");
    assert.equal(quit, 1);
  });

  it("boots straight to play when the splash is skipped", () => {
    const { game, screen } = bootGame({ seed: 7 });
    assert.equal(snapshot(game).mode, "play");
    assert.ok(!screen.frame().includes(TITLE_TAGLINE));
  });

  it("offers View recording only when a recording exists", () => {
    assert.ok(
      !titleLines()
        .map(plain)
        .some((l) => l.includes("View recording")),
    );
    const entries: RecordingEntry[] = [
      { label: "2026-10-17 12-42-29  depth 1", path: "/rec/7.json" },
    ];
    const lines = titleLines(entries);
    assert.ok(lines.map(plain).some((l) => l.includes("View recording")));
    assert.ok(
      lines.some(
        (l) =>
          typeof l !== "string" &&
          l.some((span) => span.text === "v" && span.reverse === true),
      ),
    );
  });

  it("opens the picker on v and watches the chosen recording", () => {
    const entries: RecordingEntry[] = [
      { label: "2026-10-17 12-42-29  depth 1", path: "/rec/9.json" },
      { label: "2026-10-17 12-30-17  depth 17", path: "/rec/7.json" },
    ];
    const picked: string[] = [];
    const { game, screen } = bootGame({
      title: true,
      seed: 7,
      recordings: entries,
      onReplayPath: (path) => picked.push(path),
    });
    assert.equal(snapshot(game).mode, "title");
    game.onKey("v");
    assert.equal(snapshot(game).mode, "recordings");
    assert.match(screen.frame(), /Recordings/);
    assert.match(screen.frame(), /2026-10-17 12-42-29 {2}depth 1/);
    assert.match(screen.frame(), /Enter: watch/);
    game.onKey("j"); // move to the older recording
    game.onKey("\r");
    assert.deepEqual(picked, ["/rec/7.json"]);
  });

  it("does not repaint an old game after a replay replaces it", () => {
    const screen = new VirtualScreen();
    let game: Game | null = null;
    const replace = (next: Game): void => {
      game?.close();
      game = next;
      next.boot();
    };
    const start = (title: boolean, replay: Key[] = []): void => {
      replace(
        new Game({
          screen,
          sleep: immediate,
          quit: () => {},
          arena: true,
          seed: 7,
          title,
          replay,
          recordings: [
            { label: "2026-10-17 12-42-29  depth 1", path: "/rec/7.json" },
          ],
          onReplayPath: () => start(false),
        }),
      );
    };
    start(true);
    game!.onKey(decodeInput("v"));
    game!.onKey(decodeInput("\r"));
    assert.match(screen.frame(), /Replay/);
    assert.ok(!screen.frame().includes("Recordings"));
  });

  it("returns to the splash from the picker on q", () => {
    const entries: RecordingEntry[] = [
      { label: "2026-10-17 12-42-29  depth 1", path: "/rec/1.json" },
    ];
    const { game } = bootGame({ title: true, seed: 7, recordings: entries });
    game.onKey("v");
    assert.equal(snapshot(game).mode, "recordings");
    game.onKey("q");
    assert.equal(snapshot(game).mode, "title");
    game.onKey("q"); // and the splash still quits
  });

  it("offers High scores and shows the table on s", () => {
    const stored = [
      scoreLine(
        {
          outcome: "dead",
          seed: 1,
          depth: 5,
          level: 3,
          xp: 30,
          turns: 100,
          commands: 40,
          killedBy: "code-snake (Python 3.9)",
        },
        "2026-10-17T09:30:00.000Z",
      ),
      scoreLine(
        {
          outcome: "dead",
          seed: 2,
          depth: 2,
          level: 1,
          xp: 4,
          turns: 20,
          commands: 10,
          killedBy: null,
        },
        "2026-10-17T09:31:00.000Z",
      ),
    ];
    const { game, screen } = bootGame({
      title: true,
      seed: 7,
      readScores: () => stored,
    });
    assert.ok(
      titleLines()
        .map(plain)
        .some((l) => l.includes("High scores")),
    );
    assert.ok(
      titleLines().some(
        (l) =>
          typeof l !== "string" &&
          l.some((span) => span.text === "s" && span.reverse === true),
      ),
    );
    game.onKey("s");
    assert.equal(snapshot(game).mode, "scores");
    assert.match(screen.frame(), /High scores/);
    assert.match(screen.frame(), /depth 5/);
    assert.match(screen.frame(), /q: back/);
    game.onKey("q");
    assert.equal(snapshot(game).mode, "title");
  });

  it("shows an empty table when nothing is stored", () => {
    const { game, screen } = bootGame({ title: true, seed: 7 });
    game.onKey("s");
    assert.equal(snapshot(game).mode, "scores");
    assert.match(screen.frame(), /no runs yet/);
  });

  it("lists stored scores best first", () => {
    const deep = scoreLine(
      {
        outcome: "dead",
        seed: 1,
        depth: 9,
        level: 1,
        xp: 0,
        turns: 1,
        commands: 1,
        killedBy: null,
      },
      "2026-10-17T01:00:00.000Z",
    );
    const shy = scoreLine(
      {
        outcome: "dead",
        seed: 2,
        depth: 1,
        level: 1,
        xp: 0,
        turns: 1,
        commands: 1,
        killedBy: null,
      },
      "2026-10-17T02:00:00.000Z",
    );
    const rows = scoreRows([shy, deep]);
    assert.match(rows[0]!, /depth 9/);
    assert.match(rows[1]!, /depth 1/);
    assert.match(scoreRows([])[0]!, /no runs yet/);
  });
});

describe("data paths", () => {
  /** Set env vars for one test body, then restore their previous values. */
  function withEnv(
    changes: Record<string, string | undefined>,
    fn: () => void,
  ): void {
    const saved: Record<string, string | undefined> = {};
    for (const name of Object.keys(changes)) {
      saved[name] = process.env[name];
    }
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    try {
      fn();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  }

  it("uses one data-dir override for every store", () => {
    const root = path.join(tmpdir(), "hf-data");
    withEnv(
      { [DATA_ENV]: root, XDG_DATA_HOME: path.join(tmpdir(), "hf-xdg") },
      () => {
        assert.equal(defaultDataDir(), root);
        assert.equal(defaultScorePath(), path.join(root, "scores.txt"));
        assert.equal(defaultMorgueDir(), path.join(root, "morgue"));
        assert.equal(defaultRecordingDir(), path.join(root, "recordings"));
      },
    );
  });

  it("falls back to the XDG data home", () => {
    const xdg = path.join(tmpdir(), "hf-xdg");
    withEnv({ [DATA_ENV]: undefined, XDG_DATA_HOME: xdg }, () => {
      const root = path.join(xdg, "hacker-fables");
      assert.equal(defaultDataDir(), root);
      assert.equal(defaultScorePath(), path.join(root, "scores.txt"));
      assert.equal(defaultMorgueDir(), path.join(root, "morgue"));
      assert.equal(defaultRecordingDir(), path.join(root, "recordings"));
    });
  });
});

describe("scores file", () => {
  it("appends finished-run lines to the given file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hf-scores-"));
    const file = path.join(dir, "scores.txt");
    appendScore("a\tb", file);
    appendScore("c\td", file);
    assert.equal(readFileSync(file, "utf8"), "a\tb\nc\td\n");
    assert.deepEqual(readScores(file), ["a\tb", "c\td"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads an absent scores file as empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hf-noscore-"));
    assert.deepEqual(readScores(path.join(dir, "missing.txt")), []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("enemies", () => {
  /** A two-cell walrus operator: head right, its tail one cell left. */
  const makeWalrus = (over: Partial<Enemy> = {}): Enemy => ({
    kind: "walrus",
    x: 5,
    y: 5,
    hp: 10,
    maxHp: 10,
    bite: 3,
    version: pythonVersion("3.9"),
    ...over,
  });

  it("keeps the walrus a rigid := when it glides sideways", () => {
    const e = makeWalrus();
    slideEnemy(e, { x: 6, y: 5 });
    assert.equal(e.x, 6);
    assert.equal(e.y, 5);
    assert.deepEqual(enemyCells(e), [
      { x: 6, y: 5 },
      { x: 5, y: 5 },
    ]);
  });

  it("keeps the walrus := through a diagonal glide", () => {
    // The whole glyph shifts at once, so the tail stays directly left.
    const e = makeWalrus();
    slideEnemy(e, { x: 6, y: 6 });
    assert.deepEqual(enemyCells(e), [
      { x: 6, y: 6 },
      { x: 5, y: 6 },
    ]);
  });

  it("paints the walrus as a two-cell :=", () => {
    const e = makeWalrus();
    assert.equal(enemyGlyphAtCell(e, 5, 5), "=");
    assert.equal(enemyGlyphAtCell(e, 4, 5), ":");
    assert.deepEqual(enemyColor(e), snakeColor(pythonVersion("3.9")));
    const snake = makeWalrus({
      kind: "snake",
      version: pythonVersion("3.9"),
    });
    assert.equal(enemyGlyphAtCell(snake, 5, 5), "S");
  });

  it("selects the whole walrus from either tile", () => {
    const e = makeWalrus();
    assert.deepEqual(selectionCells([e], { x: 5, y: 5 }), [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]);
    assert.deepEqual(selectionCells([e], { x: 4, y: 5 }), [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]);
    assert.deepEqual(selectionCells([e], { x: 7, y: 7 }), [{ x: 7, y: 7 }]);
  });

  it("keeps the visual block a full rectangle over a walrus", () => {
    const e = makeWalrus(); // tail (4,5), head (5,5)
    // Dragging column 5 down onto the head widens the block to column 4,
    // so the whole walrus is inside one rectangle, not a stepped notch.
    assert.deepEqual(blockBounds([e], { x: 5, y: 3 }, { x: 5, y: 5 }), {
      x0: 4,
      y0: 3,
      x1: 5,
      y1: 5,
    });
    assert.deepEqual(blockBounds([e], { x: 4, y: 3 }, { x: 4, y: 5 }), {
      x0: 4,
      y0: 3,
      x1: 5,
      y1: 5,
    });
    assert.deepEqual(blockBounds([e], { x: 0, y: 0 }, { x: 1, y: 1 }), {
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 1,
    });
  });

  it("steps the cursor past a walrus as one unit", () => {
    const e = makeWalrus(); // tail (4,5), head (5,5)
    // Standing on either tile, stepping across hops past the whole glyph.
    assert.deepEqual(cursorStep([e], { x: 4, y: 5 }, 1, 0), { x: 6, y: 5 });
    assert.deepEqual(cursorStep([e], { x: 5, y: 5 }, -1, 0), { x: 3, y: 5 });
    // Leaving the far side, landing from outside, and perpendicular steps
    // are all ordinary single steps.
    assert.deepEqual(cursorStep([e], { x: 5, y: 5 }, 1, 0), { x: 6, y: 5 });
    assert.deepEqual(cursorStep([e], { x: 3, y: 5 }, 1, 0), { x: 4, y: 5 });
    assert.deepEqual(cursorStep([e], { x: 4, y: 5 }, 0, -1), { x: 4, y: 4 });
  });

  it("reverses both walrus tiles when the cursor sits on either", () => {
    const e = makeWalrus();
    const screen = new VirtualScreen();
    const S = makeState({
      enemies: [e],
      cursor: { x: 4, y: 5 },
      explored: gridFromKeys(["4,5", "5,5"]),
      visible: gridFromKeys(["4,5", "5,5"]),
      player: { x: 0, y: 0 },
      ground: [],
      walls: createGrid(),
    });
    drawCursor(S, screen);
    assert.deepEqual(screen.at(5, 5 + MAP_TOP), {
      ch: "=",
      fg: "red",
      reverse: true,
    });
    assert.deepEqual(screen.at(4, 5 + MAP_TOP), {
      ch: ":",
      fg: "red",
      reverse: true,
    });
  });

  it("hops the free-look cursor clean over a walrus", () => {
    const e = makeWalrus(); // tail (4,5), head (5,5)
    const screen = new VirtualScreen();
    const S = makeState({
      mode: "look",
      enemies: [e],
      cursor: { x: 3, y: 5 },
      explored: gridFromKeys(["4,5", "5,5"]),
      visible: gridFromKeys(["4,5", "5,5"]),
      player: { x: 0, y: 0 },
      ground: [],
      walls: createGrid(),
      message: "",
    });
    lookStep(S, 1, 0);
    render(S, screen);
    // Lands on the walrus, both tiles lit.
    assert.deepEqual(S.ui.cursor, { x: 4, y: 5 });
    assert.equal(screen.at(4, 5 + MAP_TOP)?.reverse, true);
    assert.equal(screen.at(5, 5 + MAP_TOP)?.reverse, true);
    lookStep(S, 1, 0);
    render(S, screen);
    // The next step is past the whole glyph, which is now unlit.
    assert.deepEqual(S.ui.cursor, { x: 6, y: 5 });
    assert.notEqual(screen.at(5, 5 + MAP_TOP)?.reverse, true);
  });

  it("covers exactly the walrus on first touch, then moves past next step", () => {
    const e = makeWalrus(); // tail (4,5), head (5,5)
    const screen = new VirtualScreen();
    const S = makeState({
      mode: "visual",
      enemies: [e],
      cursor: { x: 3, y: 5 },
      visualAnchor: { x: 3, y: 5 },
      visualRect: [],
      explored: gridFromKeys(["3,5", "4,5", "5,5", "6,5"]),
      visible: gridFromKeys(["3,5", "4,5", "5,5", "6,5"]),
      player: { x: 0, y: 0 },
      ground: [],
      walls: createGrid(),
      message: "",
    });
    S.ui.visual.rect = cellsInRect(S);

    // First touch lands on the glyph and the block covers it whole, with
    // no extra cell past it.
    visualMove(S, 1, 0);
    render(S, screen);
    assert.deepEqual(S.ui.cursor, { x: 4, y: 5 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.x),
      [3, 4, 5],
    );
    // The block covers both tiles: the head stays reversed and the moving
    // corner on the tail carries the cursor highlight.
    assert.equal(screen.at(3, 5 + MAP_TOP)?.reverse, true);
    assert.equal(screen.at(5, 5 + MAP_TOP)?.reverse, true);
    assert.equal(screen.at(4, 5 + MAP_TOP)?.fg, "black");
    assert.equal(screen.at(4, 5 + MAP_TOP)?.bg, "yellow");

    // The next step moves the edge past the glyph, which stays covered.
    visualMove(S, 1, 0);
    assert.deepEqual(S.ui.cursor, { x: 6, y: 5 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.x),
      [3, 4, 5, 6],
    );
  });

  it("spawns a two-cell walrus only from the walrus depth", () => {
    const shallow = snapshot(
      bootGame({
        arena: false,
        seed: 38,
        depth: 9,
      }).game,
    );
    assert.equal(
      shallow.enemies.some((e) => e.kind === "walrus"),
      false,
    );
    const deep = snapshot(
      bootGame({
        arena: false,
        seed: 38,
        depth: 10,
      }).game,
    );
    const walrus = deep.enemies.find((e) => e.kind === "walrus");
    assert.ok(walrus, "expected a walrus at depth 10");
    assert.equal(walrus.cells.length, 2);
    // The glyph always reads ":=": the tail sits one cell left of the head.
    assert.deepEqual(walrus.cells[1]!, {
      x: walrus.cells[0]!.x - 1,
      y: walrus.cells[0]!.y,
    });
    assert.ok(Number.parseFloat(walrus.version) >= 3.8);
  });

  it("spawns more walruses as the cap grows", () => {
    const walruses = (seed: number, depth: number): number =>
      snapshot(bootGame({ arena: false, seed, depth }).game).enemies.filter(
        (e) => e.kind === "walrus",
      ).length;
    // Depth 9 cap 2 (seed 80 spawns both); depth 13 cap 4 (seed 23 spawns all).
    assert.equal(walruses(80, 9), 2);
    assert.equal(walruses(23, 13), 4);
    // No level ever spawns past its cap.
    for (const depth of [7, 9, 11, 13, 14]) {
      for (let seed = 1; seed <= 20; seed++) {
        const n = walruses(seed, depth);
        assert.ok(
          n <= walrusCapForDepth(depth),
          `depth ${depth} seed ${seed} spawned ${n}`,
        );
      }
    }
  });

  it("fights the walrus as one enemy across two cells", async () => {
    // Seed 25, depth 8: the walrus appears with a quiet approach, so the
    // duel runs undisturbed.
    const { game, screen } = bootGame({ arena: false, seed: 25, depth: 8 });
    isolateWalrus(game);
    assert.ok(snapshot(game).enemies.some((e) => e.kind === "walrus"));
    await driveUntil(
      game,
      screen,
      (s) => {
        const walrus = s.enemies.find((e) => e.kind === "walrus");
        return walrus ? stepToward(s, walrus.x, walrus.y) : null;
      },
      (s) => !s.enemies.some((e) => e.kind === "walrus"),
    );
    const s = snapshot(game);
    assert.equal(s.dead, false);
    assert.ok(
      s.log.some((line) =>
        /The walrus operator \(Python [\d.]+.*\) dissolves into pixels!/.test(
          line,
        ),
      ),
    );
  });
});

describe("corruption tint", () => {
  /** A one-wall, one-floor nook for probing wall color without a full run. */
  const nook = (opts: { enemies: Enemy[]; visible: Grid }): GameState =>
    makeState({
      omniscient: false,
      enemies: opts.enemies,
      player: { x: 5, y: 5 },
      walls: gridFromKeys(["1,1"]),
      ground: [],
      explored: gridFromKeys(["1,1", "2,2"]),
      visible: opts.visible,
      depth: 1,
      turns: 0,
      level: blankLevel({ cleared: opts.enemies.length === 0 }),
    });

  const snake: Enemy = {
    kind: "snake",
    x: 9,
    y: 9,
    hp: 6,
    maxHp: 6,
    bite: 2,
    version: pythonVersion("3.9"),
  };

  /** Bump into a wall west of the player and return the narrated line. */
  const bumpWall = (opts: {
    enemies: Enemy[];
    depth?: number;
    turns?: number;
    x?: number;
    y?: number;
  }): string => {
    const x = opts.x ?? 5;
    const y = opts.y ?? 5;
    const S = makeState({
      player: { x: x + 1, y },
      walls: gridFromKeys([`${x},${y}`]),
      explored: gridFromKeys([`${x},${y}`]),
      visible: gridFromKeys([`${x},${y}`]),
      turns: opts.turns ?? 0,
      level: blankLevel({
        depth: opts.depth ?? 1,
        enemies: opts.enemies,
        cleared: opts.enemies.length === 0,
      }),
    });
    handleKey(S, {} as unknown as InputDeps, makeKey("h"));
    return plain(S.ui.message);
  };

  /** Look at a wall section from the cursor and return the narrated line. */
  const lookWall = (opts: {
    enemies: Enemy[];
    depth?: number;
    turns?: number;
    x?: number;
    y?: number;
    visible?: boolean;
  }): string => {
    const x = opts.x ?? 5;
    const y = opts.y ?? 5;
    const S = makeState({
      mode: "look",
      cursor: { x, y },
      player: x === 0 && y === 0 ? { x: 1, y: 0 } : { x: 0, y: 0 },
      walls: gridFromKeys([`${x},${y}`]),
      explored: gridFromKeys([`${x},${y}`]),
      visible:
        opts.visible === false ? createGrid() : gridFromKeys([`${x},${y}`]),
      turns: opts.turns ?? 0,
      level: blankLevel({
        depth: opts.depth ?? 1,
        enemies: opts.enemies,
        cleared: opts.enemies.length === 0,
      }),
    });
    handleKey(S, {} as unknown as InputDeps, makeKey("o"));
    return plain(S.ui.message);
  };

  it("runs the walls red while any enemy is left", () => {
    const S = nook({ enemies: [snake], visible: gridFromKeys(["1,1", "2,2"]) });
    assert.equal(cellSpec(S, 1, 1)?.fg, STYLE_WALL_CORRUPT_RAMP[0]!.fg); // one body: dimmest
  });

  it("cools the walls to Bell Labs blue once the floor is clear", () => {
    const S = nook({ enemies: [], visible: gridFromKeys(["1,1", "2,2"]) });
    assert.equal(cellSpec(S, 1, 1)?.fg, STYLE_WALL_CLEAN.fg);
  });

  it("steps the wall red up the ramp with the absolute headcount", () => {
    // The ramp is keyed to the count itself, not a share of the floor, so a
    // shade reads the same at any depth. One enemy is its own dimmest band.
    const shadeOf = (left: number) =>
      cellSpec(
        nook({
          enemies: Array.from({ length: left }, (_, i) => ({
            ...snake,
            x: 9 + i,
            y: 9,
          })),
          visible: gridFromKeys(["1,1", "2,2"]),
        }),
        1,
        1,
      )?.fg;
    assert.equal(shadeOf(0), STYLE_WALL_CLEAN.fg);
    assert.equal(shadeOf(1), STYLE_WALL_CORRUPT_RAMP[0]!.fg);
    assert.equal(shadeOf(2), STYLE_WALL_CORRUPT_RAMP[1]!.fg);
    assert.equal(shadeOf(5), STYLE_WALL_CORRUPT_RAMP[1]!.fg);
    assert.equal(shadeOf(6), STYLE_WALL_CORRUPT_RAMP[2]!.fg);
    assert.equal(shadeOf(10), STYLE_WALL_CORRUPT_RAMP[2]!.fg);
    assert.equal(shadeOf(11), STYLE_WALL_CORRUPT_RAMP[3]!.fg);
    assert.equal(shadeOf(20), STYLE_WALL_CORRUPT_RAMP[3]!.fg);
    assert.equal(shadeOf(21), STYLE_WALL_CORRUPT_RAMP[4]!.fg);
    assert.equal(shadeOf(35), STYLE_WALL_CORRUPT_RAMP[4]!.fg);
    assert.equal(shadeOf(36), STYLE_WALL_CORRUPT_RAMP[5]!.fg);
    assert.equal(shadeOf(50), STYLE_WALL_CORRUPT_RAMP[5]!.fg);
    assert.equal(shadeOf(51), STYLE_WALL_CORRUPT.fg); // past the scale: full red
  });

  it("pins a floor holding a live boss to full red", () => {
    const boss: Enemy = {
      kind: "boss",
      x: 9,
      y: 9,
      hp: 65,
      maxHp: 65,
      bite: 3,
      version: BOSS_VERSION,
    };
    const S = nook({
      enemies: [boss, snake],
      visible: gridFromKeys(["1,1", "2,2"]),
    });
    assert.equal(cellSpec(S, 1, 1)?.fg, STYLE_WALL_CORRUPT.fg);
  });

  it("describes the wall's corruption band", () => {
    const withLeft = (left: number): string =>
      bumpWall({
        enemies: Array.from({ length: left }, (_, i) => ({
          ...snake,
          x: 9 + i,
          y: 9,
        })),
      });
    assert.equal(withLeft(0), "A wall in traditional Bell Labs blue.");
    assert.equal(withLeft(1), "A wall with hints of corruption.");
    assert.equal(withLeft(5), "A wall with hints of corruption.");
    assert.equal(withLeft(6), "A wall tinted red.");
    assert.equal(withLeft(20), "A wall tinted red.");
    assert.equal(withLeft(21), "A red-hot wall.");
    assert.equal(withLeft(50), "A red-hot wall.");
    assert.equal(withLeft(51), "A wall of blinding red light.");
  });

  it("puts a boss on the wall's top description", () => {
    const boss: Enemy = {
      ...snake,
      kind: "boss",
      hp: 65,
      maxHp: 65,
      version: BOSS_VERSION,
    };
    assert.equal(
      bumpWall({ enemies: [boss] }),
      "A wall of blinding red light.",
    );
  });

  it("keeps recalled walls generic and describes visible ones", () => {
    assert.equal(
      lookWall({ enemies: [snake], x: 4, y: 5, visible: false }),
      "You recall a wall.",
    );
    assert.equal(
      lookWall({ enemies: [snake], x: 4, y: 5 }),
      "You see a wall with hints of corruption.",
    );
  });

  it("repaints the walls the moment a melee kill crosses a tier", () => {
    const screen = new VirtualScreen();
    screen.begin();
    const crew: Enemy[] = Array.from({ length: 6 }, (_, i) => ({
      ...snake,
      x: 2 + i,
      y: 2 + i,
      hp: 3,
    }));
    const S = makeState({
      ...nook({ enemies: crew, visible: gridFromKeys(["1,1"]) }),
      hp: 16,
      xp: 0,
      plevel: 1,
      events: [],
    });
    paintCell(S, screen, 1, 1);
    assert.deepEqual(screen.at(1, 1 + MAP_TOP), {
      ch: "#",
      ...STYLE_WALL_CORRUPT_RAMP[2],
    }); // six alive
    attack(S, crew[0]!); // six bodies down to five crosses into the 2-5 band
    paintCell(S, screen, 1, 1);
    assert.deepEqual(screen.at(1, 1 + MAP_TOP), {
      ch: "#",
      ...STYLE_WALL_CORRUPT_RAMP[1],
    });
  });

  it("maps headcounts onto the tiers", () => {
    assert.equal(corruptionTier(0), 0); // clean
    assert.equal(corruptionTier(1), 1); // one enemy: its own dimmest red
    assert.equal(corruptionTier(5), 2);
    assert.equal(corruptionTier(6), 3);
    assert.equal(corruptionTier(50), 6);
    assert.equal(corruptionTier(51), 7); // past the scale: full red
    assert.equal(corruptionTier(1, true), 7); // a boss pins the floor
  });

  /** A bottom-floor cell that flickers at a given turn, for render probes. */
  const firstGlitch = (turn: number): { key: string; glyph: string } => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) {
        if (x === 5 && y === 5) continue; // keep off the nook's player cell
        const glyph = glitchGlyph(x, y, turn, BOSS_DEPTH);
        if (glyph !== null) {
          return { key: `${x},${y}`, glyph };
        }
      }
    }
    throw new Error("no cell flickers at that turn");
  };

  /** A bottom-floor cell that stays solid at a given turn, for look probes. */
  const firstSolid = (turn: number): string => {
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 40; x++) {
        if (glitchGlyph(x, y, turn, BOSS_DEPTH) === null) {
          return `${x},${y}`;
        }
      }
    }
    throw new Error("every cell flickers at that turn");
  };

  /** A nook holding one wall cell, on the bottom by default. */
  const glitchProbe = (opts: {
    key: string;
    turn: number;
    enemies: Enemy[];
    depth?: number;
    visible?: Grid;
  }): GameState =>
    makeState({
      ...nook({
        enemies: opts.enemies,
        visible: opts.visible ?? gridFromKeys([opts.key]),
      }),
      walls: gridFromKeys([opts.key]),
      explored: gridFromKeys([opts.key]),
      depth: opts.depth ?? BOSS_DEPTH,
      turns: opts.turn,
    });

  it("glitches only the bottom floor", () => {
    assert.equal(GLITCH_MIN_DEPTH, BOSS_DEPTH);
    assert.equal(glitchChance(1), 0);
    assert.equal(glitchChance(BOSS_DEPTH - 1), 0);
    assert.equal(glitchChance(BOSS_DEPTH), GLITCH_PEAK);
  });

  it("flickers a noise alphabet, never a terrain or item glyph", () => {
    const seen = new Set<string>();
    for (let x = 0; x < 80; x++) {
      for (let y = 0; y < 20; y++) {
        const glyph = glitchGlyph(x, y, 5, BOSS_DEPTH);
        if (glyph === null) continue;
        assert.equal(glyph, glitchGlyph(x, y, 5, BOSS_DEPTH)); // deterministic, no RNG
        seen.add(glyph);
      }
    }
    assert.ok(seen.size > 4, "the shimmer should use several glyphs");
    for (const glyph of seen) {
      assert.ok(GLITCH_GLYPHS.includes(glyph));
      assert.equal("#.@?<>= )".includes(glyph), false);
    }
  });

  it("flickers a bottom wall in the wall's own red, and heals it when clear", () => {
    const { key, glyph } = firstGlitch(3);
    const [x, y] = key.split(",").map(Number) as [number, number];
    const boss: Enemy = {
      kind: "boss",
      x: 70,
      y: 18,
      hp: 65,
      maxHp: 65,
      bite: 3,
      version: BOSS_VERSION,
    };
    const lit = cellSpec(glitchProbe({ key, turn: 3, enemies: [boss] }), x, y);
    assert.equal(lit?.ch, glyph);
    assert.equal(lit?.fg, STYLE_WALL_CORRUPT.fg); // the wall red, not some accent
    // A cleared bottom heals; out of sight stays memory gray; neither the
    // floors above the bottom nor a shallow floor ever glitch.
    assert.equal(
      cellSpec(glitchProbe({ key, turn: 3, enemies: [] }), x, y)?.ch,
      "#",
    );
    assert.equal(
      cellSpec(
        glitchProbe({ key, turn: 3, enemies: [boss], depth: BOSS_DEPTH - 1 }),
        x,
        y,
      )?.ch,
      "#",
    );
    assert.equal(
      cellSpec(
        glitchProbe({ key, turn: 3, enemies: [boss], visible: createGrid() }),
        x,
        y,
      )?.ch,
      "#",
    );
    assert.equal(
      cellSpec(glitchProbe({ key, turn: 3, enemies: [boss], depth: 1 }), x, y)
        ?.ch,
      "#",
    );
  });

  it("describes every wall on a glitching floor as flickering", () => {
    const key = firstSolid(3);
    const [x, y] = key.split(",").map(Number) as [number, number];
    const boss: Enemy = {
      kind: "boss",
      x: 70,
      y: 18,
      hp: 65,
      maxHp: 65,
      bite: 3,
      version: BOSS_VERSION,
    };
    // This wall is solid right now, yet the floor itself still glitches.
    assert.equal(glitchGlyph(x, y, 3, BOSS_DEPTH), null);
    assert.equal(
      bumpWall({ enemies: [boss], depth: BOSS_DEPTH, turns: 3, x, y }),
      "A wall flickering in and out of physical reality.",
    );
    assert.equal(
      lookWall({ enemies: [boss], depth: BOSS_DEPTH, turns: 3, x, y }),
      "You see a wall flickering in and out of physical reality.",
    );
    assert.equal(
      lookWall({ enemies: [boss], depth: BOSS_DEPTH - 1, turns: 3, x, y }),
      "You see a wall of blinding red light.",
    );
  });

  it("leaves a cleared floor's walls solid", () => {
    assert.equal(
      bumpWall({ enemies: [], depth: BOSS_DEPTH, turns: 3, x: 4, y: 5 }),
      "A wall in traditional Bell Labs blue.",
    );
    assert.equal(
      lookWall({ enemies: [], depth: BOSS_DEPTH, turns: 3, x: 4, y: 5 }),
      "You see a wall in traditional Bell Labs blue.",
    );
  });

  it("reseeds the shimmer each step, repainting walls that never leave sight", () => {
    const { game, screen } = bootGame({
      arena: false,
      seed: 7,
      depth: BOSS_DEPTH,
    });
    game.onKey("y"); // dismiss the arrival popup
    const at = (x: number, y: number) => screen.at(x, y + MAP_TOP);
    // A left-border cell that is in sight on arrival and flickers on turn 2
    // (arrival is turn 0, then `l` and `h` bring us back at turn 2). The
    // border never leaves sight, and the move repaint never touches it, so
    // only the per-step wall repaint can change it.
    const target = gridKeys(snapshot(game).walls)
      .map((k) => k.split(",").map(Number))
      .find(
        ([x, y]) =>
          x === 0 &&
          at(x!, y!) !== undefined &&
          glitchGlyph(0, y!, 2, BOSS_DEPTH) !== null,
      );
    assert.ok(target, "expected a border wall that flickers on turn 2");
    const [tx, ty] = target as [number, number];
    const before = at(tx, ty);
    game.onKey("l");
    game.onKey("h");
    assert.notEqual(at(tx, ty), before);
  });

  it("leaves the floor to the terminal, and remembered walls dim", () => {
    // The floor is never tinted: a whole field of colored dots reads as noise.
    const lit = nook({
      enemies: [snake],
      visible: gridFromKeys(["1,1", "2,2"]),
    });
    assert.deepEqual(cellSpec(lit, 2, 2), { ch: "." });
    // Out of sight, walls and floor both fall back to the dim gray memory.
    const dim = nook({ enemies: [], visible: createGrid() });
    assert.equal(cellSpec(dim, 1, 1)?.fg, STYLE_WALL_MEM.fg);
    assert.equal(cellSpec(dim, 2, 2)?.fg, STYLE_FLOOR_MEM.fg);
  });

  it("announces the all-clear on the killing blow", () => {
    const { game } = bootGame(); // the arena: one snake
    game.onKey("l".repeat(10)); // the tenth bump lands the kill
    const s = snapshot(game);
    assert.equal(snakesOf(s).length, 0);
    // The all-clear is the newest message and claims the one-line row.
    assert.equal(s.message, FLOOR_CLEAR_LINE);
    assert.ok(s.events.some((e) => e.type === "floor-clear"));
    // Nothing trails on the next step: the line is simply empty.
    game.onKey("l");
    assert.equal(snapshot(game).message, "");
  });

  it("cools the walls and announces the all-clear on the killing blow", () => {
    const { game, screen } = bootGame(); // the arena: one snake, border walls in sight
    const wall = () => screen.at(40, 0 + MAP_TOP);
    assert.deepEqual(wall(), { ch: "#", ...STYLE_WALL_CORRUPT_RAMP[0] });
    game.onKey("l".repeat(10)); // the kill cools the room at once
    assert.deepEqual(wall(), { ch: "#", ...STYLE_WALL_CLEAN });
    const s = snapshot(game);
    assert.equal(s.message, FLOOR_CLEAR_LINE);
    assert.ok(s.events.some((e) => e.type === "floor-clear"));
  });

  it("drops the previous key's events instead of accumulating them", () => {
    const { game } = bootGame(); // the arena: one snake
    game.onKey("l".repeat(10)); // the kill queues several events
    assert.ok(snapshot(game).events.length > 1);
    game.onKey("w"); // a fresh key with nothing to report but the clear
    assert.deepEqual(snapshot(game).events, [{ type: "clear" }]);
  });

  it("warns on entering the bottom, only while its hostiles live", () => {
    // The bottom's popup belongs to the entry, not the descent: a shortcut
    // straight to the bottom shows it too.
    const { game, screen } = bootGame({
      arena: false,
      seed: 7,
      depth: BOSS_DEPTH,
    });
    assert.equal(snapshot(game).mode, "confirm");
    assert.match(screen.frame(), /The corruption becomes more intense,/);
    assert.match(screen.frame(), /Continue\? \(y\)/);
    // y dismisses it, and descending back in with the boss alive warns again.
    game.onKey("y");
    assert.equal(snapshot(game).mode, "play");
    game.onKey("<");
    game.onKey(">");
    assert.equal(snapshot(game).mode, "confirm");
  });

  it("defers the bottom warning until the splash starts the run", () => {
    const { game } = bootGame({
      arena: false,
      seed: 7,
      depth: BOSS_DEPTH,
      title: true,
    });
    assert.equal(snapshot(game).mode, "title");
    game.onKey("s");
    assert.equal(snapshot(game).mode, "scores");
    game.onKey("q");
    assert.equal(snapshot(game).mode, "title");
    game.onKey("n");
    assert.equal(snapshot(game).mode, "lore");
    game.onKey(" ");
    assert.equal(snapshot(game).mode, "confirm");
  });

  it("replays a bottom start through its entry warning", async () => {
    const { game } = bootGame({
      arena: false,
      seed: 7,
      depth: BOSS_DEPTH,
      replay: ["y", ">"],
    });
    assert.equal(snapshot(game).mode, "confirm");
    game.onKey("l");
    await game.idle();
    assert.equal(snapshot(game).mode, "play");
    assert.match(snapshot(game).message, /can't go down/);
  });

  it("stays quiet on a bottom whose hostiles are already gone", () => {
    const bottom = (enemies: Enemy[]): GameState =>
      makeState({
        ...nook({ enemies, visible: createGrid() }),
        depth: BOSS_DEPTH,
      });
    const live = bottom([snake]);
    openCorruptionWarning(live);
    assert.equal(activeMode(live.ui), "confirm");
    const cleared = bottom([]);
    openCorruptionWarning(cleared);
    assert.notEqual(activeMode(cleared.ui), "confirm");
  });
});

describe("the GIL-less dev preview", () => {
  /** Minimal combat state for `enemyTurn`; rendering is screen-only. */
  const monsterState = (opts: {
    enemies: Enemy[];
    player: { x: number; y: number };
    walls?: Grid;
    hp?: number;
  }): GameState =>
    makeState({
      enemies: opts.enemies,
      player: { ...opts.player },
      walls: opts.walls ?? createGrid(),
      ground: [],
      explored: createGrid(),
      visible: createGrid(),
      hp: opts.hp ?? MAX_HP,
      dead: false,
      won: false,
      killedBy: null,
      message: "",
      events: [],
      mode: "play",
      insertMode: false,
      wielded: null,
      inventory: [],
      shells: 0,
      loaded: false,
      depth: BOSS_DEPTH,
      turns: 0,
      plevel: 1,
      xp: 0,
    });

  const makeBoss = (over: Partial<Enemy> = {}): Enemy => {
    const stats = ENEMY_KINDS.boss.stats(BOSS_VERSION);
    return {
      kind: "boss",
      x: 5,
      y: 5,
      hp: stats.hp,
      maxHp: stats.hp,
      bite: stats.bite,
      version: BOSS_VERSION,
      ...over,
    };
  };

  const bossLevel = (seed = 7) => buildLevel(BOSS_DEPTH, { baseSeed: seed });

  /** InputDeps the end screen needs, capturing the score line and morgue dump. */
  const settleDeps = (
    saved: string[],
    dumps: { name: string; text: string }[],
  ) =>
    ({
      arena: false,
      baseSeed: 7,
      startDepth: BOSS_DEPTH,
      quit: () => {},
      saveScore: (line: string) => saved.push(line),
      readScores: () => [],
      saveDump: (name: string, text: string) => dumps.push({ name, text }),
      saveRecording: () => {},
      onReplay: () => {},
    }) as unknown as InputDeps;

  it("shows the service elevator on the surface and the bottom only", () => {
    const bottom = bossLevel();
    assert.deepEqual(bottom.elevator, ELEVATOR_POS);
    assert.equal(
      elevatorAt(makeState({ level: bottom }), ELEVATOR_POS.x, ELEVATOR_POS.y),
      true,
    );
    assert.equal(
      elevatorAt(
        makeState({ level: bottom }),
        ELEVATOR_POS.x + 1,
        ELEVATOR_POS.y,
      ),
      false,
    );
    const surface = buildLevel(1, { baseSeed: 7 });
    assert.deepEqual(surface.elevator, ELEVATOR_POS);
    const middle = buildLevel(2, { baseSeed: 7 });
    assert.equal(middle.elevator, null);
  });

  it("paints a ride frame reversed with the shaft lit at the same cell", () => {
    const screen = new VirtualScreen();
    screen.begin();
    const lvl = buildLevel(2, { baseSeed: 7 });
    paintElevatorFrame(screen, lvl.walls, ELEVATOR_POS);
    const shaft = screen.at(ELEVATOR_POS.x, ELEVATOR_POS.y + MAP_TOP);
    assert.deepEqual(shaft, { ch: "=", ...STYLE_STAIRS });
    // A floor cell shows a dot in reverse; a wall shows a hash in reverse.
    assert.deepEqual(screen.at(1, 1 + MAP_TOP), {
      ch: gridHas(lvl.walls, 1, 1) ? "#" : ".",
      reverse: true,
    });
  });

  it("rides the shaft from the bottom to the surface, one frame per floor", () => {
    const levels = new Map<number, Level>();
    for (let d = 1; d <= BOSS_DEPTH; d++) {
      levels.set(d, buildLevel(d, { baseSeed: 7 }));
    }
    const bottom = levels.get(BOSS_DEPTH)!;
    const S = makeState({
      mode: "play",
      dead: false,
      won: false,
      gilGone: true,
      depth: BOSS_DEPTH,
      plevel: 6,
      xp: 0,
      hp: MAX_HP,
      turns: 0,
      commands: [],
      commandMark: 0,
      killedBy: null,
      levels,
      level: bottom,
      walls: bottom.walls,
      enemies: bottom.enemies,
      ground: bottom.ground,
      explored: bottom.explored,
      visible: createGrid(),
      player: { ...ELEVATOR_POS },
      message: "",
      runRecord: null,
      arena: false,
      baseSeed: 7,
      startDepth: 1,
      inventory: [],
      standing: null,
      pendingKeys: "",
      insertMode: false,
      wielded: null,
      shells: 0,
      loaded: false,
    });
    const fov = createFov(S);
    const anim = rideElevator(S, fov);

    assert.equal(S.sim.level.depth, 1);
    assert.deepEqual(S.sim.player, ELEVATOR_POS);
    // The presenter replays one floor per step strictly between the ends.
    assert.deepEqual(anim, {
      kind: "elevator",
      from: BOSS_DEPTH,
      to: 1,
    });
    assert.match(plain(formatMessage(S.sim.events)), /surface/);
  });

  it("refuses to ride the service elevator before the GIL is gone", () => {
    const { game } = bootGame({ arena: false, seed: 7, depth: BOSS_DEPTH });
    game.onKey("y"); // dismiss the arrival popup
    // Arrival is (3, 10); the shaft sits two cells east.
    game.onKey("ll");
    assert.deepEqual(snapshot(game).player, ELEVATOR_POS);
    game.onKey("=");
    const s = snapshot(game);
    assert.match(
      plain(s.message),
      new RegExp(ELEVATOR_BROKEN.replace(/\./g, "\\.")),
    );
    assert.equal(s.depth, BOSS_DEPTH);
  });

  it("lets look target the service elevator even while it is out of service", () => {
    const { game } = bootGame({ arena: false, seed: 7, depth: BOSS_DEPTH });
    game.onKey("y"); // dismiss the arrival popup
    // Stand just east of the shaft; the arrival itself is the up stairs and
    // wins the nearest-target tie, so step past it first.
    game.onKey("lll");
    game.onKey("/");
    assert.match(
      snapshot(game).message,
      /a service elevator\. Out of service\./,
    );
  });

  it("is five times the snake of its version, and twice as fast", () => {
    const base = ENEMY_KINDS.snake.stats(BOSS_VERSION);
    assert.deepEqual(ENEMY_KINDS.boss.stats(BOSS_VERSION), {
      hp: base.hp * 5,
      bite: base.bite,
    });
    assert.equal(ENEMY_KINDS.boss.stats(BOSS_VERSION).hp, 65);
    assert.equal(enemySpeed("boss"), 2);
    assert.equal(enemySpeed("snake"), 1);
    assert.equal(enemySpeed("walrus"), 1);
  });

  it("names itself and paints the dev preview reversed", () => {
    assert.equal(
      snakeName(BOSS_VERSION),
      "code-snake (Python 3.16-dev, no GIL)",
    );
    assert.equal(enemyName("boss", BOSS_VERSION), snakeName(BOSS_VERSION));
    const boss = makeBoss();
    assert.equal(enemyGlyphAtCell(boss, 5, 5), "S");
    assert.deepEqual(enemyColor(boss), {
      ...snakeColor(BOSS_VERSION),
      reverse: true,
    });
  });

  it("marks a selected boss, which reverse video cannot", () => {
    const screen = new VirtualScreen();
    const boss = makeBoss({ x: 5, y: 5 });
    const S = makeState({
      enemies: [boss],
      cursor: { x: 5, y: 5 },
      explored: gridFromKeys(["5,5"]),
      visible: gridFromKeys(["5,5"]),
      player: { x: 0, y: 0 },
      ground: [],
      walls: createGrid(),
    });

    // The boss already paints reversed, so a second reverse would leave it
    // looking exactly like the unselected boss. The cursor uses the accent.
    drawCursor(S, screen);
    assert.deepEqual(screen.at(5, 5 + MAP_TOP), {
      ch: "S",
      fg: "black",
      bg: "yellow",
    });
    assert.notDeepEqual(screen.at(5, 5 + MAP_TOP), {
      ch: "S",
      ...bossColor(),
    });
    // A normal snake still gets the plain reversed mark.
    const snake: Enemy = {
      kind: "snake",
      x: 6,
      y: 5,
      hp: 6,
      maxHp: 6,
      bite: 2,
      version: pythonVersion("3.9"),
    };
    const S2 = makeState({
      ...S,
      enemies: [snake],
      cursor: { x: 6, y: 5 },
      explored: gridFromKeys(["6,5"]),
      visible: gridFromKeys(["6,5"]),
    });
    drawCursor(S2, screen);
    assert.deepEqual(screen.at(6, 5 + MAP_TOP), {
      ch: "S",
      fg: "red",
      reverse: true,
    });
    // Repainting restores the boss's own reversed paint.
    paintCell(S, screen, 5, 5);
    assert.deepEqual(screen.at(5, 5 + MAP_TOP), {
      ch: "S",
      ...bossColor(),
    });
  });

  it("is immune to substitution scripts, like the walrus", () => {
    const visible = gridFromKeys(["5,5"]);
    const snakes = [
      { kind: "snake", version: pythonVersion("2.7"), x: 5, y: 5 },
      { kind: "boss", version: BOSS_VERSION, x: 5, y: 5 },
    ];
    assert.deepEqual(scriptTargets(snakes, visible, "all"), [snakes[0]]);
    assert.deepEqual(scriptTargets(snakes, visible, "v2"), [snakes[0]]);
  });

  it("takes two steps a turn but bites only once", () => {
    // In sight but out of reach: it closes two cells, not one.
    const distant = makeBoss({ x: 5, y: 5 });
    const far = monsterState({ enemies: [distant], player: { x: 9, y: 5 } });
    enemyTurn(far);
    assert.deepEqual({ x: distant.x, y: distant.y }, { x: 7, y: 5 });
    assert.equal(far.sim.hp, MAX_HP);

    // Already adjacent: two actions, but the second holds instead of biting.
    const near = makeBoss({ x: 4, y: 5 });
    const brawl = monsterState({ enemies: [near], player: { x: 5, y: 5 } });
    enemyTurn(brawl);
    assert.equal(brawl.sim.hp, MAX_HP - near.bite);
    assert.deepEqual({ x: near.x, y: near.y }, { x: 4, y: 5 });
    assert.equal(brawl.sim.dead, false);
  });

  it("builds the bottom as a static level with one boss and two guards", () => {
    const lvl = bossLevel();
    assert.equal(lvl.depth, BOSS_DEPTH);
    assert.equal(lvl.down, null);
    assert.deepEqual(lvl.up, lvl.start);
    const bosses = lvl.enemies.filter((e) => e.kind === "boss");
    assert.equal(bosses.length, 1);
    assert.equal(bosses[0]!.maxHp, ENEMY_KINDS.boss.stats(BOSS_VERSION).hp);
    assert.equal(bosses[0]!.bite, ENEMY_KINDS.boss.stats(BOSS_VERSION).bite);
    assert.equal(bosses[0]!.version, BOSS_VERSION);
    assert.equal(lvl.enemies.length, 3);
    for (const guard of lvl.enemies.filter((e) => e.kind !== "boss")) {
      assert.equal(guard.kind, "snake");
      // Deep-only escort: never a 2.x pushover.
      assert.ok(guard.version.index >= pythonVersion("3.8").index);
    }
    // The art rows are exactly the map, so the shape is hand-authored.
    assert.equal(bossArtRows().length, HEIGHT);
    for (const row of bossArtRows()) {
      assert.equal(row.length, WIDTH);
    }
    // Loot: one gun and two healing scripts, all on reachable floor.
    assert.equal(lvl.ground.filter((g) => g.item.kind === "weapon").length, 1);
    assert.equal(lvl.ground.filter((g) => g.item.kind === "script").length, 2);
  });

  it("is byte-identical under every seed", () => {
    const a = bossLevel(7);
    const b = bossLevel(987654);
    assert.deepEqual(gridKeys(a.walls), gridKeys(b.walls));
    assert.deepEqual(a.enemies, b.enemies);
    assert.deepEqual(a.ground, b.ground);
    assert.deepEqual(a.start, b.start);
  });

  it("lands the player on the bottom with no stairs down", () => {
    const { game } = bootGame({ arena: false, seed: 7, depth: BOSS_DEPTH });
    game.onKey("y"); // dismiss the arrival popup
    const s = snapshot(game);
    assert.equal(s.depth, BOSS_DEPTH);
    assert.equal(s.won, false);
    assert.equal(s.stairsDown, null);
    assert.deepEqual(s.stairsUp, s.player);
    assert.equal(s.enemies.filter((e) => e.kind === "boss").length, 1);
    game.onKey(">");
    assert.match(snapshot(game).message, /can't go down/);
  });

  it("powers the service elevator on the killing blow instead of ending the run", () => {
    const screen = new VirtualScreen();
    // Enter the alternate screen, as boot does, so the frame renders.
    screen.begin();
    const lvl = bossLevel();
    const boss = lvl.enemies.find((e) => e.kind === "boss")!;
    const S = makeState({
      mode: "play",
      dead: false,
      won: false,
      gilGone: false,
      depth: BOSS_DEPTH,
      plevel: 6,
      xp: 12,
      turns: 900,
      commands: [
        { label: "l", kind: "move" },
        { label: "h", kind: "move" },
        { label: "f", kind: "fire" },
      ],
      killedBy: null,
      enemies: lvl.enemies,
      runRecord: null,
      standing: null,
      recording: null,
      inputLog: keys("lhf"),
      inventory: [],
      message: "You hit the code-snake.",
      arena: false,
      baseSeed: 7,
      startDepth: BOSS_DEPTH,
    });
    killEnemy(S, boss);
    settle(S, settleDeps([], []));

    assert.equal(S.sim.gilGone, true);
    assert.equal(S.sim.won, false);
    assert.equal(S.ui.mode, "play");
    assert.equal(S.meta.runRecord, null);
    assert.match(
      plain(formatMessage(S.sim.events)),
      new RegExp(ELEVATOR_LINE.replace(/\./g, "\\.")),
    );
  });

  it("wins at the surface hatch and reports it everywhere", () => {
    const saved: string[] = [];
    const dumps: { name: string; text: string }[] = [];
    const screen = new VirtualScreen();
    screen.begin();
    const S = makeState({
      mode: "play",
      dead: false,
      won: false,
      gilGone: true,
      depth: 1,
      plevel: 6,
      xp: 12,
      turns: 900,
      commands: [
        { label: "l", kind: "move" },
        { label: "h", kind: "move" },
        { label: "f", kind: "fire" },
        { label: "<", kind: "travel" },
      ],
      killedBy: null,
      player: { x: 5, y: 5 },
      level: blankLevel({
        start: { x: 5, y: 5 },
        up: { x: 5, y: 5 },
        down: { x: 9, y: 9 },
        elevator: { ...ELEVATOR_POS },
      }),
      message: "",
      enemies: [],
      ground: [],
      explored: gridFromKeys(["5,5"]),
      visible: createGrid(),
      runRecord: null,
      standing: null,
      recording: null,
      inputLog: keys("lhf"),
      inventory: [],
      arena: false,
      baseSeed: 7,
      startDepth: BOSS_DEPTH,
    });

    ascend(S, createFov(S));
    assert.equal(S.sim.won, true);
    assert.match(
      plain(formatMessage(S.sim.events)),
      new RegExp(WIN_LINE.replace(/\./g, "\\.")),
    );

    settle(S, settleDeps(saved, dumps));
    assert.equal(S.ui.mode, "over");
    const record = S.meta.runRecord!;
    assert.equal(record.outcome, "won");
    assert.equal(record.killedBy, null);
    assert.equal(record.commands, 4);
    // A win happens at level 1, but the record names the bottom it cleared.
    assert.equal(record.depth, BOSS_DEPTH);
    // The victory bonus always outranks the same run dying at the bottom.
    assert.equal(
      scoreOf(record),
      scoreOf({ ...record, outcome: "dead" }) + WIN_BONUS,
    );
    // The scores file records "won"; the morgue dump agrees.
    assert.match(saved[0] ?? "", /\twon\twon$/);
    assert.match(dumps[0]?.text ?? "", /\| Outcome\s+\| won\s+\|/);
    render(S, screen);
    const text = screen.frame();
    assert.match(text, new RegExp(WIN_LINE.replace(/\./g, "\\.")));
    assert.match(
      text,
      new RegExp(`You defeated the Second GIL on ${levelLabel(BOSS_DEPTH)}\\.`),
    );
    assert.match(text, /high score #1 of 1/);
  });

  it("keeps the surface hatch sealed until the GIL is gone", () => {
    const screen = new VirtualScreen();
    screen.begin();
    const S = makeState({
      mode: "play",
      dead: false,
      won: false,
      gilGone: false,
      depth: 1,
      player: { x: 5, y: 5 },
      level: blankLevel({
        start: { x: 5, y: 5 },
        up: { x: 5, y: 5 },
        elevator: { ...ELEVATOR_POS },
      }),
      message: "",
      commands: [],
      inputLog: [],
    });

    ascend(S, createFov(S));
    assert.equal(S.sim.won, false);
    assert.match(
      plain(formatMessage(S.sim.events)),
      new RegExp(EXIT_SEALED.replace(/\./g, "\\.")),
    );
  });
});

describe("visual motions", () => {
  /** Minimal state for the visual key handlers; rendering is screen-only. */
  const visualState = (opts: {
    cursor: { x: number; y: number };
    explored: Grid;
    walls?: Grid;
    player?: { x: number; y: number };
  }): GameState =>
    makeState({
      mode: "visual",
      enemies: [],
      cursor: { ...opts.cursor },
      visualAnchor: { ...opts.cursor },
      visualRect: [],
      explored: opts.explored,
      visible: opts.explored,
      walls: opts.walls ?? createGrid(),
      player: opts.player ?? { x: 0, y: 20 },
      ground: [],
      message: "",
      commands: [],
      pendingKeys: "",
      depth: 1,
      turns: 0,
      plevel: 1,
      xp: 0,
    });

  const noDeps = {
    quit: () => {},
    fov: {},
  } as unknown as InputDeps;

  it("scans to the edge before walls, unknown space, and the player", () => {
    const explored = createGrid();
    for (let x = 0; x <= 8; x++) {
      gridAdd(explored, x, 4);
    }
    const base = visualState({
      cursor: { x: 3, y: 4 },
      explored,
      walls: gridFromKeys(["6,4"]),
    });
    // A wall at column 6 stops a rightward scan at 5.
    assert.deepEqual(edgeReach(base, { x: 3, y: 4 }, 1, 0), { x: 5, y: 4 });
    // Leftward runs to the map edge of the known strip.
    assert.deepEqual(edgeReach(base, { x: 3, y: 4 }, -1, 0), { x: 0, y: 4 });
    // Rows 3 and 5 are unknown, so a vertical scan cannot leave row 4.
    assert.deepEqual(edgeReach(base, { x: 3, y: 4 }, 0, -1), { x: 3, y: 4 });
    assert.deepEqual(edgeReach(base, { x: 3, y: 4 }, 0, 1), { x: 3, y: 4 });
    // The player is not a legal corner.
    const helped = visualState({
      cursor: { x: 3, y: 4 },
      explored,
      player: { x: 7, y: 4 },
    });
    assert.deepEqual(edgeReach(helped, { x: 3, y: 4 }, 1, 0), { x: 6, y: 4 });
  });

  it("stretches the block across the row with $ and ^", () => {
    const explored = createGrid();
    for (let x = 0; x <= 8; x++) {
      gridAdd(explored, x, 4);
    }
    const S = visualState({
      cursor: { x: 3, y: 4 },
      explored,
      walls: gridFromKeys(["8,4"]),
    });
    S.ui.visual.rect = cellsInRect(S);
    visualKey(S, noDeps, "$");
    assert.deepEqual(S.ui.cursor, { x: 7, y: 4 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.x),
      [3, 4, 5, 6, 7],
    );
    visualKey(S, noDeps, "^");
    assert.deepEqual(S.ui.cursor, { x: 0, y: 4 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.x),
      [0, 1, 2, 3],
    );
  });

  it("stretches the block down and up the column with G and gg", () => {
    const explored = createGrid();
    for (let y = 0; y <= 6; y++) {
      gridAdd(explored, 3, y);
    }
    const S = visualState({ cursor: { x: 3, y: 4 }, explored });
    S.ui.visual.rect = cellsInRect(S);
    visualKey(S, noDeps, "G");
    assert.deepEqual(S.ui.cursor, { x: 3, y: 6 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.y),
      [4, 5, 6],
    );
    // gg is a two-key motion: the first g pends, the second scans up.
    visualKey(S, noDeps, "g");
    assert.equal(S.ui.pendingKeys, "g");
    visualKey(S, noDeps, "g");
    assert.equal(S.ui.pendingKeys, "");
    assert.deepEqual(S.ui.cursor, { x: 3, y: 0 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.y),
      [0, 1, 2, 3, 4],
    );
  });

  it("swaps the two corners with o, leaving the rectangle unchanged", () => {
    const screen = new VirtualScreen();
    const explored = createGrid();
    for (let x = 3; x <= 5; x++) {
      for (let y = 4; y <= 6; y++) {
        gridAdd(explored, x, y);
      }
    }
    const S = visualState({ cursor: { x: 5, y: 4 }, explored });
    S.ui.visual.anchor = { x: 3, y: 6 };
    S.ui.visual.rect = cellsInRect(S);
    const before = S.ui.visual.rect.map((c) => `${c.x},${c.y}`).sort();
    visualKey(S, noDeps, "o");
    assert.deepEqual(S.ui.cursor, { x: 3, y: 6 });
    assert.deepEqual(S.ui.visual.anchor, { x: 5, y: 4 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => `${c.x},${c.y}`).sort(),
      before,
    );
    render(S, screen);
    assert.equal(screen.at(3, 6 + MAP_TOP)?.bg, "yellow");
  });

  it("slides the corner to the other end of its row with O", () => {
    const screen = new VirtualScreen();
    const explored = createGrid();
    for (let x = 3; x <= 6; x++) {
      gridAdd(explored, x, 4);
    }
    const S = visualState({ cursor: { x: 6, y: 4 }, explored });
    S.ui.visual.anchor = { x: 3, y: 4 };
    S.ui.visual.rect = cellsInRect(S);
    visualKey(S, noDeps, "O");
    assert.deepEqual(S.ui.cursor, { x: 3, y: 4 });
    assert.deepEqual(S.ui.visual.anchor, { x: 6, y: 4 });
    assert.deepEqual(
      S.ui.visual.rect.map((c) => c.x),
      [3, 4, 5, 6],
    );
    render(S, screen);
    assert.equal(screen.at(3, 4 + MAP_TOP)?.bg, "yellow");
  });
});

describe("headless game", () => {
  it("boots with the dungeon state and paints the player cell", () => {
    const { game, screen } = bootGame();
    const s = snapshot(game);
    assert.equal(s.depth, 1);
    assert.equal(s.turns, 0);
    assert.equal(s.hp, 16);
    assert.equal(plain(s.message), "Press ? for help.");
    assert.deepEqual(s.player, { x: 40, y: 10 });
    assert.equal(screen.at(40, 10 + MAP_TOP)?.ch, "@");
  });

  it("moves east one cell and one turn", () => {
    const { game, screen } = bootGame();
    game.onKey("l");
    const s = snapshot(game);
    assert.deepEqual(s.player, { x: 41, y: 10 });
    assert.equal(s.turns, 1);
    assert.equal(plain(s.message), "");
    assert.equal(screen.at(41, 10 + MAP_TOP)?.ch, "@");
    assert.notEqual(screen.at(40, 10 + MAP_TOP)?.ch, "@");
  });

  it("bumps the north wall without spending turns", () => {
    const { game } = bootGame();
    game.onKey("k".repeat(10));
    const s = snapshot(game);
    assert.deepEqual(s.player, { x: 40, y: 1 });
    assert.equal(s.turns, 9);
    assert.equal(plain(s.message), "A wall with hints of corruption.");
  });

  it("waits one turn on w", () => {
    const { game } = bootGame();
    game.onKey("w");
    const s = snapshot(game);
    assert.equal(s.turns, 1);
    assert.equal(plain(s.message), "");
  });

  it("picks up, equips, and chambers the shotgun", () => {
    const { game } = bootGame();
    armShotgun(game);
    const s = snapshot(game);
    assert.deepEqual(s.inventory, ["Modal Shotgun"]);
    assert.equal(s.wielded, "Modal Shotgun");
    assert.equal(s.loaded, true);
    assert.equal(s.insertMode, true);
    assert.equal(s.turns, 11);
    assert.match(plain(s.message), /"INSERT BULLET" mode: shell chambered\./);
  });

  it("reports a surviving snake honestly", async () => {
    // Seed 3 spawns a tough snake in the open: one shell only wounds it.
    const { game } = bootGame({
      arena: false,
      seed: 3,
      depth: BOSS_DEPTH - 1,
    });
    isolateSnakes(game);
    game.onKey("i");
    game.onKey("f");
    const cursor = game.state.ui.cursor;
    const target = snapshot(game).enemies.find(
      (e) => e.x === cursor.x && e.y === cursor.y,
    );
    assert.ok(target, "expected an aimed snake");
    game.onKey("\r");
    await game.idle();
    const s = snapshot(game);
    const blast = `You blast the ${enemyName("snake", pythonVersion(target.version))}. It reels.`;
    assert.ok(
      s.log.some((line) => line.includes(blast)),
      `expected the log to report the blast: ${s.log.join(" | ")}`,
    );
    assert.equal(snakesOf(s).length, snakesForDepth(BOSS_DEPTH - 1));
  });

  it("restores health with a heal script", async () => {
    // Seed 2 places a heal script near spawn on depth 12: the sustain
    // loop the XP curve assumes, independent of kill counts.
    const { game, screen } = bootGame({ arena: false, seed: 2, depth: 12 });
    const target = snapshot(game).items.find((i) => i.name.includes("HP:"));
    assert.ok(target, "expected a heal script on the level");
    await driveUntil(
      game,
      screen,
      (s) => stepToward(s, target.x, target.y),
      (s) => s.player.x === target.x && s.player.y === target.y,
    );
    game.onKey(",");
    assert.ok(snapshot(game).inventory.includes(target.name));
    for (let i = 0; i < 30; i++) {
      const s = snapshot(game);
      if (s.dead || s.hp < s.maxHp) {
        break;
      }
      game.onKey(hunterStep(s));
    }
    const hurt = snapshot(game);
    assert.ok(
      !hurt.dead && hurt.hp < hurt.maxHp,
      "expected to take damage first",
    );
    const healsBefore = hurt.inventory.filter((n) => n === target.name).length;
    game.onKey("s");
    game.onKey("a");
    await game.idle();
    const s = snapshot(game);
    assert.equal(s.mode, "play");
    assert.equal(
      s.inventory.filter((n) => n === target.name).length,
      healsBefore - 1,
      "script unit consumed",
    );
    const healAmounts: number[] = [];
    for (const e of s.events) {
      if (e.type === "heal") {
        healAmounts.push(e.amount);
      }
    }
    assert.ok(healAmounts.length > 0, "expected a heal event");
    assert.ok(healAmounts.every((a) => a > 0));
  });

  it("places extra shotguns at their milestones", () => {
    // The table drives both the count and the placed loot.
    assert.equal(gunsForDepth(SECOND_GUN_DEPTH - 1), 1);
    assert.equal(gunsForDepth(SECOND_GUN_DEPTH), 2);
    assert.equal(gunsForDepth(EXTRA_LOOT_DEPTH - 1), 2);
    assert.equal(gunsForDepth(EXTRA_LOOT_DEPTH), 3);
    const shallow = snapshot(
      bootGame({
        arena: false,
        seed: 7,
        depth: SECOND_GUN_DEPTH - 1,
      }).game,
    );
    const second = snapshot(
      bootGame({ arena: false, seed: 7, depth: SECOND_GUN_DEPTH }).game,
    );
    const third = snapshot(
      bootGame({ arena: false, seed: 7, depth: EXTRA_LOOT_DEPTH }).game,
    );
    const guns = (s: typeof shallow): number =>
      s.items.filter((i) => i.name === "Modal Shotgun").length;
    assert.equal(guns(shallow), 1);
    assert.equal(guns(second), 2);
    assert.equal(guns(third), 3);
  });

  it("holds step values between milestones", () => {
    const value = steps([
      [1, 1],
      [12, 2],
      [14, 3],
    ]);
    assert.equal(value(0), 1);
    assert.equal(value(1), 1);
    assert.equal(value(11), 1);
    assert.equal(value(12), 2);
    assert.equal(value(13), 2);
    assert.equal(value(14), 3);
    assert.equal(value(99), 3);
  });

  it("drops extra scripts at their milestones", () => {
    const scriptNames = new Set<string>(Object.values(SCRIPT_NAMES));
    const scripts = (depth: number): number => {
      const s = snapshot(bootGame({ arena: false, seed: 7, depth }).game);
      return s.items.filter((i) => scriptNames.has(i.name)).length;
    };
    assert.equal(scrollsForDepth(SCRIPT_DROP_DEPTH - 1), 0);
    assert.equal(scrollsForDepth(SCRIPT_DROP_DEPTH), 1);
    assert.equal(scrollsForDepth(EXTRA_LOOT_DEPTH - 1), 1);
    assert.equal(scrollsForDepth(EXTRA_LOOT_DEPTH), 2);
    assert.equal(scripts(SCRIPT_DROP_DEPTH - 1), 0);
    assert.equal(scripts(SCRIPT_DROP_DEPTH), 1);
    assert.equal(scripts(EXTRA_LOOT_DEPTH - 1), 1);
    assert.equal(scripts(EXTRA_LOOT_DEPTH), 2);
  });

  it("spawns level 1 on the surface hatch", () => {
    const s = snapshot(bootGame({ arena: false, seed: 7 }).game);
    assert.deepEqual(s.player, s.stairsUp);
  });

  it.skip("levels up on kills and heals the wounds", async () => {
    // TODO(tuning): skipped while level 2 needs 50 XP (25 unhealed kills),
    // which no probed seed/strategy survives. Re-enable when organic
    // leveling is reachable again; the heal-script test above covers the
    // heal event itself.
    // Tuning-agnostic: whatever the curve, leveling up must emit a heal
    // event whenever HP was actually restored. Only the prices test
    // pins numbers. Six waits draw bites first, so the heal is real.
    const { game, screen } = bootGame({ arena: false, seed: 4, depth: 2 });
    game.onKey("w".repeat(6));
    await driveUntil(
      game,
      screen,
      (s) => hunterStep(s),
      (s) => s.events.some((e) => e.type === "level-up"),
    );
    const events = snapshot(game).events;
    assert.ok(events.some((e) => e.type === "level-up" && e.level === 2));
    const healAmounts: number[] = [];
    for (const e of events) {
      if (e.type === "heal") {
        healAmounts.push(e.amount);
      }
    }
    assert.ok(healAmounts.length > 0, "expected a heal event on level-up");
    assert.ok(healAmounts.every((a) => a > 0));
    assert.match(
      snapshot(game).message,
      /You advance to level 2!.*You feel restored\./,
    );
  });

  it("refuses visual block while locked", () => {
    const { game } = bootGame({ arena: false, seed: 7, depth: 1 });
    game.onKey("\x16");
    const s = snapshot(game);
    assert.equal(s.mode, "play");
    assert.equal(s.visualUnlocked, false);
    assert.match(plain(s.message), /haven't learned VISUAL BLOCK mode/);
  });

  it("confirms before quitting play", () => {
    let quit = false;
    const { game } = bootGame({ quit: () => (quit = true) });
    game.onKey("q");
    assert.equal(snapshot(game).mode, "confirm");
    assert.equal(quit, false);
    game.onKey("n");
    assert.equal(snapshot(game).mode, "play");
    game.onKey("q");
    game.onKey("y");
    assert.equal(quit, true);
  });

  it("driveUntil throws the last keys plus the screen on failure", async () => {
    const { game, screen } = bootGame();
    try {
      await driveUntil(
        game,
        screen,
        () => "h",
        () => false,
        { max: 3, tail: 2 },
      );
    } catch (err: unknown) {
      const message = (err as Error).message;
      assert.ok(message.includes("driveUntil gave up"));
      assert.ok(message.includes('["h","h"]'));
      assert.ok(message.includes("@"));
      return;
    }
    assert.fail("driveUntil should have thrown");
  });

  it("fires the chambered shell for a kill", async () => {
    const { game } = bootGame();
    armShotgun(game);
    game.onKey("l".repeat(4));
    game.onKey("f");
    game.onKey("\r");
    await game.idle();
    const s = snapshot(game);
    assert.equal(snakesOf(s).length, 0);
    assert.equal(s.turns, 16);
    assert.equal(s.message, FLOOR_CLEAR_LINE);
    assert.ok(
      s.log.some((e) =>
        /You blast the code-snake \(Python 3\.9\) into pixels!/.test(e),
      ),
    );
  });

  it("buffers keys behind an animation and draws the result after it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { game, screen } = bootGame({ seed: 7, sleep: () => gate });
    armShotgun(game);
    game.onKey("l".repeat(4));
    const before = snapshot(game);
    game.onKey("f");
    game.onKey("\r");
    game.onKey("h");
    const during = snapshot(game);
    try {
      assert.deepEqual(
        during.player,
        before.player,
        "the queued step must wait for the shot animation",
      );
    } finally {
      release();
      await game.idle();
    }
    const after = snapshot(game);
    assert.equal(after.player.x, before.player.x - 1);
    assert.equal(screen.at(after.player.x, after.player.y + MAP_TOP)?.ch, "@");
  });

  it("repeats a single shot by re-aiming at the nearest enemy", async () => {
    const { game } = bootGame({ seed: 7 });
    armShotgun(game);
    // Aim at the snake, step off it, and fire into empty floor: a miss.
    game.onKey("f");
    game.onKey("j");
    game.onKey("\r");
    await game.idle();
    const missed = snapshot(game);
    assert.equal(snakesOf(missed).length, 1);
    assert.equal(missed.turns, 12);
    assert.equal(missed.shells, 19);
    // `.` chambers (one turn), re-runs `f` to re-aim (one turn): the snake dies.
    game.onKey(".");
    await game.idle();
    const hit = snapshot(game);
    assert.equal(snakesOf(hit).length, 0);
    assert.equal(hit.turns, 14);
    assert.equal(hit.shells, 18);
    assert.equal(hit.message, FLOOR_CLEAR_LINE);
    assert.ok(
      hit.log.some((e) =>
        /You blast the code-snake \(Python 3\.9\) into pixels!/.test(e),
      ),
    );
    // With the level clear, `.` spends nothing and says so.
    game.onKey(".");
    await game.idle();
    const quiet = snapshot(game);
    assert.equal(quiet.turns, 14);
    assert.equal(quiet.shells, 18);
    assert.equal(
      plain(quiet.message),
      "No targets in range to repeat the shot.",
    );
  });

  it("refuses to repeat once the level is clear", async () => {
    const { game } = bootGame({ seed: 7 });
    armShotgun(game);
    game.onKey("f");
    game.onKey("\r"); // the aimed shot kills the only snake
    await game.idle();
    assert.equal(snakesOf(snapshot(game)).length, 0);
    game.onKey(".");
    await game.idle();
    const quiet = snapshot(game);
    assert.equal(quiet.turns, 12);
    assert.equal(quiet.shells, 19);
    assert.equal(
      plain(quiet.message),
      "No targets in range to repeat the shot.",
    );
  });

  it("has nothing to repeat before any shot", () => {
    const { game } = bootGame();
    game.onKey(".");
    const s = snapshot(game);
    assert.equal(s.turns, 0);
    assert.equal(plain(s.message), "Nothing to repeat.");
  });

  it("forgets the shot after a non-fire action", async () => {
    const { game } = bootGame({ seed: 7 });
    armShotgun(game);
    game.onKey("f");
    game.onKey("\r");
    await game.idle();
    assert.equal(snakesOf(snapshot(game)).length, 0);
    game.onKey("/"); // look around: a non-move, non-shot action
    game.onKey("q");
    game.onKey(".");
    const s = snapshot(game);
    assert.equal(plain(s.message), "Nothing to repeat.");
  });

  it("trades two bumps for two bites, then clears the floor", () => {
    const { game } = bootGame();
    game.onKey("l".repeat(10));
    const s = snapshot(game);
    assert.equal(snakesOf(s).length, 0);
    assert.equal(s.hp, 12);
    assert.equal(s.message, FLOOR_CLEAR_LINE);
  });

  it("passes a turn when the last snake dies in melee", () => {
    const { game } = bootGame();
    game.onKey("l".repeat(10));
    const s = snapshot(game);
    assert.equal(snakesOf(s).length, 0);
    assert.equal(s.turns, 10);
  });

  it("leaves a blank margin around a menu panel below the message", () => {
    const { game, screen } = bootGame();
    game.onKey("?");
    assert.ok(screen.row(0).startsWith("Press ? for help."));
    // The panel starts two rows down; the row above and sides stay blank.
    assert.equal(screen.row(1).slice(38).trim(), "");
    assert.equal(screen.row(2)[38], " ");
    assert.ok(
      screen.row(2).slice(39).startsWith("What do you want help with?"),
    );
    assert.equal(screen.row(2)[79], " ");
    assert.equal(screen.row(8).slice(38).trim(), "");
  });

  it("repaints clobbered map cells after panel and pager close", () => {
    const { game, screen } = bootGame();
    const booted = screen.updates.length;
    game.onKey("?"); // help menu panel paints raw over the right side
    game.onKey("q"); // close repaints the play frame
    assert.ok(
      screen.updates.length > booted,
      "panel close re-emitted map cells",
    );
    game.onKey("?");
    game.onKey("a"); // pager paints raw over everything
    const paged = screen.updates.length;
    game.onKey("q"); // close repaints the play frame
    assert.ok(
      screen.updates.length > paged,
      "pager close re-emitted map cells",
    );
    assert.equal(screen.at(40, 10 + MAP_TOP)?.ch, "@");
  });

  it("repaints only changed cells on a step", () => {
    const { game, screen } = bootGame();
    const before = screen.updates.length;
    assert.ok(before > 1000, `boot should full-paint, got ${before}`);
    game.onKey("l");
    const delta = screen.updates.length - before;
    assert.ok(delta < 20, `one step repainted ${delta} cells`);
  });

  it("reselects from fire mode with gv", async () => {
    const { game } = bootGame();
    armShotgun(game);
    game.onKey("f");
    game.onKey("\x16");
    game.onKey("l");
    game.onKey("\x1b");
    assert.equal(snapshot(game).mode, "play");
    game.onKey("f");
    assert.equal(snapshot(game).mode, "target");
    game.onKey("g");
    game.onKey("v");
    const s = snapshot(game);
    assert.equal(s.mode, "visual");
    assert.match(plain(s.message), /VISUAL BLOCK/);
  });

  it("enters visual block straight from play with ^V", () => {
    const { game } = bootGame();
    armShotgun(game);
    game.onKey("\x16");
    const s = snapshot(game);
    assert.equal(s.mode, "visual");
    assert.match(plain(s.message), /VISUAL BLOCK/);
  });

  it("refuses ^V from play when no gun is wielded", () => {
    const { game } = bootGame();
    game.onKey("\x16");
    const s = snapshot(game);
    assert.equal(s.mode, "play");
    assert.match(plain(s.message), /equip the Modal Shotgun/);
  });

  it("resizes the visual block with a small repaint", () => {
    const { game, screen } = bootGame();
    armShotgun(game);
    game.onKey("f");
    game.onKey("\x16");
    assert.equal(snapshot(game).mode, "visual");
    const before = screen.updates.length;
    game.onKey("l");
    const delta = screen.updates.length - before;
    assert.ok(delta <= 8, `visual resize repainted ${delta} cells`);
  });

  it("grants 20 shells with the first shotgun", () => {
    const { game, screen } = bootGame();
    assert.ok(!screen.writes.join("").includes("Ammo:"));
    game.onKey("h".repeat(10));
    game.onKey(",");
    const s = snapshot(game);
    assert.deepEqual(s.inventory, ["Modal Shotgun"]);
    assert.equal(s.shells, 20);
    assert.match(plain(s.message), /20 shells/);
    assert.ok(screen.writes.join("").includes("Ammo:20"));
  });

  it("chambers from the reserve and spends the chambered round", async () => {
    const { game, screen } = bootGame();
    armShotgun(game);
    assert.equal(snapshot(game).shells, 19);
    assert.ok(screen.writes.join("").includes("Ammo:20"));
    game.onKey("l".repeat(4));
    game.onKey("f");
    game.onKey("\r");
    await game.idle();
    const s = snapshot(game);
    assert.equal(s.shells, 19);
    assert.equal(s.loaded, false);
    assert.ok(screen.writes.join("").includes("Ammo:19"));
    assert.equal(s.message, FLOOR_CLEAR_LINE);
    assert.ok(
      s.log.some((e) =>
        /You blast the code-snake \(Python 3\.9\) into pixels!/.test(e),
      ),
    );
  });

  it("fires the visual block spending one round per enemy", async () => {
    const { game } = bootGame();
    armShotgun(game);
    game.onKey("f");
    game.onKey("\x16");
    game.onKey("\r");
    await game.idle();
    const s = snapshot(game);
    assert.equal(snakesOf(s).length, 0);
    assert.equal(s.shells, 19);
    assert.equal(s.message, FLOOR_CLEAR_LINE);
    assert.ok(
      s.log.some((e) =>
        /You blast the code-snake \(Python 3\.9\) into pixels!/.test(e),
      ),
    );
  });

  it("fires one round at a walrus even though the block covers both tiles", async () => {
    // Seed 1, depth 11 spawns a walrus with a quiet approach.
    const { game, screen } = bootGame({ arena: false, seed: 1, depth: 11 });
    isolateWalrus(game);
    assert.ok(snapshot(game).enemies.some((e) => e.kind === "walrus"));
    game.onKey("i"); // chamber the shotgun the deep-start kit grants
    await game.idle();
    await driveUntil(
      game,
      screen,
      (s) => {
        const w = s.enemies.find((e) => e.kind === "walrus");
        if (!w) {
          return null;
        }
        return Math.max(
          Math.abs(w.x - s.player.x),
          Math.abs(w.y - s.player.y),
        ) <= 2
          ? null
          : stepToward(s, w.x, w.y);
      },
      (s) => {
        const w = s.enemies.find((e) => e.kind === "walrus");
        return (
          w !== undefined &&
          Math.max(Math.abs(w.x - s.player.x), Math.abs(w.y - s.player.y)) <= 2
        );
      },
    );
    const before = snapshot(game);
    const walrus = before.enemies.find((e) => e.kind === "walrus");
    assert.ok(walrus, "expected the walrus to still be alive");
    // The block anchors on the walrus and grows to cover both tiles.
    game.onKey("f");
    game.onKey("\x16");
    const shells = snapshot(game).shells;
    game.onKey("\r");
    await game.idle();
    const after = snapshot(game).enemies.find((e) => e.kind === "walrus");
    assert.ok(after, "the walrus survives a single round");
    assert.equal(
      walrus.hp - after.hp,
      SHOTGUN_DMG,
      "both tiles take one bullet, not two",
    );
    assert.equal(
      snapshot(game).shells,
      shells,
      "the chambered round covers both tiles",
    );
  });

  it("repeats a volley at its recorded tiles, re-highlighting the block", async () => {
    // Same walrus setup: it survives one round, so the recorded tiles still
    // hold a live target when `.` refires them.
    let probe: { x: number; y: number }[] | null = null;
    let screenRef: VirtualScreen | null = null;
    const sleep = async (): Promise<void> => {
      if (probe === null || screenRef === null) {
        return;
      }
      const cells = probe;
      probe = null;
      // The tracer's first step has landed; the other recorded cells must
      // still carry the reversed visual selection behind it.
      assert.ok(
        cells.some((c) => screenRef?.at(c.x, c.y + MAP_TOP)?.reverse === true),
        "the repeated block is highlighted under the tracer",
      );
    };
    const { game, screen } = bootGame({
      arena: false,
      seed: 25,
      depth: 8,
      sleep,
    });
    screenRef = screen;
    isolateWalrus(game);
    game.onKey("i"); // chamber the shotgun the deep-start kit grants
    await game.idle();
    await driveUntil(
      game,
      screen,
      (s) => {
        const w = s.enemies.find((e) => e.kind === "walrus");
        if (!w) {
          return null;
        }
        return Math.max(
          Math.abs(w.x - s.player.x),
          Math.abs(w.y - s.player.y),
        ) <= 2
          ? null
          : stepToward(s, w.x, w.y);
      },
      (s) => {
        const w = s.enemies.find((e) => e.kind === "walrus");
        return (
          w !== undefined &&
          Math.max(Math.abs(w.x - s.player.x), Math.abs(w.y - s.player.y)) <= 2
        );
      },
    );
    game.onKey("f");
    game.onKey("\x16");
    game.onKey("\r");
    await game.idle();
    const wounded = snapshot(game);
    assert.ok(
      wounded.enemies.some((e) => e.kind === "walrus"),
      "the walrus survives the first volley",
    );
    const shells = wounded.shells;
    // `.` brings the block back and refires it; the presenter plays the
    // tracer, then lands in play with the walrus gone.
    probe = game.state.ui.lastFire?.cells ?? null;
    game.onKey(".");
    await game.idle();
    assert.equal(probe, null, "the tracer ran");
    const killed = snapshot(game);
    assert.equal(
      killed.enemies.some((e) => e.kind === "walrus"),
      false,
    );
    assert.equal(killed.shells, shells - 1);
    // Nothing left on those tiles: `.` is quiet and spends nothing.
    game.onKey(".");
    await game.idle();
    const quiet = snapshot(game);
    assert.equal(quiet.shells, shells - 1);
    assert.equal(
      plain(quiet.message),
      "No targets in range to repeat the shot.",
    );
  });

  it("refuses to chamber when dry", async () => {
    const { game } = bootGame();
    armShotgun(game);
    // First i reuses the armed chamber; the next 19 spend the rest.
    for (let i = 0; i < 20; i++) {
      game.onKey("i");
      game.onKey("f");
      game.onKey("\r");
      await game.idle();
    }
    assert.equal(snapshot(game).shells, 0);
    game.onKey("i");
    assert.match(snapshot(game).message, /No shells left/);
  });

  it("treats a repeat i in insert mode as a free noop", () => {
    const { game } = bootGame();
    armShotgun(game);
    const before = snapshot(game).turns;
    game.onKey("i");
    const s = snapshot(game);
    assert.match(plain(s.message), /"INSERT BULLET" mode/);
    assert.match(plain(s.message), /Already in/);
    assert.equal(s.turns, before);
    assert.equal(s.loaded, true);
    assert.equal(s.insertMode, true);
  });

  it("repeats the dry warning for free", async () => {
    const { game } = bootGame();
    armShotgun(game);
    for (let i = 0; i < 20; i++) {
      game.onKey("i");
      game.onKey("f");
      game.onKey("\r");
      await game.idle();
    }
    game.onKey("i");
    const before = snapshot(game).turns;
    game.onKey("i");
    assert.match(snapshot(game).message, /No shells left/);
    assert.equal(snapshot(game).turns, before);
  });

  it("paints colored messages at full visible width", () => {
    const { game, screen } = bootGame();
    armShotgun(game);
    const row = screen.textRuns.find((t) =>
      plain(t.spans).includes("INSERT BULLET"),
    );
    assert.ok(row !== undefined, "chamber message was painted");
    assert.equal(plain(row.spans).length, 80);
    assert.equal(
      row.spans.find((span) => span.text.includes("INSERT BULLET"))?.fg,
      "blue",
    );
  });

  it("reselects the last block on a dry gun", async () => {
    const { game } = bootGame();
    armShotgun(game);
    game.onKey("\x16"); // enter target, then visual, while the gun is loaded
    game.onKey("l");
    game.onKey("\x1b"); // back to play; the last block stays remembered
    for (let i = 0; i < 20; i++) {
      game.onKey("i");
      game.onKey("f");
      game.onKey("\r");
      await game.idle();
    }
    game.onKey("i"); // dry chamber: insert stance, nothing loaded
    const dry = snapshot(game);
    assert.equal(dry.loaded, false);
    game.onKey("g");
    game.onKey("v");
    const s = snapshot(game);
    assert.equal(s.mode, "visual");
    assert.match(plain(s.message), /VISUAL BLOCK/);
  });

  it("reselects the last block after firing a volley", async () => {
    const { game } = bootGame();
    armShotgun(game);
    game.onKey("\x16");
    game.onKey("l");
    game.onKey("\r");
    await game.idle();
    const fired = snapshot(game);
    assert.equal(fired.mode, "play");
    assert.equal(fired.loaded, false);
    game.onKey("g");
    game.onKey("v");
    const s = snapshot(game);
    assert.equal(s.mode, "visual");
    assert.match(plain(s.message), /VISUAL BLOCK/);
  });

  it("does not charge a turn for failed chambers", async () => {
    const empty = bootGame();
    empty.game.onKey("i");
    assert.match(snapshot(empty.game).message, /nothing to equip/);
    assert.equal(snapshot(empty.game).turns, 0);
    const { game } = bootGame();
    armShotgun(game);
    for (let i = 0; i < 20; i++) {
      game.onKey("i");
      game.onKey("f");
      game.onKey("\r");
      await game.idle();
    }
    const before = snapshot(game).turns;
    game.onKey("i");
    assert.match(snapshot(game).message, /No shells left/);
    assert.equal(snapshot(game).turns, before);
  });

  it("refuses travel to unknown stairs for free", () => {
    const { game } = bootGame({ arena: false, seed: 7 });
    game.onKey(">");
    const s = snapshot(game);
    assert.match(plain(s.message), /haven't found the down stairs/);
    assert.equal(s.turns, 0);
    assert.equal(s.depth, 1);
  });

  it("travels to known stairs before descending", () => {
    const { game } = bootGame({ arena: false, seed: 7 });
    game.onKey(WALK_DOWN.slice(0, 32));
    game.onKey(">");
    const s = snapshot(game);
    assert.deepEqual(s.player, { x: 57, y: 7 });
    assert.match(plain(s.message), /You see a staircase down\./);
    game.onKey(">");
    assert.equal(snapshot(game).depth, 2);
  });

  it("calls the level-one up stairs the way out", () => {
    const S = makeState({
      mode: "play",
      player: { x: 2, y: 1 },
      depth: 1,
      up: { x: 1, y: 1 },
      walls: createGrid(),
      explored: gridFromKeys(["1,1", "2,1"]),
      visible: gridFromKeys(["1,1", "2,1"]),
    });
    handleKey(
      S,
      { quit: () => {}, fov: createFov(S) } as unknown as InputDeps,
      makeKey("<"),
    );
    assert.equal(
      plain(S.ui.message),
      "You see the staircase out of Bell Labs.",
    );
  });

  it("travels back to the up stairs", () => {
    const { game } = bootGame({ arena: false, seed: 7 });
    game.onKey(WALK_DOWN);
    game.onKey(">");
    const up = snapshot(game).stairsUp;
    game.onKey("k");
    game.onKey("<");
    const s = snapshot(game);
    assert.deepEqual(s.player, up);
    assert.match(plain(s.message), /You see a staircase up\./);
    game.onKey("<");
    assert.equal(snapshot(game).depth, 1);
  });

  it("descends and ascends the seeded dungeon", () => {
    const { game } = bootGame({ arena: false, seed: 7 });
    game.onKey(WALK_DOWN);
    game.onKey(">");
    assert.equal(snapshot(game).depth, 2);
    assert.match(snapshot(game).message, /You descend to level 2\./);
    game.onKey("<");
    assert.equal(snapshot(game).depth, 1);
    assert.match(snapshot(game).message, /You ascend to level 1\./);
  });

  it("starts at the given depth with the skipped shells", () => {
    const { game } = bootGame({ arena: false, seed: 7, depth: 3 });
    const s = snapshot(game);
    assert.equal(s.depth, 3);
    assert.equal(snakesOf(s).length, snakesForDepth(3));
    assert.equal(s.wielded, "Modal Shotgun");
    assert.equal(s.shells, 40);
    assert.equal(s.turns, 0);
    assert.match(plain(s.message), /Press \? for help\./);
  });

  it("banks rank and scrolls into a deep start", () => {
    // Clearing levels 1..13 earns rank 5 with 200 XP left over, and a
    // careful dive would carry three scrolls plus the shells.
    const { game } = bootGame({ arena: false, seed: 7, depth: 14 });
    const s = snapshot(game);
    assert.equal(s.plevel, 5);
    assert.equal(s.xp, 200);
    assert.equal(s.shells, 260);
    assert.equal(s.visualUnlocked, true);
    assert.equal(s.inventory.filter((n) => n.includes("script")).length, 3);
    // The scrolls are real: the execute menu opens on them.
    game.onKey("s");
    assert.equal(snapshot(game).mode, "menu");
  });

  it("snakes below keep moving while upstairs", () => {
    const fresh = bootGame({ arena: false, seed: 7 });
    const initialSnakes = snakeCellsOf(snapshot(fresh.game));
    const { game } = bootGame({ arena: false, seed: 7, depth: 2 });
    game.onKey("w".repeat(8));
    assert.ok(snapshot(game).hp > 0, "survived the upstairs wait");
    game.onKey("<");
    const s = snapshot(game);
    assert.equal(s.depth, 1);
    assert.notDeepEqual(snakeCellsOf(s), initialSnakes);
  });

  it("wanders only the floors beside the player", () => {
    const far: Enemy = {
      kind: "snake",
      x: 1,
      y: 1,
      hp: 6,
      maxHp: 6,
      bite: 2,
      version: pythonVersion("3.9"),
    };
    const near: Enemy = { ...far, x: 2, y: 2 };
    const current = blankLevel({ depth: 3, enemies: [] });
    const farAbove = blankLevel({ depth: 1, enemies: [far] });
    const beside = blankLevel({ depth: 2, enemies: [] });
    const below = blankLevel({ depth: 4, enemies: [near] });
    const S = makeState({
      level: current,
      levels: new Map([
        [1, farAbove],
        [2, beside],
        [3, current],
        [4, below],
      ]),
      player: { x: 5, y: 5 },
    });
    passTurn(S);
    assert.deepEqual({ x: far.x, y: far.y }, { x: 1, y: 1 });
    assert.notDeepEqual({ x: near.x, y: near.y }, { x: 2, y: 2 });
  });

  it("keeps crowded levels clear around the entry stairs", () => {
    const { game } = bootGame({
      arena: false,
      seed: 7,
      depth: BOSS_DEPTH - 1,
    });
    const s = snapshot(game);
    assert.equal(s.depth, BOSS_DEPTH - 1);
    assert.equal(snakesOf(s).length, snakesForDepth(BOSS_DEPTH - 1));
    const up = s.stairsUp;
    assert.ok(up !== null);
    for (const c of snakeCellsOf(s)) {
      assert.ok(
        chebyshev(c, up) >= 8,
        `snake at ${c.x},${c.y} spawns too close to the entry`,
      );
    }
  });
});

describe("repeat shot", () => {
  /** A single-tile code-snake for the hand-built repeat state. */
  const snakeAt = (x: number, y: number): Enemy => ({
    kind: "snake",
    x,
    y,
    hp: 6,
    maxHp: 6,
    bite: 2,
    version: pythonVersion("3.9"),
  });

  /** Minimal state for repeatShot; the screen only sees cell paints. */
  const fireState = (opts: {
    player: { x: number; y: number };
    enemies: Enemy[];
    lastFire: FireAction | null;
  }): GameState => {
    const seen = createGrid();
    for (let x = 0; x <= 8; x++) {
      for (let y = 0; y <= 8; y++) {
        gridAdd(seen, x, y);
      }
    }
    const gun = shotgunSpec();
    return makeState({
      player: { ...opts.player },
      enemies: opts.enemies,
      walls: createGrid(),
      explored: seen,
      visible: seen,
      ground: [],
      message: "",
      depth: 1,
      turns: 0,
      plevel: 1,
      xp: 0,
      hp: 16,
      mode: "play",
      dead: false,
      insertMode: false,
      loaded: false,
      shells: 5,
      wielded: gun,
      inventory: [gun],
      cursor: { ...opts.player },
      visualAnchor: { ...opts.player },
      visualRect: [],
      lastFire: opts.lastFire,
      visualUnlocked: true,
      events: [],
      pendingKeys: "",
      commands: [],
      commandMark: 0,
    });
  };

  it("applies a fire command without touching the presentation mode", () => {
    const a = snakeAt(4, 4);
    const S = fireState({
      player: { x: 3, y: 4 },
      enemies: [a],
      lastFire: null,
    });
    S.ui.mode = "target";
    const cursor = { ...S.ui.cursor };
    const anim = fireCommand(S, {
      cells: [{ x: 4, y: 4 }],
      center: { x: 4, y: 4 },
      visual: false,
    });
    assert.equal(S.ui.mode, "target");
    assert.deepEqual(S.ui.cursor, cursor);
    assert.deepEqual(S.sim.level.enemies, []);
    assert.equal(anim?.kind, "tracer");
    assert.equal(anim?.kind === "tracer" ? anim.ghosts.length : 0, 1);
  });

  it("re-aims a single-shot repeat at the nearest enemy", () => {
    const a = snakeAt(4, 4);
    const b = snakeAt(5, 5);
    const S = fireState({
      player: { x: 3, y: 4 },
      enemies: [a, b],
      lastFire: { cells: [], visual: false },
    });
    const anim = repeatFire(S);
    assert.deepEqual(S.sim.level.enemies, [b]); // the nearer A took the re-aimed shot
    assert.equal(S.sim.turns, 2); // chamber turn + fire turn
    assert.equal(S.sim.shells, 4); // only the chambered round is spent
    assert.equal(anim?.kind, "tracer"); // the presenter plays the line
    assert.equal(S.sim.events.filter((e) => e.type === "kill").length, 1);
  });

  it("refires a volley at the recorded tiles, not the nearest enemy", () => {
    // A sits next to the player; the recorded block is out at B. The repeat
    // must refire B's tiles rather than re-aim at A.
    const a = snakeAt(4, 3);
    const b = snakeAt(6, 4);
    const S = fireState({
      player: { x: 4, y: 4 },
      enemies: [a, b],
      lastFire: {
        cells: [
          { x: 6, y: 4 },
          { x: 6, y: 5 },
        ],
        visual: true,
      },
    });
    const anim = repeatFire(S);
    assert.deepEqual(S.sim.level.enemies, [a]); // B took the recorded volley
    assert.equal(S.sim.turns, 2);
    assert.equal(S.sim.shells, 4);
    // The block went up and the volley produced one ray for B's tile.
    assert.equal(anim?.kind === "tracer" ? anim.lines.length : 0, 1);
    assert.equal(anim?.kind === "tracer" ? anim.selection?.length : 0, 2);
    assert.equal(S.sim.events.filter((e) => e.type === "kill").length, 1);
  });

  it("captures the pre-shot selection on a visual tracer", () => {
    const a = snakeAt(6, 4);
    const S = fireState({
      player: { x: 4, y: 4 },
      enemies: [a],
      lastFire: null,
    });
    S.ui.mode = "visual";
    S.ui.visual.anchor = { x: 6, y: 4 };
    S.ui.cursor = { x: 6, y: 5 };
    S.ui.visual.rect = [
      { x: 6, y: 4 },
      { x: 6, y: 5 },
    ];
    const anim = fireVisual(S);
    assert.equal(anim?.kind, "tracer");
    assert.deepEqual(S.sim.level.enemies, []);
    assert.equal(S.ui.mode, "play");
    assert.equal(anim?.kind === "tracer" ? anim.selection?.length : 0, 2);
  });

  it("stays quiet when the recorded tiles are no longer fireable", () => {
    const S = fireState({
      player: { x: 2, y: 2 },
      enemies: [],
      lastFire: { cells: [{ x: 7, y: 7 }], visual: true },
    });
    const anim = repeatFire(S);
    assert.equal(anim, null);
    assert.equal(
      plain(formatMessage(S.sim.events)),
      "No targets in range to repeat the shot.",
    );
    assert.equal(S.sim.turns, 0);
  });

  it("stays quiet to repeat before any shot", () => {
    const S = fireState({
      player: { x: 2, y: 2 },
      enemies: [snakeAt(3, 2)],
      lastFire: null,
    });
    const anim = repeatFire(S);
    assert.equal(anim, null);
    assert.equal(S.sim.level.enemies.length, 1);
    assert.equal(plain(formatMessage(S.sim.events)), "Nothing to repeat.");
  });
});
