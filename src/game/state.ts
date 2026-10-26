/**
 * Game state: simulation, presentation, and run metadata.
 *
 * A `Game` instance keeps a single `S: GameState`; logic reads and writes
 * `S.sim`, `S.ui`, and `S.meta` instead of one flat bag. Level-owned data
 * (walls, enemies, ground, explored) lives on `S.sim.level`.
 * Transient screens live in a modal stack on `S.ui`.
 */
import type { Cell, RichText } from "../ui/style.ts";
import { createRng, type Rng } from "../world/rng.ts";
import {
  type EnemyKind,
  type EnemyRef,
  type PythonVersion,
} from "../combat/enemies.ts";
import { BOSS_DEPTH } from "../world/depth.ts";
import type { Item, ScriptEffect } from "../player/items.ts";
import type { Enemy, Level } from "../world/map.ts";
import type { Vec } from "../world/geometry.ts";
import { createGrid, type Grid } from "../world/grid.ts";
import { UI } from "../content.ts";
import type { Recording, RecordingEntry } from "../records/recording.ts";
import type { Key } from "../input/key.ts";
import type { Standing } from "../records/score.ts";

/** The player's hit-point ceiling. */
export const MAX_HP = 16;

/** Modes that own the whole display beneath any modal stack. */
export type BaseMode =
  | "title"
  | "lore"
  | "recordings"
  | "scores"
  | "play"
  | "target"
  | "visual"
  | "look"
  | "over";

/** Every mode the renderer and input handler can see, modals included. */
export type Mode = BaseMode | "menu" | "pager" | "confirm";

/** How a run ended. */
export type Outcome = "dead" | "quit" | "won";

/** Everything a finished run reports, whether shown or written. */
export interface RunRecord {
  outcome: Outcome;
  seed: number;
  depth: number;
  level: number;
  xp: number;
  turns: number;
  commands: number;
  killedBy: string | null;
}

/** Coarse buckets for the end-of-run breakdown by type. */
export type CommandKind = "move" | "fire" | "item" | "travel" | "other";

/** One recorded gameplay command: its tally label and its bucket. */
export interface CommandEntry {
  label: string;
  kind: CommandKind;
}

/** One selectable menu row: label text and an optional hotkey. */
export interface MenuRow {
  text: string;
  key: string | null;
  hi?: boolean | undefined;
}

/** The stages a single menu modal can show. */
export type MenuStage = "list" | "equip" | "help" | "details" | "script";

/** A list modal: inventory, equip, script, help, or look details. */
export interface MenuModal {
  kind: "menu";
  stage: MenuStage;
  rows: MenuRow[];
  cursor: number;
}

/** A scroll/search modal. */
export interface PagerModal {
  kind: "pager";
  title: string;
  lines: string[];
  top: number;
  query: string | null;
  typing: boolean;
  match: number;
  noMatch: boolean;
}

/** What an explicit y in a confirm popup does. */
export type ConfirmAction = "unlock" | "corruption" | "quit";

/** A yes/no popup: visual-block unlock, the corruption warning, and quit. */
export interface ConfirmModal {
  kind: "confirm";
  action: ConfirmAction;
  rows: MenuRow[];
  cursor: number;
}

/** One transient screen layered over whatever is below it. */
export type Modal = MenuModal | PagerModal | ConfirmModal;

/** One pre-shot selection cell, captured for a tracer's opening frame. */
export interface VisualCell {
  x: number;
  y: number;
  cell: Cell;
}

/**
 * A one-shot animation the presenter plays. The presenter plays it
 * against the screen and then draws the final frame.
 */
export type Animation =
  | {
      kind: "tracer";
      lines: Vec[][];
      /** Enemies the shot killed; the presenter erases them at impact. */
      ghosts: Enemy[];
      /**
       * The visual block as it looked before the shot. To be repainted before
       * the rest of the animation.
       */
      selection?: VisualCell[] | undefined;
    }
  | { kind: "elevator"; from: number; to: number };

/** The last shot, kept so `.` can repeat it. */
export interface FireAction {
  /** For a volley, the block tiles to refire at (world coords); empty for a shot. */
  cells: Vec[];
  /** A visual-block volley vs a single aimed shot. */
  visual: boolean;
}

/** How many messages the log keeps before dropping the oldest. */
export const LOG_LIMIT = 1000;

/**
 * One thing that happened during a key. The simulation appends these in
 * order and holds no styled display text; the presenter maps them to the
 * message line (see messages.ts). Some events are pure facts (kills, heals)
 * and render nothing on their own.
 */
export type SimEvent =
  | { type: "kill"; version: PythonVersion; xp: number }
  | {
      type: "bite";
      kind: EnemyKind;
      version: PythonVersion;
      damage: number;
      fatal: boolean;
    }
  | { type: "heal"; amount: number }
  | { type: "level-up"; level: number }
  | { type: "unlock"; ability: string }
  | { type: "slain"; kind: EnemyKind; version: PythonVersion }
  | {
      type: "meleeHit";
      kind: EnemyKind;
      version: PythonVersion;
      hp: number;
      maxHp: number;
    }
  | { type: "shot"; killed: EnemyRef[]; wounded: EnemyRef[]; shortfall: number }
  | { type: "script"; effect: ScriptEffect; kills: number }
  | {
      type: "look-enemy";
      kind: EnemyKind;
      version: PythonVersion;
      hp: number;
      maxHp: number;
      sees: boolean;
    }
  | { type: "insert"; state: "already" | "chambered" | "stance"; gun?: string }
  | { type: "visual-block" }
  | { type: "elevator-on" }
  | { type: "floor-clear" }
  | { type: "win" }
  | { type: "clear" }
  | { type: "note"; text: string };

/** The world and the run's progress through it. */
export interface SimState {
  levels: Map<number, Level>;
  /** The live level; `level.depth` is the current depth. */
  level: Level;
  player: Vec;
  inventory: Item[];
  wielded: Item | null;
  /** Cells the player currently sees. */
  visible: Grid;
  hp: number;
  dead: boolean;
  /** The GIL-less dev preview is dead: the run is won. */
  won: boolean;
  /** The bottom's boss has fallen: the service elevator and surface hatch
   * come online, whether or not the player is still on the bottom. */
  gilGone: boolean;
  turns: number;
  loaded: boolean;
  shells: number;
  insertMode: boolean;
  xp: number;
  plevel: number;
  visualUnlocked: boolean;
  /** Set by a level-up: the presenter opens the unlock popup once. */
  pendingUnlock: boolean;
  /** Set on entering the bottom: the presenter opens the warning once. */
  pendingCorruption: boolean;
  /**
   * Everything that happened this key, in order. The presenter turns it
   * into the message line; the next key clears it, so it never grows.
   */
  events: SimEvent[];
  /** The enemy that landed the killing blow, or null while alive. */
  killedBy: string | null;
  /**
   * The run's ambient randomness, seeded once from `meta.baseSeed`. Enemy
   * wander draws from it; other concerns derive their own forks, so an
   * extra roll can never shift a stream already in use.
   */
  rng: Rng;
}

/** Cursor-mode extras that are not shared with the other modes. */
export interface LookState {
  /** Move through walls instead of jumping between landmarks. */
  free: boolean;
}

/** Visual-block anchor, covered cells, and the last block for `gv`. */
export interface VisualState {
  anchor: Vec;
  rect: Vec[];
  /** The last block, so `gv` can restore it. */
  last: { anchor: Vec; cursor: Vec } | null;
}

/** Title-browser and replay-picker state. */
export interface RecordingsState {
  entries: RecordingEntry[];
  cursor: number;
}

/** Everything the screen and input layer own. */
export interface UiState {
  /** The rendered message line; the presenter builds it from `sim.events`. */
  message: RichText;
  /** The screen under the modal stack. */
  mode: BaseMode;
  /** Transient screens, bottom to top. Empty means `mode` owns the frame. */
  modals: Modal[];
  /** Presentation-derived history of every narrated event. */
  log: RichText[];
  /**
   * One cursor shared by the cursor modes: aim in target/visual, inspection
   * in look. Each mode sets it on entry, so switching never inherits a stale
   * position by accident.
   */
  cursor: Vec;
  /** A leader key (`g`) awaiting its tail, or "". */
  pendingKeys: string;
  /** Digits awaiting a counted move, like vim's count prefix; "" when none. */
  count: string;
  lastFire: FireAction | null;
  look: LookState;
  visual: VisualState;
  /** Replay omniscience: reveal the whole level regardless of sight. */
  omniscient: boolean;
  recordings: RecordingsState;
  /** Where the current level's segment starts in `meta.commands`. */
  commandMark: number;
  /** Whether the splash offers a quit key. Web builds hide it. */
  showQuit: boolean;
}

/** Run identity and everything a finished run reports. */
export interface MetaState {
  /** Generation config, fixed for the run: the arena flag and layout seed. */
  arena: boolean;
  baseSeed: number;
  /** The depth this run began at, for the end screen. */
  startDepth: number;
  /** Every gameplay command this run, in order, with its tally bucket. */
  commands: CommandEntry[];
  /** Every normalized key this run received, in order, for the recording. */
  inputLog: Key[];
  /** Set once the run ends: the frozen record the end screen shows. */
  runRecord: RunRecord | null;
  /** Set once the run ends: the replayable recording the end screen offers. */
  recording: Recording | null;
  /** The finished run's score and rank, once scored; null when unscored. */
  standing: Standing | null;
  /** The stored score lines behind the splash's high-score table. */
  scoreLines: string[];
}

/** The single mutable root: simulation, presentation, and run metadata. */
export interface GameState {
  sim: SimState;
  ui: UiState;
  meta: MetaState;
}

/** Inputs `createState` cannot derive: run config and the opening level. */
export interface StateInit {
  arena: boolean;
  baseSeed: number;
  startDepth: number;
  visualUnlocked: boolean;
  firstLevel: Level;
}

/**
 * The one canonical constructor for `S`. Every field is set here, so adding
 * a field to a sub-state is a compile error until it gets a default.
 */
export function createState(init: StateInit): GameState {
  const { firstLevel } = init;
  return {
    sim: {
      levels: new Map([[firstLevel.depth, firstLevel]]),
      level: firstLevel,
      player: { ...firstLevel.start },
      inventory: [],
      wielded: null,
      visible: createGrid(),
      hp: MAX_HP,
      dead: false,
      won: false,
      gilGone: false,
      turns: 0,
      loaded: false,
      shells: 0,
      insertMode: false,
      xp: 0,
      plevel: 1,
      visualUnlocked: init.visualUnlocked,
      pendingUnlock: false,
      pendingCorruption: false,
      events: [],
      killedBy: null,
      rng: createRng(init.baseSeed),
    },
    ui: {
      message: UI.initialMessage,
      mode: "play",
      modals: [],
      log: [],
      cursor: { x: 0, y: 0 },
      pendingKeys: "",
      count: "",
      lastFire: null,
      look: { free: false },
      visual: { anchor: { x: 0, y: 0 }, rect: [], last: null },
      omniscient: false,
      recordings: { entries: [], cursor: 0 },
      commandMark: 0,
      showQuit: true,
    },
    meta: {
      arena: init.arena,
      baseSeed: init.baseSeed,
      startDepth: init.startDepth,
      commands: [],
      inputLog: [],
      runRecord: null,
      recording: null,
      standing: null,
      scoreLines: [],
    },
  };
}

/** Whether the live level is the bottom with hostiles still alive. */
export function shouldWarnCorruption(S: GameState): boolean {
  return S.sim.level.depth === BOSS_DEPTH && S.sim.level.enemies.length > 0;
}

/** Queue the bottom's warning for the presenter after entering the level. */
export function markCorruptionWarning(S: GameState): void {
  if (shouldWarnCorruption(S)) {
    S.sim.pendingCorruption = true;
  }
}

/** The mode that owns the frame: the top modal, else the base mode. */
export function activeMode(ui: UiState): Mode {
  const top = ui.modals[ui.modals.length - 1];
  if (top === undefined) {
    return ui.mode;
  }
  switch (top.kind) {
    case "menu":
      return "menu";
    case "pager":
      return "pager";
    case "confirm":
      return "confirm";
  }
}

/** The top modal when it is a menu, else null. */
export function currentMenu(ui: UiState): MenuModal | null {
  const top = ui.modals[ui.modals.length - 1];
  return top !== undefined && top.kind === "menu" ? top : null;
}

/** The top modal when it is a pager, else null. */
export function currentPager(ui: UiState): PagerModal | null {
  const top = ui.modals[ui.modals.length - 1];
  return top !== undefined && top.kind === "pager" ? top : null;
}

/** The top modal when it is a confirm popup, else null. */
export function currentConfirm(ui: UiState): ConfirmModal | null {
  const top = ui.modals[ui.modals.length - 1];
  return top !== undefined && top.kind === "confirm" ? top : null;
}

/** Push a transient screen; the one below it stays exactly as it was. */
export function openModal(ui: UiState, modal: Modal): void {
  ui.modals.push(modal);
}

/** Pop the top transient screen, revealing whatever was below it. */
export function closeModal(ui: UiState): void {
  ui.modals.pop();
}
