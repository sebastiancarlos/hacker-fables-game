/**
 * CLI: turn process arguments into one run configuration.
 *
 * Pure argument handling. The platform owns terminal IO and storage; main
 * passes `process.argv` here, then launches the game from the result.
 */
import { parseArgs as parseNodeArgs } from "node:util";
import { BOSS_DEPTH } from "./world/depth.ts";

/** Parsed command-line options for one process launch. */
export interface RunOptions {
  arena: boolean;
  seed?: number | undefined;
  /** Starting depth, from 1 through the bottom. */
  level?: number | undefined;
  /** Show the boot splash unless `--no-title` is passed. */
  title: boolean;
  /** Replay a recording: a file path, or "latest" for the newest on disk. */
  replay?: string | undefined;
}

/** Parse one integer flag, throwing instead of silently ignoring junk. */
function parseIntegerFlag(flag: string, value: string): number {
  const text = value.trim();
  if (!/^-?\d+$/.test(text)) {
    throw new Error(`${flag} expects an integer, got ${value}`);
  }
  const n = Number(text);
  if (!Number.isSafeInteger(n)) {
    throw new Error(`${flag} expects an integer, got ${value}`);
  }
  return n;
}

/** Turn a bare `--replay` into `--replay=latest` before node parses. */
function normalizeReplay(args: string[]): string[] {
  const out = [...args];
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== "--replay") {
      continue;
    }
    const next = out[i + 1];
    if (next === undefined || next.startsWith("-")) {
      out[i] = "--replay=latest";
    }
  }
  return out;
}

/**
 * Parse entrypoint arguments.
 * Bad values throw, and `--level` must be between 1 and the bottom.
 */
export function parseArgs(argv: string[]): RunOptions {
  let parsed;
  try {
    parsed = parseNodeArgs({
      args: normalizeReplay(argv.slice(2)),
      strict: true,
      allowPositionals: false,
      options: {
        arena: { type: "boolean" },
        seed: { type: "string" },
        level: { type: "string" },
        replay: { type: "string" },
        "no-title": { type: "boolean" },
      },
    });
  } catch (err) {
    throw new Error(`Invalid arguments: ${(err as Error).message}`);
  }
  const { values } = parsed;
  const seedText = values.seed;
  const seed =
    typeof seedText === "string"
      ? parseIntegerFlag("--seed", seedText)
      : undefined;
  const levelText = values.level;
  let level: number | undefined;
  if (typeof levelText === "string") {
    const n = parseIntegerFlag("--level", levelText);
    if (n < 1 || n > BOSS_DEPTH) {
      throw new Error(`--level expects 1 through ${BOSS_DEPTH}, got ${n}`);
    }
    level = n;
  }
  const replay = values.replay;
  return {
    arena: values.arena === true,
    seed,
    level,
    title: values["no-title"] !== true,
    replay: typeof replay === "string" ? replay : undefined,
  };
}
