/**
 * Dump: the morgue report written when a run ends.
 *
 * Pure: a frozen RunRecord plus the run's commands and pack becomes a
 * Markdown report. The end screen summarizes the same record; the dump
 * keeps it in a file the player can read later, NetHack-style, and the
 * padding is chosen so the raw source still reads as columns.
 */
import type { CommandEntry, RunRecord } from "../game/state.ts";
import { commandKinds, levelLabel } from "./score.ts";
import { visibleLength } from "../ui/text.ts";

/** Filename for a run dump: filesystem-safe, sortable, unique per seed. */
export function dumpFileName(iso: string, seed: number): string {
  return `run-${iso.replace(/[:.]/g, "-")}-seed${seed}.md`;
}

/**
 * A Markdown table: header, rule, then rows with each cell padded to its
 * column's widest so the file lines up before anything renders it.
 */
function table(headers: string[], rows: string[][]): string[] {
  const width = headers.map((head, c) =>
    Math.max(
      3,
      visibleLength(head),
      ...rows.map((row) => visibleLength(row[c] ?? "")),
    ),
  );
  const line = (cells: string[], fill = " ") =>
    `| ${cells.map((cell, c) => cell.padEnd(width[c]!, fill)).join(" | ")} |`;
  return [
    line(headers),
    line(
      headers.map(() => "---"),
      "-",
    ),
    ...rows.map((row) => line(row)),
  ];
}

/** The morgue report: a Markdown summary of the run, ready to write. */
export function dumpText(
  record: RunRecord,
  commands: CommandEntry[],
  inventory: string[],
  iso: string,
): string {
  const facts: string[][] = [
    ["Written", iso],
    ["Outcome", record.outcome],
  ];
  if (record.killedBy !== null) {
    facts.push(["Cause", record.killedBy]);
  }
  facts.push(
    ["Location", levelLabel(record.depth)],
    ["Depth", String(record.depth)],
    ["Level", String(record.level)],
    ["Experience", String(record.xp)],
    ["Turns", String(record.turns)],
    ["Commands", String(record.commands)],
    ["Seed", String(record.seed)],
  );

  const lines: string[] = [
    "# Hacker Fables run dump",
    "",
    ...table(["Field", "Value"], facts),
  ];
  lines.push("", `## Vim commands (${record.commands})`, "");
  const kinds = commandKinds(commands);
  lines.push(
    ...(kinds.length === 0
      ? ["_None._"]
      : table(
          ["Kind", "Count"],
          kinds.map((k) => [k.kind, String(k.count)]),
        )),
  );
  lines.push("", "## Inventory", "");
  lines.push(
    ...(inventory.length === 0
      ? ["_Empty._"]
      : inventory.map((name) => `- ${name}`)),
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}
