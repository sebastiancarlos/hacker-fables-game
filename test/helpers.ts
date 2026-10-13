/**
 * Shared headless-test driver: goal-directed play plus failure dumps.
 * Imported by the sync suite and by throwaway probes (never by the game).
 */
import { WIDTH, HEIGHT, type Game } from "../src/index.ts";
import { type VirtualScreen } from "./screen.ts";
import { type Key } from "../src/key.ts";
import { decodeInput } from "../src/terminal-input.ts";
import { cloneGrid, createGrid, gridHas, type Grid } from "../src/grid.ts";
import { chebyshev, findPath, type Vec } from "../src/geometry.ts";
import {
  enemyCells,
  type Enemy,
  type GroundItem,
  type Level,
} from "../src/world.ts";
import type { Item } from "../src/items.ts";
import type { Recording, RecordingEntry } from "../src/recording.ts";
import type { Standing } from "../src/score.ts";
import { plain, type RichText } from "../src/style.ts";
import {
  activeMode,
  createState,
  MAX_HP,
  type BaseMode,
  type CommandEntry,
  type FireAction,
  type GameState,
  type MenuRow,
  type MenuStage,
  type MetaState,
  type Modal,
  type Mode,
  type RunRecord,
  type SimEvent,
  type SimState,
  type UiState,
} from "../src/game-state.ts";

/** A plain view of the game for assertions. */
export interface GameSnapshot {
  player: Vec;
  hp: number;
  maxHp: number;
  dead: boolean;
  won: boolean;
  /** The bottom's boss has fallen: the elevator and surface hatch are live. */
  gilGone: boolean;
  turns: number;
  depth: number;
  /** The rendered message line, composed from the last key's events. */
  message: string;
  /** The presentation-derived archive, newest last. */
  log: string[];
  mode: string;
  /** Every enemy, any family. */
  enemies: EnemyInfo[];
  /** Replay omniscience: the whole level is revealed. */
  omniscient: boolean;
  stairsUp: Vec | null;
  stairsDown: Vec | null;
  /** The current level's service elevator shaft, or null where none exists. */
  elevator: Vec | null;
  /** A copy of the current level's wall grid. */
  walls: Grid;
  items: { name: string; x: number; y: number }[];
  loaded: boolean;
  shells: number;
  xp: number;
  plevel: number;
  visualUnlocked: boolean;
  /** The last key's events, oldest first; the next key clears the queue. */
  events: SimEvent[];
  insertMode: boolean;
  wielded: string | null;
  inventory: string[];
  /** Gameplay command labels recorded so far, oldest first. */
  commands: string[];
  /** The enemy that landed the killing blow, or null while alive. */
  killedBy: string | null;
  /** Frozen end-of-run record, or null while the run is live. */
  record: RunRecord | null;
  /** Normalized keys recorded so far, oldest first. */
  inputLog: Key[];
}

/** One enemy, including every occupied cell. */
export interface EnemyInfo {
  kind: string;
  version: string;
  hp: number;
  maxHp: number;
  x: number;
  y: number;
  cells: Vec[];
}

/** Anything with live game state that a snapshot can project. */
export interface GameStateHolder {
  readonly state: GameState;
}

/** Project the live game state into the plain shape tests assert on. */
export function snapshot(game: GameStateHolder): GameSnapshot {
  const S = game.state;
  return {
    player: { ...S.sim.player },
    hp: S.sim.hp,
    maxHp: MAX_HP,
    dead: S.sim.dead,
    won: S.sim.won,
    gilGone: S.sim.gilGone,
    turns: S.sim.turns,
    depth: S.sim.level.depth,
    message: plain(S.ui.message),
    log: S.ui.log.map(plain),
    mode: activeMode(S.ui),
    enemies: S.sim.level.enemies.map((e) => ({
      kind: e.kind,
      version: e.version.label,
      hp: e.hp,
      maxHp: e.maxHp,
      x: e.x,
      y: e.y,
      cells: enemyCells(e).map((c) => ({ x: c.x, y: c.y })),
    })),
    stairsUp:
      S.sim.level.up === null
        ? null
        : { x: S.sim.level.up.x, y: S.sim.level.up.y },
    stairsDown:
      S.sim.level.down === null
        ? null
        : { x: S.sim.level.down.x, y: S.sim.level.down.y },
    elevator:
      S.sim.level.elevator === null
        ? null
        : { x: S.sim.level.elevator.x, y: S.sim.level.elevator.y },
    omniscient: S.ui.omniscient,
    walls: cloneGrid(S.sim.level.walls),
    items: S.sim.level.ground.map((g) => ({
      name: g.item.name,
      x: g.x,
      y: g.y,
    })),
    loaded: S.sim.loaded,
    shells: S.sim.shells,
    xp: S.sim.xp,
    plevel: S.sim.plevel,
    visualUnlocked: S.sim.visualUnlocked,
    events: [...S.sim.events],
    insertMode: S.sim.insertMode,
    wielded: S.sim.wielded === null ? null : S.sim.wielded.name,
    inventory: S.sim.inventory.map((item) => item.name),
    commands: S.meta.commands.map((entry) => entry.label),
    killedBy: S.sim.killedBy,
    record: S.meta.runRecord === null ? null : { ...S.meta.runRecord },
    inputLog: [...S.meta.inputLog],
  };
}

/** Code-snakes in a snapshot. */
export function snakesOf(snap: GameSnapshot): EnemyInfo[] {
  return snap.enemies.filter((e) => e.kind === "snake");
}

/** Head cells of code-snakes in a snapshot. */
export function snakeCellsOf(snap: GameSnapshot): Vec[] {
  return snakesOf(snap).map((e) => ({ x: e.x, y: e.y }));
}

/**
 * The test-facing game: `onKey` takes raw key strings, the way the terminal
 * would deliver them, and decodes them through the same adapter the real
 * platform uses. Tests read as if a player were typing.
 */
export interface TestGame extends GameStateHolder {
  onKey: (input: string | Key | Key[]) => void;
  boot: () => void;
  idle: () => Promise<void>;
}

/** Decode a raw key string the way the terminal adapter would. */
export function keys(input: string): Key[] {
  return decodeInput(input);
}

/** Wrap a headless game so tests can feed raw key strings. */
export function withKeys(game: Game): TestGame {
  return {
    get state() {
      return game.state;
    },
    boot: () => game.boot(),
    idle: () => game.idle(),
    onKey: (input) => {
      game.onKey(
        typeof input === "string"
          ? decodeInput(input)
          : Array.isArray(input)
            ? input
            : [input],
      );
    },
  };
}

/**
 * A hand-built blank level: no walls, no bodies, no stairs. Built without
 * RNG, so seeding a fixture never shifts the streams a seeded test relies
 * on the way a real level build would.
 */
export function blankLevel(over: Partial<Level> = {}): Level {
  return {
    depth: 1,
    start: { x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2) },
    walls: createGrid(),
    enemies: [],
    ground: [],
    explored: createGrid(),
    up: null,
    down: null,
    elevator: null,
    cleared: true,
    ...over,
  };
}

/**
 * A flat patch for tests: one level of convenience over the split state.
 * Level shorthands (walls, enemies, depth, ...) are routed onto
 * `sim.level`, so a test can never set walls that disagree with its level.
 * Modal shorthands (pager*, inv*) build the modal named by `mode`.
 */
export interface StatePatch {
  // A whole sub-state, so `{ ...otherState, field: value }` keeps working.
  sim?: Partial<SimState>;
  ui?: Partial<UiState>;
  meta?: Partial<MetaState>;
  // Simulation.
  hp?: number;
  dead?: boolean;
  won?: boolean;
  gilGone?: boolean;
  turns?: number;
  loaded?: boolean;
  shells?: number;
  insertMode?: boolean;
  xp?: number;
  plevel?: number;
  visualUnlocked?: boolean;
  pendingUnlock?: boolean;
  pendingCorruption?: boolean;
  events?: SimEvent[];
  killedBy?: string | null;
  player?: Vec;
  inventory?: Item[];
  wielded?: Item | null;
  visible?: Grid;
  message?: RichText;
  levels?: Map<number, Level>;
  // Level shorthands, merged onto sim.level.
  level?: Level;
  depth?: number;
  start?: Vec;
  walls?: Grid;
  enemies?: Enemy[];
  ground?: GroundItem[];
  explored?: Grid;
  up?: Vec | null;
  down?: Vec | null;
  elevator?: Vec | null;
  cleared?: boolean;
  // UI.
  mode?: Mode;
  cursor?: Vec;
  pendingKeys?: string;
  count?: string;
  lastFire?: FireAction | null;
  omniscient?: boolean;
  commandMark?: number;
  lookFree?: boolean;
  visualAnchor?: Vec;
  visualRect?: Vec[];
  lastVisual?: { anchor: Vec; cursor: Vec } | null;
  invStage?: MenuStage;
  invRows?: MenuRow[];
  invCursor?: number;
  pagerTitle?: string;
  pagerLines?: string[];
  pagerTop?: number;
  pagerQuery?: string | null;
  pagerTyping?: boolean;
  pagerMatch?: number;
  pagerNoMatch?: boolean;
  recEntries?: RecordingEntry[];
  recCursor?: number;
  // Metadata.
  arena?: boolean;
  baseSeed?: number;
  startDepth?: number;
  commands?: CommandEntry[];
  inputLog?: Key[];
  runRecord?: RunRecord | null;
  recording?: Recording | null;
  standing?: Standing | null;
  scoreLines?: string[];
}

/** Build the modal a `mode: "menu" | "pager" | "confirm"` patch names. */
function modalFor(over: StatePatch): Modal {
  if (over.mode === "pager") {
    return {
      kind: "pager",
      title: over.pagerTitle ?? "",
      lines: over.pagerLines ?? [],
      top: over.pagerTop ?? 0,
      query: over.pagerQuery ?? null,
      typing: over.pagerTyping ?? false,
      match: over.pagerMatch ?? -1,
      noMatch: over.pagerNoMatch ?? false,
    };
  }
  if (over.mode === "confirm") {
    return {
      kind: "confirm",
      action: "unlock",
      rows: over.invRows ?? [{ text: "Continue? (y)", key: null }],
      cursor: over.invCursor ?? 0,
    };
  }
  return {
    kind: "menu",
    stage: over.invStage ?? "list",
    rows: over.invRows ?? [],
    cursor: over.invCursor ?? 0,
  };
}

/**
 * A fully defaulted state for tests that only care about a few fields.
 * Overrides are typed against StatePatch, so a field added to the state is
 * a compile error here instead of being silently absent from a bare cast.
 */
export function makeState(over: StatePatch = {}): GameState {
  const S = createState({
    arena: false,
    baseSeed: 1,
    startDepth: 1,
    visualUnlocked: false,
    firstLevel: blankLevel(),
  });
  if (over.sim !== undefined) {
    Object.assign(S.sim, over.sim);
  }
  if (over.ui !== undefined) {
    Object.assign(S.ui, over.ui);
  }
  if (over.meta !== undefined) {
    Object.assign(S.meta, over.meta);
  }
  // Level shorthands all land on the one level object, never beside it.
  const levelPatch: Partial<Level> = {};
  if (over.depth !== undefined) levelPatch.depth = over.depth;
  if (over.start !== undefined) levelPatch.start = over.start;
  if (over.walls !== undefined) levelPatch.walls = over.walls;
  if (over.enemies !== undefined) levelPatch.enemies = over.enemies;
  if (over.ground !== undefined) levelPatch.ground = over.ground;
  if (over.explored !== undefined) levelPatch.explored = over.explored;
  if (over.up !== undefined) levelPatch.up = over.up;
  if (over.down !== undefined) levelPatch.down = over.down;
  if (over.elevator !== undefined) levelPatch.elevator = over.elevator;
  if (over.cleared !== undefined) levelPatch.cleared = over.cleared;
  S.sim.level = { ...(over.level ?? S.sim.level), ...levelPatch };
  S.sim.levels.set(S.sim.level.depth, S.sim.level);
  // Simulation.
  if (over.hp !== undefined) S.sim.hp = over.hp;
  if (over.dead !== undefined) S.sim.dead = over.dead;
  if (over.won !== undefined) S.sim.won = over.won;
  if (over.gilGone !== undefined) S.sim.gilGone = over.gilGone;
  if (over.turns !== undefined) S.sim.turns = over.turns;
  if (over.loaded !== undefined) S.sim.loaded = over.loaded;
  if (over.shells !== undefined) S.sim.shells = over.shells;
  if (over.insertMode !== undefined) S.sim.insertMode = over.insertMode;
  if (over.xp !== undefined) S.sim.xp = over.xp;
  if (over.plevel !== undefined) S.sim.plevel = over.plevel;
  if (over.visualUnlocked !== undefined)
    S.sim.visualUnlocked = over.visualUnlocked;
  if (over.pendingUnlock !== undefined)
    S.sim.pendingUnlock = over.pendingUnlock;
  if (over.pendingCorruption !== undefined)
    S.sim.pendingCorruption = over.pendingCorruption;
  if (over.events !== undefined) S.sim.events = over.events;
  if (over.killedBy !== undefined) S.sim.killedBy = over.killedBy;
  if (over.player !== undefined) S.sim.player = over.player;
  if (over.inventory !== undefined) S.sim.inventory = over.inventory;
  if (over.wielded !== undefined) S.sim.wielded = over.wielded;
  if (over.visible !== undefined) S.sim.visible = over.visible;
  if (over.message !== undefined) S.ui.message = over.message;
  if (over.levels !== undefined) S.sim.levels = over.levels;
  // UI.
  const modalMode =
    over.mode === "menu" || over.mode === "pager" || over.mode === "confirm";
  S.ui.mode = modalMode ? "play" : ((over.mode ?? "play") as BaseMode);
  if (modalMode) {
    S.ui.modals.push(modalFor(over));
  }
  if (over.cursor !== undefined) S.ui.cursor = over.cursor;
  if (over.pendingKeys !== undefined) S.ui.pendingKeys = over.pendingKeys;
  if (over.count !== undefined) S.ui.count = over.count;
  if (over.lastFire !== undefined) S.ui.lastFire = over.lastFire;
  if (over.omniscient !== undefined) S.ui.omniscient = over.omniscient;
  if (over.commandMark !== undefined) S.ui.commandMark = over.commandMark;
  if (over.lookFree !== undefined) S.ui.look.free = over.lookFree;
  if (over.visualAnchor !== undefined) S.ui.visual.anchor = over.visualAnchor;
  if (over.visualRect !== undefined) S.ui.visual.rect = over.visualRect;
  if (over.lastVisual !== undefined) S.ui.visual.last = over.lastVisual;
  if (over.recEntries !== undefined) S.ui.recordings.entries = over.recEntries;
  if (over.recCursor !== undefined) S.ui.recordings.cursor = over.recCursor;
  // Metadata.
  if (over.arena !== undefined) S.meta.arena = over.arena;
  if (over.baseSeed !== undefined) S.meta.baseSeed = over.baseSeed;
  if (over.startDepth !== undefined) S.meta.startDepth = over.startDepth;
  if (over.commands !== undefined) S.meta.commands = over.commands;
  if (over.inputLog !== undefined) S.meta.inputLog = over.inputLog;
  if (over.runRecord !== undefined) S.meta.runRecord = over.runRecord;
  if (over.recording !== undefined) S.meta.recording = over.recording;
  if (over.standing !== undefined) S.meta.standing = over.standing;
  if (over.scoreLines !== undefined) S.meta.scoreLines = over.scoreLines;
  return S;
}

/**
 * Test-only hunter: single BFS steps toward the nearest snake (or the
 * down stairs when the level is clear), recomputed live every turn.
 */
export function hunterStep(snap: GameSnapshot): string {
  const walls = snap.walls;
  const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;
  const at = (k: string): { x: number; y: number } => {
    const [x, y] = k.split(",").map(Number);
    return { x: x!, y: y! };
  };
  const walk = (to: { x: number; y: number }): string | null => {
    if (snap.player.x === to.x && snap.player.y === to.y) {
      return null;
    }
    const prev = new Map<string, string>();
    const seen = new Set<string>([key(snap.player)]);
    const queue: string[] = [key(snap.player)];
    const target = key(to);
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      if (cur === target) {
        break;
      }
      const c = at(cur);
      const nexts = [
        { x: c.x - 1, y: c.y },
        { x: c.x + 1, y: c.y },
        { x: c.x, y: c.y - 1 },
        { x: c.x, y: c.y + 1 },
      ];
      for (const next of nexts) {
        const k = key(next);
        if (
          next.x < 0 ||
          next.y < 0 ||
          next.x >= WIDTH ||
          next.y >= HEIGHT ||
          gridHas(walls, next.x, next.y) ||
          seen.has(k)
        ) {
          continue;
        }
        seen.add(k);
        prev.set(k, cur);
        queue.push(k);
      }
    }
    if (!prev.has(target)) {
      return null;
    }
    let cur: string | undefined = target;
    let first = target;
    while (cur !== undefined && cur !== key(snap.player)) {
      first = cur;
      cur = prev.get(cur);
    }
    const f = at(first);
    const dx = f.x - snap.player.x;
    const dy = f.y - snap.player.y;
    if (dx === -1) {
      return "h";
    }
    if (dx === 1) {
      return "l";
    }
    return dy === -1 ? "k" : "j";
  };
  const snakeCells = snakeCellsOf(snap);
  if (snakeCells.length === 0) {
    const down = snap.stairsDown;
    if (down === null) {
      return "w";
    }
    if (snap.player.x === down.x && snap.player.y === down.y) {
      return ">";
    }
    return walk(down) ?? ">";
  }
  let best = snakeCells[0]!;
  for (const c of snakeCells) {
    if (chebyshev(c, snap.player) < chebyshev(best, snap.player)) {
      best = c;
    }
  }
  if (chebyshev(best, snap.player) === 1) {
    const dx = Math.sign(best.x - snap.player.x);
    const dy = Math.sign(best.y - snap.player.y);
    if (dx === -1) {
      return "h";
    }
    if (dx === 1) {
      return "l";
    }
    return dy === -1 ? "k" : "j";
  }
  return walk(best) ?? "w";
}

/**
 * Test-only stepper: one BFS step toward a goal cell, recomputed live.
 * Returns null when already there, "w" (wait) when unreachable.
 */
export function stepToward(
  snap: GameSnapshot,
  tx: number,
  ty: number,
): string | null {
  if (snap.player.x === tx && snap.player.y === ty) {
    return null;
  }
  const path = findPath(
    snap.player,
    { x: tx, y: ty },
    (x, y) => gridHas(snap.walls, x, y),
    WIDTH,
    HEIGHT,
  );
  if (!path || path.length === 0) {
    return "w";
  }
  const f = path[0]!;
  const dx = f.x - snap.player.x;
  const dy = f.y - snap.player.y;
  if (dx === -1) {
    return "h";
  }
  if (dx === 1) {
    return "l";
  }
  return dy === -1 ? "k" : "j";
}

/**
 * Drive the game until pred holds: feed one key per turn from next(),
 * then throw with the last keys plus the emulated screen, so failures
 * show where the player ended up instead of a bare timeout.
 */
export async function driveUntil(
  game: TestGame,
  screen: VirtualScreen,
  next: (snap: GameSnapshot) => string | null,
  pred: (snap: GameSnapshot) => boolean,
  opts: { max?: number; tail?: number } = {},
): Promise<void> {
  const max = opts.max ?? 1500;
  const tail = opts.tail ?? 12;
  const history: string[] = [];
  for (let i = 0; i < max; i++) {
    const snap = snapshot(game);
    if (snap.dead || pred(snap)) {
      break;
    }
    const key = next(snap);
    if (key === null) {
      break;
    }
    history.push(key);
    game.onKey(key);
    await game.idle();
  }
  const final = snapshot(game);
  if (pred(final)) {
    return;
  }
  throw new Error(
    `driveUntil gave up: pred not met (mode=${final.mode} dead=${final.dead})\n` +
      `last ${Math.min(tail, history.length)} keys: ${JSON.stringify(history.slice(-tail))}\n` +
      screen.frame(),
  );
}
