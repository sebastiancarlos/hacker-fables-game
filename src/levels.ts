/**
 * Levels: arrival handling and live binding swaps.
 *
 * Pure swaps over S plus nearest-free-cell search. No screen writes.
 */
import { nearestFreeCell, type Vec } from "./geometry.ts";
import { buildLevel, enemyCellsForKindAt, type Level } from "./world.ts";
import { HEIGHT, WIDTH } from "./theme.ts";
import type { GameState } from "./game-state.ts";
import { isWall, enemyAt } from "./queries.ts";

/** The level for a depth, generating and storing it on first visit. */
export function getLevel(S: GameState, depth: number): Level {
  const existing = S.sim.levels.get(depth);
  if (existing !== undefined) {
    return existing;
  }
  const fresh = buildLevel(depth, {
    arena: S.meta.arena,
    baseSeed: S.meta.baseSeed,
  });
  S.sim.levels.set(depth, fresh);
  return fresh;
}

/**
 * Land in a level at `pos`: swap the live bindings to it, drop the player
 * there, and shove any stair-squatting enemy aside. Vision is the caller's.
 */
export function arriveAt(S: GameState, level: Level, pos: Vec): void {
  enterLevel(S, level);
  S.sim.player = { ...pos };
  clearArrival(S);
}

/** Shove a stair-squatting enemy to the nearest cell its whole body fits. */
export function clearArrival(S: GameState): void {
  const squatter = enemyAt(S, S.sim.player.x, S.sim.player.y);
  if (squatter === undefined) {
    return;
  }
  const fits = (x: number, y: number): boolean =>
    enemyCellsForKindAt(squatter.kind, x, y).every((c) => {
      if (c.x < 0 || c.y < 0 || c.x >= WIDTH || c.y >= HEIGHT) {
        return false;
      }
      if (
        isWall(S, c.x, c.y) ||
        (c.x === S.sim.player.x && c.y === S.sim.player.y)
      ) {
        return false;
      }
      const other = enemyAt(S, c.x, c.y);
      return other === undefined || other === squatter;
    });
  const spot = nearestFreeCell(
    { x: squatter.x, y: squatter.y },
    (x, y) => !fits(x, y),
    WIDTH,
    HEIGHT,
  );
  if (spot !== null) {
    squatter.x = spot.x;
    squatter.y = spot.y;
  }
}

/** Swap the live bindings to another level. */
export function enterLevel(S: GameState, next: Level): void {
  S.sim.level = next;
  // The tally's recent list is per level: start the visible segment fresh,
  // but keep the whole run so the total count survives the transition.
  S.ui.commandMark = S.meta.commands.length;
}
