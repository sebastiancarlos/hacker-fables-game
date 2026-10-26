/**
 * Style: semantic colors and styled text, free of terminal escape codes.
 *
 * The game layer speaks in cells and spans; only the screen implementation
 * knows how to serialize them to SGR. A plain string is a single unstyled
 * span, so callers that need no styling stay simple.
 */

/** A terminal color: a base name, its bright variant, or a 24-bit hex. */
export type Color =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite"
  | `#${string}`;

/** Visual attributes shared by a cell and a text span. */
export interface CellStyle {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  dim?: boolean;
  reverse?: boolean;
  /** OSC 8 hyperlink target carried by this cell or span. */
  link?: string;
}

/** One character cell with its style. */
export interface Cell extends CellStyle {
  ch: string;
}

/** A run of text sharing one style. */
export interface Span extends CellStyle {
  text: string;
}

/** Styled text: a plain string is one unstyled span. */
export type RichText = string | readonly Span[];

/** One argument to `spans`: a plain string, a span, or a run of spans. */
export type RichTextPart = RichText | Span;

/** Wrap parts as one span list, flattening strings and nested runs. */
export function spans(...parts: readonly RichTextPart[]): Span[] {
  const out: Span[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      if (part !== "") {
        out.push({ text: part });
      }
    } else if ("text" in part) {
      out.push(part);
    } else {
      out.push(...part);
    }
  }
  return out;
}

/** The visible text of a styled run, ignoring style. */
export function plain(text: RichText): string {
  return typeof text === "string" ? text : text.map((s) => s.text).join("");
}

/** Visible width of a styled run, in cells. */
export function textWidth(text: RichText): number {
  return plain(text).length;
}

/** Pad or clip a span run to exactly `width` visible cells. */
export function fitSpans(text: RichText, width: number): Span[] {
  const measured = textWidth(text);
  if (measured > width) {
    return sliceSpans(text, 0, width);
  }
  const spans = typeof text === "string" ? [{ text }] : [...text];
  if (measured < width) {
    spans.push({ text: " ".repeat(width - measured) });
  }
  return spans;
}

/**
 * Slice `[start, end)` out of a styled run, preserving each span's style.
 * Character offsets count the visible text, not escape codes.
 */
export function sliceSpans(text: RichText, start: number, end: number): Span[] {
  const out: Span[] = [];
  const input = typeof text === "string" ? [{ text }] : text;
  let at = 0;
  for (const span of input) {
    const from = at;
    const to = at + span.text.length;
    at = to;
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    if (a < b) {
      out.push({ ...span, text: span.text.slice(a - from, b - from) });
    }
    if (at >= end) {
      break;
    }
  }
  return out;
}

/** Mark http(s) URLs as OSC 8 links, preserving the surrounding styles. */
export function linkify(text: RichText): Span[] {
  const input = typeof text === "string" ? [{ text }] : text;
  const out: Span[] = [];
  for (const span of input) {
    let last = 0;
    for (const match of span.text.matchAll(/https?:\/\/[^\s]+/g)) {
      const at = match.index ?? 0;
      if (at > last) {
        out.push({ ...span, text: span.text.slice(last, at) });
      }
      out.push({ ...span, text: match[0], link: match[0] });
      last = at + match[0].length;
    }
    if (last < span.text.length) {
      out.push({ ...span, text: span.text.slice(last) });
    }
  }
  return out;
}
