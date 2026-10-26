/**
 * Theme: grid size, layout rows, semantic colors, and animation timing.
 *
 * Pure constants and color functions only, free of terminal escapes. The
 * screen implementation turns these styles into SGR; every game layer can
 * share them without import cycles.
 */
import type { CellStyle } from "./style.ts";

/** Map dimensions in cells: the playfield, not the whole terminal. */
export const WIDTH = 80;
/** Height of the playfield in cells. */
export const HEIGHT = 21;

/** Terminal row where the map starts. */
export const MAP_TOP = 1;
/** Terminal row for the status line. */
export const STATUS_ROW = HEIGHT + 1;
// Row 1: message, rows 2-22: map, row 23: status, row 24: dungeon,
// row 25: the vim command tally.
export const DUNGEON_ROW = HEIGHT + 2;
/** Terminal row for the vim command tally. */
export const COMMAND_ROW = HEIGHT + 3;
/** Total terminal rows: message, map, status, dungeon, tally. */
export const SCREEN_ROWS = HEIGHT + 4;

// Basic foregrounds only. No background codes, so the terminal's own
// background shows through everywhere (no surprise salmon).
export const STYLE_PLAYER: CellStyle = { fg: "#ffffff", bold: true };
// Ambient corruption tint, walls only. A floor with any hostile left runs
// hot red; once the last one falls the walls cool to Bell Labs blue. The red
// deepens in discrete steps with the number of enemies still alive, one
// shade per band of `CORRUPTION_SCALE` in `src/enemies.ts`, so the wall color
// reads as a headcount at any depth. The floor keeps the terminal's own
// foreground (a whole field of tinted dots read as noise), and even the
// fullest red stays dull enough that bright red creatures and the reversed
// boss pop against it.
export const STYLE_WALL_CLEAN: CellStyle = { fg: "#7096d8" };
/** The fullest red: a floor at maximum corruption, or one holding a boss. */
export const STYLE_WALL_CORRUPT: CellStyle = { fg: "#da3228" };
/** Wall reds, faintest flush to fullest, one per corruption tier. */
export const STYLE_WALL_CORRUPT_RAMP: readonly CellStyle[] = [
  { fg: "#74504e" },
  { fg: "#8c4a44" },
  { fg: "#a2443a" },
  { fg: "#b43f34" },
  { fg: "#c23a2f" },
  { fg: "#ce362b" },
  STYLE_WALL_CORRUPT,
];
/** Ground items and inventory accents. */
export const STYLE_ITEM: CellStyle = { fg: "cyan" };
/** A tracer cell in flight. */
export const STYLE_SHOT: CellStyle = { fg: "yellow", bold: true };
/** Stairs in sight. */
export const STYLE_STAIRS: CellStyle = { fg: "#ffffff", bold: true };
/** Remembered stairs. */
export const STYLE_STAIRS_MEM: CellStyle = { fg: "white" };
/** Remembered walls. */
export const STYLE_WALL_MEM: CellStyle = { fg: "brightBlack" };
/** Remembered items. */
export const STYLE_ITEM_MEM: CellStyle = { fg: "cyan", dim: true };
/** Remembered floor. */
export const STYLE_FLOOR_MEM: CellStyle = { fg: "brightBlack" };
/** The clear-floor accent. */
export const STYLE_BLUE: CellStyle = { fg: "blue" };
/** Warning and highlight text. */
export const STYLE_YELLOW: CellStyle = { fg: "yellow" };
/** Danger and corruption text. */
export const STYLE_RED: CellStyle = { fg: "red" };
/** Reverse video: swap foreground and background for one glyph (hotkeys). */
export const STYLE_REVERSE: CellStyle = { reverse: true };

/**
 * Heat gradation by Python-version index: 2.x cool green, 3.x yellow to
 * red, the dev preview alone a truecolor pure red (#ff0000) and bold, so
 * it never takes the terminal theme's red. The enemy tables map their
 * versions onto this.
 */
export function versionHeatColor(index: number): CellStyle {
  if (index <= 7) {
    return { fg: "green" };
  }
  if (index <= 11) {
    return { fg: "yellow" };
  }
  if (index <= 14) {
    return { fg: "yellow", bold: true };
  }
  if (index <= 17) {
    return { fg: "red" };
  }
  if (index <= 21) {
    return { fg: "magenta" };
  }
  if (index <= 23) {
    return { fg: "magenta", bold: true };
  }
  return { fg: "#ff0000", bold: true };
}

// The moving corner of a visual block. The rectangle is drawn reversed, so
// every block cell already shows its glyph color as a solid background; a
// white corner would vanish against the reversed floor. Yellow instead, the
// same accent the VISUAL mode pill uses, so the corner pops.
export const STYLE_VISUAL_CORNER: CellStyle = { fg: "black", bg: "yellow" };

/**
 * The look/target cursor marker. Reverse video marks a selected cell
 * everywhere else, but an enemy that already paints reversed (the
 * GIL-less dev preview) would swallow a second reverse and look
 * unselected, so those cells take this accent block instead.
 */
export const STYLE_CURSOR: CellStyle = STYLE_VISUAL_CORNER;

/** Time budget for one tracer animation. Steps are clamped to 5-25 ms. */
export const SHOT_BUDGET_MS = 120;
/** Pause on each floor of the service elevator ride, in milliseconds. */
export const ELEVATOR_FRAME_MS = 45;

// Right-side menu panel, NetHack 5.0 style: map stays visible.
// Minimum width; paintPanel widens to fit longer rows.
export const PANEL_W = 40;
/** First row of a menu panel, two rows below the message line. */
export const PANEL_TOP = 2;
/** Blank cells kept between a menu panel and the map. */
export const PANEL_MARGIN = 1;
/** Visible pager body rows; the footer takes the last screen row. */
export const PAGE_ROWS = SCREEN_ROWS - 1;
