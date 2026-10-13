/**
 * Endgame: the death (or victory) screen and the score it persists.
 *
 * Mutates S and files the run; the renderer paints the "over" screen. The
 * record is built once and stored on S, so the end screen, the score file,
 * and a future dump all read the same frozen summary.
 */
import type { GameState, Outcome } from "./game-state.ts";
import { buildRunRecord, scoreLine, scoreOf, scoreRank } from "./score.ts";
import { dumpFileName, dumpText } from "./dump.ts";
import {
  RECORDING_VERSION,
  recordingFileName,
  serializeRecording,
  type Recording,
} from "./recording.ts";
import { dispatch, type Binding } from "./keymap.ts";
import { END_KEYS } from "./end-keys.ts";
import type { RunStore } from "./game.ts";

/** Run config and storage hooks for filing the end screen. */
export interface EndDeps extends RunStore {
  seed: number;
  /** Whether the run began in the arena, for the replay header. */
  arena: boolean;
  /** The run's starting depth, for the replay header. */
  depth: number;
  quit: () => void;
  /** Clock for the score timestamp; injected for deterministic tests. */
  now?: () => Date;
}

/**
 * File the run once: freeze the run record, write its score line, morgue
 * dump, and replay recording, and enter "over" mode. Re-entrant calls are
 * no-ops, so death detected twice never writes twice.
 */
export function openEndScreen(S: GameState, deps: EndDeps): void {
  if (S.meta.runRecord === null) {
    const outcome: Outcome = S.sim.won ? "won" : S.sim.dead ? "dead" : "quit";
    const record = buildRunRecord(S, deps.seed, outcome);
    S.meta.runRecord = record;
    // Rank against the file as it stands, before this run joins it, so its
    // own line never counts against it. Only scored runs carry a standing.
    S.meta.standing =
      deps.saveScore === undefined
        ? null
        : scoreRank(deps.readScores?.() ?? [], scoreOf(record));
    const iso = (deps.now?.() ?? new Date()).toISOString();
    if (deps.saveScore !== undefined) {
      deps.saveScore(scoreLine(record, iso));
    }
    if (deps.saveDump !== undefined) {
      const names = S.sim.inventory.map((item) => item.name);
      deps.saveDump(
        dumpFileName(iso, record.seed),
        dumpText(record, S.meta.commands, names, iso),
      );
    }
    const recording: Recording = {
      version: RECORDING_VERSION,
      seed: deps.seed,
      arena: deps.arena,
      depth: deps.depth,
      keys: [...S.meta.inputLog],
    };
    S.meta.recording = recording;
    if (deps.saveRecording !== undefined) {
      deps.saveRecording(
        recordingFileName(iso, record.seed),
        serializeRecording(recording),
      );
    }
  }
  S.ui.mode = "over";
  S.ui.modals.length = 0;
}

/** Run-end filing; the generation config comes from `S`. */
export type SettleDeps = Omit<EndDeps, "seed" | "arena" | "depth">;

/** Set up the death (or victory) screen. Idempotent across repeat calls. */
export function settle(S: GameState, deps: SettleDeps): void {
  if (S.ui.mode === "over") {
    return;
  }
  if (!S.sim.dead && !S.sim.won) {
    return;
  }
  openEndScreen(S, {
    ...deps,
    seed: S.meta.baseSeed,
    arena: S.meta.arena,
    depth: S.meta.startDepth,
  });
}

/** What an end-screen key can reach: the run's state and its outcomes. */
interface EndCtx {
  S: GameState;
  quit: () => void;
  onReplay?: ((rec: Recording) => void) | undefined;
}

/** End-screen bindings: `r` watches the run again, the rest leave. */
const END_BINDINGS: Binding<EndCtx>[] = [
  {
    keys: [END_KEYS.replay, END_KEYS.replay.toUpperCase()],
    run: (c) => {
      if (c.onReplay !== undefined && c.S.meta.recording !== null) {
        c.onReplay(c.S.meta.recording);
      }
    },
  },
  {
    keys: [END_KEYS.quit, END_KEYS.quit.toUpperCase(), "<CR>", "<Esc>"],
    run: (c) => c.quit(),
  },
];

/**
 * End-screen keys: `r` watches the run again, `q`/Return/Esc leaves the
 * game, the rest wait.
 */
export function endScreenKey(
  S: GameState,
  chunk: string,
  quit: () => void,
  onReplay?: (rec: Recording) => void,
): void {
  dispatch(END_BINDINGS, { S, quit, onReplay }, chunk);
}
