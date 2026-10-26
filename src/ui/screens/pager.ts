/**
 * Pager, help menu, and unlock confirm.
 *
 * Every function mutates S only: it pushes or pops a modal and edits that
 * modal's own state. Closing a modal reveals exactly what was below it, so
 * a pager opened from help returns to help instead of guessing a mode.
 */
import {
  closeModal,
  currentPager,
  currentConfirm,
  openModal,
  shouldWarnCorruption,
  type GameState,
  type MenuRow,
  type PagerModal,
} from "../../game/state.ts";
import { PAGE_ROWS } from "../theme.ts";
import { dispatch, type Binding, type KeyCtx } from "../../input/keymap.ts";
import { UI } from "../../content.ts";
import { plain } from "../style.ts";

/** Clamp a pager's top row to the scrollable range. */
export function clampTop(p: PagerModal, v: number): number {
  return Math.max(0, Math.min(v, p.lines.length - PAGE_ROWS));
}

/** Open a scrollable pager with the given title and lines. */
export function openPager(S: GameState, title: string, lines: string[]): void {
  openModal(S.ui, {
    kind: "pager",
    title,
    lines,
    top: 0,
    query: null,
    typing: false,
    match: -1,
    noMatch: false,
  });
}

/** Close the top pager modal. */
export function closePager(S: GameState): void {
  closeModal(S.ui);
}

/** The message archive, Brogue's Shift-M screen, over the live pager. */
export function showLog(S: GameState): void {
  const lines = S.ui.log.length === 0 ? [UI.noMessages] : S.ui.log.map(plain);
  openPager(S, UI.logTitle, lines);
}

/** Turn fixed copy into rows, highlighting the title and the question. */
function confirmRows(lines: readonly string[]): MenuRow[] {
  return lines.map((text, i) => ({
    text,
    key: null,
    hi: i === 0 || i === lines.length - 1,
  }));
}

/** Skill popup: explains itself until dismissed with y. */
export function openConfirm(S: GameState): void {
  openModal(S.ui, {
    kind: "confirm",
    action: "unlock",
    rows: confirmRows(UI.unlockRows),
    cursor: 0,
  });
}

/**
 * The bottom's entry popup, in the same format as the skill popup. Shown
 * only while the level's hostiles still live.
 */
export function openCorruptionWarning(S: GameState): void {
  if (!shouldWarnCorruption(S)) {
    return;
  }
  openModal(S.ui, {
    kind: "confirm",
    action: "corruption",
    rows: confirmRows(UI.corruptionRows),
    cursor: 0,
  });
}

/** Quitting is destructive, so play asks first; y quits, n/Esc resumes. */
export function openQuitConfirm(S: GameState): void {
  openModal(S.ui, {
    kind: "confirm",
    action: "quit",
    rows: confirmRows(UI.quitRows),
    cursor: 0,
  });
}

/** Dismiss the confirmation modal. */
export function closeConfirm(S: GameState): void {
  closeModal(S.ui);
}

/**
 * The confirm popup answers to y, and cancels on n or Escape. A quit
 * confirmation hands control to the platform only after the explicit y.
 */
export function confirmKey(
  S: GameState,
  chunk: string,
  quit: () => void = () => {},
): void {
  const confirm = currentConfirm(S.ui);
  if (confirm === null) {
    return;
  }
  if (chunk === "y" || chunk === "Y") {
    closeConfirm(S);
    if (confirm.action === "quit") {
      quit();
    }
    return;
  }
  if (chunk === "n" || chunk === "N" || chunk === "<Esc>") {
    closeConfirm(S);
  }
}

/** Move the pager to the next search match from `from`. */
export function findMatch(S: GameState, from: number): void {
  const p = currentPager(S.ui);
  if (p === null) {
    return;
  }
  const q = (p.query ?? "").toLowerCase();
  if (q === "") {
    p.noMatch = false;
    return;
  }
  let idx = p.lines.findIndex(
    (line, i) => i >= from && line.toLowerCase().includes(q),
  );
  if (idx === -1) {
    idx = p.lines.findIndex((line) => line.toLowerCase().includes(q));
  }
  if (idx === -1) {
    p.noMatch = true;
    return;
  }
  p.noMatch = false;
  p.match = idx;
  p.top = clampTop(p, idx);
}

/** Move the pager's top by `delta`, clamped. */
function pagerScroll(S: GameState, delta: number): void {
  const p = currentPager(S.ui);
  if (p !== null) {
    p.top = clampTop(p, p.top + delta);
  }
}

/** Rows moved by a half-page pager scroll. */
const HALF_PAGE = Math.floor(PAGE_ROWS / 2);

/** Pager keys: scroll, jump, search, and quit, one binding per action. */
const PAGER_BINDINGS: Binding<KeyCtx>[] = [
  {
    keys: ["j", "J", "<CR>", "<Down>"],
    run: (c) => pagerScroll(c.S, 1),
  },
  {
    keys: ["k", "K", "<Up>"],
    run: (c) => pagerScroll(c.S, -1),
  },
  {
    keys: [" ", "<PageDown>", "<C-f>"],
    run: (c) => pagerScroll(c.S, PAGE_ROWS),
  },
  {
    keys: ["b", "B", "<PageUp>", "<C-b>"],
    run: (c) => pagerScroll(c.S, -PAGE_ROWS),
  },
  { keys: ["<C-d>"], run: (c) => pagerScroll(c.S, HALF_PAGE) },
  { keys: ["<C-u>"], run: (c) => pagerScroll(c.S, -HALF_PAGE) },
  { keys: ["<C-e>"], run: (c) => pagerScroll(c.S, 1) },
  { keys: ["<C-y>"], run: (c) => pagerScroll(c.S, -1) },
  {
    keys: ["g", "<Home>"],
    run: (c) => {
      const p = currentPager(c.S.ui);
      if (p !== null) {
        p.top = 0;
      }
    },
  },
  {
    keys: ["G", "<End>"],
    run: (c) => {
      const p = currentPager(c.S.ui);
      if (p !== null) {
        p.top = clampTop(p, Number.MAX_SAFE_INTEGER);
      }
    },
  },
  {
    keys: ["/"],
    run: (c) => {
      const p = currentPager(c.S.ui);
      if (p !== null) {
        p.typing = true;
        p.query = "";
        p.noMatch = false;
      }
    },
  },
  {
    keys: ["n", "N"],
    run: (c) => {
      const p = currentPager(c.S.ui);
      if (p !== null) {
        findMatch(c.S, p.match + 1);
      }
    },
  },
  { keys: ["q", "Q", "<Esc>"], run: (c) => closePager(c.S) },
];

/** Pager key rows for the command reference, grouped by action. */
export const PAGER_HELP_ROWS = [
  { keys: "j, k, Enter, arrows", text: "scroll one row" },
  { keys: "space, b, PgUp/PgDn", text: "scroll one page" },
  { keys: "ctrl-d, ctrl-u", text: "scroll half a page" },
  { keys: "ctrl-e, ctrl-y", text: "scroll one row" },
  { keys: "g, home", text: "jump to top" },
  { keys: "G, end", text: "jump to bottom" },
  { keys: "/", text: "search" },
  { keys: "n, N", text: "next or previous match" },
  { keys: "q, Esc", text: "close the pager" },
] as const;

/** Pager keys: type a search, scroll, jump, or close. */
export function pagerKey(S: GameState, chunk: string): void {
  const p = currentPager(S.ui);
  if (p === null) {
    return;
  }
  if (p.typing) {
    if (chunk === "<CR>") {
      p.typing = false;
      findMatch(S, p.top);
    } else if (chunk === "<Esc>") {
      p.typing = false;
      p.query = null;
      p.noMatch = false;
    } else if (chunk === "<BS>") {
      p.query = (p.query ?? "").slice(0, -1);
    } else if (chunk.length === 1 && chunk >= " " && chunk <= "~") {
      p.query = `${p.query ?? ""}${chunk}`;
    }
    return;
  }
  dispatch(PAGER_BINDINGS, { S }, chunk);
}

/** Help menu: what to show help about. */
export function showHelp(S: GameState): void {
  openModal(S.ui, {
    kind: "menu",
    stage: "help",
    rows: [
      { text: UI.helpTitle, key: null, hi: true },
      { text: "", key: null },
      { text: UI.helpCommands, key: "a" },
      { text: UI.helpAbout, key: "b" },
      { text: "", key: null },
      { text: UI.endRow, key: null },
    ],
    cursor: 0,
  });
}
