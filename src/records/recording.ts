/**
 * Recording: the seed and input that reproduce a run, Brogue-style.
 *
 * A run is a deterministic function of its seed and the keys fed to it, so
 * replaying those keys from the same seed rebuilds the run exactly. Each
 * finished run is written as one recording beside its morgue dump, and
 * `--replay` (or the title's "View recording") feeds it back in.
 *
 * Pure: no IO, no Screen; the platform layer owns the file.
 */
import type { Key } from "../input/key.ts";

/** On-disk format tag; bump when the shape of Recording changes. */
export const RECORDING_VERSION = 2;

/** A run reduced to what replay needs: the seed, the setup, and the keys. */
export interface Recording {
  version: number;
  seed: number;
  arena: boolean;
  /** Starting depth (`--level`), so a skipped descent replays identically. */
  depth: number;
  /** Normalized keys in the order they were pressed, portable off-terminal. */
  keys: Key[];
}

/** Filename for a run's recording: filesystem-safe, sortable, unique per seed. */
export function recordingFileName(iso: string, seed: number): string {
  return `run-${iso.replace(/[:.]/g, "-")}-seed${seed}.json`;
}

/** One recording offered by the picker: what to show and where it lives. */
export interface RecordingEntry {
  /** Display label, for example `2026-10-16 12-34-56-789  seed 7  depth 1`. */
  label: string;
  /** Filesystem path, read on selection. */
  path: string;
}

/**
 * A human label for a recording file: its run stamp and starting depth.
 * The stamp is the file's ISO time with the punctuation flattened, so
 * `run-2026-10-17T12-42-29-149Z-seed7.json` reads `2026-10-17 12-42-29`.
 */
export function recordingLabel(fileName: string, depth: number): string {
  const stamp = fileName.replace(/^run-/, "").replace(/-seed\d+\.json$/, "");
  const pretty = stamp
    .replace("T", " ")
    .replace(/-\d+Z$/, "")
    .replace(/Z$/, "");
  return `${pretty}  depth ${depth}`;
}

/** Serialize a recording as one JSON line, safe for any control key. */
export function serializeRecording(rec: Recording): string {
  return `${JSON.stringify(rec)}\n`;
}

/** Parse on-disk text back into a recording, or null when it is malformed. */
export function parseRecording(text: string): Recording | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const raw = data as Record<string, unknown>;
  if (
    raw.version !== RECORDING_VERSION ||
    typeof raw.seed !== "number" ||
    typeof raw.arena !== "boolean" ||
    typeof raw.depth !== "number" ||
    !Array.isArray(raw.keys) ||
    !raw.keys.every(isKey)
  ) {
    return null;
  }
  return {
    version: raw.version,
    seed: raw.seed,
    arena: raw.arena,
    depth: raw.depth,
    keys: raw.keys,
  };
}

/** True when a parsed value is a normalized `Key`. */
function isKey(value: unknown): value is Key {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const key = value as Record<string, unknown>;
  return (
    typeof key.key === "string" &&
    typeof key.ctrl === "boolean" &&
    typeof key.shift === "boolean"
  );
}
