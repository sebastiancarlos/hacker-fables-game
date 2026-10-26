/**
 * Terminal input adapter: the only module that decodes terminal escape
 * bytes. It turns a raw stdin chunk into `Key`s, so the core never sees an
 * escape sequence and a recording of those keys replays on any platform.
 */
import { KEY_NAME, makeKey, type Key, type NamedKey } from "../../input/key.ts";

/** Arrows, Home, and End, keyed by their CSI/SS3 final byte. */
const CSI_FINAL: Record<string, NamedKey> = {
  A: KEY_NAME.arrowUp,
  B: KEY_NAME.arrowDown,
  C: KEY_NAME.arrowRight,
  D: KEY_NAME.arrowLeft,
  H: KEY_NAME.home,
  F: KEY_NAME.end,
};

/** Tilde-terminated CSI numbers and the key each stands for. */
const CSI_TILDE: Record<string, NamedKey> = {
  "1": KEY_NAME.home,
  "2": KEY_NAME.insert,
  "3": KEY_NAME.delete,
  "4": KEY_NAME.end,
  "5": KEY_NAME.pageUp,
  "6": KEY_NAME.pageDown,
  "7": KEY_NAME.home,
  "8": KEY_NAME.end,
};

/** Decode one raw input chunk into normalized keys, in order. */
export function decodeInput(chunk: string): Key[] {
  const keys: Key[] = [];
  let at = 0;
  while (at < chunk.length) {
    const point = chunk.codePointAt(at)!;
    const ch = String.fromCodePoint(point);
    if (ch === "\x1b") {
      const taken = decodeEscape(chunk, at, keys);
      if (taken === 0) {
        keys.push(makeKey(KEY_NAME.escape));
        at += 1;
      } else {
        at += taken;
      }
      continue;
    }
    at += ch.length;
    const key = decodeChar(point, ch);
    if (key !== null) {
      keys.push(key);
    }
  }
  return keys;
}

/** Decode one non-escape code point, or null for a byte worth dropping. */
function decodeChar(point: number, ch: string): Key | null {
  if (ch === "\r" || ch === "\n") {
    return makeKey(KEY_NAME.enter);
  }
  if (ch === "\t") {
    return makeKey(KEY_NAME.tab);
  }
  if (ch === "\x7f" || ch === "\b") {
    return makeKey(KEY_NAME.backspace);
  }
  if (point === 0) {
    return null; // NUL is a no-op
  }
  if (point >= 1 && point <= 26) {
    // Ctrl-A through Ctrl-Z arrive as the low control bytes.
    return makeKey(String.fromCharCode(point + 96), { ctrl: true });
  }
  if (point >= 0x1c && point <= 0x1f) {
    // Ctrl-\, Ctrl-], Ctrl-^, Ctrl-_ have no letter to name them.
    return makeKey("\\]^_"[point - 0x1c]!, { ctrl: true });
  }
  if (point >= 0x41 && point <= 0x5a) {
    // A terminal delivers Shift+a as "A"; normalize to the base key.
    return makeKey(ch.toLowerCase(), { shift: true });
  }
  return makeKey(ch);
}

/**
 * Decode one escape sequence starting at `at`, pushing its key. Returns the
 * bytes consumed, or 0 when this is a bare ESC (the caller emits Escape).
 */
function decodeEscape(chunk: string, at: number, keys: Key[]): number {
  const rest = chunk.slice(at);
  const csi = /^\x1b\[(\d*)(?:;(\d+))?([A-Za-z~])/.exec(rest);
  if (csi !== null) {
    const [, first = "", mod = "", final = ""] = csi;
    keys.push(csiKey(first, mod, final) ?? makeKey(KEY_NAME.unidentified));
    return csi[0].length;
  }
  const ss3 = /^\x1bO([A-DFH])/.exec(rest);
  if (ss3 !== null) {
    const name = CSI_FINAL[ss3[1]!];
    keys.push(
      name === undefined ? makeKey(KEY_NAME.unidentified) : makeKey(name),
    );
    return ss3[0].length;
  }
  // A private or unrecognized CSI sequence: swallow it whole, so no stray
  // escape byte or parameter reaches a binding.
  const unknown = /^\x1b\[[0-9;?]*[A-Za-z~]/.exec(rest);
  if (unknown !== null) {
    keys.push(makeKey(KEY_NAME.unidentified));
    return unknown[0].length;
  }
  return 0;
}

/** Build the key a CSI sequence names, or null when it names nothing. */
function csiKey(first: string, mod: string, final: string): Key | null {
  const mods = modifierBits(mod);
  if (final === "~") {
    const name = CSI_TILDE[first];
    return name === undefined ? null : makeKey(name, mods);
  }
  const name = CSI_FINAL[final];
  return name === undefined ? null : makeKey(name, mods);
}

/** Modifiers in a CSI parameter: bit 0 is Shift, bit 2 is Ctrl. */
function modifierBits(mod: string): { ctrl: boolean; shift: boolean } {
  const bits = (mod === "" ? 1 : Number(mod)) - 1;
  return { shift: (bits & 1) !== 0, ctrl: (bits & 4) !== 0 };
}
