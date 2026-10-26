/**
 * FrameBuffer: a dense grid of styled cells and the dirty-run diff.
 *
 * Painters write cells and styled rows into the back buffer. `diff` compares
 * it with the front buffer and returns maximal changed runs, widening a run
 * to cover every cell of a text row that changed. `commit` copies the back
 * buffer to the front. The buffer knows nothing about ANSI; a terminal, a
 * canvas, or a DOM front end can use the same diff.
 */
import { fitSpans, type Cell, type CellStyle, type RichText } from "./style.ts";
import { SCREEN_ROWS, WIDTH } from "./theme.ts";

/** One maximal run of changed cells on a row; `end` is exclusive. */
export interface FrameRun {
  /** First changed column. */
  x: number;
  /** One past the last changed column. */
  end: number;
  /** Row containing the run. */
  y: number;
}

/** One styled row written by `text`, kept atomic during the next diff. */
interface TextGroup {
  /** First visible column of the row. */
  x: number;
  /** Row containing the text. */
  y: number;
  /** Number of visible columns covered by the text. */
  width: number;
}

/** Canonical key for interning a cell or span style. */
function styleKey(style: CellStyle): string {
  return [
    style.fg ?? "",
    style.bg ?? "",
    style.bold === true ? "1" : "",
    style.dim === true ? "1" : "",
    style.reverse === true ? "1" : "",
    style.link ?? "",
  ].join("\u0000");
}

/** Reject glyphs that would occupy more than one cell. */
function glyph(ch: string): string {
  if (ch.length !== 1) {
    throw new Error(`cell glyph must be one code unit: ${JSON.stringify(ch)}`);
  }
  return ch;
}

/** Dense front/back cell grid with an interned style table. */
export class FrameBuffer {
  /** Visible columns. */
  readonly width: number;
  /** Visible rows. */
  readonly height: number;
  /** Number of cells in the grid. */
  private readonly size: number;
  /** Glyphs in the frame being painted. */
  private readonly backCh: string[];
  /** Interned style ids for the frame being painted. */
  private readonly backStyle: Uint16Array;
  /** Glyphs in the last committed frame; null means "unknown". */
  private readonly frontCh: (string | null)[];
  /** Style ids in the last committed frame; -1 means "unknown". */
  private readonly frontStyle: Int32Array;
  /** Text group id per cell; zero means the cell is not in a text row. */
  private readonly groupOf: Uint16Array;
  /** Text group extents, indexed by group id. Index zero is unused. */
  private readonly groups: (TextGroup | undefined)[] = [undefined];
  /** Next text group id for this frame. */
  private nextGroup = 1;
  /** Scratch flags for the current diff. */
  private readonly dirty: Uint8Array;
  /** Interned styles, indexed by style id. Index zero is unstyled. */
  private readonly styles: CellStyle[] = [{}];
  /** Style-key to style-id map. */
  private readonly styleIds = new Map<string, number>([[styleKey({}), 0]]);

  /** Create a buffer, defaulting to the game's 80x25 terminal. */
  constructor(width = WIDTH, height = SCREEN_ROWS) {
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.backCh = Array<string>(this.size).fill(" ");
    this.backStyle = new Uint16Array(this.size);
    this.frontCh = Array<string | null>(this.size).fill(null);
    this.frontStyle = new Int32Array(this.size).fill(-1);
    this.groupOf = new Uint16Array(this.size);
    this.dirty = new Uint8Array(this.size);
  }

  /** Clear both grids and forget every text group. */
  reset(): void {
    this.backCh.fill(" ");
    this.backStyle.fill(0);
    this.frontCh.fill(null);
    this.frontStyle.fill(-1);
    this.groupOf.fill(0);
    this.groups.length = 1;
    this.nextGroup = 1;
  }

  /** Mark the next diff as a full repaint without clearing the back buffer. */
  invalidate(): void {
    this.frontCh.fill(null);
    this.frontStyle.fill(-1);
  }

  /** Paint one cell into the back buffer. */
  cell(x: number, y: number, cell: Cell): void {
    const at = this.index(x, y);
    if (at < 0) {
      return;
    }
    this.backCh[at] = glyph(cell.ch);
    this.backStyle[at] = this.internStyle(cell);
    this.groupOf[at] = 0;
  }

  /** Paint one styled row into the back buffer as an atomic text group. */
  text(x: number, y: number, text: RichText, width: number): void {
    if (y < 0 || y >= this.height || width <= 0) {
      return;
    }
    const id = this.nextGroup;
    if (id > 0xffff) {
      throw new Error("too many text groups");
    }
    this.nextGroup++;
    let at = x;
    let start = -1;
    let end = -1;
    for (const span of fitSpans(text, width)) {
      const style = this.internStyle(span);
      for (const ch of span.text) {
        if (at >= 0 && at < this.width) {
          const cellAt = this.index(at, y);
          this.backCh[cellAt] = glyph(ch);
          this.backStyle[cellAt] = style;
          this.groupOf[cellAt] = id;
          if (start < 0) {
            start = at;
          }
          end = at + 1;
        }
        at++;
      }
    }
    if (start >= 0) {
      this.groups[id] = { x: start, y, width: end - start };
    }
  }

  /** The glyph at a cell in the back buffer. */
  glyphAt(x: number, y: number): string {
    const at = this.index(x, y);
    return at < 0 ? " " : this.backCh[at]!;
  }

  /** The interned style id at a cell in the back buffer. */
  styleIdAt(x: number, y: number): number {
    const at = this.index(x, y);
    return at < 0 ? 0 : this.backStyle[at]!;
  }

  /** The style object for an interned style id. */
  style(styleId: number): CellStyle {
    return this.styles[styleId] ?? {};
  }

  /** All changed runs, with text groups expanded to their full extents. */
  diff(): FrameRun[] {
    this.dirty.fill(0);
    let any = false;
    for (let at = 0; at < this.size; at++) {
      if (
        this.frontStyle[at] !== this.backStyle[at] ||
        this.frontCh[at] !== this.backCh[at]
      ) {
        this.dirty[at] = 1;
        any = true;
      }
    }
    if (!any) {
      return [];
    }

    const touched = new Set<number>();
    for (let at = 0; at < this.size; at++) {
      if (this.dirty[at] !== 0 && this.groupOf[at] !== 0) {
        touched.add(this.groupOf[at]!);
      }
    }
    for (const id of touched) {
      const group = this.groups[id];
      if (group === undefined) {
        continue;
      }
      const base = group.y * this.width;
      for (let x = group.x; x < group.x + group.width; x++) {
        this.dirty[base + x] = 1;
      }
    }

    const runs: FrameRun[] = [];
    for (let y = 0; y < this.height; y++) {
      const base = y * this.width;
      let x = 0;
      while (x < this.width) {
        while (x < this.width && this.dirty[base + x] === 0) {
          x++;
        }
        if (x >= this.width) {
          break;
        }
        const start = x;
        while (x < this.width && this.dirty[base + x] !== 0) {
          x++;
        }
        runs.push({ x: start, end: x, y });
      }
    }
    return runs;
  }

  /** Keep the back buffer as the new front and start a fresh text-group pass. */
  commit(): void {
    for (let at = 0; at < this.size; at++) {
      this.frontCh[at] = this.backCh[at]!;
      this.frontStyle[at] = this.backStyle[at]!;
    }
    this.groupOf.fill(0);
    this.groups.length = 1;
    this.nextGroup = 1;
  }

  /** The back buffer as visible text rows. */
  rows(): string {
    let out = "";
    for (let y = 0; y < this.height; y++) {
      if (y > 0) {
        out += "\n";
      }
      const base = y * this.width;
      for (let x = 0; x < this.width; x++) {
        out += this.backCh[base + x];
      }
    }
    return out;
  }

  /** Convert zero-based coords to a row-major index, or -1 when outside. */
  private index(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
      return -1;
    }
    return y * this.width + x;
  }

  /** Intern a style and return its stable id. */
  private internStyle(style: CellStyle): number {
    const key = styleKey(style);
    const found = this.styleIds.get(key);
    if (found !== undefined) {
      return found;
    }
    const id = this.styles.length;
    if (id > 0xffff) {
      throw new Error("too many interned styles");
    }
    this.styles.push({ ...style });
    this.styleIds.set(key, id);
    return id;
  }
}
