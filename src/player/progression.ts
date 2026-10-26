/**
 * Progression: XP, rank, and the loadout a deep start grants.
 *
 * Pure folds over the level curve. Enemies supplies the per-level snake
 * count a full clear would have killed; items supplies script kinds and
 * the shells bundled with each gun.
 */
import { snakesForDepth } from "../combat/enemies.ts";
import { SHELLS_PER_GUN, type ScriptEffect } from "./items.ts";

/** XP for every snake kill, tuning knob. */
export const XP_PER_KILL = 2;

/** XP debt to rise from `level` to the next. */
export function xpNext(level: number): number {
  return level * 50;
}

/** Loadout and rank banked by skipping levels on a deep start. */
export interface StartKit {
  /** Player rank banked by clearing everything above the depth. */
  plevel: number;
  /** XP left over past that rank. */
  xp: number;
  /** Shells gathered from the skipped levels (one gun's worth each). */
  shells: number;
  /** Scrolls a dive would have banked, heals first. */
  scripts: ScriptEffect[];
}

/** XP a full clear of levels 1..depth-1 would earn, at XP_PER_KILL each. */
export function xpForClearedLevels(depth: number): number {
  let kills = 0;
  for (let d = 1; d < depth; d++) {
    kills += snakesForDepth(d);
  }
  return kills * XP_PER_KILL;
}

/**
 * Fold a lump of XP through the level curve without side effects, so a
 * start kit lands on the same rank a played game would have reached.
 */
export function levelFromXp(xp: number): { plevel: number; xp: number } {
  let plevel = 1;
  let left = xp;
  while (left >= xpNext(plevel)) {
    left -= xpNext(plevel);
    plevel++;
  }
  return { plevel, xp: left };
}

/** Heals lead the cycle so a deep start can mend through its first fight. */
const START_SCRIPT_CYCLE: ScriptEffect[] = ["heal", "all", "heal", "v2"];

/** Scrolls banked by a depth: one per four levels, heals first. */
export function startingScripts(depth: number): ScriptEffect[] {
  const count = Math.max(0, Math.floor(depth / 4));
  const scripts: ScriptEffect[] = [];
  for (let i = 0; i < count; i++) {
    scripts.push(START_SCRIPT_CYCLE[i % START_SCRIPT_CYCLE.length]!);
  }
  return scripts;
}

/** Full loadout for a `--level depth` start: rank, scrolls, and ammo. */
export function startingKit(depth: number): StartKit {
  const { plevel, xp } = levelFromXp(xpForClearedLevels(depth));
  return {
    plevel,
    xp,
    shells: (depth - 1) * SHELLS_PER_GUN,
    scripts: startingScripts(depth),
  };
}
