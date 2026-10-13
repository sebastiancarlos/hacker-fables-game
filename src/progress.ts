/**
 * Progress: XP awards and kill bookkeeping.
 *
 * Mutates S.sim.xp, S.sim.plevel, S.sim.hp, S.sim.level.enemies, S.sim.events,
 * and S.sim.gilGone only. Narration is queued as typed events; the presenter
 * decides what to paint, so no screen writes happen here.
 */
import { VISUAL_UNLOCK_LEVEL, XP_PER_KILL, xpNext } from "./progression.ts";
import type { Enemy } from "./world.ts";
import { MAX_HP, type GameState } from "./game-state.ts";
import { ENEMY_KINDS } from "./enemies.ts";
import { note } from "./events.ts";
import { NOTE } from "./content.ts";

/** Award XP for kills: levels heal fully and unlock visual block. */
export function awardXp(S: GameState, kills: number): void {
  if (kills <= 0) {
    return;
  }
  S.sim.xp += kills * XP_PER_KILL;
  while (S.sim.xp >= xpNext(S.sim.plevel)) {
    S.sim.xp -= xpNext(S.sim.plevel);
    S.sim.plevel++;
    const healed = MAX_HP - S.sim.hp;
    S.sim.hp = MAX_HP;
    S.sim.events.push({ type: "level-up", level: S.sim.plevel });
    if (healed > 0) {
      S.sim.events.push({ type: "heal", amount: healed });
    }
    note(S, NOTE.restored);
    if (S.sim.plevel === VISUAL_UNLOCK_LEVEL && !S.sim.visualUnlocked) {
      S.sim.visualUnlocked = true;
      S.sim.events.push({ type: "unlock", ability: "visual" });
      S.sim.pendingUnlock = true;
    }
  }
}

/**
 * Kill one enemy in the only way there is: take the body off the floor,
 * log the kill (the renderer re-shades the level's walls when a body is
 * lost), and award its XP. The boss's fall also powers the service elevator
 * and the surface hatch, so the run can end where it began. Every death
 * path goes through here, so a new one cannot forget part of the bookkeeping.
 */
export function killEnemy(S: GameState, enemy: Enemy): void {
  const at = S.sim.level.enemies.indexOf(enemy);
  if (at < 0) {
    // Already dead: never let splice(-1) eat the last live enemy.
    return;
  }
  S.sim.level.enemies.splice(at, 1);
  S.sim.events.push({ type: "kill", version: enemy.version, xp: XP_PER_KILL });
  // The floor goes quiet as soon as its last body falls, not a step later.
  if (S.sim.level.enemies.length === 0 && !S.sim.level.cleared) {
    S.sim.level.cleared = true;
    S.sim.events.push({ type: "floor-clear" });
  }
  awardXp(S, 1);
  if (ENEMY_KINDS[enemy.kind].boss && !S.sim.gilGone) {
    S.sim.gilGone = true;
    S.sim.events.push({ type: "elevator-on" });
  }
}
