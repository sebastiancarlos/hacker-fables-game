/**
 * Key: the normalized keypress the core consumes.
 *
 * Platform adapters decode native input into this: the terminal parses
 * escape sequences into named keys, a web or mobile front end builds it from
 * its own events. `key` is a printable character or a named key ("Enter",
 * "Escape", "Tab", "Backspace", "ArrowUp", "Home", "PageUp"), and the
 * modifiers are explicit. Nothing above the adapter sees raw bytes.
 *
 * A `Key` uses platform-neutral names. `keyToken` later converts it into the
 * vim-notation string a binding table matches, such as `<CR>` or `<C-v>`.
 */

/** The platform-neutral names a terminal adapter can put in `Key.key`. */
export const KEY_NAME = {
  escape: "Escape",
  enter: "Enter",
  tab: "Tab",
  backspace: "Backspace",
  insert: "Insert",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageUp: "PageUp",
  pageDown: "PageDown",
  arrowUp: "ArrowUp",
  arrowDown: "ArrowDown",
  arrowLeft: "ArrowLeft",
  arrowRight: "ArrowRight",
  unidentified: "Unidentified",
} as const;

/** One named key a terminal adapter can report. */
export type NamedKey = (typeof KEY_NAME)[keyof typeof KEY_NAME];

/** One normalized keypress, platform-neutral. */
export interface Key {
  /** A printable character, or a named key such as `Enter` or `ArrowUp`. */
  key: string;
  ctrl: boolean;
  shift: boolean;
}

/** Build a key, defaulting both modifiers to off. */
export function makeKey(
  key: string,
  mods: { ctrl?: boolean; shift?: boolean } = {},
): Key {
  return { key, ctrl: mods.ctrl ?? false, shift: mods.shift ?? false };
}

/**
 * The canonical vim name for each named key. Binding tables use these names
 * inside angle brackets, while `Key.key` keeps the platform-neutral name.
 * Printable characters need no entry: their token is the character itself.
 */
const VIM_NAME: Record<NamedKey, string> = {
  [KEY_NAME.escape]: "Esc",
  [KEY_NAME.enter]: "CR",
  [KEY_NAME.tab]: "Tab",
  [KEY_NAME.backspace]: "BS",
  [KEY_NAME.insert]: "Insert",
  [KEY_NAME.delete]: "Del",
  [KEY_NAME.home]: "Home",
  [KEY_NAME.end]: "End",
  [KEY_NAME.pageUp]: "PageUp",
  [KEY_NAME.pageDown]: "PageDown",
  [KEY_NAME.arrowUp]: "Up",
  [KEY_NAME.arrowDown]: "Down",
  [KEY_NAME.arrowLeft]: "Left",
  [KEY_NAME.arrowRight]: "Right",
  [KEY_NAME.unidentified]: "Unknown",
};

/** Arrow keys and the vim direction each stands for. */
const ARROW_DIRS: Record<string, string> = {
  [KEY_NAME.arrowUp]: "k",
  [KEY_NAME.arrowDown]: "j",
  [KEY_NAME.arrowLeft]: "h",
  [KEY_NAME.arrowRight]: "l",
};

/**
 * Fold an arrow onto its vim direction, keeping Shift (which runs); every
 * other key passes through. Ctrl+arrow is left alone: it is not a movement,
 * and folding it would turn Ctrl+Down into Ctrl+j, a different binding. Only
 * the directional modes fold, so an arrow in a hotkey menu never masquerades
 * as its h/j/k/l key.
 */
export function foldArrow(key: Key): Key {
  const dir = key.ctrl ? undefined : ARROW_DIRS[key.key];
  return dir === undefined
    ? key
    : { key: dir, ctrl: key.ctrl, shift: key.shift };
}

/**
 * Convert one normalized key into the canonical vim notation bindings use.
 * Printable keys stay as themselves and Shift+letter becomes the uppercase
 * letter. Named keys become `<Esc>`, `<CR>`, `<Up>`, and so on. Ctrl is
 * always kept as a `<C-...>` prefix, including on named keys and punctuation.
 * Shift is only represented on unmodified letters: named keys drop it (so
 * Shift+Down still scrolls) and Ctrl+letter stays lowercase.
 */
export function keyToken(key: Key): string {
  const named = (VIM_NAME as Record<string, string>)[key.key];
  if (named === undefined && !key.ctrl) {
    if (key.shift && key.key.length === 1 && key.key >= "a" && key.key <= "z") {
      return key.key.toUpperCase();
    }
    return key.key;
  }
  const base =
    named ??
    (key.key === " "
      ? "Space"
      : key.key.length === 1
        ? key.key.toLowerCase()
        : key.key);
  return `<${key.ctrl ? "C-" : ""}${base}>`;
}

/** True for Ctrl-C, the one key the platform quits on. */
export function isQuit(key: Key): boolean {
  return key.ctrl && key.key.toLowerCase() === "c";
}
