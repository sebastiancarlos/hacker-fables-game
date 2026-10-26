/**
 * Combat: melee bumps plus the Modal Shotgun simulation.
 *
 * Every function mutates `S.sim` only. Aim, visual selection, and mode
 * changes live in `aim.ts`; this module takes plain cells in a `FireCommand`
 * and returns a tracer animation for the presenter to play. Turn passing is
 * a direct call into monsters; no screen and no hooks.
 */
import { bresenham, type Vec } from "../world/geometry.ts";
import type { EnemyRef } from "./enemies.ts";
import {
  chooseShots,
  isWeapon,
  nearestReachableTarget,
  SHOTGUN_DMG,
} from "../player/items.ts";
import type { Enemy } from "../world/map.ts";
import type { Animation, GameState } from "../game/state.ts";
import { isWall, enemyAt, enemyCellsIn } from "../world/queries.ts";
import { killEnemy } from "../player/progress.ts";
import { passTurn } from "./monsters.ts";
import { note, say } from "../game/events.ts";
import { MSG, NOTE } from "../content.ts";

/** Damage one bare-handed bump deals. */
export const MELEE_DMG = 3;

/** Bump attack: stepping into an enemy hits it instead of moving. */
export function attack(S: GameState, enemy: Enemy): void {
  enemy.hp -= MELEE_DMG;
  if (enemy.hp <= 0) {
    // Losing a body changes the floor's corruption: the renderer re-emits
    // every wall next frame, so the room takes the new shade at once.
    say(S, { type: "slain", kind: enemy.kind, version: enemy.version });
    killEnemy(S, enemy);
  } else {
    say(S, {
      type: "meleeHit",
      kind: enemy.kind,
      version: enemy.version,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
    });
  }
}

/** Insert Bullet Mode: equip a gun if needed, chamber, stay in mode. */
export function chamber(S: GameState): void {
  if (S.sim.insertMode && S.sim.loaded) {
    say(S, { type: "insert", state: "already" });
    return;
  }
  if (S.sim.insertMode && S.sim.shells === 0) {
    note(S, NOTE.noShells);
    return;
  }
  if (!isWeapon(S.sim.wielded)) {
    const gun = S.sim.inventory.find(isWeapon);
    if (gun === undefined) {
      note(S, NOTE.nothingToEquip);
      return;
    }
    S.sim.wielded = gun;
    if (S.sim.shells === 0) {
      S.sim.insertMode = true;
      note(S, MSG.equipNoShells(gun.name));
      return;
    }
    S.sim.loaded = true;
    S.sim.shells--;
    S.sim.insertMode = true;
    say(S, { type: "insert", state: "chambered", gun: gun.name });
  } else if (S.sim.loaded) {
    S.sim.insertMode = true;
    say(S, { type: "insert", state: "stance" });
  } else if (S.sim.shells === 0) {
    S.sim.insertMode = true;
    note(S, NOTE.noShells);
    return;
  } else {
    S.sim.loaded = true;
    S.sim.shells--;
    S.sim.insertMode = true;
    say(S, { type: "insert", state: "chambered" });
  }
  passTurn(S);
}

/** First enemy on a ray, stopping at walls. */
export function planShot(S: GameState, line: Vec[]): Enemy | null {
  for (const c of line) {
    if (isWall(S, c.x, c.y)) {
      return null;
    }
    const target = enemyAt(S, c.x, c.y);
    if (target !== undefined) {
      return target;
    }
  }
  return null;
}

/** Resolve hits: damage, events, and one turn pass; return the dead. */
function resolveShots(S: GameState, hits: Set<Enemy>, shortfall = 0): Enemy[] {
  const killed: EnemyRef[] = [];
  const doomed: Enemy[] = [];
  const wounded: EnemyRef[] = [];
  for (const target of hits) {
    target.hp -= SHOTGUN_DMG;
    if (target.hp <= 0) {
      doomed.push(target);
      killed.push({ kind: target.kind, version: target.version });
    } else {
      wounded.push({ kind: target.kind, version: target.version });
    }
  }
  // The shot is one event; the kills that follow add their own facts and
  // any level-up line, all composed by the presenter in order.
  say(S, { type: "shot", killed, wounded, shortfall });
  for (const target of doomed) {
    killEnemy(S, target);
  }
  passTurn(S);
  return doomed;
}

/**
 * One fire command from the input layer. `cells` are the aimed tiles (one
 * for `f`, the whole block for a volley), and `center` is the middle square
 * a dry block still traces through. The input layer owns the cursor and
 * mode; this only applies the shot.
 */
export interface FireCommand {
  cells: Vec[];
  center: Vec;
  visual: boolean;
}

/** Fire the chambered round at a command's cells, spending the reserve. */
export function fireCommand(
  S: GameState,
  command: FireCommand,
): Animation | null {
  const chambered = S.sim.loaded;
  S.sim.loaded = false;
  S.sim.insertMode = false;
  const hits = new Set<Enemy>();
  for (const cell of command.cells) {
    const hit = planShot(
      S,
      bresenham(S.sim.player.x, S.sim.player.y, cell.x, cell.y),
    );
    if (hit !== null) {
      hits.add(hit);
    }
  }
  // One round per covered enemy, nearest first; the chambered round
  // fires free and the rest come out of the reserve.
  const plan = chooseShots([...hits], S.sim.player, S.sim.shells, chambered);
  S.sim.shells = plan.shells;
  const lines: Vec[][] = [];
  if (plan.kept.length === 0 && chambered) {
    // Nothing covered: one shot at the aim point or the middle of the block.
    const target = command.visual ? command.center : command.cells[0];
    if (target !== undefined) {
      lines.push(bresenham(S.sim.player.x, S.sim.player.y, target.x, target.y));
    }
  } else {
    for (const kept of plan.kept) {
      lines.push(bresenham(S.sim.player.x, S.sim.player.y, kept.x, kept.y));
    }
  }
  // Dry with nothing covered: no animation, the echo below is free.
  const doomed = resolveShots(S, new Set(plan.kept), plan.shortfall);
  return lines.length === 0 ? null : { kind: "tracer", lines, ghosts: doomed };
}

/** True when a visible enemy sits on a clear ray from the player. */
export function hasReachableTarget(S: GameState): boolean {
  const target = nearestReachableTarget(
    S.sim.player,
    enemyCellsIn(S),
    S.sim.visible,
    (x, y) => isWall(S, x, y),
  );
  return target !== null;
}

/** True when at least one recorded tile still has an enemy on a clear ray. */
export function anyFireableCell(S: GameState, cells: Vec[]): boolean {
  return cells.some(
    (c) =>
      planShot(S, bresenham(S.sim.player.x, S.sim.player.y, c.x, c.y)) !== null,
  );
}
