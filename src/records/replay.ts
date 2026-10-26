/**
 * Replay: one recording fed through the game's normal key pump.
 *
 * The driver owns only playback state: the key cursor, the pause/step budget,
 * and the loop that waits between turns. The game owns state, rendering, and
 * the pump; the host interface is the narrow bridge between them.
 */
import { KEY_NAME, type Key } from "../input/key.ts";
import type { GameState } from "../game/state.ts";

/** Gap between replayed keys, so a recording is watchable. */
const REPLAY_PACE_MS = 60;

/** The game operations a replay needs. */
export interface ReplayHost {
  /** The live run state. */
  readonly state: Readonly<GameState>;
  /** True while a key or its animation is still in progress. */
  isBusy: () => boolean;
  /** True once the game has been closed or replaced. */
  isClosed: () => boolean;
  /** Queue one recorded key for the normal pump. */
  enqueue: (key: Key) => void;
  /** Resolve once queued keys and any animation have settled. */
  whenPumpIdle: () => Promise<void>;
  /** Draw the current frame, including playback controls. */
  renderFrame: () => void;
  /** Flush the screen, then wait. */
  sleep: (ms: number) => Promise<void>;
  /** Leave the replay for the title screen. */
  exitReplay: () => void;
}

/** Drive one recording through a game's key pump. */
export class ReplayDriver {
  /** The game operations this driver calls. */
  readonly #host: ReplayHost;
  /** Normalized keys from the recording, fed in order. */
  readonly #keys: readonly Key[];
  /** Index of the next recorded key to feed. */
  #at = 0;
  /** Turns left before holding; null while playing, 0 while paused. */
  #stepBudget: number | null = 0;
  /** Callback which wakes the replay loop when playback state changes. */
  #wakeFn: (() => void) | null = null;

  /** Bind a recording to the game that will run it. */
  constructor(host: ReplayHost, keys: readonly Key[]) {
    this.#host = host;
    this.#keys = keys;
  }

  /** True while playback controls, not gameplay keys, own input. */
  get takesInput(): boolean {
    return !this.#host.isClosed() && this.#host.state.meta.runRecord === null;
  }

  /** True while the held or stepping controls should paint. */
  get showsControls(): boolean {
    return (
      this.#stepBudget !== null && this.#host.state.meta.runRecord === null
    );
  }

  /** Start feeding the recording, beginning held at turn zero. */
  start(): void {
    void this.#feed();
  }

  /** Wake a parked feed loop after the game closes. */
  stop(): void {
    this.#wake();
  }

  /** Handle one batch of playback-control keys, a paste included. */
  playbackKey(keys: readonly Key[]): void {
    for (const key of keys) {
      if (key.key === " ") {
        this.#stepBudget = this.#stepBudget === null ? 0 : null;
        if (!this.#host.isBusy()) {
          this.#host.renderFrame();
        }
        if (this.#stepBudget === null) {
          this.#wake();
        }
      } else if (key.key === KEY_NAME.tab) {
        this.#host.state.ui.omniscient = !this.#host.state.ui.omniscient;
        if (!this.#host.isBusy()) {
          this.#host.renderFrame();
        }
      } else if (key.key === "l" && !key.shift && !key.ctrl) {
        // Step one turn, and hold there so the next `l` steps again.
        this.#stepBudget = (this.#stepBudget ?? 0) + 1;
        this.#wake();
      } else if (key.key === KEY_NAME.escape || key.key.toLowerCase() === "q") {
        this.#host.exitReplay();
        return;
      }
    }
  }

  /** Resolve once playback reaches a hold, the end, or a close. */
  async idle(): Promise<void> {
    for (;;) {
      await this.#host.whenPumpIdle();
      if (this.#host.isClosed()) {
        return;
      }
      if (this.#stepBudget === null) {
        if (this.#at < this.#keys.length) {
          await this.#host.sleep(0);
          continue;
        }
        return;
      }
      if (this.#stepBudget > 0) {
        await this.#host.sleep(0);
        continue;
      }
      return;
    }
  }

  /** Wake the parked loop after a playback-state change. */
  #wake(): void {
    const wake = this.#wakeFn;
    this.#wakeFn = null;
    wake?.();
  }

  /** Feed recorded keys until one game turn passes, or the recording ends. */
  async #advanceTurn(): Promise<void> {
    const S = this.#host.state;
    const target = S.sim.turns + 1;
    while (
      !this.#host.isClosed() &&
      S.sim.turns < target &&
      this.#at < this.#keys.length
    ) {
      this.#host.enqueue(this.#keys[this.#at++]!);
      await this.#host.whenPumpIdle();
    }
  }

  /** Play the recording back at a watchable pace, honoring pause and steps. */
  async #feed(): Promise<void> {
    while (!this.#host.isClosed() && this.#at < this.#keys.length) {
      if (this.#stepBudget === null) {
        await this.#host.sleep(REPLAY_PACE_MS);
      }
      while (this.#stepBudget === 0 && !this.#host.isClosed()) {
        await new Promise<void>((resolve) => {
          this.#wakeFn = resolve;
        });
      }
      if (this.#host.isClosed() || this.#at >= this.#keys.length) {
        break;
      }
      await this.#advanceTurn();
      if (this.#stepBudget !== null && this.#stepBudget > 0) {
        this.#stepBudget--;
      }
      // A paused step repaints the tally itself, so restore the controls.
      this.#host.renderFrame();
    }
  }
}
