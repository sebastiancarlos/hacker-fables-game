/**
 * Look mode: cursor inspection of seen and remembered terrain.
 *
 * Every function mutates S only. The details menu is a direct call into
 * inventory; the renderer paints the cursor and help line for look mode.
 */
import { chebyshev, lookTargets, type Vec } from "./geometry.ts";
import { MAX_HP, type GameState } from "./game-state.ts";
import {
  isWall,
  itemAt,
  enemyAt,
  enemyCellsIn,
  stairsAt,
  elevatorAt,
  inBounds,
  isExplored,
  isVisible,
  stepCursor,
  wallsGlitching,
  wallTier,
} from "./queries.ts";
import { enemySeesPlayer } from "./monsters.ts";
import { showDetailsFor } from "./inventory.ts";
import { note } from "./events.ts";
import { MSG } from "./content.ts";
import { dispatch, type Binding, type KeyCtx } from "./keymap.ts";

/** Describe what's under the look cursor, Angband-style. */
export function describe(S: GameState): void {
  const c = S.ui.cursor;
  if (!isExplored(S, c.x, c.y)) {
    note(S, MSG.unexplored);
  } else if (c.x === S.sim.player.x && c.y === S.sim.player.y) {
    note(S, MSG.yourself(S.sim.hp, MAX_HP));
  } else {
    const visible = isVisible(S, c.x, c.y);
    const recall = visible ? "see" : "recall";
    const s = enemyAt(S, c.x, c.y);
    if (s !== undefined && visible) {
      S.sim.events.push({
        type: "look-enemy",
        kind: s.kind,
        version: s.version,
        hp: s.hp,
        maxHp: s.maxHp,
        sees: enemySeesPlayer(S, s),
      });
    } else {
      const g = itemAt(S, c.x, c.y);
      if (g !== undefined) {
        note(S, MSG.recallItem(recall, g.item.name));
      } else if (elevatorAt(S, c.x, c.y)) {
        note(S, MSG.recallElevator(recall, S.sim.gilGone));
      } else {
        const st = stairsAt(S, c.x, c.y);
        if (st !== undefined) {
          note(S, MSG.recallStairs(recall, st === "<" ? "up" : "down"));
        } else if (isWall(S, c.x, c.y)) {
          note(
            S,
            visible
              ? MSG.seeWall(wallTier(S), wallsGlitching(S))
              : MSG.recallWall,
          );
        } else {
          note(S, MSG.recallFloor(recall));
        }
      }
    }
  }
}

/**
 * Landmarks worth targeting: both stairs and the service elevator. The
 * elevator counts even while it is out of service, so a curious player can
 * point look at it (or jump between it and the stairs) and read what it is.
 */
function lookMarks(S: GameState): Vec[] {
  const marks: Vec[] = [];
  if (S.sim.level.up !== null) {
    marks.push({ ...S.sim.level.up });
  }
  if (S.sim.level.down !== null) {
    marks.push({ ...S.sim.level.down });
  }
  if (S.sim.level.elevator !== null) {
    marks.push({ ...S.sim.level.elevator });
  }
  return marks;
}

/** Look mode: cursor starts on the nearest thing you can see. */
export function enterLook(S: GameState): void {
  const seen = (p: Vec): boolean => isVisible(S, p.x, p.y);
  const known = (p: Vec): boolean => isExplored(S, p.x, p.y);
  const stairs = lookMarks(S);
  const interesting: Vec[] = lookTargets(
    enemyCellsIn(S),
    S.sim.level.ground.map((g) => ({ x: g.x, y: g.y })),
    stairs,
    seen,
    known,
  );
  interesting.sort(
    (a, b) => chebyshev(a, S.sim.player) - chebyshev(b, S.sim.player),
  );
  S.ui.cursor =
    interesting.length > 0 ? { ...interesting[0]! } : { ...S.sim.player };
  S.ui.look.free = false;
  S.ui.mode = "look";
  describe(S);
}

/** Jump to the nearest thing you can see in a direction. */
export function lookJump(S: GameState, dx: number, dy: number): void {
  const seen = (p: Vec): boolean => isVisible(S, p.x, p.y);
  const known = (p: Vec): boolean => isExplored(S, p.x, p.y);
  const stairs = lookMarks(S).filter(known);
  const under = enemyAt(S, S.ui.cursor.x, S.ui.cursor.y);
  const pts: Vec[] = [
    ...lookTargets(
      enemyCellsIn(S),
      S.sim.level.ground.map((g) => ({ x: g.x, y: g.y })),
      stairs,
      seen,
      known,
    ).filter((p) => enemyAt(S, p.x, p.y) !== under),
    { ...S.sim.player },
  ];
  const ahead = pts.filter(
    (p) =>
      (dx !== 0 ? Math.sign(p.x - S.ui.cursor.x) === dx : true) &&
      (dy !== 0 ? Math.sign(p.y - S.ui.cursor.y) === dy : true) &&
      !(p.x === S.ui.cursor.x && p.y === S.ui.cursor.y),
  );
  if (ahead.length === 0) {
    return;
  }
  ahead.sort((a, b) => chebyshev(a, S.ui.cursor) - chebyshev(b, S.ui.cursor));
  S.ui.cursor = { ...ahead[0]! };
  describe(S);
}

/** Step the look cursor freely, walls included, hopping whole enemies. */
export function lookStep(S: GameState, dx: number, dy: number): void {
  const dest = stepCursor(S, S.ui.cursor, dx, dy, inBounds);
  if (dest === null) {
    return;
  }
  S.ui.cursor = dest;
  describe(S);
}

/** Step the cursor freely, or jump between landmarks, depending on mode. */
function lookMove(S: GameState, dx: number, dy: number): void {
  if (S.ui.look.free) {
    lookStep(S, dx, dy);
  } else {
    lookJump(S, dx, dy);
  }
}

/** Look keys: the four directions, free/jump toggle, details, and leave. */
const LOOK_BINDINGS: Binding<KeyCtx>[] = [
  { keys: ["h", "H"], run: (c) => lookMove(c.S, -1, 0) },
  { keys: ["j", "J"], run: (c) => lookMove(c.S, 0, 1) },
  { keys: ["k", "K"], run: (c) => lookMove(c.S, 0, -1) },
  { keys: ["l", "L"], run: (c) => lookMove(c.S, 1, 0) },
  {
    keys: ["o", "O"],
    run: (c) => {
      c.S.ui.look.free = !c.S.ui.look.free;
      describe(c.S);
    },
  },
  { keys: ["r", "R"], run: (c) => showDetailsFor(c.S, c.S.ui.cursor) },
  {
    keys: ["q", "Q", "<Esc>"],
    run: (c) => {
      c.S.ui.mode = "play";
      c.S.sim.events.push({ type: "clear" });
    },
  },
];

/** Look keys: move the cursor, jump landmarks, or open details. */
export function lookKey(S: GameState, chunk: string): void {
  dispatch(LOOK_BINDINGS, { S }, chunk);
}
