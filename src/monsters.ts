/**
 * Enemies: sight, movement, bites, and turn parity.
 *
 * Single-tile code-snakes and the two-cell walrus operator share one AI.
 * A snake is one cell; the walrus is a rigid ":=" glyph whose body is
 * derived from its head, so every glide (diagonal included) moves both
 * cells at once and the shape can never break. This module only mutates S;
 * the renderer repaints the frame once per key.
 */
import * as ROT from "rot-js";
import { adjacent, bresenham, chebyshev, type Vec } from "./geometry.ts";
import type { Rng } from "./rng.ts";
import { ENEMY_KINDS, enemyName, enemySpeed } from "./enemies.ts";
import { enemyCells, enemyCellsForKindAt, type Enemy } from "./world.ts";
import { HEIGHT, WIDTH } from "./theme.ts";
import type { GameState } from "./game-state.ts";
import { isWall, enemyAt } from "./queries.ts";
import { gridHas, type Grid } from "./grid.ts";

/** How far an enemy can see, in cells. */
export const SIGHT = 20;

/** True when the enemy can see the player: in range with a clear ray. */
export function enemySeesPlayer(S: GameState, e: Enemy): boolean {
  const near = Math.min(
    ...enemyCells(e).map((c) => chebyshev(c, S.sim.player)),
  );
  if (near > SIGHT) {
    return false;
  }
  for (const c of bresenham(e.x, e.y, S.sim.player.x, S.sim.player.y)) {
    if (isWall(S, c.x, c.y)) {
      return false;
    }
  }
  return true;
}

/** True when any enemy cell touches the player (8-directional). */
export function enemyTouchesPlayer(S: GameState, e: Enemy): boolean {
  return enemyCells(e).some((c) => adjacent(c, S.sim.player));
}

/**
 * Move an enemy so its head lands on `next`, keeping the family shape.
 * The body is derived from the head, so the walrus glides as a rigid
 * ":=" glyph: even a diagonal step shifts both cells together and the
 * glyph never rotates or deforms.
 */
export function slideEnemy(e: Enemy, next: Vec): void {
  e.x = next.x;
  e.y = next.y;
}

/** Per-level context for wandering where the player is not. */
export interface EnemyCtx {
  walls: Grid;
  enemies: Enemy[];
  player: Vec | null;
  /** The wander stream; see `Rng`. */
  rng: Rng;
}

/** True when another enemy already occupies the cell. */
function occupiedByOther(
  ctx: EnemyCtx,
  self: Enemy,
  x: number,
  y: number,
): boolean {
  return ctx.enemies.some(
    (o) => o !== self && enemyCells(o).some((c) => c.x === x && c.y === y),
  );
}

/**
 * True when the whole body fits if the head moves to `next`: every cell
 * in bounds, floor, clear of other enemies and the player. The walrus
 * is checked across both of its cells, so it can never squeeze a body
 * cell into a wall even on a diagonal.
 */
function canStep(ctx: EnemyCtx, self: Enemy, next: Vec): boolean {
  for (const c of enemyCellsForKindAt(self.kind, next.x, next.y)) {
    if (c.x < 0 || c.y < 0 || c.x >= WIDTH || c.y >= HEIGHT) {
      return false;
    }
    if (gridHas(ctx.walls, c.x, c.y)) {
      return false;
    }
    if (occupiedByOther(ctx, self, c.x, c.y)) {
      return false;
    }
    if (ctx.player !== null && c.x === ctx.player.x && c.y === ctx.player.y) {
      return false;
    }
  }
  return true;
}

/** Wander blindly: a random legal step for the family. */
export function enemyWander(e: Enemy, ctx: EnemyCtx): void {
  const opts: Vec[] = [];
  for (const d of ENEMY_KINDS[e.kind].dirs) {
    const next = { x: e.x + d.x, y: e.y + d.y };
    if (canStep(ctx, e, next)) {
      opts.push(next);
    }
  }
  if (opts.length === 0) {
    return;
  }
  slideEnemy(e, opts[ctx.rng.int(0, opts.length - 1)]!);
}

/** First A* step from the head toward the player, or null when adjacent. */
function huntStep(S: GameState, e: Enemy): Vec | null {
  const path = new ROT.Path.AStar(
    S.sim.player.x,
    S.sim.player.y,
    (x: number, y: number) => {
      if (isWall(S, x, y)) {
        return false;
      }
      const other = enemyAt(S, x, y);
      return other === undefined || other === e;
    },
    { topology: 8 },
  );
  const steps: Vec[] = [];
  path.compute(e.x, e.y, (x: number, y: number) => {
    steps.push({ x, y });
  });
  return steps[1] ?? null;
}

/**
 * The legal step that brings the head closest to a goal, or null. Used
 * when a wide body cannot follow its head's path directly.
 */
function nearestGlide(ctx: EnemyCtx, e: Enemy, goal: Vec): Vec | null {
  let best: Vec | null = null;
  for (const d of ENEMY_KINDS[e.kind].dirs) {
    const next = { x: e.x + d.x, y: e.y + d.y };
    if (!canStep(ctx, e, next)) {
      continue;
    }
    if (best === null || chebyshev(next, goal) < chebyshev(best, goal)) {
      best = next;
    }
  }
  return best;
}

/** One step along the A* path toward the player. False when stuck. */
export function enemyStep(S: GameState, e: Enemy): boolean {
  const ctx: EnemyCtx = {
    walls: S.sim.level.walls,
    enemies: S.sim.level.enemies,
    player: S.sim.player,
    rng: S.sim.rng,
  };
  const next = huntStep(S, e);
  if (
    next === null ||
    (next.x === S.sim.player.x && next.y === S.sim.player.y)
  ) {
    return false;
  }
  // A wide body cannot always trace its head's path; the walrus falls
  // back to the nearest-fitting glide so it still closes in.
  const step = canStep(ctx, e, next)
    ? next
    : nearestGlide(ctx, e, S.sim.player);
  if (step === null) {
    return false;
  }
  slideEnemy(e, step);
  return true;
}

/** Bite the player from any adjacent cell, once a turn. */
export function enemyBite(S: GameState, e: Enemy): void {
  S.sim.hp -= e.bite;
  const fatal = S.sim.hp <= 0;
  if (fatal) {
    S.sim.hp = 0;
    S.sim.dead = true;
    S.sim.killedBy = enemyName(e.kind, e.version);
  }
  S.sim.events.push({
    type: "bite",
    kind: e.kind,
    version: e.version,
    damage: e.bite,
    fatal,
  });
}

/**
 * Each living enemy gets one move per player action (turn parity), and the
 * GIL-less dev preview gets two: it moves twice as fast but still bites
 * only once a turn, so a cornered boss wounds rather than doubles up.
 * Enemies hunt 8-directionally, snakes wander four ways while the
 * walrus glides eight as one glyph, and any enemy bites from a
 * surrounding cell; only the player is bound to 4-directional vim
 * movement. An enemy that cannot see you wanders instead of hunting.
 */
export function enemyTurn(S: GameState): void {
  for (const e of [...S.sim.level.enemies]) {
    if (S.sim.dead) {
      break;
    }
    let bit = false;
    for (let left = enemySpeed(e.kind); left > 0 && !S.sim.dead; left--) {
      if (!enemySeesPlayer(S, e)) {
        enemyWander(e, {
          walls: S.sim.level.walls,
          enemies: S.sim.level.enemies,
          player: S.sim.player,
          rng: S.sim.rng,
        });
      } else if (enemyTouchesPlayer(S, e)) {
        if (bit) {
          break; // Second action while adjacent: hold instead of biting again.
        }
        enemyBite(S, e);
        bit = true;
      } else if (!enemyStep(S, e)) {
        break; // Boxed in: the rest of the turn is spent nowhere.
      }
    }
  }
}

/**
 * One player action passes one turn on the current level; the adjacent
 * floors wander blindly, so a dive does not pay for every level above it.
 * Any popup a turn queues is left on `S.sim` for the presenter.
 */
export function passTurn(S: GameState): void {
  S.sim.turns++;
  enemyTurn(S);
  const here = S.sim.level.depth;
  for (const other of S.sim.levels.values()) {
    if (other === S.sim.level || Math.abs(other.depth - here) > 1) {
      continue;
    }
    for (const e of [...other.enemies]) {
      // Off-level drift: no player to avoid and nothing to repaint.
      enemyWander(e, {
        walls: other.walls,
        enemies: other.enemies,
        player: null,
        rng: S.sim.rng,
      });
    }
  }
}
