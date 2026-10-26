/**
 * Enemies: the code-snake, walrus operator, and GIL-less dev preview.
 *
 * One table, `ENEMY_KINDS`, describes each family's shape, movement, look,
 * name, and death.
 *
 * Also holds corruption and the deep-level glitch, both keyed to enemy
 * counts and depth.
 */
import type { Vec } from "./geometry.ts";
import { versionHeatColor } from "./theme.ts";
import { type CellStyle, type Span, spans } from "./style.ts";
import { ENEMY_FLAVOR, MSG, WOUND, type CountNoun } from "./content.ts";
import { BOSS_DEPTH, curve } from "./depth.ts";

/** Enemy families. */
export type EnemyKind = "snake" | "walrus" | "boss";

/**
 * One Python release as an enemy version. The index drives heat, stats,
 * and depth rolls; the labels are display-only, so no caller needs indexOf.
 */
export interface PythonVersion {
  /** Ordinal in the release line. */
  index: number;
  /** Full release label, like "3.16 (dev preview)". */
  label: string;
  /** Short label for names and the target status row. */
  short: string;
  /** Major release, for the Python 2 substitution rule. */
  major: 2 | 3;
}

/** A family and version, enough to name an enemy in an event. */
export interface EnemyRef {
  kind: EnemyKind;
  version: PythonVersion;
}

/** Make a python release, before its ordinal is assigned. */
function release(
  major: 2 | 3,
  minor: number,
  label = `${major}.${minor}`,
  short = label,
): Omit<PythonVersion, "index"> {
  return { label, short, major };
}

/** Enemy levels as Python versions, up to the dev preview. */
export const PYTHON_VERSIONS: readonly PythonVersion[] = [
  release(2, 0),
  release(2, 1),
  release(2, 2),
  release(2, 3),
  release(2, 4),
  release(2, 5),
  release(2, 6),
  release(2, 7),
  release(3, 0),
  release(3, 1),
  release(3, 2),
  release(3, 3),
  release(3, 4),
  release(3, 5),
  release(3, 6),
  release(3, 7),
  release(3, 8),
  release(3, 9),
  release(3, 10),
  release(3, 11),
  release(3, 12),
  release(3, 13),
  release(3, 14),
  release(3, 15),
  release(3, 16, "3.16 (dev preview)", "3.16-dev, no GIL"),
].map((v, index) => ({ ...v, index }));

/** Get a release by either label kind, for constants and tests. */
export function pythonVersion(label: string): PythonVersion {
  const found = PYTHON_VERSIONS.find(
    (v) => v.label === label || v.short === label,
  );
  if (found === undefined) {
    throw new Error(`unknown Python version: ${label}`);
  }
  return found;
}

/** HP and bite damage for one snake version. */
export interface SnakeStats {
  hp: number;
  bite: number;
}

/** Full display name with the version, for every mention. */
export function snakeName(version: PythonVersion): string {
  return `code-snake (Python ${version.short})`;
}

/** Python 2 stays lowercase; 3.x rears up. */
export function snakeGlyph(version: PythonVersion): string {
  return version.major === 2 ? "s" : "S";
}

/**
 * Heat gradation by version: 2.x cool green, 3.x yellow to red, the dev
 * preview alone a true pure red. The ordinal picks the shade; the shades
 * themselves live in theme.
 */
export function snakeColor(version: PythonVersion): CellStyle {
  return versionHeatColor(version.index);
}

/** The walrus operator := first appeared in Python 3.8. */
export const WALRUS_BASE_VERSION = pythonVersion("3.8");

/** First depth the walrus operator appears, halfway down the dive. */
export const WALRUS_MIN_DEPTH = Math.floor(BOSS_DEPTH / 2);

/** The last depth that spawns normal enemies; the boss owns the bottom. */
const LAST_NORMAL_DEPTH = BOSS_DEPTH - 1;

/** Highest Python version index. */
const MAX_VERSION = PYTHON_VERSIONS.length - 1;

/** Difficulty curves, one per ramped stat. */
const DIFFICULTY = {
  snakes: curve([
    [1, 4],
    [2, 6],
    [BOSS_DEPTH, 60],
  ]),
  snakeVersion: curve(
    [
      [1, 3],
      [2, 4],
      [LAST_NORMAL_DEPTH, MAX_VERSION],
    ],
    Math.floor,
  ),
  walrusCap: curve(
    [
      [WALRUS_MIN_DEPTH, 1],
      [BOSS_DEPTH, 6],
    ],
    Math.floor,
  ),
  walrusVersion: curve([
    [WALRUS_MIN_DEPTH, WALRUS_BASE_VERSION.index],
    [LAST_NORMAL_DEPTH, MAX_VERSION],
  ]),
};

/** Snake count for a depth. */
export function snakesForDepth(depth: number): number {
  return DIFFICULTY.snakes(depth);
}

/** Crowded levels keep the entry stairs clear of snakes. */
export const CROWD_COUNT = 15;

/** Keep-out radius around the spawn and crowded entries. */
export const KEEP_OUT = 8;

/**
 * Spawn exclusion anchor: snakes keep their distance from the level-1
 * spawn only. Deeper snakes spawn anywhere (null anchor), including
 * near the stairs the player just came down.
 *
 * Exception: crowded levels keep the entry clear instead.
 */
export function snakeAnchor(
  depth: number,
  start: Vec,
  up: Vec | null,
): Vec | null {
  if (depth === 1) {
    return start;
  }
  if (snakesForDepth(depth) >= CROWD_COUNT && up !== null) {
    return up;
  }
  return null;
}

/** A version for a depth: the ceiling rises with danger. */
export function versionForDepth(depth: number, roll: number): PythonVersion {
  const top = DIFFICULTY.snakeVersion(depth);
  return PYTHON_VERSIONS[Math.min(top, Math.floor(roll * (top + 1)))]!;
}

/** How many walruses a level may spawn. */
export function walrusCapForDepth(depth: number): number {
  return depth < WALRUS_MIN_DEPTH ? 0 : DIFFICULTY.walrusCap(depth);
}

// --- Walrus operator: the two-cell enemy family ---------------------

/** Chance each eligible walrus slot actually spawns a walrus. */
export const WALRUS_CHANCE = 0.25;

/** The walrus keeps this far from the spawn, being rare and nasty. */
export const WALRUS_KEEP_OUT = 10;

/** A two-cell enemy paints its operator across two tiles, ":=". */
export const WALRUS_HEAD_GLYPH = "=";
/** The tail half of the walrus operator's two-cell glyph. */
export const WALRUS_TAIL_GLYPH = ":";

/** Full display name with the version, for every mention. */
export function walrusName(version: PythonVersion): string {
  return `walrus operator (Python ${version.short})`;
}

/**
 * Heat gradation by version, same scale as snakes, for the versions
 * that have it: the operator never predates 3.8.
 */
export function walrusColor(version: PythonVersion): CellStyle {
  return snakeColor(version);
}

/** Version for a depth, floored at 3.8 and maxed before the boss. */
export function walrusVersionForDepth(
  depth: number,
  roll: number,
): PythonVersion {
  const base = WALRUS_BASE_VERSION.index;
  const top = Math.max(base, DIFFICULTY.walrusVersion(depth));
  const idx = Math.min(top, base + Math.floor(roll * (top - base + 1)));
  return PYTHON_VERSIONS[idx]!;
}

// --- The GIL-less dev preview: the final boss -----------------------

/** The version the boss dresses as: the last python, still a preview. */
export const BOSS_VERSION = PYTHON_VERSIONS[PYTHON_VERSIONS.length - 1]!;

/** Actions the boss takes per player action: it moves twice as fast. */
export const BOSS_SPEED = 2;

/** Its HP as a multiple of the same-version snake: five times the shell. */
export const BOSS_HP_MULT = 5;

/**
 * The boss paints as the dev preview reversed: the same true pure red,
 * inverted, so the last snake reads as a solid red block with a dark
 * glyph rather than one more red letter.
 */
export function bossColor(): CellStyle {
  return { ...snakeColor(BOSS_VERSION), reverse: true };
}

/** Four-directional steps, shared by snake wander and off-level drift. */
const DIRS4: Vec[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];

/** Eight-directional steps: the walrus glides diagonally as one glyph. */
const DIRS8: Vec[] = [
  ...DIRS4,
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: 1 },
];

/** What every enemy family shares: how it looks, moves, and dies. */
export interface EnemyKindSpec {
  /** Body cell offsets from the head, head first. */
  shape: Vec[];
  /** Steps the family may take. */
  dirs: Vec[];
  /** Actions the family takes per player action. */
  speed: number;
  /** HP and bite for a version: the family's only stat computation. */
  stats: (version: PythonVersion) => SnakeStats;
  /** One cell's glyph; `head` tells a two-cell body's head from its tail. */
  glyph: (version: PythonVersion, head: boolean) => string;
  /** Style for a version. */
  color: (version: PythonVersion) => CellStyle;
  /** Full display name for a version. */
  name: (version: PythonVersion) => string;
  /** Death line, given the display name. */
  killMsg: (name: string) => string;
  /** Singular and plural nouns for volley reports. */
  countNoun: CountNoun;
  /** True when substitution scripts may target it. */
  scriptable: boolean;
  /** True for the final boss: pins the walls red and ends the run. */
  boss: boolean;
  /** Flavor lines under the HP/bite rows in the details panel. */
  flavor: string[];
}

/**
 * The enemy families, one table: shape, movement, look, name, and death.
 * Every per-family branch in the codebase reads a row here instead.
 */
export const ENEMY_KINDS: Record<EnemyKind, EnemyKindSpec> = {
  snake: {
    shape: [{ x: 0, y: 0 }],
    dirs: DIRS4,
    speed: 1,
    // Higher versions hit harder and take more punishment.
    stats: (version) => {
      const idx = version.index;
      return { hp: Math.max(2, idx - 11), bite: 1 + Math.floor(idx / 9) };
    },
    glyph: (version) => snakeGlyph(version),
    color: (version) => snakeColor(version),
    name: (version) => snakeName(version),
    killMsg: MSG.killEnemy,
    countNoun: { one: "code-snake", many: "code-snakes" },
    scriptable: true,
    boss: false,
    flavor: [...ENEMY_FLAVOR.snake],
  },
  walrus: {
    shape: [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
    ],
    dirs: DIRS8,
    speed: 1,
    // Scaled up from the same-version snake: twice the HP, one more bite.
    stats: (version) => {
      const base = ENEMY_KINDS.snake.stats(version);
      return { hp: base.hp * 2, bite: base.bite + 1 };
    },
    glyph: (_version, head) => (head ? WALRUS_HEAD_GLYPH : WALRUS_TAIL_GLYPH),
    color: (version) => walrusColor(version),
    name: (version) => walrusName(version),
    killMsg: MSG.killEnemy,
    countNoun: { one: "walrus operator", many: "walrus operators" },
    scriptable: false,
    boss: false,
    flavor: [...ENEMY_FLAVOR.walrus],
  },
  boss: {
    shape: [{ x: 0, y: 0 }],
    dirs: DIRS4,
    speed: BOSS_SPEED,
    // A scaled-up dev-preview snake.
    stats: () => {
      const base = ENEMY_KINDS.snake.stats(BOSS_VERSION);
      return { hp: base.hp * BOSS_HP_MULT, bite: base.bite };
    },
    glyph: (version) => snakeGlyph(version),
    color: () => bossColor(),
    name: (version) => snakeName(version),
    killMsg: MSG.killBoss,
    countNoun: { one: "GIL-less dev preview", many: "GIL-less dev previews" },
    scriptable: false,
    boss: true,
    flavor: [...ENEMY_FLAVOR.boss],
  },
};

/** The spec for a loose kind name, defaulting to the plain snake. */
export function enemyKindSpec(kind: string | undefined): EnemyKindSpec {
  return ENEMY_KINDS[(kind ?? "snake") as EnemyKind] ?? ENEMY_KINDS.snake;
}

/** Actions a family takes per player action; only the boss gets two. */
export function enemySpeed(kind: EnemyKind): number {
  return ENEMY_KINDS[kind].speed;
}

/** Display name for any enemy family. */
export function enemyName(kind: EnemyKind, version: PythonVersion): string {
  return ENEMY_KINDS[kind].name(version);
}

/** Wound words, Angband-style bands. Empty when unhurt. */
export function woundWord(hpNow: number, hpMax: number): string {
  const pct = (100 * hpNow) / hpMax;
  if (pct >= 100) {
    return "";
  }
  if (pct >= 60) {
    return WOUND.somewhat;
  }
  if (pct >= 25) {
    return WOUND.wounded;
  }
  if (pct >= 10) {
    return WOUND.badly;
  }
  return WOUND.almostDead;
}

/** Enemy HP in the player's reversed language: leading HP% of the name. */
export function healthLabel(
  name: string,
  hpNow: number,
  hpMax: number,
): Span[] {
  const n =
    hpNow >= hpMax
      ? name.length
      : Math.max(0, Math.round((name.length * hpNow) / hpMax));
  return spans(
    "[",
    { text: name.slice(0, n), reverse: true },
    `${name.slice(n)}]`,
  );
}

/**
 * Enemy counts at or below which each corruption tier applies, ascending.
 * The scale is absolute, not a share of the floor's population, so a shade
 * of wall red always means the same headcount at any depth. One enemy is its
 * own dimmest band; past the last entry the walls are at full red. Tier 0 is
 * an empty floor, Bell Labs blue.
 */
export const CORRUPTION_SCALE: readonly number[] = [0, 1, 5, 10, 20, 35, 50];

/**
 * Corruption tier for a live headcount: 0 is clean, otherwise the index of
 * the count's band on `CORRUPTION_SCALE`, topping out at full red for
 * anything past the scale. A live boss pins its floor to the top. Pure, so
 * the tint is testable without a screen.
 */
export function corruptionTier(enemiesLeft: number, bossAlive = false): number {
  if (bossAlive) {
    return CORRUPTION_SCALE.length;
  }
  for (let tier = 0; tier < CORRUPTION_SCALE.length; tier++) {
    if (enemiesLeft <= CORRUPTION_SCALE[tier]!) {
      return tier;
    }
  }
  return CORRUPTION_SCALE.length;
}

/** Depth where the glitch begins: only the GIL's own floor. */
export const GLITCH_MIN_DEPTH = BOSS_DEPTH;
/** Fraction of visible wall cells that flicker per turn at the bottom. */
export const GLITCH_PEAK = 0.1;
/**
 * The ASCII noise the bottom's walls flicker through.
 */
export const GLITCH_GLYPHS: readonly string[] = [..."%&*+~^;:/\\|[]{("];

/**
 * How thick the glitch runs on a floor: zero everywhere except the bottom,
 * where `GLITCH_PEAK` of visible wall cells flicker. Keyed to depth, not
 * headcount, so only the GIL's own level frays; the glitch is only ever drawn
 * while the floor stays corrupt, so a swept room heals.
 */
export function glitchChance(depth: number): number {
  if (!Number.isFinite(depth) || depth < GLITCH_MIN_DEPTH) {
    return 0;
  }
  return GLITCH_PEAK;
}

/**
 * A deterministic 32-bit hash of a cell and a turn. Rendering must not touch
 * the run's RNG, because a render-time draw would desync a replay, so the
 * flicker is hashed instead of rolled: a given cell and turn always paint the
 * same glyph, which is what keeps replays byte-identical.
 */
function cellHash(x: number, y: number, turn: number): number {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(y + 0x165667b1, 0xc2b2ae35);
  h ^= Math.imul(turn + 1, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * The noise glyph a wall cell flickers to this turn, or null to stay a wall.
 * The low byte of the hash gates the flicker against `glitchChance`; the
 * higher bits pick the glyph, so the gate and the choice do not move together.
 */
export function glitchGlyph(
  x: number,
  y: number,
  turn: number,
  depth: number,
): string | null {
  const chance = glitchChance(depth);
  if (chance <= 0) {
    return null;
  }
  const h = cellHash(x, y, turn);
  if ((h & 0xff) >= chance * 256) {
    return null;
  }
  return GLITCH_GLYPHS[(h >>> 8) % GLITCH_GLYPHS.length]!;
}
