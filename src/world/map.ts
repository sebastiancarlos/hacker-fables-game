/**
 * World: level layout, population, memory, and stairs.
 */
import * as ROT from "rot-js";
import { createRng, SEED_MODULUS, type Rng } from "./rng.ts";
import {
  BOSS_VERSION,
  CROWD_COUNT,
  ENEMY_KINDS,
  KEEP_OUT,
  pythonVersion,
  snakeAnchor,
  snakesForDepth,
  versionForDepth,
  WALRUS_CHANCE,
  WALRUS_KEEP_OUT,
  walrusCapForDepth,
  walrusVersionForDepth,
  type EnemyKind,
  type PythonVersion,
} from "../combat/enemies.ts";
import { BOSS_DEPTH, steps } from "./depth.ts";
import { chebyshev, nearestFreeCell, type Vec } from "./geometry.ts";
import {
  scriptSpec,
  shotgunSpec,
  type Item,
  type ScriptEffect,
} from "../player/items.ts";
import { HEIGHT, WIDTH } from "../ui/theme.ts";
import { createGrid, gridAdd, gridDelete, gridHas, type Grid } from "./grid.ts";

/** First depth where a level can drop a script. */
export const SCRIPT_DROP_DEPTH = Math.ceil(BOSS_DEPTH * 0.4);

/** First depth where a level carries a second shotgun. */
export const SECOND_GUN_DEPTH = Math.ceil(BOSS_DEPTH * 0.6);

/** First depth where a level carries an extra shotgun and script. */
export const EXTRA_LOOT_DEPTH = 11;

/** Shotguns placed on a level, by depth. Later guns are ammo pickups. */
const GUNS = steps([
  [1, 1],
  [SECOND_GUN_DEPTH, 2],
  [EXTRA_LOOT_DEPTH, 3],
]);

/** How many shotguns a level carries. */
export function gunsForDepth(depth: number): number {
  return GUNS(depth);
}

/** Scripts dropped on a level, by depth. */
const SCROLLS = steps([
  [1, 0],
  [SCRIPT_DROP_DEPTH, 1],
  [EXTRA_LOOT_DEPTH, 2],
]);

/** How many scripts a level drops. */
export function scrollsForDepth(depth: number): number {
  return SCROLLS(depth);
}

/** An item or shell pile lying on the floor. */
export interface GroundItem {
  item: Item;
  x: number;
  y: number;
}

/**
 * One enemy. `x, y` is the head and the kind fixes the rest of the
 * body. A code-snake is a single tile; the walrus operator is a rigid
 * two-cell glyph that always reads ":=".
 */
export interface Enemy {
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  bite: number;
  version: PythonVersion;
}

/**
 * Build one live enemy from its kind's table row, at a cell.
 */
export function spawnEnemy(
  kind: EnemyKind,
  version: PythonVersion,
  pos: Vec,
): Enemy {
  const stats = ENEMY_KINDS[kind].stats(version);
  return {
    kind,
    x: pos.x,
    y: pos.y,
    hp: stats.hp,
    maxHp: stats.hp,
    bite: stats.bite,
    version,
  };
}

/** Body cell offsets from the head, head first. */
export function enemyShape(kind: EnemyKind): Vec[] {
  return ENEMY_KINDS[kind].shape;
}

/** Every cell a kind occupies with its head at (x, y), head first. */
export function enemyCellsForKindAt(
  kind: EnemyKind,
  x: number,
  y: number,
): Vec[] {
  return enemyShape(kind).map((o) => ({ x: x + o.x, y: y + o.y }));
}

/** Every cell an enemy occupies, head first. */
export function enemyCells(e: Enemy): Vec[] {
  return enemyCellsForKindAt(e.kind, e.x, e.y);
}

/** The enemy occupying (x, y), head or body, if any. */
export function enemyOn(
  enemies: Enemy[],
  x: number,
  y: number,
): Enemy | undefined {
  return enemies.find((e) => {
    const shape = enemyShape(e.kind);
    return shape.some((o) => e.x + o.x === x && e.y + o.y === y);
  });
}

/** A dungeon level: layout, population, memory, stairs, and elevator. */
export interface Level {
  depth: number;
  start: Vec;
  walls: Grid;
  enemies: Enemy[];
  ground: GroundItem[];
  explored: Grid;
  up: Vec | null;
  down: Vec | null;
  elevator: Vec | null;
  /**
   * True once the floor has been swept of every hostile and the all-clear
   * announced.
   */
  cleared: boolean;
}

/** Generation inputs. */
export interface BuildOpts {
  /** Dungeon mode when false, single-room arena when true. Defaults to false. */
  arena?: boolean;
  baseSeed: number;
  /** Grid width, defaulting to `WIDTH`. */
  width?: number;
  /** Grid height, defaulting to `HEIGHT`. */
  height?: number;
}

/**
 * The last level, hand-authored, same for every seed.
 *
 * Markers include: `@` arrival (also the up stairs), `B` the boss,
 * `s` the guards.
 */
const BOSS_ART: string[] = [
  "################################################################################",
  "#..............................................................................#",
  "#..............................................................................#",
  "#...........##......................##.........................................#",
  "#...........##......................##.................#########################",
  "#......................................................#.......................#",
  "#......................................................#....s.....?............#",
  "#.......................##.............................#......##......##.......#",
  "#.......................##.............................#......##......##.......#",
  "#.............................................##.......#.......................#",
  "#..@....).......................s.............##..........................B....#",
  "#......................................................#.......................#",
  "#.......................##.............................#......##......##.......#",
  "#.......................##.............................#......##......##.......#",
  "#......................................................#.......................#",
  "#......................................................#.......................#",
  "#...........##......................##.................#########################",
  "#...........##..............?.......##.........................................#",
  "#..............................................................................#",
  "#..............................................................................#",
  "################################################################################",
];

const BOSS_GUARDS: PythonVersion[] = [
  pythonVersion("3.12"),
  pythonVersion("3.10"),
];

/** Exported boss art, for testing the level's dimensions. */
export function bossArtRows(): string[] {
  return [...BOSS_ART];
}

/**
 * The service elevator's fixed shaft cell: the same (x, y) on the surface
 * (level 1) and the bottom (level `BOSS_DEPTH`). The floors between show
 * it only during the ride animation. Chosen from the boss art's open hall,
 * just east of the arrival.
 */
export const ELEVATOR_POS: Vec = { x: 5, y: 10 };

/** Build the bottom level: static walls, guards, loot, and the boss. */
function buildBossLevel(depth: number, width: number, height: number): Level {
  const walls = createGrid();
  const ground: GroundItem[] = [];
  const enemies: Enemy[] = [];
  const guardSpots: Vec[] = [];
  let start: Vec = { x: 1, y: 1 };
  let boss: Vec | null = null;
  for (let y = 0; y < height; y++) {
    const row = BOSS_ART[y] ?? "";
    for (let x = 0; x < width; x++) {
      switch (row[x] ?? "#") {
        case "#":
          gridAdd(walls, x, y);
          break;
        case "@":
          start = { x, y };
          break;
        case "B":
          boss = { x, y };
          break;
        case "s":
          guardSpots.push({ x, y });
          break;
        case ")":
          ground.push({ item: shotgunSpec(), x, y });
          break;
        case "?":
          ground.push({ item: scriptSpec("heal"), x, y });
          break;
        default:
          break; // floor
      }
    }
  }
  guardSpots.forEach((pos, i) => {
    const version = BOSS_GUARDS[i % BOSS_GUARDS.length]!;
    enemies.push(spawnEnemy("snake", version, pos));
  });
  enemies.push(spawnEnemy("boss", BOSS_VERSION, boss!));
  return {
    depth,
    start,
    walls,
    enemies,
    ground,
    explored: createGrid(),
    up: start,
    down: null,
    elevator: { ...ELEVATOR_POS },
    cleared: enemies.length === 0,
  };
}

/** Generate the arena's wall grid. */
function arenaWalls(width: number, height: number): Grid {
  const grid = createGrid();
  new ROT.Map.Arena(width, height).create(
    (x: number, y: number, wall: number) => {
      if (wall === 1) {
        gridAdd(grid, x, y);
      }
    },
  );
  return grid;
}

/** Angband-shaped: a few large open rooms joined by corridors. */
function dungeonWalls(rng: Rng, width: number, height: number): Grid {
  for (let attempt = 0; attempt < 20; attempt++) {
    const grid = createGrid();
    const gen = new ROT.Map.Uniform(width, height, {
      roomWidth: [10, 24],
      roomHeight: [6, 12],
      roomDugPercentage: 0.25,
      // High: the default 1000ms makes generation wall-clock dependent,
      // which breaks --seed determinism on loaded machines.
      timeLimit: 10000,
    });
    const done = rng.using(() =>
      gen.create((x: number, y: number, wall: number) => {
        if (wall === 1) {
          gridAdd(grid, x, y);
        }
      }),
    );
    if (done !== null) {
      return grid;
    }
  }
  throw new Error(
    `dungeon generation failed after 20 attempts (${width}x${height})`,
  );
}

/** Mixers for deriving deterministic placement and level seeds. */
const SALT_MULTIPLIER = 31;
const DEPTH_MULTIPLIER = 1013904223;

/** Derive one level's seed from the run seed and depth. */
function levelSeed(baseSeed: number, depth: number): number {
  return (
    (Math.abs(baseSeed) * SALT_MULTIPLIER + depth * DEPTH_MULTIPLIER) %
    SEED_MODULUS
  );
}

/** Roll a version for a salted placement: a pure function of (depth, salt). */
function pickSnakeVersion(depth: number, salt: number): PythonVersion {
  const roll = createRng(Math.floor(Math.abs(salt)) % SEED_MODULUS).uniform();
  return versionForDepth(depth, roll);
}

/**
 * Pick a head cell for an occupied shape inside `width` x `height`. Every
 * cell in `shape` is an offset from the head, so the whole body must fit.
 *
 * A cell is eligible when it is inside the bounds, not a wall, and absent
 * from `banned`. Draw random candidates up to 100 times and accept the first
 * whose head is at Chebyshev distance at least `minDist` from `near`. If
 * none passes, return the last candidate in row-major order, which may be
 * closer. Returns null when no placement fits.
 */
function shapeSpot(
  shape: readonly Vec[],
  rng: Rng,
  walls: Grid,
  banned: Vec[],
  near: Vec | null,
  minDist: number,
  width: number,
  height: number,
): Vec | null {
  const taken = (x: number, y: number): boolean =>
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height ||
    gridHas(walls, x, y) ||
    banned.some((b) => b.x === x && b.y === y);
  const spots: Vec[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (shape.every((o) => !taken(x + o.x, y + o.y))) {
        spots.push({ x, y });
      }
    }
  }
  if (spots.length === 0) {
    return null;
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const pick = spots[rng.int(0, spots.length - 1)]!;
    if (near === null || chebyshev(pick, near) >= minDist) {
      return { ...pick };
    }
  }
  return { ...spots[spots.length - 1]! };
}

/** Pick a single-cell floor spot, throwing when the level has none. */
function randomFloor(
  rng: Rng,
  wallSet: Grid,
  banned: Vec[] = [],
  near: Vec | null = null,
  minDist = 0,
  width: number,
  height: number,
): Vec {
  const spot = shapeSpot(
    [{ x: 0, y: 0 }],
    rng,
    wallSet,
    banned,
    near,
    minDist,
    width,
    height,
  );
  if (spot === null) {
    throw new Error(`no eligible floor cell in ${width}x${height}`);
  }
  return spot;
}

/** Pick a head cell for an enemy kind using every cell of its shape. */
function enemySpot(
  kind: EnemyKind,
  rng: Rng,
  walls: Grid,
  banned: Vec[],
  near: Vec | null,
  minDist: number,
  width: number,
  height: number,
): Vec | null {
  return shapeSpot(
    enemyShape(kind),
    rng,
    walls,
    banned,
    near,
    minDist,
    width,
    height,
  );
}

/** Cells reachable from `start` through non-wall cells, 4-directionally. */
function floodFill(
  walls: Grid,
  start: Vec,
  width: number,
  height: number,
): Grid {
  const seen = createGrid();
  const stack: Vec[] = [{ ...start }];
  while (stack.length > 0) {
    const p = stack.pop() as Vec;
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) {
      continue;
    }
    if (gridHas(walls, p.x, p.y) || gridHas(seen, p.x, p.y)) {
      continue;
    }
    gridAdd(seen, p.x, p.y);
    stack.push(
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    );
  }
  return seen;
}

/**
 * Force one generated cell walkable and reachable from `start`: carve it
 * out of the walls, then, if the generator left it in a pocket, cut the
 * straightest path toward the start's region. Deterministic, so the same
 * (seed, depth) still rebuilds the same level.
 */
function openCell(
  walls: Grid,
  start: Vec,
  cell: Vec,
  width: number,
  height: number,
): void {
  gridDelete(walls, cell.x, cell.y);
  const seen = floodFill(walls, start, width, height);
  let x = cell.x;
  let y = cell.y;
  while (!gridHas(seen, x, y)) {
    gridDelete(walls, x, y);
    if (x !== start.x) {
      x += Math.sign(start.x - x);
    } else if (y !== start.y) {
      y += Math.sign(start.y - y);
    } else {
      break;
    }
  }
}

/** Build a level for a depth, using the arena or dungeon generator. */
export function buildLevel(depth: number, opts: BuildOpts): Level {
  const {
    arena: useArena = false,
    baseSeed,
    width = WIDTH,
    height = HEIGHT,
  } = opts;
  // The bottom is hand-authored, so every seed rebuilds it identically.
  if (depth >= BOSS_DEPTH) {
    return buildBossLevel(depth, width, height);
  }
  if (useArena) {
    const enemies: Enemy[] = [
      spawnEnemy("snake", pythonVersion("3.9"), { x: 56, y: 10 }),
    ];
    return {
      depth,
      start: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
      walls: arenaWalls(width, height),
      enemies,
      ground: [{ item: shotgunSpec(), x: 30, y: 10 }],
      explored: createGrid(),
      up: null,
      down: null,
      elevator: null,
      cleared: enemies.length === 0,
    };
  }

  // Layout is a pure function of (seed, depth): a fresh game
  // rebuilds the same level no matter how many turns passed before
  // descending, and the shared rot-js singleton is never touched.
  const rng = createRng(levelSeed(baseSeed, depth));
  const walls = dungeonWalls(rng, width, height);
  const at = (banned: Vec[] = [], near: Vec | null = null, minDist = 0): Vec =>
    randomFloor(rng, walls, banned, near, minDist, width, height);
  const start = at();
  const gunPos = at([start]);
  const placed: Vec[] = [start, gunPos];
  const enemies: Enemy[] = [];
  let down: Vec;
  let up: Vec | null;
  const snakeSpots: Vec[] = [];
  const snakeCount = snakesForDepth(depth);
  if (snakeCount >= CROWD_COUNT) {
    // Crowded levels fix the stairs first so spawning snakes keep
    // clear of the up stairs the player arrives on.
    down = at(placed, start, 10);
    up = at([...placed, down], down, 10);
    placed.push(down, up);
    for (let i = 0; i < snakeCount; i++) {
      const s = at(placed, snakeAnchor(depth, start, up), KEEP_OUT);
      placed.push(s);
      snakeSpots.push(s);
    }
  } else {
    for (let i = 0; i < snakeCount; i++) {
      const s = at(placed, snakeAnchor(depth, start, null), KEEP_OUT);
      placed.push(s);
      snakeSpots.push(s);
    }
    down = at(placed, start, 10);
    up = depth === 1 ? null : at([...placed, down], down, 10);
  }

  // Versions are a pure function of (depth, salt).
  snakeSpots.forEach((pos, i) => {
    const salt =
      ((pos.x * SALT_MULTIPLIER + pos.y) * SALT_MULTIPLIER + i) *
        SALT_MULTIPLIER +
      depth;
    const version = pickSnakeVersion(depth, salt);
    enemies.push(spawnEnemy("snake", version, pos));
  });

  const loot: GroundItem[] = [
    { item: shotgunSpec(), x: gunPos.x, y: gunPos.y },
  ];

  // Loot draws from its own "loot" stream, so changing loot rolls cannot
  // consume numbers from the layout stream and shift generated geometry.
  const lootRng = rng.fork("loot");

  // spawn scripts
  for (let i = 0; i < scrollsForDepth(depth); i++) {
    const roll = lootRng.uniform();
    const effect: ScriptEffect =
      roll < 1 / 3 ? "v2" : roll < 2 / 3 ? "all" : "heal";
    const spot = randomFloor(lootRng, walls, placed, null, 0, width, height);
    placed.push(spot);
    loot.push({ item: scriptSpec(effect), x: spot.x, y: spot.y });
  }

  // spawn extra guns (later guns are ammo pickups)
  for (let i = 1; i < gunsForDepth(depth); i++) {
    const spot = randomFloor(lootRng, walls, placed, null, 0, width, height);
    placed.push(spot);
    loot.push({ item: shotgunSpec(), x: spot.x, y: spot.y });
  }

  // The walrus operator: rare, two cells, from its introduction depth.
  // Its cap grows with depth.
  const walrusRng = rng.fork("walrus");
  for (let i = 0, cap = walrusCapForDepth(depth); i < cap; i++) {
    if (walrusRng.uniform() >= WALRUS_CHANCE) {
      continue;
    }
    const head = enemySpot(
      "walrus",
      walrusRng,
      walls,
      placed,
      start,
      WALRUS_KEEP_OUT,
      width,
      height,
    );
    if (head === null) {
      break; // No room for another two-cell glyph.
    }
    placed.push(head, { x: head.x - 1, y: head.y });
    const version = walrusVersionForDepth(depth, walrusRng.uniform());
    enemies.push(spawnEnemy("walrus", version, head));
  }

  // The service elevator for level 1. Walkable and wired into the floor plan,
  // evict anything the generator left there.
  let elevator: Vec | null = null;
  if (depth === 1) {
    elevator = { ...ELEVATOR_POS };
    openCell(walls, start, elevator, width, height);
    const taken = (x: number, y: number): boolean =>
      gridHas(walls, x, y) ||
      loot.some((g) => g.x === x && g.y === y) ||
      enemies.some((e) =>
        enemyCellsForKindAt(e.kind, e.x, e.y).some(
          (c) => c.x === x && c.y === y,
        ),
      ) ||
      (start.x === x && start.y === y) ||
      (down.x === x && down.y === y);
    const evict = (who: Vec): void => {
      if (who.x !== elevator!.x || who.y !== elevator!.y) {
        return;
      }
      const spot = nearestFreeCell(
        elevator!,
        (x, y) => taken(x, y),
        width,
        height,
      );
      if (spot !== null) {
        who.x = spot.x;
        who.y = spot.y;
      }
    };
    for (const g of loot) {
      evict(g);
    }
    for (const e of enemies) {
      evict(e);
    }
    evict(down);
    // Level 1's up stairs are the surface hatch where the run begins.
    up = start;
  }

  return {
    depth,
    start,
    walls,
    enemies,
    ground: loot,
    explored: createGrid(),
    up,
    down,
    elevator,
    cleared: enemies.length === 0,
  };
}
