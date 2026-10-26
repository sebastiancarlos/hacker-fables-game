/**
 * Commands: the one-line tally the status area shows, built from the labels
 * the gameplay modes record.
 *
 * Pure rendering helpers only, no IO and no Screen. One label per atomic
 * command, so the same list can key the eventual end-of-run breakdown by
 * type. The labels and buckets live with the key tables in input.ts, so a
 * key and its tally text cannot drift apart. Consecutive repeats merge into
 * `(xN)`; dropped runs leave a `...` on the left.
 */
import type { CommandEntry } from "../game/state.ts";

/** One collapsed command: a label and how many times it repeated in a row. */
interface CommandRun {
  label: string;
  count: number;
}

/** Collapse consecutive identical labels since `from` into runs. */
function collapseRuns(commands: CommandEntry[], from: number): CommandRun[] {
  const runs: CommandRun[] = [];
  for (let i = from; i < commands.length; i++) {
    const label = commands[i]!.label;
    const last = runs[runs.length - 1];
    if (last !== undefined && last.label === label) {
      last.count++;
    } else {
      runs.push({ label, count: 1 });
    }
  }
  return runs;
}

/**
 * Render one run: a lone command is its label, a repeat gains `(xN)`.
 * A label that already ends in a paren absorbs the count instead, so
 * `.(visual-fire)` doubles as `.(visual-fire x2)`, not a doubled paren.
 */
function runText(run: CommandRun): string {
  if (run.count === 1) {
    return run.label;
  }
  if (run.label.endsWith(")")) {
    return `${run.label.slice(0, -1)} x${run.count})`;
  }
  return `${run.label} (x${run.count})`;
}

/**
 * The tally line: the run-wide command count and the most recent labels
 * of the current level, packed to fit `width`. `from` is where the
 * current level's segment starts in `commands`, so a fresh level shows
 * the running total with an empty recent list. Consecutive repeats merge
 * into `(xN)`; dropped runs leave a `...` on the left.
 */
export function commandLine(
  commands: CommandEntry[],
  from: number,
  width: number,
): string {
  const head = `Vim Commands (${commands.length}):`;
  const runs = collapseRuns(commands, from);
  if (runs.length === 0) {
    return head;
  }
  const sep = ", ";
  let tail = "";
  let shown = 0;
  for (let i = runs.length - 1; i >= 0; i--) {
    const piece = runText(runs[i]!);
    const trial = shown === 0 ? piece : `${piece}${sep}${tail}`;
    const lead = i > 0 ? 4 : 0; // room for "..." once anything is dropped
    if (head.length + 1 + lead + trial.length > width) {
      break;
    }
    tail = trial;
    shown++;
  }
  const lead = shown < runs.length ? "... " : "";
  return `${head} ${lead}${tail}`;
}
