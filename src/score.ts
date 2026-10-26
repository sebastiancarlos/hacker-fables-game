/**
 * Score: the end-of-run record, its one-line scores-file form, and the
 * lines the end screen shows.
 *
 * Pure helpers only: no IO and no Screen, so one record feeds the end
 * screen, the persisted score line, and (later) the dump and replay.
 */
import type {
  CommandEntry,
  CommandKind,
  GameState,
  Outcome,
  RunRecord,
} from "./game-state.ts";
import { DEATH_LINE, DUNGEON_NAME, END, WIN_LINE } from "./content.ts";
import { BOSS_DEPTH } from "./depth.ts";
import { END_KEYS } from "./end-keys.ts";
import { STYLE_REVERSE } from "./theme.ts";
import { type RichText, linkify, spans } from "./style.ts";

/** Capture the current run as a finished record. */
export function buildRunRecord(
  S: GameState,
  seed: number,
  outcome: Outcome,
): RunRecord {
  return {
    outcome,
    seed,
    // A win happens at level 1's surface hatch, so report the bottom: the
    // GIL can only have fallen `BOSS_DEPTH` deep, however far back up you
    // walked to leave.
    depth: outcome === "won" ? BOSS_DEPTH : S.sim.level.depth,
    level: S.sim.plevel,
    xp: S.sim.xp,
    turns: S.sim.turns,
    commands: S.meta.commands.length,
    killedBy: S.sim.killedBy,
  };
}

/** One tab-separated line for the scores file. */
export function scoreLine(record: RunRecord, iso: string): string {
  const detail = (record.killedBy ?? record.outcome).replace(/[\t\r\n]+/g, " ");
  return [
    iso,
    String(record.seed),
    String(record.depth),
    String(record.level),
    String(record.xp),
    String(record.turns),
    String(record.commands),
    record.outcome,
    detail,
  ].join("\t");
}

/** Points per sub-level reached: the dominant term, so deeper always wins. */
export const DEPTH_POINTS = 1000;
/** Points per character level gained. */
export const LEVEL_POINTS = 100;
/** Points per experience point (two per kill). */
export const XP_POINTS = 10;
/** Points docked per recorded command: efficiency is the tiebreaker. */
export const COMMAND_PENALTY = 1;
/** Flat bonus for finishing the dive instead of dying in it. */
export const WIN_BONUS = 10000;

/**
 * A finished run's score. Depth dominates (each sub-level is worth a
 * thousand), progression adds, and the command count subtracts, so two
 * runs at the same depth rank by how few keystrokes the deeper one took.
 * A victory adds a flat bonus, so it always outranks dying at the bottom.
 * Never negative, so a long shallow run cannot outscore a single descent.
 */
export function scoreOf(record: RunRecord): number {
  const progress =
    record.depth * DEPTH_POINTS +
    record.level * LEVEL_POINTS +
    record.xp * XP_POINTS -
    record.commands * COMMAND_PENALTY;
  const bonus = record.outcome === "won" ? WIN_BONUS : 0;
  return Math.max(0, progress) + bonus;
}

/** A parsed scores-file line: the record, when it finished, and its score. */
export interface ScoreEntry {
  iso: string;
  record: RunRecord;
  score: number;
}

/** Where a fresh score lands among the stored ones. */
export interface Standing {
  score: number;
  /** 1-based rank; ties share the better rank. */
  rank: number;
  /** Stored scores, counting this run. */
  total: number;
}

/** Parse one tab-separated scores line, or null when it is malformed. */
export function parseScoreLine(line: string): ScoreEntry | null {
  const parts = line.split("\t");
  if (parts.length < 9) {
    return null;
  }
  const [iso, seed, depth, level, xp, turns, commands, outcome, detail] = parts;
  const nums = [seed, depth, level, xp, turns, commands].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) {
    return null;
  }
  if (outcome !== "dead" && outcome !== "quit" && outcome !== "won") {
    return null;
  }
  const record: RunRecord = {
    outcome,
    seed: nums[0]!,
    depth: nums[1]!,
    level: nums[2]!,
    xp: nums[3]!,
    turns: nums[4]!,
    commands: nums[5]!,
    killedBy: detail === outcome ? null : (detail ?? null),
  };
  return { iso: iso!, record, score: scoreOf(record) };
}

/** Order two scored runs best-first: score, then depth, then fewest commands. */
function bestFirst(a: ScoreEntry, b: ScoreEntry): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  if (a.record.depth !== b.record.depth) {
    return b.record.depth - a.record.depth;
  }
  if (a.record.commands !== b.record.commands) {
    return a.record.commands - b.record.commands;
  }
  return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0;
}

/** The stored scores, best first; unreadable lines are dropped. */
export function highScores(lines: string[]): ScoreEntry[] {
  return lines
    .map(parseScoreLine)
    .filter((entry): entry is ScoreEntry => entry !== null)
    .sort(bestFirst);
}

/** Where a score of `score` lands among `lines`, with the new total. */
export function scoreRank(lines: string[], score: number): Standing {
  const entries = highScores(lines);
  return {
    score,
    rank: 1 + entries.filter((e) => e.score > score).length,
    total: entries.length + 1,
  };
}

/**
 * One high-score row as cells: rank, score, depth, level, commands, date,
 * and cause. Kept split so the table can align them into columns.
 */
export function scoreCells(rank: number, entry: ScoreEntry): string[] {
  return [
    `${String(rank).padStart(2)}.`,
    String(entry.score),
    `depth ${entry.record.depth}`,
    `Lv ${entry.record.level}`,
    `cmds ${entry.record.commands}`,
    entry.iso.slice(0, 10),
    entry.record.killedBy ?? entry.record.outcome,
  ];
}

/** Display order of the buckets. */
const KINDS: CommandKind[] = ["move", "fire", "item", "travel", "other"];

/** Non-zero command counts by kind, in display order. */
export function commandKinds(
  commands: CommandEntry[],
): { kind: CommandKind; count: number }[] {
  const counts = new Map<CommandKind, number>();
  for (const command of commands) {
    counts.set(command.kind, (counts.get(command.kind) ?? 0) + 1);
  }
  return KINDS.filter((kind) => counts.has(kind)).map((kind) => ({
    kind,
    count: counts.get(kind) as number,
  }));
}

/** Flavor depth label: the facility and its numbered sub-level. */
export function levelLabel(depth: number): string {
  return `"${DUNGEON_NAME}" Sub-level ${depth}`;
}

/** One end-screen inventory row: an item name and how many are carried. */
export interface InventoryRow {
  name: string;
  count: number;
}

/** Collapse identical item names into one row each, in first-seen order. */
export function groupInventory(inventory: string[]): InventoryRow[] {
  const rows: InventoryRow[] = [];
  for (const name of inventory) {
    const found = rows.find((row) => row.name === name);
    if (found === undefined) {
      rows.push({ name, count: 1 });
    } else {
      found.count++;
    }
  }
  return rows;
}

/** Logical end-screen lines, unpadded: render centers them on the frame. */
export function endScreenLines(
  record: RunRecord,
  commands: CommandEntry[],
  inventory: string[],
  canReplay = false,
  standing: Standing | null = null,
): RichText[] {
  const lines: RichText[] = [];
  lines.push(
    record.outcome === "dead"
      ? DEATH_LINE
      : record.outcome === "won"
        ? WIN_LINE
        : END.quitLine,
  );
  lines.push("");
  lines.push(
    record.outcome === "won"
      ? END.won(levelLabel(record.depth))
      : record.killedBy === null
        ? END.quitAt(levelLabel(record.depth))
        : END.slain(record.killedBy, levelLabel(record.depth)),
  );
  lines.push("");
  lines.push(
    END.stats(record.depth, record.level, record.xp, record.turns, record.seed),
  );
  const score = scoreOf(record);
  lines.push(
    standing === null
      ? END.score(score)
      : END.scoreRank(score, standing.rank, standing.total),
  );
  lines.push("");
  lines.push(END.commands(record.commands));
  const kinds = commandKinds(commands);
  lines.push(
    kinds.length === 0
      ? END.none
      : kinds.map((k) => `${k.kind} ${k.count}`).join("   "),
  );
  lines.push("");
  lines.push(END.inventory);
  const rows = groupInventory(inventory);
  if (rows.length === 0) {
    lines.push(END.empty);
  } else {
    for (const row of rows.slice(0, 6)) {
      lines.push(row.count > 1 ? `${row.name} x${row.count}` : row.name);
    }
    if (rows.length > 6) {
      lines.push(END.more(rows.length - 6));
    }
  }
  lines.push("");
  if (canReplay) {
    lines.push(
      spans(
        END.replayLead,
        { text: END_KEYS.replay, ...STYLE_REVERSE },
        END.replayTail,
      ),
    );
  }
  lines.push(
    spans(
      END.quitLead,
      { text: END_KEYS.quit, ...STYLE_REVERSE },
      END.quitTail,
    ),
  );
  lines.push("");
  lines.push(END.coffeeLead);
  lines.push(linkify(END.coffeeUrl));
  return lines;
}
