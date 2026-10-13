/**
 * Text: row layout.
 *
 * Pure string helpers, no IO. `visibleLength`/`wrapText`/`alignColumns`/
 * `fitRow`/`fitRich` measure and lay out rows by visible cells. Styling
 * lives in style.ts, not in these strings. Input lexing lives in
 * terminal-input.ts.
 */
import { type RichText, type Span, plain, sliceSpans, spans } from "./style.ts";

/** Visible cells in a plain string. Styling lives outside the text. */
export function visibleLength(s: string): number {
  return s.length;
}

/** Word-wrap plain text to `width` cells, keeping words whole. */
export function wrapText(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const trial = line === "" ? word : `${line} ${word}`;
    if (trial.length > width && line !== "") {
      lines.push(line);
      line = word;
    } else {
      line = trial;
    }
  }
  if (line !== "") {
    lines.push(line);
  }
  return lines;
}

/**
 * Lay cells out in columns, `column -t` style: every cell is padded to its
 * column's widest, so the blocks line up down the table. Columns named in
 * `right` are padded on the left instead, for numbers.
 */
export function alignColumns(
  rows: string[][],
  gap = 2,
  right: number[] = [],
): string[] {
  const width = (c: number) =>
    Math.max(0, ...rows.map((row) => visibleLength(row[c] ?? "")));
  return rows.map((row) =>
    row
      .map((cell, c) => {
        if (c === row.length - 1) {
          return cell;
        }
        const pad = " ".repeat(Math.max(0, width(c) - visibleLength(cell)));
        return right.includes(c) ? pad + cell : cell + pad;
      })
      .join(" ".repeat(gap)),
  );
}

/**
 * Pad or truncate a full-width row by visible cells. Truncation backs
 * off to the last word edge instead of slicing mid-word.
 */
export function fitRow(s: string, width: number): string {
  const truncated = s.length > width;
  let out = truncated ? s.slice(0, width) : s;
  let vis = out.length;
  if (truncated) {
    const edge = out.lastIndexOf(" ");
    if (edge !== -1 && (edge + 1) * 2 > width) {
      out = out.slice(0, edge);
      vis = edge;
    }
  }
  return out + " ".repeat(Math.max(0, width - vis));
}

/**
 * Pad or truncate a styled run to `width` cells, backing off to the last
 * word edge. Styles are preserved through the cut, and the final padding
 * is unstyled.
 */
export function fitRich(text: RichText, width: number): Span[] {
  const s = plain(text);
  if (s.length <= width) {
    const pad = width - s.length;
    return spans(text, pad > 0 ? { text: " ".repeat(pad) } : "");
  }
  let cut = width;
  const edge = s.slice(0, width).lastIndexOf(" ");
  if (edge !== -1 && (edge + 1) * 2 > width) {
    cut = edge;
  }
  return spans(sliceSpans(text, 0, cut), {
    text: " ".repeat(Math.max(0, width - cut)),
  });
}
