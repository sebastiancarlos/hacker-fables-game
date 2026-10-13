/**
 * Items: scripts, the Modal Shotgun, and shot planning.
 *
 * `Item` is a discriminated union and `ITEM_KINDS` gives each family its
 * glyph, look-panel rows, and pickup behavior. Scripts identify themselves
 * by effect, never by display name. Pure functions over item specs and enemy
 * cells. `scriptTargets` consults the enemy table to learn which families
 * substitutions may delete, so the rule lives once in enemies; geometry
 * supplies rays and distances.
 */
import { bresenham, chebyshev, type Vec } from "./geometry.ts";
import { gridHas, type Grid } from "./grid.ts";
import {
  enemyKindSpec,
  enemyName,
  type EnemyRef,
  type PythonVersion,
} from "./enemies.ts";
import type { GameState } from "./game-state.ts";
import {
  MIXED_ENEMY_NOUN,
  MSG,
  SCRIPT_DETAILS,
  SCRIPT_NAMES,
  type CountNoun,
} from "./content.ts";

/** Count noun for a target set: its family when uniform, generic otherwise. */
function shotNoun(targets: EnemyRef[]): CountNoun {
  const first = targets[0]?.kind;
  return first !== undefined && targets.every((target) => target.kind === first)
    ? enemyKindSpec(first).countNoun
    : MIXED_ENEMY_NOUN;
}

/**
 * Shot report: kills pixelated, survivors reeling. Single shots name
 * their target; volleys count the family, or generic enemies when mixed.
 */
export function shotMessage(
  killed: EnemyRef[],
  wounded: EnemyRef[],
  shortfall: number,
): string {
  const total = killed.length + wounded.length;
  let message: string;
  if (total === 0) {
    message = MSG.shotEcho;
  } else if (total === 1 && killed.length === 1) {
    const target = killed[0]!;
    message = MSG.shotKill(enemyName(target.kind, target.version));
  } else if (total === 1) {
    const target = wounded[0]!;
    message = MSG.shotWound(enemyName(target.kind, target.version));
  } else if (wounded.length === 0) {
    message = MSG.shotVolleyKill(total, shotNoun(killed));
  } else if (killed.length === 0) {
    message = MSG.shotVolleyWound(total, shotNoun(wounded));
  } else {
    message = MSG.shotMixed(
      killed.length,
      wounded.length,
      shotNoun([...killed, ...wounded]),
    );
  }
  if (shortfall > 0) {
    message += MSG.shotShortfall(shortfall);
  }
  return message;
}

/** Script effects: v2 deletes visible Python 2, all clears view, heal mends. */
export type ScriptEffect = "v2" | "all" | "heal";

/** Item families: one carried weapon and the executable scripts. */
export type ItemKind = "weapon" | "script";

/** The Modal Shotgun. */
export interface WeaponItem {
  kind: "weapon";
  name: string;
  glyph: ")";
}

/** One executable substitution script. */
export interface ScriptItem {
  kind: "script";
  name: string;
  glyph: "?";
  effect: ScriptEffect;
}

/** Anything the player can carry or find on the floor. */
export type Item = WeaponItem | ScriptItem;

/** Narrow an item to the gun, including a missing item. */
export function isWeapon(item: Item | null | undefined): item is WeaponItem {
  return item?.kind === "weapon";
}

/** Narrow an item to a script, including a missing item. */
export function isScript(item: Item | null | undefined): item is ScriptItem {
  return item?.kind === "script";
}

/** What a pickup does besides removing the item from the floor. */
export interface PickupPlan {
  /** True when the item itself joins the inventory. */
  carried: boolean;
  /** Reserve after the pickup, when the item feeds the shells. */
  shells?: number;
  message: string;
}

/** Shape, look-panel rows, and pickup behavior for one item family. */
export interface ItemKindSpec<T extends Item> {
  glyph: T["glyph"];
  details: (item: T, equipped: boolean) => string[];
  pickup: (item: T, S: GameState) => PickupPlan;
}

/** Damage one shell deals, at any range. */
export const SHOTGUN_DMG = 6;

/** Every item family's behavior in one table, like ENEMY_KINDS. */
export const ITEM_KINDS: {
  weapon: ItemKindSpec<WeaponItem>;
  script: ItemKindSpec<ScriptItem>;
} = {
  weapon: {
    glyph: ")",
    details: (_item, equipped) => [
      MSG.gunDamage(SHOTGUN_DMG),
      MSG.chamberAim,
      equipped ? MSG.equipped : MSG.notEquipped,
      "",
      MSG.gunFlavor,
    ],
    pickup: (_item, S) => {
      const found = shotgunPickup(hasWeapon(S), S.sim.shells);
      return {
        carried: found.takeGun,
        shells: found.shells,
        message: found.message,
      };
    },
  },
  script: {
    glyph: "?",
    details: (item) => [SCRIPT_DETAILS[item.effect], MSG.executeWith],
    pickup: (item) => ({
      carried: true,
      message: MSG.pickupScript(item.name),
    }),
  },
};

/** A script as a ground or inventory item spec. */
export function scriptSpec(effect: ScriptEffect): ScriptItem {
  return {
    name: SCRIPT_NAMES[effect],
    glyph: ITEM_KINDS.script.glyph,
    kind: "script",
    effect,
  };
}

/** The one weapon, as an item spec, so its shape lives in one place. */
export function shotgunSpec(): WeaponItem {
  return {
    name: "Modal Shotgun",
    glyph: ITEM_KINDS.weapon.glyph,
    kind: "weapon",
  };
}

/** True when the player already carries or wields a gun. */
function hasWeapon(S: GameState): boolean {
  return isWeapon(S.sim.wielded) || S.sim.inventory.some(isWeapon);
}

/** The look-panel rows for an item, from its family's table. */
export function itemDetails(item: Item, equipped: boolean): string[] {
  return item.kind === "weapon"
    ? ITEM_KINDS.weapon.details(item, equipped)
    : ITEM_KINDS.script.details(item, equipped);
}

/** Apply an item's pickup behavior, from its family's table. */
export function itemPickup(item: Item, S: GameState): PickupPlan {
  return item.kind === "weapon"
    ? ITEM_KINDS.weapon.pickup(item, S)
    : ITEM_KINDS.script.pickup(item, S);
}

/** Carried scripts of one effect, with their display name. */
export interface ScriptGroup {
  effect: ScriptEffect;
  name: string;
  items: ScriptItem[];
}

/** Carried scripts grouped by effect, first-seen order, guns skipped. */
export function groupScripts(inventory: Item[]): ScriptGroup[] {
  const groups: ScriptGroup[] = [];
  for (const item of inventory) {
    if (!isScript(item)) {
      continue;
    }
    const found = groups.find((g) => g.effect === item.effect);
    if (found === undefined) {
      groups.push({
        effect: item.effect,
        name: SCRIPT_NAMES[item.effect],
        items: [item],
      });
    } else {
      found.items.push(item);
    }
  }
  return groups;
}

/** Minimal snake shape needed to decide script targets. */
export interface ScriptSnake extends Vec {
  version: PythonVersion;
  /** Enemy family; absent means a code-snake (older callers). */
  kind?: string;
}

/** Snakes a script execution removes: visible snakes of its kinds. */
export function scriptTargets<T extends ScriptSnake>(
  snakes: T[],
  visible: Grid,
  effect: ScriptEffect,
): T[] {
  if (effect === "heal") {
    return [];
  }
  // Substitutions match snake glyphs only, never the walrus operator's
  // ":=" nor the GIL-less dev preview, so scripts never touch either.
  const isSnake = (s: ScriptSnake): boolean => enemyKindSpec(s.kind).scriptable;
  if (effect === "all") {
    return snakes.filter((s) => isSnake(s) && gridHas(visible, s.x, s.y));
  }
  return snakes.filter(
    (s) => isSnake(s) && s.version.major === 2 && gridHas(visible, s.x, s.y),
  );
}

/** Execution report: kills counted, misses admitted, wounds mended. */
export function scriptMessage(effect: ScriptEffect, kills: number): string {
  if (effect === "heal") {
    return MSG.scriptHeal;
  }
  return effect === "v2" ? MSG.scriptV2(kills) : MSG.scriptAll(kills);
}

/** Shells bundled with every Modal Shotgun pickup. */
export const SHELLS_PER_GUN = 20;

/** Result of picking up a shotgun: reserve shells and whether it is kept. */
export interface ShellPickup {
  /** Reserve after the pickup. */
  shells: number;
  /** False when the finder already carries one: shells only. */
  takeGun: boolean;
  message: string;
}

/** Shotgun pickup: the first gun arms you, later ones feed the reserve. */
export function shotgunPickup(hasGun: boolean, shells: number): ShellPickup {
  if (hasGun) {
    return {
      shells: shells + SHELLS_PER_GUN,
      takeGun: false,
      message: MSG.pickupShells(SHELLS_PER_GUN),
    };
  }
  return {
    shells: shells + SHELLS_PER_GUN,
    takeGun: true,
    message: MSG.pickupGun(SHELLS_PER_GUN),
  };
}

/** A volley plan: targets kept, shells left, and unfired targets. */
export interface ShotPlan<T> {
  /** Covered enemies, nearest first, capped by shells available. */
  kept: T[];
  /** Reserve after spending one per kept shot past the chambered round. */
  shells: number;
  /** Covered enemies left unfired for lack of shells. */
  shortfall: number;
}

/**
 * Visual ammo plan: shoot as many covered enemies as shells allow,
 * nearest first. The chambered round (loaded) fires free; the rest
 * come out of the reserve.
 */
export function chooseShots<T extends Vec>(
  hits: T[],
  player: Vec,
  shells: number,
  loaded: boolean,
): ShotPlan<T> {
  const ordered = [...hits].sort(
    (a, b) => chebyshev(a, player) - chebyshev(b, player),
  );
  const kept = ordered.slice(0, shells + (loaded ? 1 : 0));
  const fromReserve = Math.max(0, kept.length - (loaded ? 1 : 0));
  return {
    kept,
    shells: shells - fromReserve,
    shortfall: ordered.length - kept.length,
  };
}

/**
 * Nearest enemy cell the bullet can actually reach: visible, with a clear
 * ray, and first on that ray. Shadowcasting sees around corners that
 * a straight bullet cannot follow, so visibility alone overpromises.
 */
export function nearestReachableTarget(
  player: Vec,
  snakes: Vec[],
  visible: Grid,
  isWall: (x: number, y: number) => boolean,
): Vec | null {
  const key = (p: Vec): string => `${p.x},${p.y}`;
  const occupied = new Map<string, Vec>(snakes.map((s) => [key(s), s]));
  const reachable: Vec[] = [];
  for (const s of snakes) {
    if (!gridHas(visible, s.x, s.y)) {
      continue;
    }
    let hit: Vec | null = null;
    for (const c of bresenham(player.x, player.y, s.x, s.y)) {
      if (isWall(c.x, c.y)) {
        hit = null;
        break;
      }
      const other = occupied.get(key(c));
      if (other !== undefined) {
        hit = other;
        break;
      }
    }
    if (hit !== null && hit.x === s.x && hit.y === s.y) {
      reachable.push(s);
    }
  }
  reachable.sort((a, b) => chebyshev(a, player) - chebyshev(b, player));
  return reachable[0] ?? null;
}
