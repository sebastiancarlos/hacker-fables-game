/**
 * Movement: stepping, running, stair travel, and level changes.
 *
 * Every function mutates S and takes (S, fov, ...). Attacking, turn passing,
 * and vision are direct calls; the elevator ride hands the presenter an
 * animation instead of painting frames itself.
 */
import type { Fov } from "./vision.ts";
import { findPath, type Vec } from "./geometry.ts";
import { BOSS_DEPTH, enemyName } from "./enemies.ts";
import { ELEVATOR_POS, type Enemy } from "./world.ts";
import { HEIGHT, WIDTH } from "./theme.ts";
import {
  markCorruptionWarning,
  type Animation,
  type GameState,
} from "./game-state.ts";
import {
  isWall,
  itemAt,
  enemyAt,
  stairsAt,
  isExplored,
  isVisible,
  wallsGlitching,
  wallTier,
} from "./queries.ts";
import { attack } from "./combat.ts";
import { passTurn } from "./monsters.ts";
import { arriveAt, getLevel } from "./levels.ts";
import { computeVision } from "./vision.ts";
import { EXIT_SEALED, LABEL, MSG } from "./content.ts";
import { note } from "./events.ts";

/** Try to step the player, blocked by walls. */
export function move(S: GameState, fov: Fov, dx: number, dy: number): void {
  // A new step starts a new line; the presenter replaces the old message
  // even when this turn has nothing to add.
  S.sim.events.push({ type: "clear" });
  const nx = S.sim.player.x + dx;
  const ny = S.sim.player.y + dy;
  if (isWall(S, nx, ny)) {
    note(S, MSG.wall(wallTier(S), wallsGlitching(S)));
    return;
  }
  const target = enemyAt(S, nx, ny);
  if (target !== undefined) {
    attack(S, target);
    passTurn(S);
    return;
  }
  S.sim.player.x = nx;
  S.sim.player.y = ny;
  computeVision(S, fov);
  const steppedOn = itemAt(S, nx, ny);
  if (steppedOn !== undefined) {
    note(S, MSG.seeHere(steppedOn.item.name));
  }
  passTurn(S);
}

/**
 * Something that halts an auto-walk at the player's cell: an enemy that
 * just came into view, an item underfoot, or a staircase.
 */
function disturbance(S: GameState, seenBefore: Set<Enemy>): boolean {
  for (const s of S.sim.level.enemies) {
    if (isVisible(S, s.x, s.y) && !seenBefore.has(s)) {
      note(S, MSG.comesIntoView(enemyName(s.kind, s.version)));
      return true;
    }
  }
  if (itemAt(S, S.sim.player.x, S.sim.player.y) !== undefined) {
    return true;
  }
  const stair = stairsAt(S, S.sim.player.x, S.sim.player.y);
  if (stair !== undefined) {
    note(S, MSG.staircase(stair === "<" ? "up" : "down", S.sim.level.depth));
    return true;
  }
  return false;
}

/** Run straight until disturbed: wall, item, enemy ahead, or death. */
export function run(
  S: GameState,
  fov: Fov,
  dx: number,
  dy: number,
  limit = 100,
): void {
  const seenBefore = new Set<Enemy>();
  for (const s of S.sim.level.enemies) {
    if (isVisible(S, s.x, s.y)) {
      seenBefore.add(s);
    }
  }
  // Each step queues its own events behind a `clear`; the presenter can
  // replay the lines in order instead of the sim collecting them.
  let vx = dx;
  let vy = dy;
  let openArea = false;
  let steps = 0;
  const step = (sx: number, sy: number): void => {
    move(S, fov, sx, sy);
  };
  for (let i = 0; i < 100 && steps < limit; i++) {
    const nx = S.sim.player.x + vx;
    const ny = S.sim.player.y + vy;
    const blocker = enemyAt(S, nx, ny);
    if (blocker !== undefined) {
      note(S, MSG.blocksWay(enemyName(blocker.kind, blocker.version)));
      break;
    }
    if (isWall(S, nx, ny)) {
      // Turn only in real corridors: never seen openness, exactly one
      // open side, and the side cell constricted (both flanks walled).
      // Room walls and entrances stop the run instead.
      if (!openArea) {
        const sides: Vec[] =
          vx !== 0
            ? [
                { x: 0, y: -1 },
                { x: 0, y: 1 },
              ]
            : [
                { x: -1, y: 0 },
                { x: 1, y: 0 },
              ];
        const open = sides.filter(
          (s) => !isWall(S, S.sim.player.x + s.x, S.sim.player.y + s.y),
        );
        if (open.length === 1) {
          const o = open[0]!;
          const tx = S.sim.player.x + o.x;
          const ty = S.sim.player.y + o.y;
          const f1x = o.x !== 0 ? tx : tx - 1;
          const f1y = o.x !== 0 ? ty - 1 : ty;
          const f2x = o.x !== 0 ? tx : tx + 1;
          const f2y = o.x !== 0 ? ty + 1 : ty;
          if (isWall(S, f1x, f1y) && isWall(S, f2x, f2y)) {
            vx = o.x;
            vy = o.y;
            continue;
          }
        }
      }
      step(vx, vy);
      break;
    }
    step(vx, vy);
    steps++;
    if (S.sim.dead) {
      break;
    }
    // Openness latches: both sides open means room, and room
    // walls never turn a run afterwards.
    const perpX = vx !== 0 ? 0 : 1;
    const perpY = vx !== 0 ? 1 : 0;
    if (
      !isWall(S, S.sim.player.x + perpX, S.sim.player.y + perpY) &&
      !isWall(S, S.sim.player.x - perpX, S.sim.player.y - perpY)
    ) {
      openArea = true;
    }
    if (disturbance(S, seenBefore)) {
      break;
    }
  }
}

/** Walk a found path to known stairs, stopping at disturbances. */
export function travelTo(
  S: GameState,
  fov: Fov,
  dest: Vec,
  label: string,
): void {
  const seenBefore = new Set<Enemy>();
  for (const s of S.sim.level.enemies) {
    if (isVisible(S, s.x, s.y)) {
      seenBefore.add(s);
    }
  }
  const path = findPath(
    S.sim.player,
    dest,
    (x, y) => isWall(S, x, y),
    WIDTH,
    HEIGHT,
  );
  if (path === null || path.length === 0) {
    note(S, MSG.cannotReach(label));
    return;
  }
  for (const step of path) {
    const blocker = enemyAt(S, step.x, step.y);
    if (blocker !== undefined) {
      note(S, MSG.blocksWay(enemyName(blocker.kind, blocker.version)));
      return;
    }
    move(S, fov, step.x - S.sim.player.x, step.y - S.sim.player.y);
    if (S.sim.dead) {
      return;
    }
    if (disturbance(S, seenBefore)) {
      return;
    }
  }
}

/** Take the down stairs when the player is standing on them. */
export function descend(S: GameState, fov: Fov): void {
  if (
    S.sim.level.down !== null &&
    S.sim.player.x === S.sim.level.down.x &&
    S.sim.player.y === S.sim.level.down.y
  ) {
    const nextDepth = S.sim.level.depth + 1;
    const next = getLevel(S, nextDepth);
    arriveAt(S, next, next.up ?? S.sim.player);
    computeVision(S, fov);
    note(S, MSG.descend(nextDepth));
    if (nextDepth === BOSS_DEPTH) {
      markCorruptionWarning(S);
    }
    return;
  }
  if (S.sim.level.down === null) {
    note(S, MSG.cantGoDown);
    return;
  }
  if (!isExplored(S, S.sim.level.down.x, S.sim.level.down.y)) {
    note(S, MSG.noDownStairs);
    return;
  }
  travelTo(S, fov, S.sim.level.down, LABEL.downStairs);
}

/** Go back up to the previous level, as you left it. */
export function ascend(S: GameState, fov: Fov): void {
  if (
    S.sim.level.up !== null &&
    S.sim.player.x === S.sim.level.up.x &&
    S.sim.player.y === S.sim.level.up.y
  ) {
    if (S.sim.level.depth === 1) {
      // Level 1's up stairs are the surface hatch: sealed until the
      // GIL-less dev preview falls, then the run's clean exit.
      if (!S.sim.gilGone) {
        note(S, EXIT_SEALED);
      } else {
        S.sim.won = true;
        S.sim.events.push({ type: "win" });
      }
      return;
    }
    const prev = getLevel(S, S.sim.level.depth - 1);
    arriveAt(S, prev, prev.down ?? S.sim.player);
    computeVision(S, fov);
    note(S, MSG.ascend(S.sim.level.depth));
    return;
  }
  if (S.sim.level.up === null) {
    note(S, MSG.cantGoUp);
    return;
  }
  if (!isExplored(S, S.sim.level.up.x, S.sim.level.up.y)) {
    note(S, MSG.noUpStairs);
    return;
  }
  travelTo(S, fov, S.sim.level.up, LABEL.upStairs);
}

/**
 * Ride the shaft between the surface (level 1) and the bottom. The state
 * arrives on the destination floor and the presenter plays one reversed
 * frame per intermediate floor, at the same cell.
 */
export function rideElevator(S: GameState, fov: Fov): Animation {
  const from = S.sim.level.depth;
  const to = from === 1 ? BOSS_DEPTH : 1;
  const step = to > from ? 1 : -1;
  for (let d = from + step; d !== to + step; d += step) {
    // Generate each floor in travel order so the presenter can replay them
    // from cache; generation order also keeps the RNG deterministic.
    getLevel(S, d);
  }
  arriveAt(S, getLevel(S, to), ELEVATOR_POS);
  computeVision(S, fov);
  note(S, to === 1 ? MSG.elevatorSurface : MSG.elevatorDepth(to));
  markCorruptionWarning(S);
  return { kind: "elevator", from, to };
}
