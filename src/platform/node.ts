/**
 * Thin platform layer: the only place that touches process stdin,
 * stdout, timers, and the persisted data files. The game never imports
 * this module.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UI } from "../content.ts";
import {
  parseRecording,
  recordingLabel,
  type Recording,
  type RecordingEntry,
} from "../records/recording.ts";

// The hooks for the Node terminal.
export interface Terminal {
  write: (s: string) => void;
  sleep: (ms: number) => Promise<void>;
  onData: (fn: (chunk: string) => void) => void;
  quit: () => void;
}

/**
 * Bind the game to the real Node terminal and return the four hooks it
 * needs:
 * - `write` sends bytes to stdout.
 * - `sleep` waits on a real timer, for pacing animations.
 * - `onData` reads stdin and, when stdin is a TTY, switches it to raw mode
 *   so keypresses arrive unbuffered and Ctrl+C still reaches the process.
 *   The "not TTY" case is for piped stdin, which is how the test suite feeds
 *   keys. It registers `fn` as the data handler.
 * - `quit` undoes the terminal setup. It prints the goodbye line and exits
 *   from the write callback, because `process.exit` would otherwise truncate
 *   buffered piped output.
 */
export function createTerminal(): Terminal {
  let restored = false;

  /** Undo raw mode, the alternate screen, and the hidden cursor. */
  const restore = (): void => {
    if (restored) {
      return;
    }
    restored = true;
    try {
      process.stdout.write("\x1b[?25h"); // show cursor
      process.stdout.write("\x1b[?1049l"); // leave alternate screen
    } catch {
      // stdout may already be gone during a hard crash.
    }
    try {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    } catch {
      // stdin may already be gone during a hard crash.
    }
  };
  process.once("exit", restore);

  /** Restore before rethrowing, so the crash leaves a usable shell. */
  const onUncaught = (err: unknown): void => {
    restore();
    process.removeListener("uncaughtException", onUncaught);
    throw err;
  };
  process.on("uncaughtException", onUncaught);

  const write = (s: string): void => {
    process.stdout.write(s);
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

  const onData = (fn: (chunk: string) => void): void => {
    process.stdin.setEncoding("utf8");
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("data", fn);
  };

  const quit = (): void => {
    restore();
    // Exit only after the goodbye flushes.
    process.stdout.write(`${UI.goodbye}\n`, () => process.exit(0));
  };

  return { write, sleep, onData, quit };
}

/** Read a non-empty environment override. */
function envPath(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

/** Env var that overrides the game data dir, for tests and hermetic runs. */
export const DATA_ENV = "HACKER_FABLES_DATA";

/** Root data directory for the game: env override, XDG data home, or fallback. */
export function defaultDataDir(): string {
  const override = envPath(DATA_ENV);
  if (override !== undefined) {
    return override;
  }
  const data =
    envPath("XDG_DATA_HOME") ?? path.join(os.homedir(), ".local", "share");
  return path.join(data, "hacker-fables");
}

/** Where finished runs are appended. */
export function defaultScorePath(): string {
  return path.join(defaultDataDir(), "scores.txt");
}

/** Append one finished-run line, creating the file's directory if needed. */
export function appendScore(
  line: string,
  file: string = defaultScorePath(),
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${line}\n`);
}

/** All stored score lines, oldest first; empty when the file is absent. */
export function readScores(file: string = defaultScorePath()): string[] {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
  } catch {
    return [];
  }
}

/** Where run dumps go. */
export function defaultMorgueDir(): string {
  return path.join(defaultDataDir(), "morgue");
}

/** Write one run dump, creating the morgue directory if needed. */
export function writeDump(
  name: string,
  text: string,
  dir: string = defaultMorgueDir(),
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

/** Where run recordings go. */
export function defaultRecordingDir(): string {
  return path.join(defaultDataDir(), "recordings");
}

/** Write one run recording, creating the recordings directory if needed. */
export function writeRecording(
  name: string,
  text: string,
  dir: string = defaultRecordingDir(),
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

/** Recording files on disk, oldest first (names carry a sortable timestamp). */
export function listRecordings(dir: string = defaultRecordingDir()): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(dir, name));
}

/** Read and parse one recording, or null when it is missing or malformed. */
export function readRecording(file: string): Recording | null {
  try {
    return parseRecording(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Recordings on disk for the picker: readable ones only, newest first. */
export function recordingEntries(
  dir: string = defaultRecordingDir(),
): RecordingEntry[] {
  const entries: RecordingEntry[] = [];
  for (const file of listRecordings(dir)) {
    const rec = readRecording(file);
    if (rec !== null) {
      entries.push({
        label: recordingLabel(path.basename(file), rec.depth),
        path: file,
      });
    }
  }
  return entries.reverse();
}

/** The newest readable recording on disk, or null when there are none. */
export function latestRecording(
  dir: string = defaultRecordingDir(),
): Recording | null {
  const newest = recordingEntries(dir)[0];
  return newest === undefined ? null : readRecording(newest.path);
}

/** Resolve `--replay`: a path, or the newest recording for "latest". */
export function resolveReplay(
  target: string | undefined,
  dir: string = defaultRecordingDir(),
): Recording | null {
  if (target === undefined) {
    return null;
  }
  return target === "latest" ? latestRecording(dir) : readRecording(target);
}
