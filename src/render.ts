/**
 * Render: screen painting.
 *
 * Every function takes (S, screen, ...) explicitly.
 */
import { panelGeometry, type Vec } from "./geometry.ts";
import { ENEMY_KINDS, enemyName, healthLabel } from "./enemies.ts";
import { xpNext } from "./progression.ts";
import { isWeapon } from "./items.ts";
import { fitRich, fitRow, visibleLength, wrapText } from "./text.ts";
import type { Enemy } from "./world.ts";
import { HEIGHT, WIDTH } from "./theme.ts";
import { gridHas, type Grid } from "./grid.ts";
import { LORE_LINES, UI } from "./content.ts";
import {
  MAX_HP,
  currentConfirm,
  currentMenu,
  currentPager,
  type GameState,
  type MenuRow,
  type PagerModal,
  type VisualCell,
} from "./game-state.ts";
import type { Screen } from "./screen.ts";
import {
  isWall,
  itemAt,
  enemyAt,
  isEnemyHead,
  stairsAt,
  selectionCells,
  elevatorAt,
  wallGlitchGlyph,
  wallTier,
} from "./queries.ts";
import {
  DUNGEON_ROW,
  COMMAND_ROW,
  PAGE_ROWS,
  STYLE_FLOOR_MEM,
  STYLE_ITEM,
  STYLE_ITEM_MEM,
  STYLE_PLAYER,
  STYLE_STAIRS,
  STYLE_STAIRS_MEM,
  STYLE_WALL_CLEAN,
  STYLE_WALL_CORRUPT_RAMP,
  STYLE_WALL_MEM,
  MAP_TOP,
  PANEL_MARGIN,
  PANEL_TOP,
  PANEL_W,
  STYLE_CURSOR,
  STYLE_REVERSE,
  STYLE_VISUAL_CORNER,
  SCREEN_ROWS,
  STATUS_ROW,
} from "./theme.ts";
import {
  type Cell,
  type CellStyle,
  type RichText,
  type Span,
  linkify,
  spans,
  textWidth,
} from "./style.ts";
import { commandLine } from "./commands.ts";
import { endScreenLines } from "./score.ts";
import { scoreRows, titleLines } from "./title.ts";

/** Glyph for one enemy cell. */
export function enemyGlyphAtCell(e: Enemy, x: number, y: number): string {
  return ENEMY_KINDS[e.kind].glyph(e.version, isEnemyHead(e, x, y));
}

/** Style for an enemy. */
export function enemyColor(e: Enemy): CellStyle {
  return ENEMY_KINDS[e.kind].color(e.version);
}

/**
 * Paint one map cell with the provided content.
 *
 * `toggleReverse` flips the cell's reverse attribute without mutating `cell`,
 * so that a "reversing of a reversed" looks visually as "unreversed", as expected.
 */
export function putCell(
  screen: Screen,
  x: number,
  y: number,
  cell: Cell,
  toggleReverse = false,
): void {
  const reverse = Boolean(cell.reverse) !== toggleReverse;
  const out: Cell = { ...cell };
  if (reverse) {
    out.reverse = true;
  } else {
    delete out.reverse;
  }
  screen.cell(x, y + MAP_TOP, out);
}

/** The glyph and style a map cell shows, or null when still unexplored. */
export function cellSpec(S: GameState, x: number, y: number): Cell | null {
  // Replay omniscience sees the whole level: nothing is unexplored, and
  // every cell reads as if it were in sight (full-color enemies, items).
  const omni = S.ui.omniscient;

  // bail if no info
  if (!omni && !gridHas(S.sim.level.explored, x, y)) {
    return null;
  }

  // track coordinate being recalled
  const mem = !omni && !gridHas(S.sim.visible, x, y);

  if (x === S.sim.player.x && y === S.sim.player.y) {
    return { ch: "@", ...STYLE_PLAYER };
  }
  const s = enemyAt(S, x, y);
  if (s !== undefined && !mem) {
    return { ch: enemyGlyphAtCell(s, x, y), ...enemyColor(s) };
  }
  const g = itemAt(S, x, y);
  if (g !== undefined) {
    return { ch: g.item.glyph, ...(mem ? STYLE_ITEM_MEM : STYLE_ITEM) };
  }
  const st = stairsAt(S, x, y);
  if (st !== undefined) {
    return { ch: st, ...(mem ? STYLE_STAIRS_MEM : STYLE_STAIRS) };
  }
  if (elevatorAt(S, x, y)) {
    return { ch: "=", ...(mem ? STYLE_STAIRS_MEM : STYLE_STAIRS) };
  }
  if (isWall(S, x, y)) {
    if (mem) {
      return { ch: "#", ...STYLE_WALL_MEM };
    }
    // The bottom's still-corrupt walls shimmer with noise glyphs, drawn in
    // the wall's own color. Only cells in sight glitch, and only while the
    // floor has enemies left, so the flicker stops the moment it heals.
    return { ch: wallGlitchGlyph(S, x, y) ?? "#", ...wallTint(S) };
  }
  return { ch: ".", ...(mem ? STYLE_FLOOR_MEM : {}) };
}

/**
 * The wall color for the floor's current corruption: Bell Labs blue when
 * clear, else a red from the ramp, deeper the more enemies are still alive.
 * The ramp is keyed to the absolute headcount, so a shade means the same
 * thing at any depth. A live boss pins it to full red.
 */
function wallTint(S: GameState): CellStyle {
  const tier = wallTier(S);
  return tier === 0 ? STYLE_WALL_CLEAN : STYLE_WALL_CORRUPT_RAMP[tier - 1]!;
}

/**
 * Redraw one map cell.
 * Unlike `putCell`, `paintCell` is game-state aware, and figures out what
 * cell to put.
 */
export function paintCell(
  S: GameState,
  screen: Screen,
  x: number,
  y: number,
  toggleReverse = false,
): void {
  putCell(screen, x, y, cellSpec(S, x, y) ?? { ch: " " }, toggleReverse);
}

/**
 * One frame of the service elevator ride: a floor's walls drawn in reverse,
 * the shaft lit in the stairs' white at the same cell on every floor.
 */
export function paintElevatorFrame(screen: Screen, walls: Grid, at: Vec): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const shaft = x === at.x && y === at.y;
      const ch = shaft ? "=" : gridHas(walls, x, y) ? "#" : ".";
      putCell(
        screen,
        x,
        y,
        shaft ? { ch, ...STYLE_STAIRS } : { ch, ...STYLE_REVERSE },
      );
    }
  }
}

/** Rewrite only the top message line, measured in visible cells. */
function paintMessage(S: GameState, screen: Screen): void {
  screen.text(0, 0, fitRich(S.ui.message, WIDTH), WIDTH);
}

/** Rewrite the status line. */
export function paintStatus(S: GameState, screen: Screen): void {
  // Hitpoint bar, NetHack style: the name itself is the bar, with the
  // HP% portion in reverse video.
  const name = UI.playerName.padEnd(30).slice(0, 30);
  const pct = (S.sim.hp / MAX_HP) * 100;
  let fill = Math.floor((30 * pct) / 100);
  if (fill < 1 && pct > 0) {
    fill = 1;
  }
  if (fill >= 30 && pct < 100) {
    fill = 29;
  }
  const pillText =
    S.ui.mode === "visual"
      ? UI.modeVisual
      : S.sim.insertMode
        ? UI.modeInsert
        : UI.modeNormal;
  const pillStyle: CellStyle =
    S.ui.mode === "visual"
      ? { fg: "black", bg: "yellow" }
      : S.sim.insertMode
        ? { fg: "black", bg: "blue" }
        : { fg: "black", bg: "white" };
  const hasGun = isWeapon(S.sim.wielded) || S.sim.inventory.some(isWeapon);
  const rest = UI.statusRest(
    S.sim.hp,
    MAX_HP,
    S.sim.wielded !== null ? S.sim.wielded.name : null,
    hasGun ? S.sim.shells + (S.sim.loaded ? 1 : 0) : null,
  );
  const line: Span[] = [{ text: "[" }];
  if (fill > 0) {
    line.push({ text: name.slice(0, fill), reverse: true });
  }
  line.push({ text: `${name.slice(fill)}]` });
  line.push({
    text: rest
      .padEnd(WIDTH - 32 - pillText.length)
      .slice(0, WIDTH - 32 - pillText.length),
  });
  line.push({ text: pillText, ...pillStyle });
  screen.text(0, STATUS_ROW, line, WIDTH);
}

/**
 * Paint the dungeon status line: depth, character level, and experience,
 * with any pending count or armed leader echoed at the right edge.
 */
function paintDungeonLine(S: GameState, screen: Screen): void {
  let row =
    `Dlvl:${S.sim.level.depth}  Lv:${S.sim.plevel}  Xp:${S.sim.xp}/${xpNext(S.sim.plevel)}`
      .padEnd(WIDTH)
      .slice(0, WIDTH);
  for (const echo of [S.ui.count, S.ui.pendingKeys]) {
    if (echo !== "") {
      row = row.slice(0, WIDTH - echo.length) + echo;
    }
  }
  screen.text(0, DUNGEON_ROW, row, WIDTH);
}

/** Vim command line: the count and the most recent commands. */
function paintCommandsLine(S: GameState, screen: Screen): void {
  screen.text(
    0,
    COMMAND_ROW,
    fitRow(commandLine(S.meta.commands, S.ui.commandMark, WIDTH), WIDTH),
    WIDTH,
  );
}

/**
 * Recording controls, shown in the command row while a replay is paused in
 * place of the vim tally.
 */
export function paintPlaybackControls(screen: Screen): void {
  screen.text(0, COMMAND_ROW, fitRow(UI.replayControls, WIDTH), WIDTH);
}

/**
 * Paint "target line" row while targeting: the target's health, or standard help.
 * Otherwise, paint the dungeon line.
 */
function paintTargetStatus(S: GameState, screen: Screen): void {
  const s = enemyAt(S, S.ui.cursor.x, S.ui.cursor.y);
  if (s !== undefined && gridHas(S.sim.visible, S.ui.cursor.x, S.ui.cursor.y)) {
    const line = spans(
      healthLabel(enemyName(s.kind, s.version), s.hp, s.maxHp),
      ` ${UI.targetHint(s.hp, s.maxHp)}`,
    );
    screen.text(0, DUNGEON_ROW, fitRich(line, WIDTH), WIDTH);
    return;
  }
  paintDungeonLine(S, screen);
}

/**
 * Paint a block of lines centered on the frame, one line per row, both
 * across and down.
 */
function paintCenteredScreen(screen: Screen, lines: readonly RichText[]): void {
  const top = Math.max(0, Math.floor((SCREEN_ROWS - lines.length) / 2));
  for (let y = 0; y < SCREEN_ROWS; y++) {
    const text = y >= top && y - top < lines.length ? lines[y - top]! : "";
    const vis = Math.min(textWidth(text), WIDTH);
    const pad = Math.max(0, Math.floor((WIDTH - vis) / 2));
    screen.text(0, y, fitRich(spans(" ".repeat(pad), text), WIDTH), WIDTH);
  }
}

/**
 * Centered picker: a heading, the rows with one reversed, and a footer of
 * keys. Rows are padded to a common width so the highlight reads as a bar.
 */
function paintPicker(
  screen: Screen,
  title: string,
  rows: string[],
  selIdx: number,
  footer: string,
): void {
  const width = Math.max(
    title.length,
    footer.length,
    ...rows.map((r) => r.length),
    1,
  );
  const lines: RichText[] = [title, ""];
  rows.forEach((row, i) => {
    const padded = `  ${row}`.padEnd(width + 2);
    lines.push(spans(i === selIdx ? { text: padded, reverse: true } : padded));
  });
  lines.push("", footer);
  paintCenteredScreen(screen, lines);
}

/**
 * Centered table: a heading, rows padded to a common width so their columns
 * line up, and a footer of keys.
 */
function paintTable(
  screen: Screen,
  title: string,
  rows: string[],
  footer: string,
): void {
  const width = Math.max(
    title.length,
    footer.length,
    ...rows.map((r) => visibleLength(r)),
    1,
  );
  const lines: RichText[] = [title, ""];
  for (const row of rows) {
    lines.push(`  ${row}`.padEnd(width + 2));
  }
  lines.push("", footer);
  paintCenteredScreen(screen, lines);
}

/** Word-wrap rows to panel width. Continuations are unselectable. */
function wrapRows(rows: MenuRow[], width: number): MenuRow[] {
  return rows.flatMap((row) =>
    wrapText(row.text, width).map((text, i) => ({
      text,
      key: i === 0 ? row.key : null,
      hi: i === 0 ? row.hi : undefined,
    })),
  );
}

/**
 * Clear the one-cell border around a panel. The terminal's own background
 * shows through, keeping the map from touching the panel text.
 */
function clearPanelMargin(
  screen: Screen,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const left = Math.max(0, x - PANEL_MARGIN);
  const right = Math.min(WIDTH, x + width + PANEL_MARGIN);
  const span = " ".repeat(right - left);
  if (y - PANEL_MARGIN >= 0) {
    screen.text(left, y - PANEL_MARGIN, span, span.length);
  }
  if (y + height < SCREEN_ROWS) {
    screen.text(left, y + height, span, span.length);
  }
  for (let row = y; row < y + height; row++) {
    screen.text(left, row, " ".repeat(x - left), x - left);
    screen.text(
      x + width,
      row,
      " ".repeat(right - x - width),
      right - x - width,
    );
  }
}

/** Paint a text panel over the right side. Shorter than screen: map shows below. */
function paintPanel(
  screen: Screen,
  rows: MenuRow[],
  selIdx: number,
  pageRows: number,
): void {
  // Leave one blank column at each edge, so the margin always fits.
  const geo = panelGeometry(rows, PANEL_W, WIDTH - PANEL_MARGIN * 2);
  const x = geo.x + PANEL_MARGIN;
  const maxRows = Math.min(
    pageRows + 1,
    SCREEN_ROWS - PANEL_TOP - PANEL_MARGIN,
  );
  const fitted = wrapRows(rows, geo.w).slice(0, maxRows);
  clearPanelMargin(screen, x, PANEL_TOP, geo.w, fitted.length);
  let sel = -1;
  fitted.forEach((row, y) => {
    const padded = row.text.padEnd(geo.w).slice(0, geo.w);
    let hot = row.hi === true;
    if (row.key !== null) {
      sel++;
      hot = hot || sel === selIdx;
    }
    // Reverse video, like NetHack's HIGHLIGHT_COLOR + A_REVERSE.
    screen.text(
      x,
      PANEL_TOP + y,
      spans(hot ? { text: padded, ...STYLE_REVERSE } : padded),
      geo.w,
    );
  });
}

/** Paint one pager row, reversing every query match. */
function paintPagerLine(
  p: PagerModal,
  screen: Screen,
  y: number,
  text: string,
): void {
  const plain = text.padEnd(WIDTH).slice(0, WIDTH);
  const q = p.query;
  if (q === null || q === "") {
    screen.text(0, y, linkify(plain), WIDTH);
    return;
  }
  const at: number[] = [];
  const ql = q.toLowerCase();
  const low = plain.toLowerCase();
  let i = low.indexOf(ql);
  while (i !== -1) {
    at.push(i);
    i = low.indexOf(ql, i + 1);
  }
  const line: Span[] = [];
  let last = 0;
  for (const pos of at) {
    if (pos < last) {
      continue;
    }
    if (pos > last) {
      line.push({ text: plain.slice(last, pos) });
    }
    line.push({ text: plain.slice(pos, pos + ql.length), reverse: true });
    last = pos + ql.length;
  }
  if (last < plain.length) {
    line.push({ text: plain.slice(last) });
  }
  screen.text(0, y, linkify(line), WIDTH);
}

/** The pager footer: position, percentage, and search state. */
function pagerStatus(p: PagerModal, pageRows: number): string {
  if (p.typing) {
    return UI.pagerTyping(p.query ?? "");
  }
  const n = p.lines.length;
  const bot = Math.min(p.top + pageRows, n);
  const pct = n <= pageRows || bot >= n ? 100 : Math.floor((bot / n) * 100);
  let s = UI.pagerStatus(p.title, p.top, bot, n, pct);
  if (p.noMatch) {
    s += UI.pagerNoMatch;
  } else if (p.query) {
    s += UI.pagerQuery(p.query);
  }
  return s;
}

/** Paint the visible pager lines and its status footer. */
function paintPager(p: PagerModal, screen: Screen, pageRows: number): void {
  for (let r = 0; r < pageRows; r++) {
    paintPagerLine(p, screen, r, p.lines[p.top + r] ?? "");
  }
  screen.text(
    0,
    pageRows,
    spans({
      text: pagerStatus(p, pageRows).padEnd(WIDTH).slice(0, WIDTH),
      ...STYLE_REVERSE,
    }),
    WIDTH,
  );
}

/**
 * Highlight a cursor cell.
 * For use for "target" and "look" mode (but not visual)
 */
function paintCursorCell(
  S: GameState,
  screen: Screen,
  x: number,
  y: number,
): void {
  const spec = cellSpec(S, x, y);
  if (spec !== null && spec.reverse === true) {
    // Reversed entities (like boss) would cancel a reverse onto
    // themselves, swallowing the highlight. This instead keeps the
    // reverse and tint cursor instead.
    putCell(screen, x, y, { ch: spec.ch, ...STYLE_CURSOR });
    return;
  }
  paintCell(S, screen, x, y, true);
}

/**
 * Highlight every cursor cell (even those selecting enities covering multiple cells).
 * For use for "target" and "look" mode (but not visual)
 */
export function drawCursor(S: GameState, screen: Screen): void {
  for (const c of selectionCells(S.sim.level.enemies, S.ui.cursor)) {
    paintCursorCell(S, screen, c.x, c.y);
  }
}

/** Flip a captured cell's reverse flag the way `putCell` would. */
function toggleReverse(cell: Cell): Cell {
  const out = { ...cell };
  if (out.reverse === true) {
    delete out.reverse;
  } else {
    out.reverse = true;
  }
  return out;
}

/**
 * The current visual block as concrete cells. Captured before a shot so the
 * tracer can paint the selection from the pre-fire state.
 */
export function visualSelectionCells(S: GameState): VisualCell[] {
  return S.ui.visual.rect.map((c) => {
    if (c.x === S.ui.cursor.x && c.y === S.ui.cursor.y) {
      const spec = cellSpec(S, c.x, c.y);
      return {
        x: c.x,
        y: c.y,
        cell: { ch: spec === null ? " " : spec.ch, ...STYLE_VISUAL_CORNER },
      };
    }
    return {
      x: c.x,
      y: c.y,
      cell: toggleReverse(cellSpec(S, c.x, c.y) ?? { ch: " " }),
    };
  });
}

/** Paint the block reversed with the moving corner highlighted. The screen
 * diff drops every cell whose content did not change. */
function paintVisual(S: GameState, screen: Screen): void {
  for (const { x, y, cell } of visualSelectionCells(S)) {
    putCell(screen, x, y, cell);
  }
}

/** Bottom-row help while looking. Restored by the play frame on exit. */
function paintLookHelp(screen: Screen): void {
  screen.text(0, DUNGEON_ROW, UI.lookHelp, WIDTH);
}

/**
 * Draw the play frame (map, message, status, dungeon, commands).
 */
function paintFrame(S: GameState, screen: Screen): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      paintCell(S, screen, x, y);
    }
  }
  paintMessage(S, screen);
  paintStatus(S, screen);
  paintDungeonLine(S, screen);
  paintCommandsLine(S, screen);
}

/** Recordings picker: one row per recording, the cursor reversed. */
function paintRecordingsScreen(S: GameState, screen: Screen): void {
  const rows =
    S.ui.recordings.entries.length === 0
      ? [UI.recordingsEmpty]
      : S.ui.recordings.entries.map((e) => e.label);
  paintPicker(
    screen,
    UI.recordingsTitle,
    rows,
    S.ui.recordings.cursor,
    UI.recordingsFooter,
  );
}

/** High-score table, centered, with its key hint underneath. */
function paintScoreList(S: GameState, screen: Screen): void {
  paintTable(
    screen,
    UI.scoresTitle,
    scoreRows(S.meta.scoreLines),
    UI.scoresFooter,
  );
}

/** Title screen: the boot splash. */
export function paintTitleMode(S: GameState, screen: Screen): void {
  paintCenteredScreen(
    screen,
    titleLines(S.ui.recordings.entries, S.ui.showQuit),
  );
}

/** Lore splash shown when a run begins. */
export function paintLoreMode(_S: GameState, screen: Screen): void {
  paintCenteredScreen(screen, LORE_LINES);
}

/** Recordings picker. */
export function paintRecordingsMode(S: GameState, screen: Screen): void {
  paintRecordingsScreen(S, screen);
}

/** High-score table. */
export function paintScoresMode(S: GameState, screen: Screen): void {
  paintScoreList(S, screen);
}

/** End screen: the frozen run summary. */
export function paintOverMode(S: GameState, screen: Screen): void {
  if (S.meta.runRecord !== null) {
    paintCenteredScreen(
      screen,
      endScreenLines(
        S.meta.runRecord,
        S.meta.commands,
        S.sim.inventory.map((i) => i.name),
        S.meta.recording !== null,
        S.meta.standing,
      ),
    );
  }
}

/** Plain play frame. */
export function paintPlayMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
}

/** Play frame with look cursor and its bottom-row help. */
export function paintLookMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
  drawCursor(S, screen);
  paintLookHelp(screen);
}

/** Play frame with the aim cursor and target health row. */
export function paintTargetMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
  drawCursor(S, screen);
  paintTargetStatus(S, screen);
}

/** Play frame with the visual block. */
export function paintVisualMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
  paintVisual(S, screen);
}

/** Play frame with a menu panel over it. */
export function paintMenuMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
  const menu = currentMenu(S.ui);
  if (menu !== null) {
    paintPanel(screen, menu.rows, menu.cursor, PAGE_ROWS);
  }
}

/** Play frame with a confirm popup over it. */
export function paintConfirmMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
  const confirm = currentConfirm(S.ui);
  if (confirm !== null) {
    paintPanel(screen, confirm.rows, confirm.cursor, PAGE_ROWS);
  }
}

/** Pager: styled lines over the map. */
export function paintPagerMode(S: GameState, screen: Screen): void {
  paintFrame(S, screen);
  const pager = currentPager(S.ui);
  if (pager !== null) {
    paintPager(pager, screen, PAGE_ROWS);
  }
}
