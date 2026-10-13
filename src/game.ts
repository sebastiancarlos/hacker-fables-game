/**
 * Game: headless state owner and presenter wiring.
 *
 * The instance owns a single `GameState`. Logic mutates that state and may
 * return an animation; this module queues keys, plays each animation to
 * completion, draws the result, and hands recordings to a replay driver.
 */
import type { Screen } from "./screen.ts";
import { enemyCells, buildLevel, ELEVATOR_POS, type Enemy } from "./world.ts";
import {
  createState,
  markCorruptionWarning,
  type Animation,
  type GameState,
} from "./game-state.ts";
import type { Recording, RecordingEntry } from "./recording.ts";
import { isQuit, type Key } from "./key.ts";
import { SEED_MODULUS } from "./rng.ts";
import { scriptSpec, shotgunSpec, type Item } from "./items.ts";
import { startingKit, VISUAL_UNLOCK_LEVEL } from "./progression.ts";
import { arriveAt, getLevel } from "./levels.ts";
import { createFov, computeVision, type Fov } from "./vision.ts";
import type { InputDeps } from "./input.ts";
import {
  handleKey,
  presentAfterKey,
  presentPendingEffects,
  render,
} from "./modes.ts";
import {
  paintCell,
  paintElevatorFrame,
  paintPlaybackControls,
  putCell,
} from "./render.ts";
import { openTitle } from "./title.ts";
import { isWall } from "./queries.ts";
import { ELEVATOR_FRAME_MS, SHOT_BUDGET_MS, STYLE_SHOT } from "./theme.ts";
import { ReplayDriver } from "./replay.ts";

/** Persistence and replay hooks passed in by the platform. */
export interface RunStore {
  /** Append one finished-run score line. Omitted in tests and headless play. */
  saveScore?: ((line: string) => void) | undefined;
  /** The stored score lines, read to rank the run and fill the table. */
  readScores?: (() => string[]) | undefined;
  /** Write one finished-run morgue dump. Omitted by the web frontend. */
  saveDump?: ((name: string, text: string) => void) | undefined;
  /** Write one finished-run replay recording. Omitted in tests and headless play. */
  saveRecording?: ((name: string, text: string) => void) | undefined;
  /** Watch a recording again (the end screen's `r`): in-memory, no file. */
  onReplay?: ((rec: Recording) => void) | undefined;
}

/** Everything `Game` needs from its platform and run store. */
export interface GameDeps extends RunStore {
  /** Terminal surface. */
  screen: Screen;
  /** Injected clock: real timers on terminal, immediate in tests. */
  sleep: (ms: number) => Promise<void>;
  /** Platform quit (restore the terminal and exit). */
  quit: () => void;
  /** True for the deterministic single-room arena (for tests). */
  arena: boolean;
  /** Show the quit key on the splash. Defaults to true. */
  showQuit?: boolean | undefined;
  /** Optional dungeon seed for reproducible generation. */
  seed?: number | undefined;
  /** Start directly at this depth. */
  startDepth?: number | undefined;
  /** Show the boot splash first; default true. Tests pass false. */
  title?: boolean | undefined;
  /** Normalized keys to replay on boot, from a Recording. Implies no title. */
  replay?: Key[] | undefined;
  /** Recordings the splash can watch, newest first. */
  recordings?: RecordingEntry[] | undefined;
  /** Watch the recording at this path (the picker's selection). */
  onReplayPath?: ((path: string) => void) | undefined;
  /** Leave a replay for the title screen. */
  onQuitToTitle?: (() => void) | undefined;
}

/** Headless game: one instance owns one run, all IO via deps. */
export class Game {
  /** Platform and run-store hooks. */
  readonly #deps: GameDeps;
  /** Terminal surface this game paints to. */
  readonly #screen: Screen;
  /** The run's mutable state. */
  readonly #state: GameState;
  /** Shadowcasting FOV instance used to compute visibility. */
  readonly #fov: Fov;
  /** References needed for key handlers bound to this game. */
  readonly #inputDeps: InputDeps;

  /** A quit is pending until the current key's frame is drawn. */
  #quitRequested = false;
  /** Finished or replaced: this game must not feed or paint. */
  #closed = false;
  /** Keys accepted but not yet processed. */
  #queue: Key[] = [];
  /** True while a key or its animation is still in progress. */
  #busy = false;
  /** Resolves when the current animation settles. */
  #inflight: Promise<void> = Promise.resolve();
  /** Playback driver when this game is replaying a recording. */
  readonly #replay: ReplayDriver | null;

  constructor(deps: GameDeps) {
    this.#deps = deps;
    this.#screen = deps.screen;

    // One seed drives both the dungeon layout and the ambient RNG, so a run
    // is a pure function of its seed and input. That purity is what lets a
    // recording replay the run byte-for-byte.
    const baseSeed = deps.seed ?? Math.floor(Math.random() * SEED_MODULUS);
    const startDepth = deps.startDepth ?? 1;

    const firstLevel = buildLevel(1, {
      arena: deps.arena,
      baseSeed,
    });
    this.#state = createState({
      arena: deps.arena,
      baseSeed,
      startDepth,
      visualUnlocked: deps.arena || startDepth >= VISUAL_UNLOCK_LEVEL,
      firstLevel,
    });

    this.#state.ui.showQuit = deps.showQuit ?? true;

    // create FOV instance
    this.#fov = createFov(this.#state);

    // create #inputDeps, with references to pass to key handlers.
    this.#inputDeps = {
      saveScore: deps.saveScore,
      readScores: deps.readScores,
      saveDump: deps.saveDump,
      saveRecording: deps.saveRecording,
      onReplay: deps.onReplay,
      quit: () => this.#quit(),
      fov: this.#fov,
      onReplayPath: deps.onReplayPath,
      onQuitToTitle: deps.onQuitToTitle,
    };

    // handle starting above level 1 (typically via `--level N` flag)
    if (!deps.arena && startDepth > 1) {
      // generate all levels
      const S = this.#state;
      const target = startDepth;
      for (let d = 2; d <= target; d++) {
        getLevel(S, d);
      }
      const dest = getLevel(S, target);
      arriveAt(S, dest, dest.up ?? S.sim.player);

      // Grants the stats/items a careful dive would have obtained
      const gun: Item = shotgunSpec();
      S.sim.wielded = gun;
      S.sim.inventory.push(gun);
      const kit = startingKit(target);
      S.sim.shells += kit.shells;
      S.sim.plevel = kit.plevel;
      S.sim.xp = kit.xp;
      for (const effect of kit.scripts) {
        S.sim.inventory.push(scriptSpec(effect));
      }
    }

    // setup replay driver, if needed
    this.#replay =
      deps.replay === undefined
        ? null
        : new ReplayDriver(
            {
              state: this.#state,
              isBusy: () => this.#busy,
              isClosed: () => this.#closed,
              enqueue: (key) => {
                this.#queue.push(key);
                this.#pump();
              },
              whenPumpIdle: () => this.#whenPumpIdle(),
              renderFrame: () => this.#renderFrame(),
              sleep: (ms) => this.#sleep(ms),
              exitReplay: () => this.#exitPlayback(),
            },
            deps.replay,
          );
  }

  /** Game state getter, for inspection. Treated as read-only. */
  get state(): Readonly<GameState> {
    return this.#state;
  }

  /** Mark the instance closed and wake a parked replay loop. */
  close(): void {
    this.#closed = true;
    this.#queue.length = 0;
    this.#replay?.stop();
  }

  /** Flush the screen before waiting for `ms`. */
  async #sleep(ms: number): Promise<void> {
    this.#screen.flush();
    await this.#deps.sleep(ms);
  }

  // Quit is deferred to the end of the key. The frame for the
  // quitting key must reach the screen before the terminal leaves
  // the alternate screen and flushes.
  #quit(): void {
    this.#quitRequested = true;
  }

  /**
   * Leave for good once the current key batch has finished drawing. Queued
   * keys are dropped because the terminal is about to go away.
   */
  #maybeQuit(): void {
    if (!this.#quitRequested) {
      return;
    }
    this.#quitRequested = false;
    this.#queue.length = 0;
    this.#screen.flush();
    this.#deps.quit();
  }

  /** Ctrl-C: stop immediately, dropping queued keys and any animation. */
  #hardQuit(): void {
    this.#queue.length = 0;
    this.#closed = true;
    this.#replay?.stop();
    this.#screen.flush();
    this.#deps.quit();
  }

  /** Leave a replay for the title screen, stopping the feed first. */
  #exitPlayback(): void {
    this.close();
    this.#deps.onQuitToTitle?.();
  }

  /**
   * Draw the current frame, overlay replay controls, then send it to the
   * terminal.
   */
  #renderFrame(): void {
    if (this.#closed) {
      return;
    }
    const S = this.#state;
    render(S, this.#screen);
    if (this.#replay?.showsControls === true) {
      paintPlaybackControls(this.#screen);
    }
    this.#screen.flush();
  }

  /** Play one simulation animation against the screen. */
  async #playAnimation(anim: Animation): Promise<void> {
    if (this.#closed) {
      return;
    }
    const S = this.#state;
    if (anim.kind === "tracer") {
      // Paint the captured visual block first. Natural visual shots and `gv`
      // already show it; `.` does not, so this gives every volley the same
      // opening frame without delaying the shot.
      for (const { x, y, cell } of anim.selection ?? []) {
        putCell(this.#screen, x, y, cell);
      }
      if (anim.selection !== undefined) {
        this.#screen.flush();
      }
      // The pre-key frame is still on screen. Restore each cell from the
      // current state, and erase a killed enemy's whole body as soon as the
      // ray reaches any part of it.
      const gone = new Set<Enemy>();
      // Map each ghost's cells once, so a tracer step does not rescan
      // every doomed enemy and rebuild its shape for every cell.
      const ghostByCell = new Map<string, Enemy>();
      for (const enemy of anim.ghosts) {
        for (const cell of enemyCells(enemy)) {
          ghostByCell.set(`${cell.x},${cell.y}`, enemy);
        }
      }
      for (const line of anim.lines) {
        if (this.#closed) {
          return;
        }
        const stepMs =
          line.length === 0
            ? 0
            : Math.min(
                25,
                Math.max(5, Math.floor(SHOT_BUDGET_MS / line.length)),
              );
        for (const c of line) {
          if (isWall(S, c.x, c.y)) {
            break;
          }
          putCell(this.#screen, c.x, c.y, { ch: "*", ...STYLE_SHOT });
          await this.#sleep(stepMs);
          if (this.#closed) {
            return;
          }
          paintCell(S, this.#screen, c.x, c.y);
          const ghost = ghostByCell.get(`${c.x},${c.y}`);
          if (ghost !== undefined && !gone.has(ghost)) {
            gone.add(ghost);
            for (const g of enemyCells(ghost)) {
              paintCell(S, this.#screen, g.x, g.y);
            }
          }
        }
      }
      return;
    }
    // elevator animation
    const step = anim.to > anim.from ? 1 : -1;
    for (let d = anim.from + step; d !== anim.to + step; d += step) {
      if (this.#closed) {
        return;
      }
      paintElevatorFrame(this.#screen, getLevel(S, d).walls, ELEVATOR_POS);
      await this.#sleep(ELEVATOR_FRAME_MS);
    }
  }

  /** Apply one key and return any animation it produced. */
  #step(key: Key): Animation | null {
    const S = this.#state;
    // Record every key fed to the run (title keys and the post-death screen
    // excepted), replay keys included, so the end screen can offer the same
    // run again.
    if (S.ui.mode !== "title" && S.meta.runRecord === null) {
      S.meta.inputLog.push(key);
    }

    const anim = handleKey(S, this.#inputDeps, key);

    // The key may have replaced this game (a replay pick or a replay
    // request). Stop before this instance paints over the new one.
    if (this.#closed) {
      this.#queue.length = 0;
      return null;
    }

    return anim;
  }

  /**
   * Draw a key's result. Death and win frames come before the end screen;
   * popups and the end screen open after any animation has played.
   */
  #settleKey(): void {
    if (this.#closed) {
      return;
    }
    const S = this.#state;
    if (S.sim.dead || S.sim.won) {
      this.#renderFrame();
    }
    presentAfterKey(S, this.#inputDeps);
    this.#renderFrame();
  }

  /**
   * Process queued keys synchronously until one asks for an animation. The
   * animation then owns the screen; its continuation resumes the queue.
   */
  #pump(): void {
    if (this.#busy || this.#closed) {
      return;
    }
    this.#busy = true;
    try {
      while (!this.#closed && !this.#quitRequested && this.#queue.length > 0) {
        const anim = this.#step(this.#queue.shift()!);
        if (this.#closed) {
          break;
        }
        if (anim !== null) {
          this.#inflight = this.#playThenResume(anim);
          return;
        }
        this.#settleKey();
      }
    } catch (error) {
      this.#busy = false;
      throw error;
    }
    this.#busy = false;
    this.#maybeQuit();
  }

  /** Play one key's animation, draw its final frame, then resume the queue. */
  async #playThenResume(anim: Animation): Promise<void> {
    try {
      await this.#playAnimation(anim);
      if (!this.#closed) {
        this.#settleKey();
      }
    } finally {
      this.#busy = false;
    }
    if (!this.#closed) {
      this.#pump();
    }
  }

  /** Resolve once the queue and any animation have settled. */
  async #whenPumpIdle(): Promise<void> {
    while (this.#busy) {
      await this.#inflight;
    }
  }

  /**
   * Feed normalized keys.
   *
   * While a replay is still running, the usual keys give way to playback
   * controls. Once the run ends, the end screen takes over. Ctrl-C always
   * quits.
   */
  onKey(keys: Key[]): void {
    if (keys.some(isQuit)) {
      this.#hardQuit();
      return;
    }

    if (this.#replay?.takesInput === true) {
      this.#replay.playbackKey(keys);
    } else {
      this.#queue.push(...keys);
      this.#pump();
    }
  }

  /** Compute the first frame and open the splash, replay, or warning. */
  boot(): void {
    const S = this.#state;
    this.#screen.begin();
    computeVision(S, this.#fov);
    if (this.#replay !== null) {
      // handle replay
      markCorruptionWarning(S);
      presentPendingEffects(S);
      this.#renderFrame();
      this.#replay.start();
    } else if (this.#deps.title ?? true) {
      // handle title
      openTitle(
        S,
        this.#deps.recordings ?? [],
        this.#deps.readScores?.() ?? [],
      );
      this.#renderFrame();
    } else {
      // handle regular game
      markCorruptionWarning(S);
      presentPendingEffects(S);
      this.#renderFrame();
    }
  }

  /** Resolve once playback and any pending replay step have settled. */
  async idle(): Promise<void> {
    if (this.#replay !== null) {
      await this.#replay.idle();
      return;
    }
    await this.#whenPumpIdle();
  }
}
