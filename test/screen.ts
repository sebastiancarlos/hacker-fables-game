/**
 * Test-only screens: an ANSI terminal emulator and a virtual `Screen`.
 *
 * Keeping both beside the tests leaves production with only the real
 * terminal screen, while the emulator still reports what a player sees.
 */
import type { Screen } from "../src/ui/screen.ts";
import {
  serializeCell,
  serializeSpans,
} from "../src/platform/terminal/ansi-screen.ts";
import {
  fitSpans,
  type Cell,
  type RichText,
  type Span,
} from "../src/ui/style.ts";

/**
 * Minimal terminal emulator: cursor positioning, SGR state, text grid.
 * Feeds the same byte stream (live or recorded) and reports what the
 * player actually sees, so assertions target the final screen instead
 * of bytes that were merely emitted mid-run. Entering the alternate
 * screen clears the grid and SGR state; leaving it freezes the frame
 * (the goodbye that follows belongs to the main screen, not the game).
 *
 * 25x80 by default: the message row, 21 map rows, and three footer rows
 * (status, dungeon, command tally).
 */
export class TerminalEmulator {
  /** Visible character cells, row-major. */
  private readonly grid: string[][];
  /** SGR parameters active at each visible cell, row-major. */
  private readonly styles: string[][];
  /** Current cursor row. */
  private curRow = 0;
  /** Current cursor column. */
  private curCol = 0;
  /** SGR parameters active at the cursor. */
  private currentSgr = "";
  /** True between alternate-screen enter and leave. */
  private live = false;
  /** Emulator width in columns. */
  private readonly width: number;
  /** Emulator height in rows. */
  private readonly height: number;

  /** Create an emulator with a blank grid of the given size. */
  constructor(width = 80, height = 25) {
    this.width = width;
    this.height = height;
    this.grid = Array.from({ length: height }, () =>
      Array<string>(width).fill(" "),
    );
    this.styles = Array.from({ length: height }, () =>
      Array<string>(width).fill(""),
    );
  }

  /** Feed terminal output and update the visible grid. */
  write(s: string): void {
    let i = 0;
    while (i < s.length) {
      if (s[i] === "\x1b" && s[i + 1] === "]") {
        let j = i + 2;
        while (
          j < s.length &&
          s[j] !== "\x07" &&
          !(s[j] === "\x1b" && s[j + 1] === "\\")
        ) {
          j++;
        }
        i = s[j] === "\x07" ? j + 1 : Math.min(s.length, j + 2);
        continue;
      }
      if (s[i] === "\x1b" && s[i + 1] === "[") {
        const m = /^\x1b\[([?0-9;]*)([A-Za-z])/.exec(s.slice(i));
        if (m === null) {
          i++;
          continue;
        }
        i += m[0].length;
        const params = m[1] ?? "";
        const final = m[2] ?? "";
        if (params === "?1049" && final === "h") {
          for (const row of this.grid) {
            row.fill(" ");
          }
          for (const row of this.styles) {
            row.fill("");
          }
          this.curRow = 0;
          this.curCol = 0;
          this.currentSgr = "";
          this.live = true;
        } else if (params === "?1049" && final === "l") {
          this.live = false;
        } else if (final === "m") {
          this.currentSgr = params === "" || params === "0" ? "" : params;
        } else if (this.live && (final === "H" || final === "f")) {
          const [r, c] = params.split(";").map(Number);
          this.curRow = Math.min(this.height - 1, Math.max(0, (r || 1) - 1));
          this.curCol = Math.min(this.width - 1, Math.max(0, (c || 1) - 1));
        }
        // Other modes are display metadata: skip.
        continue;
      }
      if (!this.live) {
        i++;
        continue;
      }
      if (s[i] === "\n") {
        this.curRow = Math.min(this.height - 1, this.curRow + 1);
        this.curCol = 0;
      } else if (s[i] === "\r") {
        this.curCol = 0;
      } else if (s.charCodeAt(i) >= 32) {
        const ch = s[i];
        const row = this.grid[this.curRow];
        const styleRow = this.styles[this.curRow];
        if (ch !== undefined && row !== undefined) {
          row[this.curCol] = ch;
        }
        if (styleRow !== undefined) {
          styleRow[this.curCol] = this.currentSgr;
        }
        if (this.curCol < this.width - 1) {
          this.curCol++;
        }
      }
      i++;
    }
  }

  /** The visible text frame, one string per row. */
  text(): string {
    return this.grid.map((row) => row.join("")).join("\n");
  }

  /** The visible style frame, one NUL-separated SGR row per line. */
  styleText(): string {
    return this.styles.map((row) => row.join("\u0000")).join("\n");
  }

  /** One visible row, 0-based. */
  row(i: number): string {
    return this.grid[i]?.join("") ?? "";
  }

  /** SGR parameters active at one visible cell. */
  styleAt(x: number, y: number): string {
    return this.styles[y]?.[x] ?? "";
  }
}

/** Test screen: records structured cells and styled text for assertions. */
export class VirtualScreen implements Screen {
  /** Every raw string written, in order. */
  writes: string[] = [];
  /** Last structured cell per coordinate. */
  cells = new Map<string, Cell>();
  /** Every changed cell, in write order. */
  updates: { x: number; y: number; cell: Cell }[] = [];
  /** Every styled text run, in write order. */
  textRuns: { x: number; y: number; spans: readonly Span[] }[] = [];
  /** Emulated terminal used for the visible frame. */
  private readonly term = new TerminalEmulator();

  /** Enter the alternate screen and record the write. */
  begin = (): void => {
    this.writes.push("\x1b[?1049h");
    this.term.write("\x1b[?1049h");
  };

  /** Move the emulated cursor to a cell. */
  park = (x: number, y: number): void => {
    this.term.write(`\x1b[${y + 1};${x + 1}H`);
  };

  /** Record one changed cell and feed the emulator. */
  cell = (x: number, y: number, cell: Cell): void => {
    const key = `${x},${y}`;
    const prev = this.cells.get(key);
    if (
      prev !== undefined &&
      prev.ch === cell.ch &&
      prev.fg === cell.fg &&
      prev.bg === cell.bg &&
      prev.bold === cell.bold &&
      prev.dim === cell.dim &&
      prev.reverse === cell.reverse &&
      prev.link === cell.link
    ) {
      return;
    }
    this.cells.set(key, cell);
    this.updates.push({ x, y, cell });
    this.term.write(`\x1b[${y + 1};${x + 1}H${serializeCell(cell)}`);
  };

  /** Record one styled text run and feed the emulator. */
  text = (x: number, y: number, text: RichText, width: number): void => {
    const spans = fitSpans(text, width);
    this.textRuns.push({ x, y, spans });
    this.writes.push(serializeSpans(spans));
    this.term.write(`\x1b[${y + 1};${x + 1}H${serializeSpans(spans)}\x1b[0m`);
    // Text overwrites any map cell under it, so drop those cells from the
    // diff cache; a later cell() re-records and re-emits them.
    for (let i = 0; i < width; i++) {
      this.cells.delete(`${x + i},${y}`);
    }
  };

  /** Forget every recorded cell. */
  invalidate = (): void => {
    this.cells.clear();
  };

  /** No-op: this screen records each call immediately. */
  flush = (): void => {};

  /** Last structured cell written at terminal coords, if any. */
  at(x: number, y: number): Cell | undefined {
    return this.cells.get(`${x},${y}`);
  }

  /** Last visible glyph written at terminal coords, if any. */
  atText(x: number, y: number): string | undefined {
    return this.cells.get(`${x},${y}`)?.ch;
  }

  /** Last styled row written at terminal coords, if any. */
  spansAt(y: number): readonly Span[] | undefined {
    return [...this.textRuns].reverse().find((t) => t.y === y)?.spans;
  }

  /** What the player actually sees: the emulated 25x80 text frame. */
  frame(): string {
    return this.term.text();
  }

  /** What the player sees, including each cell's active SGR parameters. */
  styledFrame(): string {
    return this.term.styleText();
  }

  /** One visible row of the emulated frame, 0-based. */
  row(i: number): string {
    return this.term.row(i);
  }
}
