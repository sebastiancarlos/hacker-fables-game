/**
 * Title: the boot splash shown before a run starts, plus its browsers.
 *
 * A minimal home screen, shaped like Brogue's title menu: a keyed list
 * where `n` begins a run, `v` opens the recordings picker, `s` shows the
 * high-score table, and `q` quits. Any other key begins play too, so a
 * stray press never traps the player on the splash. The mode and cursor
 * state live here; the renderer paints each mode.
 */
import type { GameState } from "./game-state.ts";
import type { RecordingEntry } from "./recording.ts";
import {
  TITLE_ART,
  TITLE_ART_MASK,
  TITLE_TAGLINE,
  TITLE_TEXT,
  UI,
} from "./content.ts";
import { highScores, scoreCells } from "./score.ts";
import { alignColumns } from "./text.ts";
import { STYLE_RED, STYLE_REVERSE, STYLE_YELLOW } from "./theme.ts";
import {
  type CellStyle,
  type RichText,
  type Span,
  spans,
  textWidth,
} from "./style.ts";
import { dispatch, type Binding, type KeyCtx } from "./keymap.ts";

/** One keyed entry on the splash: the key and what it opens. */
interface TitleItem {
  key: string;
  label: string;
}

/**
 * Splash entries, in order. `n`, `s`, and `q` are always offered; "View
 * recording" appears only when there is a recording to watch.
 */
function items(entries: RecordingEntry[], showQuit = true): TitleItem[] {
  const rows: TitleItem[] = [{ key: "n", label: UI.newGame }];
  if (entries.length > 0) {
    rows.push({ key: "v", label: UI.viewRecording });
  }
  rows.push({ key: "s", label: UI.highScores });
  if (showQuit) {
    rows.push({ key: "q", label: UI.quit });
  }
  return rows;
}

/** One menu row: the key reversed for emphasis, then its label. */
function itemRow(item: TitleItem): Span[] {
  return spans({ text: item.key, ...STYLE_REVERSE }, `  ${item.label}`);
}

/** Right-pad every line to the widest, so the block centers on one edge. */
function padBlock(lines: RichText[]): RichText[] {
  const width = Math.max(...lines.map((line) => textWidth(line)));
  return lines.map((line) => spans(line, " ".repeat(width - textWidth(line))));
}

/**
 * The banner, colored per TITLE_ART_MASK: red licks on top, yellow
 * licks below, the letter bodies in the terminal's standard color.
 * Consecutive same-color cells share one SGR span.
 */
function bannerRows(): Span[][] {
  return TITLE_ART.map((glyphs, i) => {
    const mask = TITLE_ART_MASK[i] ?? "";
    const line: Span[] = [];
    let style: CellStyle = {};
    let run = "";
    const flush = (): void => {
      if (run !== "") {
        line.push({ text: run, ...style });
        run = "";
      }
    };
    for (let x = 0; x < glyphs.length; x++) {
      const next: CellStyle =
        mask[x] === "R" ? STYLE_RED : mask[x] === "Y" ? STYLE_YELLOW : {};
      if (next.fg !== style.fg) {
        flush();
        style = next;
      }
      run += glyphs[x];
    }
    flush();
    return line;
  });
}

/** The splash lines: banner art, tagline, then the keyed menu, one blank apart. */
export function titleLines(
  entries: RecordingEntry[] = [],
  showQuit = true,
): RichText[] {
  const menu = padBlock(items(entries, showQuit).map(itemRow));
  const rows: RichText[] = [];
  for (const row of menu) {
    if (rows.length > 0) {
      rows.push(""); // one blank line between entries
    }
    rows.push(row);
  }
  return [
    ...padBlock(bannerRows()),
    "",
    TITLE_TEXT,
    "",
    TITLE_TAGLINE,
    "",
    "",
    ...rows,
  ];
}

/** Enter title mode, remembering what can be browsed. */
export function openTitle(
  S: GameState,
  entries: RecordingEntry[] = [],
  scoreLines: string[] = [],
): void {
  S.ui.mode = "title";
  S.ui.modals.length = 0;
  S.ui.recordings.entries = entries;
  S.meta.scoreLines = scoreLines;
}

/** What a title key can reach: the state and the quit hook. */
interface TitleCtx extends KeyCtx {
  quit: () => void;
}

/** Start a run: dismiss the splash and queue the bottom's warning. */
function startRun(S: GameState): void {
  S.ui.mode = "lore";
}

/**
 * Title bindings: `q` quits, `v` opens the picker (when it holds
 * something, else it too starts a run), `s` shows the high scores.
 */
const TITLE_BINDINGS: Binding<TitleCtx>[] = [
  {
    keys: ["v", "V"],
    run: (c) =>
      c.S.ui.recordings.entries.length > 0
        ? openRecordings(c.S)
        : startRun(c.S),
  },
  { keys: ["s", "S"], run: (c) => openScores(c.S) },
];

/**
 * Title keys: the bound keys act, anything else drops into a run, so a
 * stray press never traps the player on the splash.
 */
export function titleKey(S: GameState, chunk: string, quit: () => void): void {
  if (S.ui.showQuit && (chunk === "q" || chunk === "Q")) {
    quit();
    return;
  }
  if (!dispatch(TITLE_BINDINGS, { S, quit }, chunk)) {
    startRun(S);
  }
}

/** Open the recordings picker over the splash, cursor on the newest. */
export function openRecordings(S: GameState): void {
  S.ui.mode = "recordings";
  S.ui.recordings.cursor = 0;
}

/** Return from the picker to the splash. */
export function closeRecordings(S: GameState): void {
  S.ui.mode = "title";
}

/** What a picker key can reach: the state and its two outcomes. */
interface RecordingsCtx extends KeyCtx {
  onPick: (path: string) => void;
  onCancel: () => void;
}

/** Picker bindings: j/k move, Enter watches the highlight, q/Esc backs out. */
const RECORDINGS_BINDINGS: Binding<RecordingsCtx>[] = [
  {
    keys: ["j", "J"],
    run: (c) => {
      c.S.ui.recordings.cursor = Math.min(
        c.S.ui.recordings.cursor + 1,
        Math.max(0, c.S.ui.recordings.entries.length - 1),
      );
    },
  },
  {
    keys: ["k", "K"],
    run: (c) => {
      c.S.ui.recordings.cursor = Math.max(c.S.ui.recordings.cursor - 1, 0);
    },
  },
  {
    keys: ["<CR>"],
    run: (c) => {
      const entry = c.S.ui.recordings.entries[c.S.ui.recordings.cursor];
      if (entry !== undefined) {
        c.onPick(entry.path);
      }
    },
  },
  { keys: ["q", "Q", "<Esc>"], run: (c) => c.onCancel() },
];

/**
 * Picker keys: `j`/`k` move the cursor, Enter watches the highlighted
 * recording, `q`/Esc returns to the splash.
 */
export function recordingsKey(
  S: GameState,
  chunk: string,
  onPick: (path: string) => void,
  onCancel: () => void,
): void {
  dispatch(RECORDINGS_BINDINGS, { S, onPick, onCancel }, chunk);
}

/** How many rows the high-score table shows. */
export const SCORE_ROWS = 10;

/** The high-score rows, best first, columns aligned, or a placeholder. */
export function scoreRows(lines: string[]): string[] {
  const entries = highScores(lines).slice(0, SCORE_ROWS);
  if (entries.length === 0) {
    return ["(no runs yet)"];
  }
  return alignColumns(
    entries.map((e, i) => scoreCells(i + 1, e)),
    3,
    [1],
  );
}

/** Open the high-score table over the splash. */
export function openScores(S: GameState): void {
  S.ui.mode = "scores";
}

/** Return from the table to the splash. */
export function closeScores(S: GameState): void {
  S.ui.mode = "title";
}

/** What a score-table key can reach: only the cancel hook. */
interface ScoresCtx {
  onCancel: () => void;
}

/** The table answers to q, Esc, or Enter: all leave. */
const SCORES_BINDINGS: Binding<ScoresCtx>[] = [
  { keys: ["q", "Q", "<Esc>", "<CR>"], run: (c) => c.onCancel() },
];

/** Table keys: `q`, Esc, or Enter returns to the splash. */
export function scoresKey(chunk: string, onCancel: () => void): void {
  dispatch(SCORES_BINDINGS, { onCancel }, chunk);
}
