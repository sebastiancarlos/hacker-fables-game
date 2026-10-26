#!/usr/bin/env node
/**
 * Main: terminal entry point. Run with `node src/main.ts` or `npm start`.
 *
 * Tests never import, they drive `Game` directly with a VirtualScreen
 * from `test/screen.ts`.
 *
 * A run can be started fresh (scored, with a splash) or replayed from a
 * recording. The "View recording" picker boots a second, unscored game in place.
 */
import { AnsiScreen } from "./screen.ts";
import {
  appendScore,
  createTerminal,
  readRecording,
  readScores,
  recordingEntries,
  resolveReplay,
  writeDump,
  writeRecording,
} from "./platform.ts";
import { parseArgs } from "./cli.ts";
import { Game } from "./game.ts";
import type { Recording } from "./recording.ts";
import { decodeInput } from "./terminal-input.ts";

/** Parsed command-line options for this launch. */
const opts = parseArgs(process.argv);

/** The terminal binding for this process. */
const term = createTerminal();

/** The screen that writes through that terminal. */
const screen = new AnsiScreen(term.write);

/** The active game; every launch replaces it in place. */
let game: Game | null = null;

/** Swap in a new game, closing the old one before the new one paints. */
function replace(next: Game): void {
  game?.close();
  game = next;
  next.boot();
}

/** Watch a recording: a fresh, unscored, deterministic re-run of its keys. */
function replay(rec: Recording): void {
  replace(
    new Game({
      screen,
      sleep: term.sleep,
      quit: term.quit,
      arena: rec.arena,
      seed: rec.seed,
      startDepth: rec.depth,
      title: false,
      replay: rec.keys,
      onReplay: replay,
      onQuitToTitle: () => start(true),
    }),
  );
}

/** Watch the recording at a path (the picker's selection). */
function replayPath(path: string): void {
  const rec = readRecording(path);
  if (rec !== null) {
    replay(rec);
  }
}

/** Start a fresh, scored run, with the splash when asked. */
function start(showTitle: boolean): void {
  replace(
    new Game({
      screen,
      sleep: term.sleep,
      quit: term.quit,
      arena: opts.arena,
      seed: opts.seed,
      startDepth: opts.level,
      title: showTitle,
      saveScore: (line) => appendScore(line),
      readScores: () => readScores(),
      saveDump: (name, text) => writeDump(name, text),
      saveRecording: (name, text) => writeRecording(name, text),
      recordings: recordingEntries(),
      onReplay: replay,
      onReplayPath: replayPath,
      onQuitToTitle: () => start(true),
    }),
  );
}

const requested = resolveReplay(opts.replay);
if (requested !== null) {
  replay(requested);
} else {
  start(opts.title);
}

term.onData((chunk) => game?.onKey(decodeInput(chunk)));
