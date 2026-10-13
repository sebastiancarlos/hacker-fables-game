/**
 * Web platform: browser storage and an xterm.js terminal adapter.
 *
 * The game stays platform-neutral; this module is the browser twin of
 * `platform.ts`.
 */
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  parseRecording,
  recordingLabel,
  type Recording,
  type RecordingEntry,
} from "./recording.ts";
import type { Terminal } from "./platform.ts";

/** Storage keys. */
const SCORE_KEY = "hacker-fables:scores";
const RECORDING_PREFIX = "hacker-fables:recording:";

/** Read JSON from localStorage, returning `fallback` on any failure. */
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Append one finished-run score line. */
export function appendScore(line: string): void {
  const scores = readScores();
  scores.push(line);
  localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
}

/** All stored score lines, oldest first. */
export function readScores(): string[] {
  return readJson<string[]>(SCORE_KEY, []);
}

/** Write one run recording. */
export function saveRecording(name: string, text: string): void {
  localStorage.setItem(RECORDING_PREFIX + name, text);
}

/** Recording file names on disk, oldest first. */
function listRecordingNames(): string[] {
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null && key.startsWith(RECORDING_PREFIX)) {
      names.push(key.slice(RECORDING_PREFIX.length));
    }
  }
  return names.sort();
}

/** Read and parse one recording, or null when missing or malformed. */
export function readRecording(name: string): Recording | null {
  try {
    const raw = localStorage.getItem(RECORDING_PREFIX + name);
    if (raw === null) {
      return null;
    }
    return parseRecording(raw);
  } catch {
    return null;
  }
}

/** Recordings in storage for the splash picker, newest first. */
export function recordingEntries(): RecordingEntry[] {
  const entries: RecordingEntry[] = [];
  for (const name of listRecordingNames()) {
    const rec = readRecording(name);
    if (rec !== null) {
      entries.push({
        label: recordingLabel(name, rec.depth),
        path: name,
      });
    }
  }
  return entries.reverse();
}

/** Resolve a replay target against browser storage. */
export function resolveReplay(target: string | undefined): Recording | null {
  if (target === undefined) {
    return null;
  }
  if (target === "latest") {
    const newest = recordingEntries()[0];
    return newest === undefined ? null : readRecording(newest.path);
  }
  return readRecording(target);
}

/** Adapt an xterm.js terminal to the game's terminal contract. */
export function createWebTerminal(
  term: XtermTerminal,
  onQuit: () => void = () => {
    window.location.reload();
  },
): Terminal {
  let writeFinished: Promise<void> = Promise.resolve();

  return {
    write: (s: string): void => {
      if (s === "") {
        writeFinished = Promise.resolve();
        return;
      }
      writeFinished = new Promise((resolve) => {
        term.write(s, resolve);
      });
    },
    sleep: (ms: number): Promise<void> =>
      Promise.all([
        writeFinished,
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, ms);
        }),
      ]).then(() => undefined),
    onData: (fn: (chunk: string) => void): void => {
      term.onData((chunk) => {
        fn(chunk);
      });
    },
    quit: (): void => {
      term.write("\x1b[?1049l\x1b[?25h");
      onQuit();
    },
  };
}
