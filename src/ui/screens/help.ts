/**
 * Help: compose the command pager from the gameplay bindings.
 *
 * The key rows are read from the play table, so a binding's help text and
 * its action share one declaration. Static prose stays in content.ts.
 */
import { COMMANDS_HELP } from "../../content.ts";
import type { CommandKind } from "../../game/state.ts";
import { PAGER_HELP_ROWS } from "./pager.ts";

/** The binding fields the command pager reads. */
export interface HelpBinding {
  keys: string[];
  kind: CommandKind;
  help?: string;
  helpKeys?: string;
}

/** One two-key command's help row. */
export interface HelpSequence {
  label: string;
  kind: CommandKind;
  help?: string;
  helpKeys?: string;
  helpAfter?: string;
}

/** A mode's bindings and sequences, reduced to what help needs. */
export interface HelpTable {
  bindings: HelpBinding[];
  sequences: HelpSequence[];
  countMoves?: Record<string, unknown>;
}

/** Width of the key column before the description. */
const KEY_COLUMN = 21;

/** One aligned help row. */
function helpRow(keys: string, text: string): string {
  const dots = ".".repeat(Math.max(2, KEY_COLUMN - keys.length));
  return `${keys} ${dots} ${text}`;
}

/** The text a binding shows in the key column. */
function bindingKeys(binding: HelpBinding): string {
  return binding.helpKeys ?? binding.keys[0] ?? "";
}

/** A generated row: the key column and its description. */
interface HelpRow {
  keys: string;
  text: string;
}

/**
 * Build one mode's rows. A blank separates movement from the actions,
 * the counted-move row follows the movement rows, and a sequence can
 * anchor itself after the binding it extends.
 */
function helpRows(table: HelpTable): (HelpRow | null)[] {
  const rows: (HelpRow | null)[] = [];
  let moving = true;
  for (const binding of table.bindings) {
    if (binding.help === undefined) {
      continue;
    }
    if (moving && binding.kind !== "move") {
      if (table.countMoves !== undefined) {
        rows.push({
          keys: COMMANDS_HELP.countMoves.keys,
          text: COMMANDS_HELP.countMoves.help,
        });
      }
      moving = false;
      rows.push(null);
    }
    rows.push({ keys: bindingKeys(binding), text: binding.help });
  }
  if (moving && table.countMoves !== undefined) {
    rows.push({
      keys: COMMANDS_HELP.countMoves.keys,
      text: COMMANDS_HELP.countMoves.help,
    });
  }
  for (const sequence of table.sequences) {
    if (sequence.help === undefined) {
      continue;
    }
    const row = {
      keys: sequence.helpKeys ?? sequence.label,
      text: sequence.help,
    };
    const after = sequence.helpAfter;
    const at =
      after === undefined
        ? -1
        : rows.findIndex((candidate) => candidate?.keys === after);
    if (at === -1) {
      rows.push(row);
    } else {
      rows.splice(at + 1, 0, row);
    }
  }
  return rows;
}

/** Render generated rows, preserving the blank separators. */
function renderRows(rows: (HelpRow | null)[]): string[] {
  return rows.map((row) => (row === null ? "" : helpRow(row.keys, row.text)));
}

/** The complete command reference, with key rows read from a mode table. */
export function commandsLines(table: HelpTable): string[] {
  return [
    COMMANDS_HELP.title,
    "",
    ...COMMANDS_HELP.pagerIntro,
    ...PAGER_HELP_ROWS.map((row) => helpRow(row.keys, row.text)),
    "",
    ...COMMANDS_HELP.movementIntro,
    "",
    ...renderRows(helpRows(table)),
    "",
    ...COMMANDS_HELP.combat,
    "",
    ...COMMANDS_HELP.bottom,
    "",
    ...COMMANDS_HELP.shotgun,
    "",
    ...COMMANDS_HELP.visual,
  ];
}
