/**
 * Aim: the presentation-side cursor and visual block.
 *
 * The input layer owns this mode state and the sim only sees plain cells
 * through `FireCommand`. Everything here mutates `S.ui` plus, for a shot,
 * calls into combat and returns the tracer for the presenter.
 */
import { isWeapon, nearestReachableTarget } from "../player/items.ts";
import type { Animation, GameState } from "../game/state.ts";
import type { Vec } from "../world/geometry.ts";
import {
  blockBounds,
  canLandCursor,
  edgeReach,
  enemyCellsIn,
  isWall,
  stepCursor,
} from "../world/queries.ts";
import { note, say } from "../game/events.ts";
import { NOTE } from "../content.ts";
import { visualSelectionCells } from "../ui/render.ts";
import {
  anyFireableCell,
  chamber,
  fireCommand,
  hasReachableTarget,
  type FireCommand,
} from "./combat.ts";

/** Fire mode: cursor auto-targets the nearest enemy you can see. */
export function enterTarget(S: GameState): void {
  if (!isWeapon(S.sim.wielded)) {
    note(S, NOTE.needGun);
    return;
  }
  if (!S.sim.loaded) {
    note(S, NOTE.needLoaded);
    return;
  }
  const target = nearestReachableTarget(
    S.sim.player,
    enemyCellsIn(S),
    S.sim.visible,
    (x, y) => isWall(S, x, y),
  );
  if (target === null) {
    for (const d of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      if (!isWall(S, S.sim.player.x + d.x, S.sim.player.y + d.y)) {
        S.ui.cursor = { x: S.sim.player.x + d.x, y: S.sim.player.y + d.y };
        break;
      }
    }
  } else {
    S.ui.cursor = { x: target.x, y: target.y };
  }
  S.ui.mode = "target";
  note(S, NOTE.chooseTarget);
}

/**
 * Move the aim cursor one step, treating a multi-tile enemy as one unit:
 * standing on a walrus, a step hops past the whole glyph. When the far
 * edge is blocked, it falls back to the next cell so the cursor can still
 * shift onto the enemy's other tile.
 */
export function moveCursor(S: GameState, dx: number, dy: number): void {
  const dest = stepCursor(S, S.ui.cursor, dx, dy, (p) => canLandCursor(S, p));
  if (dest !== null) {
    S.ui.cursor = dest;
  }
}

/**
 * Cells of the visual block: the anchor-to-cursor rectangle, grown so
 * any enemy it touches is covered whole (both walrus tiles), which keeps
 * the selection a full rectangle rather than a stepped shape.
 */
export function cellsInRect(S: GameState): Vec[] {
  const { x0, y0, x1, y1 } = blockBounds(
    S.sim.level.enemies,
    S.ui.visual.anchor,
    S.ui.cursor,
  );
  const cells: Vec[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      cells.push({ x, y });
    }
  }
  return cells;
}

/** Shared refusal when the visual block is still locked. */
function reportLocked(S: GameState): void {
  note(S, NOTE.visualLocked);
}

/** Remember the current block so `gv` can restore it. */
function rememberVisual(S: GameState): void {
  S.ui.visual.last = {
    anchor: { ...S.ui.visual.anchor },
    cursor: { ...S.ui.cursor },
  };
}

/**
 * Show the current selection: switch to VISUAL BLOCK, remember it for `gv`,
 * and queue the announcement; the renderer paints the block and status pill.
 */
function showVisual(S: GameState): void {
  S.ui.mode = "visual";
  rememberVisual(S);
  say(S, { type: "visual-block" });
}

/** Visual block mode: anchor a vim-style rectangle at the cursor. */
export function enterVisual(S: GameState): void {
  if (!S.sim.visualUnlocked) {
    reportLocked(S);
    return;
  }
  S.ui.visual.anchor = { ...S.ui.cursor };
  S.ui.visual.rect = cellsInRect(S);
  showVisual(S);
}

/**
 * Enter visual block straight from play: aim at the nearest enemy first,
 * exactly as `f` would, then anchor there. A locked block or an unarmed or
 * unloaded gun reports and stays in play.
 */
export function enterVisualFromPlay(S: GameState): void {
  if (!S.sim.visualUnlocked) {
    reportLocked(S);
    return;
  }
  enterTarget(S);
  if (S.ui.mode === "target") {
    enterVisual(S);
  }
}

/** Move the visual corner to `dest` and resize the block. */
function applyVisualCursor(S: GameState, dest: Vec): void {
  S.ui.cursor.x = dest.x;
  S.ui.cursor.y = dest.y;
  S.ui.visual.rect = cellsInRect(S);
  rememberVisual(S);
}

/**
 * Move the visual corner one step. Stepping onto a walrus lands on its
 * near tile, and the grown block covers the whole glyph exactly; the next
 * step in the same direction then moves the edge past it. A blocked far
 * edge falls back to the next cell.
 */
export function visualMove(S: GameState, dx: number, dy: number): void {
  const dest = stepCursor(S, S.ui.cursor, dx, dy, (p) => canLandCursor(S, p));
  if (dest !== null) {
    applyVisualCursor(S, dest);
  }
}

/**
 * Visual edge motion: send the corner as far as (dx, dy) reaches before a
 * wall, an unexplored cell, or the map edge, then resize the block. This
 * backs `^`, `$` (rows) and `gg`, `G` (columns).
 */
export function visualEdge(S: GameState, dx: number, dy: number): void {
  const dest = edgeReach(S, S.ui.cursor, dx, dy);
  if (dest.x === S.ui.cursor.x && dest.y === S.ui.cursor.y) {
    return;
  }
  applyVisualCursor(S, dest);
}

/** `o`: swap the block's two corners. The rectangle itself is unchanged. */
export function visualSwapCorner(S: GameState): void {
  const anchor = { ...S.ui.visual.anchor };
  S.ui.visual.anchor = { ...S.ui.cursor };
  S.ui.cursor = anchor;
  S.ui.visual.rect = cellsInRect(S);
  rememberVisual(S);
}

/**
 * `O`: vim's parallel corner shift. Each corner slides to the other end of
 * its own line, so the cursor lands at the other corner of its row while
 * the rectangle stays exactly the same.
 */
export function visualParallelCorner(S: GameState): void {
  const oldX = S.ui.visual.anchor.x;
  S.ui.visual.anchor.x = S.ui.cursor.x;
  S.ui.cursor.x = oldX;
  S.ui.visual.rect = cellsInRect(S);
  rememberVisual(S);
}

/** Re-enter the last visual selection. */
export function gvReselect(S: GameState): void {
  if (!S.sim.visualUnlocked) {
    reportLocked(S);
    return;
  }
  if (!isWeapon(S.sim.wielded)) {
    note(S, NOTE.needGun);
    return;
  }
  if (S.ui.visual.last === null) {
    note(S, NOTE.noPreviousVisual);
    return;
  }
  S.ui.visual.anchor = { ...S.ui.visual.last.anchor };
  S.ui.cursor = { ...S.ui.visual.last.cursor };
  S.ui.visual.rect = cellsInRect(S);
  showVisual(S);
}

/** Fire one shot along the aim cursor, then return to play. */
export function fire(S: GameState): Animation | null {
  const target = { ...S.ui.cursor };
  const anim = fireCommand(S, {
    cells: [target],
    center: target,
    visual: false,
  });
  S.ui.mode = "play";
  return anim;
}

/**
 * Fire at everything covered, rendering the pre-shot block on the
 * tracer animation's opening frame. This part of the tracer animation lets
 * a `.` command start from the same visual selection frame as a natural
 * visual shot would.
 */
export function fireVisual(S: GameState): Animation | null {
  const selection = visualSelectionCells(S);
  const anim = fireVisualNow(S);
  return anim?.kind === "tracer" ? { ...anim, selection } : anim;
}

/** Fire at everything covered: one ray per cell, one hit per enemy. */
function fireVisualNow(S: GameState): Animation | null {
  const cells = S.ui.visual.rect.map((cell) => ({ ...cell }));
  const center: Vec = {
    x: Math.round((S.ui.visual.anchor.x + S.ui.cursor.x) / 2),
    y: Math.round((S.ui.visual.anchor.y + S.ui.cursor.y) / 2),
  };
  const command: FireCommand = { cells, center, visual: true };
  const anim = fireCommand(S, command);
  S.ui.mode = "play";
  return anim;
}

/**
 * `.` repeats the last shot. A volley refires the exact tiles it was aimed at
 * (bringing the block back up first), while a single shot re-runs `f` and
 * re-aims at the nearest enemy. Either way it chambers first, spending the
 * turns the original sequence would, and stays quiet when there is no previous
 * shot or nothing on the recorded tiles can still be hit.
 */
export function repeatFire(S: GameState): Animation | null {
  const action = S.ui.lastFire;
  if (action === null) {
    note(S, NOTE.nothingToRepeat);
    return null;
  }
  const fireable = action.visual
    ? anyFireableCell(S, action.cells)
    : hasReachableTarget(S);
  if (!fireable) {
    note(S, NOTE.nothingInRange);
    return null;
  }
  chamber(S);
  if (!S.sim.loaded) {
    return null; // No shells, or nothing armed: chamber already said why.
  }
  if (!action.visual) {
    // A single shot has no fixed tiles: re-aim at the nearest enemy, as `f`.
    enterTarget(S);
    return fire(S);
  }
  // A volley keeps its exact tiles; show the block again, then refire it.
  const xs = action.cells.map((c) => c.x);
  const ys = action.cells.map((c) => c.y);
  S.ui.visual.anchor = { x: Math.min(...xs), y: Math.min(...ys) };
  S.ui.cursor = { x: Math.max(...xs), y: Math.max(...ys) };
  S.ui.visual.rect = action.cells.map((c) => ({ ...c }));
  showVisual(S);
  return fireVisual(S);
}
