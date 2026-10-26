/**
 * Queries: read-only lookups over GameState.
 *
 * Pure functions of (S, coords). No screen writes, no mutations, so
 * render, vision, combat, and movement can all share them without cycles.
 * Enemies are matched on any occupied cell, head included.
 */
import type { GameState } from "../game/state.ts";
import type { Vec } from "./geometry.ts";
import { gridHas } from "./grid.ts";
import { enemyCells, enemyOn, type Enemy, type GroundItem } from "./map.ts";
import { HEIGHT, WIDTH } from "../ui/theme.ts";
import {
  corruptionTier,
  ENEMY_KINDS,
  glitchChance,
  glitchGlyph,
} from "../combat/enemies.ts";

/** Walls come from rot-js: Arena for tests, big-room dungeon for play. */
export function isWall(S: GameState, x: number, y: number): boolean {
  return gridHas(S.sim.level.walls, x, y);
}

/** The floor's corruption tier. A live boss pins it to the top. */
export function wallTier(S: GameState): number {
  return corruptionTier(
    S.sim.level.enemies.length,
    S.sim.level.enemies.some((e) => ENEMY_KINDS[e.kind].boss),
  );
}

/** True when the bottom floor still has glitching walls. */
export function wallsGlitching(S: GameState): boolean {
  return S.sim.level.enemies.length > 0 && glitchChance(S.sim.level.depth) > 0;
}

/** The noise glyph a wall cell flickers to this turn, or null for solid. */
export function wallGlitchGlyph(
  S: GameState,
  x: number,
  y: number,
): string | null {
  return wallsGlitching(S)
    ? glitchGlyph(x, y, S.sim.turns, S.sim.level.depth)
    : null;
}

/** True when the player currently sees a cell. */
export function isVisible(S: GameState, x: number, y: number): boolean {
  return gridHas(S.sim.visible, x, y);
}

/** True when a cell has ever been seen on this floor. */
export function isExplored(S: GameState, x: number, y: number): boolean {
  return gridHas(S.sim.level.explored, x, y);
}

/** The enemy occupying a cell, head or body, if any. */
export function enemyAt(S: GameState, x: number, y: number): Enemy | undefined {
  return enemyOn(S.sim.level.enemies, x, y);
}

/** True when (x, y) is an enemy's head cell. */
export function isEnemyHead(e: Enemy, x: number, y: number): boolean {
  return e.x === x && e.y === y;
}

/** Every occupied cell of every enemy, for targeting and look lists. */
export function enemyCellsIn(S: GameState): { x: number; y: number }[] {
  return S.sim.level.enemies.flatMap((e) => enemyCells(e));
}

/**
 * Cells a look or aim cursor selects: the whole enemy under the cursor
 * (both tiles of a walrus), else just the cell.
 */
export function selectionCells(enemies: Enemy[], c: Vec): Vec[] {
  const e = enemyOn(enemies, c.x, c.y);
  return e === undefined ? [{ x: c.x, y: c.y }] : enemyCells(e);
}

/**
 * One cursor step, treating an enemy as a single unit: standing on an
 * enemy, a step in a direction lands just past its far edge instead of on
 * its other tile. Approaching from outside still lands on the enemy.
 */
export function cursorStep(
  enemies: Enemy[],
  cursor: Vec,
  dx: number,
  dy: number,
): Vec {
  const here = enemyOn(enemies, cursor.x, cursor.y);
  let next = { x: cursor.x + dx, y: cursor.y + dy };
  while (here !== undefined && enemyOn(enemies, next.x, next.y) === here) {
    next = { x: next.x + dx, y: next.y + dy };
  }
  return next;
}

/**
 * A cursor step shared by aim, visual, and look: hop the whole enemy under
 * the cursor, fall back to the next cell when the far edge is unavailable,
 * and return null when neither candidate passes `bounds`.
 */
export function stepCursor(
  S: GameState,
  cursor: Vec,
  dx: number,
  dy: number,
  bounds: (p: Vec) => boolean,
): Vec | null {
  const skip = cursorStep(S.sim.level.enemies, cursor, dx, dy);
  const direct = { x: cursor.x + dx, y: cursor.y + dy };
  const dest = bounds(skip) ? skip : direct;
  return bounds(dest) ? dest : null;
}

/** True when a point lies on the map. */
export function inBounds(p: Vec): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < WIDTH && p.y < HEIGHT;
}

/** True when an aim cursor may land on a cell: in bounds, floor, not player. */
export function canLandCursor(S: GameState, p: Vec): boolean {
  return (
    inBounds(p) &&
    !isWall(S, p.x, p.y) &&
    !(p.x === S.sim.player.x && p.y === S.sim.player.y)
  );
}

/**
 * Farthest cell from `from` along (dx, dy) before the map edge, a wall,
 * an unexplored cell, or the player. One axis only, so it is the scan
 * behind the visual edge motions `^`, `$`, `gg`, and `G`.
 */
export function edgeReach(
  S: GameState,
  from: Vec,
  dx: number,
  dy: number,
): Vec {
  let p = { ...from };
  for (;;) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (nx < 0 || ny < 0 || nx >= WIDTH || ny >= HEIGHT) {
      break;
    }
    if (isWall(S, nx, ny) || !isExplored(S, nx, ny)) {
      break;
    }
    if (nx === S.sim.player.x && ny === S.sim.player.y) {
      break;
    }
    p = { x: nx, y: ny };
  }
  return p;
}

/**
 * The visual block, grown so any enemy it touches is covered whole. It
 * grows both axes, so the selection stays a full rectangle instead of
 * gaining a stepped notch when it reaches a walrus.
 */
export function blockBounds(
  enemies: Enemy[],
  anchor: Vec,
  cursor: Vec,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Math.min(anchor.x, cursor.x);
  let x1 = Math.max(anchor.x, cursor.x);
  let y0 = Math.min(anchor.y, cursor.y);
  let y1 = Math.max(anchor.y, cursor.y);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of enemies) {
      const body = enemyCells(e);
      if (!body.some((c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1)) {
        continue;
      }
      for (const c of body) {
        if (c.x < x0) {
          x0 = c.x;
          grew = true;
        }
        if (c.x > x1) {
          x1 = c.x;
          grew = true;
        }
        if (c.y < y0) {
          y0 = c.y;
          grew = true;
        }
        if (c.y > y1) {
          y1 = c.y;
          grew = true;
        }
      }
    }
  }
  return { x0, y0, x1, y1 };
}

/** The ground item at a cell, if any. */
export function itemAt(
  S: GameState,
  x: number,
  y: number,
): GroundItem | undefined {
  return S.sim.level.ground.find((g) => g.x === x && g.y === y);
}

/** The stair glyph at a cell, if any. */
export function stairsAt(
  S: GameState,
  x: number,
  y: number,
): "<" | ">" | undefined {
  if (
    S.sim.level.up !== null &&
    S.sim.level.up.x === x &&
    S.sim.level.up.y === y
  ) {
    return "<";
  }
  if (
    S.sim.level.down !== null &&
    S.sim.level.down.x === x &&
    S.sim.level.down.y === y
  ) {
    return ">";
  }
  return undefined;
}

/** True when (x, y) is the current level's service elevator shaft. */
export function elevatorAt(S: GameState, x: number, y: number): boolean {
  const ev = S.sim.level.elevator;
  return ev !== null && ev.x === x && ev.y === y;
}
