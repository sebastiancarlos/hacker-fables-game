/**
 * ANSI screen: terminal implementation of the `Screen` contract.
 *
 * Serializes structured cells and styled spans to terminal escapes. AnsiScreen
 * paints into a FrameBuffer, diffs the completed frame against the previous
 * one, and writes changed runs in a single call.
 */
import { FrameBuffer, type FrameRun } from "../../ui/frame-buffer.ts";
import type { Screen } from "../../ui/screen.ts";
import {
  type Cell,
  type CellStyle,
  type RichText,
  type Span,
} from "../../ui/style.ts";
import { SCREEN_ROWS, WIDTH } from "../../ui/theme.ts";

/** SGR foreground and background numbers for the base sixteen colors. */
const BASE_COLORS: Record<string, readonly [number, number]> = {
  black: [30, 40],
  red: [31, 41],
  green: [32, 42],
  yellow: [33, 43],
  blue: [34, 44],
  magenta: [35, 45],
  cyan: [36, 46],
  white: [37, 47],
  brightBlack: [90, 100],
  brightRed: [91, 101],
  brightGreen: [92, 102],
  brightYellow: [93, 103],
  brightBlue: [94, 104],
  brightMagenta: [95, 105],
  brightCyan: [96, 106],
  brightWhite: [97, 107],
};

/** One color as an SGR parameter list (foreground or background). */
function colorCode(color: CellStyle["fg"], bg: boolean): string {
  if (color === undefined) {
    return "";
  }
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `${bg ? 48 : 38};2;${r};${g};${b}`;
  }
  const pair = BASE_COLORS[color]!;
  return String(bg ? pair[1] : pair[0]);
}

/** The SGR opener for a style, or the empty string when unstyled. */
function styleCodes(style: CellStyle): string {
  const codes: string[] = [];
  if (style.bold === true) {
    codes.push("1");
  }
  if (style.dim === true) {
    codes.push("2");
  }
  if (style.reverse === true) {
    codes.push("7");
  }
  const fg = colorCode(style.fg, false);
  if (fg !== "") {
    codes.push(fg);
  }
  const bg = colorCode(style.bg, true);
  if (bg !== "") {
    codes.push(bg);
  }
  return codes.length === 0 ? "" : `\x1b[${codes.join(";")}m`;
}

/** Serialize one styled cell, resetting after any style. */
export function serializeCell(cell: Cell): string {
  const codes = styleCodes(cell);
  const styled = codes === "" ? cell.ch : `${codes}${cell.ch}\x1b[0m`;
  if (cell.link === undefined) {
    return styled;
  }
  return `${linkOpen(cell.link)}${styled}${LINK_CLOSE}`;
}

/** Serialize a styled run, resetting after each styled span. */
export function serializeSpans(spans: readonly Span[]): string {
  let out = "";
  let link: string | undefined;
  for (const span of spans) {
    if (span.link !== link) {
      if (link !== undefined) {
        out += LINK_CLOSE;
      }
      if (span.link !== undefined) {
        out += linkOpen(span.link);
      }
      link = span.link;
    }
    const codes = styleCodes(span);
    out += codes === "" ? span.text : `${codes}${span.text}\x1b[0m`;
  }
  if (link !== undefined) {
    out += LINK_CLOSE;
  }
  return out;
}

/** OSC 8 opener for a clickable URL. */
function linkOpen(url: string): string {
  return `\x1b]8;;${url}\x1b\\`;
}

/** OSC 8 closer, returning text to the default link target. */
const LINK_CLOSE = "\x1b]8;;\x1b\\";

/** SGR reset, used between styles and at the end of a styled run. */
const RESET = "\x1b[0m";

/** Reset SGR, enter the alternate screen, hide the cursor, and home. */
const ALT_SCREEN = "\x1b[0m\x1b[?1049h\x1b[?25l\x1b[H";

/**
 * Terminal screen: paints into a fixed back buffer and diffs it against the
 * previous frame. Writes ANSI sequences: `ESC [` (CSI) starts cursor and mode
 * commands, and SGR (`CSI ... m`) applies color and attributes. Adjacent or
 * cheaply separated runs are merged, and the whole frame is sent in one call.
 */
export class AnsiScreen implements Screen {
  /** Front/back cells and the text-group diff. */
  private readonly buffer: FrameBuffer;
  /** Writes one escape-sequence string. */
  private readonly emit: (s: string) => void;
  /** One-shot sequences that must precede the next frame. */
  private readonly pending: string[] = [];
  /** Cached SGR opener per interned style id. */
  private readonly sgrCache: string[] = [""];
  /** Last requested cursor position for the end of the frame. */
  private parked: { x: number; y: number } | null = null;

  /** Create a screen that writes through `emit`. */
  constructor(emit: (s: string) => void, width = WIDTH, height = SCREEN_ROWS) {
    this.emit = emit;
    this.buffer = new FrameBuffer(width, height);
  }

  /** Queue reset, alternate screen, hidden cursor, and home; clear buffers. */
  begin = (): void => {
    // CSI 0m clears lingering shell colors,
    // CSI ?1049h switches to the alternate screen buffer,
    // CSI ?25l hides the cursor, and
    // CSI H moves it to row 1, column 1.
    this.pending.push(ALT_SCREEN);
    this.buffer.reset();
    this.parked = null;
  };

  /** Record the final cursor position; it is sent after the frame's runs. */
  park = (x: number, y: number): void => {
    this.parked = { x, y };
  };

  /** Paint one cell into the back buffer. */
  cell = (x: number, y: number, cell: Cell): void => {
    this.buffer.cell(x, y, cell);
  };

  /** Paint one styled row into the back buffer. */
  text = (x: number, y: number, text: RichText, width: number): void => {
    this.buffer.text(x, y, text, width);
  };

  /** Force the next frame to repaint every cell. */
  invalidate = (): void => {
    this.buffer.invalidate();
  };

  /** Diff the collected frame and write it in one call. */
  flush = (): void => {
    const runs = this.buffer.diff();
    let out = this.pending.join("");
    if (runs.length > 0) {
      out += this.renderRuns(runs);
    }
    const parked = this.parked;
    if (parked !== null) {
      out += this.cup(parked.x, parked.y);
    }
    if (out !== "") {
      this.emit(out);
    }
    this.pending.length = 0;
    this.parked = null;
    this.buffer.commit();
  };

  /** Merge cheaply separated runs, then serialize each row segment. */
  private renderRuns(runs: readonly FrameRun[]): string {
    let out = "";
    let i = 0;
    while (i < runs.length) {
      const first = runs[i]!;
      const y = first.y;
      let start = first.x;
      let end = first.end;
      i++;
      while (i < runs.length && runs[i]!.y === y) {
        const next = runs[i]!;
        const merged = this.renderRun(y, start, next.end).length;
        const split =
          this.renderRun(y, start, end).length +
          this.cup(next.x, y).length +
          this.renderRun(y, next.x, next.end).length;
        if (merged >= split) {
          break;
        }
        end = next.end;
        i++;
      }
      out += this.cup(start, y) + this.renderRun(y, start, end);
    }
    return out;
  }

  /** Serialize a contiguous row segment, resetting between styles. */
  private renderRun(y: number, start: number, end: number): string {
    let out = "";
    let active = 0;
    let link: string | undefined;
    for (let x = start; x < end; x++) {
      const style = this.buffer.styleIdAt(x, y);
      if (style !== active) {
        if (active !== 0) {
          out += RESET;
        }
        const next = this.buffer.style(style).link;
        if (next !== link) {
          if (link !== undefined) {
            out += LINK_CLOSE;
          }
          if (next !== undefined) {
            out += linkOpen(next);
          }
          link = next;
        }
        if (style !== 0) {
          out += this.sgr(style);
        }
        active = style;
      }
      out += this.buffer.glyphAt(x, y);
    }
    if (active !== 0) {
      out += RESET;
    }
    if (link !== undefined) {
      out += LINK_CLOSE;
    }
    return out;
  }

  /** Cached SGR opener for an interned style id. */
  private sgr(styleId: number): string {
    const cached = this.sgrCache[styleId];
    if (cached !== undefined) {
      return cached;
    }
    const sgr = styleCodes(this.buffer.style(styleId));
    this.sgrCache[styleId] = sgr;
    return sgr;
  }

  /** Cursor-position sequence for zero-based screen coords. */
  private cup(x: number, y: number): string {
    return `\x1b[${y + 1};${x + 1}H`;
  }
}
