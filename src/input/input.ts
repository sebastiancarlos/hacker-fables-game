/**
 * Input: key dispatch across modes.
 *
 * Takes (S, deps, key) explicitly, with `key` already normalized by the
 * platform adapter. Every lower layer is imported directly; the handlers
 * mutate S and may return an animation for the presenter to play. No screen,
 * no sleep, no queue.
 */
import type { Fov } from "../world/vision.ts";
import type { Binding, KeyCtx, KeyLabel } from "./keymap.ts";
import {
  activeMode,
  type Animation,
  type CommandEntry,
  type CommandKind,
  type GameState,
  type Mode,
  markCorruptionWarning,
} from "../game/state.ts";
import type { RunStore } from "../game/game.ts";
import { chamber } from "../combat/combat.ts";
import {
  enterTarget,
  enterVisual,
  enterVisualFromPlay,
  fire,
  fireVisual,
  gvReselect,
  moveCursor,
  repeatFire,
  visualEdge,
  visualMove,
  visualParallelCorner,
  visualSwapCorner,
} from "../combat/aim.ts";
import {
  ascend,
  descend,
  move,
  rideElevator,
  run,
  travelTo,
} from "../game/movement.ts";
import {
  carriedWeapons,
  inventoryKey as inventoryKeyMod,
  pickup,
  showEquip,
  showInventory,
  showScripts,
} from "../player/inventory.ts";
import {
  confirmKey as confirmKeyMod,
  openQuitConfirm,
  pagerKey as pagerKeyMod,
  showHelp,
  showLog,
} from "../ui/screens/pager.ts";
import { enterLook, lookKey as lookKeyMod } from "../ui/screens/look.ts";
import { endScreenKey } from "../ui/screens/endgame.ts";
import {
  closeRecordings,
  closeScores,
  recordingsKey,
  scoresKey,
  titleKey,
} from "../ui/screens/title.ts";
import { passTurn } from "../combat/monsters.ts";
import { elevatorAt, isExplored } from "../world/queries.ts";
import { ELEVATOR_BROKEN, LABEL, NOTE } from "../content.ts";
import { note } from "../game/events.ts";
import { commandsLines } from "../ui/screens/help.ts";

/** What every input handler can reach besides the game state. */
export interface InputDeps extends RunStore {
  quit: () => void;
  fov: Fov;
  /** Watch the recording at this path (the picker's selection). */
  onReplayPath?: ((path: string) => void) | undefined;
  /** Leave a replay for the title screen. */
  onQuitToTitle?: (() => void) | undefined;
}

/** Lowercase move keys and their step; the only ones a count prefix binds. */
const COUNT_MOVES: Record<string, { x: number; y: number }> = {
  h: { x: -1, y: 0 },
  j: { x: 0, y: 1 },
  k: { x: 0, y: -1 },
  l: { x: 1, y: 0 },
};

/** A count holds at most this many digits; extras are ignored. */
const COUNT_MAX_DIGITS = 3;

/** True for a single ASCII digit. */
function isDigit(chunk: string): boolean {
  return chunk.length === 1 && chunk >= "0" && chunk <= "9";
}

/**
 * Log one gameplay command for the tally line, if the key names one. Bare
 * prefixes and keys that do nothing record nothing; the renderer repaints
 * the row. The binding supplies the bucket, so no label is re-parsed.
 */
function recordCommand(S: GameState, entry: CommandEntry | null): void {
  if (entry === null) {
    return;
  }
  S.meta.commands.push(entry);
}

/** What a gameplay binding can reach: the state and its side effects. */
interface GameplayCtx extends KeyCtx {
  deps: InputDeps;
}

/** A gameplay binding, which always names a tally label and bucket. */
interface GameplayBinding extends Binding<GameplayCtx> {
  label: KeyLabel;
  kind: CommandKind;
  /** One-line command-pager copy; omitted for contextual keys. */
  help?: string;
  /** How the help pager spells the keys, when the label is not enough. */
  helpKeys?: string;
}

/** A two-key command like `gv`: a leader that arms, a tail that fires. */
interface Sequence {
  leader: string;
  tail: string;
  label: string;
  kind: CommandKind;
  /** One-line command-pager copy; omitted when the sequence is mode-local. */
  help?: string;
  /** How the help pager spells the keys, usually just the label. */
  helpKeys?: string;
  /** Show this sequence's row after the binding with this help key. */
  helpAfter?: string;
  run: (ctx: GameplayCtx) => void | Animation | null;
}

/** One mode's keys: single-key bindings, two-key sequences and counts. */
interface KeyTable {
  bindings: GameplayBinding[];
  sequences: Sequence[];
  /** Counted moves (play only): a count before one runs it N times. */
  countMoves?: Record<string, { x: number; y: number }>;
}

/** Resolve a binding's label against the current state. */
function labelFor(binding: GameplayBinding, S: GameState): string | null {
  const label: KeyLabel = binding.label;
  return typeof label === "function" ? label(S) : label;
}

/** The binding a key hits in a table, if any. */
function bindingFor(
  bindings: GameplayBinding[],
  chunk: string,
): GameplayBinding | undefined {
  return bindings.find((b) => b.keys.includes(chunk));
}

/**
 * The h/j/k/l steps and their shifted twins, each key labelling itself.
 * Cursor modes treat both cases as one step, so they share an action.
 */
function stepBindings(
  step: (ctx: GameplayCtx, dx: number, dy: number) => void,
): GameplayBinding[] {
  const dirs: [string, string, number, number][] = [
    ["h", "H", -1, 0],
    ["j", "J", 0, 1],
    ["k", "K", 0, -1],
    ["l", "L", 1, 0],
  ];
  return dirs.flatMap(([lo, hi, dx, dy]) => [
    {
      keys: [lo],
      label: lo,
      kind: "move",
      run: (c: GameplayCtx) => step(c, dx, dy),
    },
    {
      keys: [hi],
      label: hi,
      kind: "move",
      run: (c: GameplayCtx) => step(c, dx, dy),
    },
  ]);
}

/** Leave a cursor mode back to play, the way target and visual both do. */
function lowerShotgun(ctx: GameplayCtx): void {
  ctx.S.ui.mode = "play";
  note(ctx.S, NOTE.lowerShotgun);
}

/** Play-mode keys: movement, the combat verbs, travel, and quit. */
const PLAY_BINDINGS: GameplayBinding[] = [
  {
    keys: ["h"],
    label: "h",
    kind: "move",
    helpKeys: "h, Left",
    help: "step west",
    run: (c) => move(c.S, c.deps.fov, -1, 0),
  },
  {
    keys: ["H"],
    label: "H",
    kind: "move",
    helpKeys: "Shift+h",
    help: "run west until disturbed",
    run: (c) => run(c.S, c.deps.fov, -1, 0),
  },
  {
    keys: ["j"],
    label: "j",
    kind: "move",
    helpKeys: "j, Down",
    help: "step south",
    run: (c) => move(c.S, c.deps.fov, 0, 1),
  },
  {
    keys: ["J"],
    label: "J",
    kind: "move",
    helpKeys: "Shift+j",
    help: "run south until disturbed",
    run: (c) => run(c.S, c.deps.fov, 0, 1),
  },
  {
    keys: ["k"],
    label: "k",
    kind: "move",
    helpKeys: "k, Up",
    help: "step north",
    run: (c) => move(c.S, c.deps.fov, 0, -1),
  },
  {
    keys: ["K"],
    label: "K",
    kind: "move",
    helpKeys: "Shift+k",
    help: "run north until disturbed",
    run: (c) => run(c.S, c.deps.fov, 0, -1),
  },
  {
    keys: ["l"],
    label: "l",
    kind: "move",
    helpKeys: "l, Right",
    help: "step east",
    run: (c) => move(c.S, c.deps.fov, 1, 0),
  },
  {
    keys: ["L"],
    label: "L",
    kind: "move",
    helpKeys: "Shift+l",
    help: "run east until disturbed",
    run: (c) => run(c.S, c.deps.fov, 1, 0),
  },
  {
    keys: ["w", "W"],
    // Wait is one verb, however it is cased.
    label: "w",
    kind: "other",
    help: "wait one turn",
    run: (c) => {
      c.S.sim.events.push({ type: "clear" });
      passTurn(c.S);
    },
  },
  {
    keys: ["."],
    // Vim-style repeat: re-run the last shot.
    label: (S) =>
      S.ui.lastFire === null
        ? "."
        : S.ui.lastFire.visual
          ? ".(visual-fire)"
          : ".(fire)",
    kind: "fire",
    help: "repeat the last shot",
    run: (c) => repeatFire(c.S),
  },
  {
    keys: [","],
    label: ",",
    kind: "item",
    help: "pick up what is here",
    forgets: true,
    run: (c) => pickup(c.S),
  },
  {
    keys: ["E"],
    label: "E",
    kind: "item",
    help: "equip menu",
    forgets: true,
    run: (c) => {
      if (carriedWeapons(c.S).length === 0) {
        note(c.S, NOTE.nothingToEquip);
      } else {
        showEquip(c.S);
      }
    },
  },
  {
    keys: ["I"],
    label: "I",
    kind: "item",
    help: "inventory list",
    forgets: true,
    run: (c) => showInventory(c.S),
  },
  {
    keys: ["M"],
    // Brogue's message archive is Shift-M.
    label: "M",
    kind: "other",
    help: "message log",
    forgets: true,
    run: (c) => showLog(c.S),
  },
  {
    keys: ["?"],
    label: "?",
    kind: "other",
    help: "this help",
    forgets: true,
    run: (c) => showHelp(c.S),
  },
  {
    keys: ["/"],
    label: "/",
    kind: "other",
    help: "look around (o free selection, r details)",
    forgets: true,
    run: (c) => enterLook(c.S),
  },
  {
    keys: ["i"],
    label: "i",
    kind: "item",
    help: '"INSERT BULLET" mode (chamber, ESC leaves)',
    run: (c) => chamber(c.S),
  },
  {
    keys: ["s"],
    label: "s",
    kind: "item",
    help: "execute a script",
    forgets: true,
    run: (c) => showScripts(c.S),
  },
  {
    keys: ["f"],
    label: "f",
    kind: "fire",
    help: "fire mode (Enter fires, ESC cancels)",
    run: (c) => enterTarget(c.S),
  },
  {
    keys: ["<C-v>"],
    label: "^V",
    kind: "fire",
    helpKeys: "^V",
    help: "visual block (unlocks at level 2)",
    run: (c) => enterVisualFromPlay(c.S),
  },
  {
    keys: [">"],
    label: ">",
    kind: "travel",
    help: "travel down, descend on stairs",
    forgets: true,
    run: (c) => {
      if (elevatorAt(c.S, c.S.sim.player.x, c.S.sim.player.y)) {
        return useElevator(c.S, c.deps);
      }
      descend(c.S, c.deps.fov);
      return null;
    },
  },
  {
    keys: ["="],
    label: "=",
    kind: "travel",
    help: "ride the service elevator",
    forgets: true,
    run: (c) => useElevator(c.S, c.deps),
  },
  {
    keys: ["<"],
    label: "<",
    kind: "travel",
    help: "travel up, ascend on stairs",
    forgets: true,
    run: (c) => ascend(c.S, c.deps.fov),
  },
  {
    keys: ["<Esc>"],
    // ESC only means something when it leaves insert mode.
    label: (S) => (S.sim.insertMode ? "ESC" : null),
    kind: "other",
    run: (c) => {
      if (c.S.sim.insertMode) {
        c.S.sim.insertMode = false;
        c.S.sim.events.push({ type: "clear" });
      }
    },
  },
  {
    keys: ["q", "Q"],
    label: "q",
    kind: "other",
    help: "quit (confirms)",
    run: (c) => openQuitConfirm(c.S),
  },
];

/** Target-mode keys: aim with the cursor, fire, or drop into visual. */
const TARGET_BINDINGS: GameplayBinding[] = [
  ...stepBindings((c, dx, dy) => moveCursor(c.S, dx, dy)),
  {
    keys: ["<CR>"],
    label: "RET",
    kind: "fire",
    // A single shot carries no tiles: `.` re-runs `f` and re-aims.
    run: (c) => {
      c.S.ui.lastFire = { cells: [], visual: false };
      return fire(c.S);
    },
  },
  {
    keys: ["<C-v>"],
    label: "^V",
    kind: "fire",
    run: (c) => enterVisual(c.S),
  },
  {
    keys: ["<Esc>"],
    label: "ESC",
    kind: "other",
    run: lowerShotgun,
  },
  {
    keys: ["q", "Q"],
    label: "q",
    kind: "other",
    run: lowerShotgun,
  },
];

/** Visual-mode keys: resize and shift the rectangle, then volley. */
const VISUAL_BINDINGS: GameplayBinding[] = [
  ...stepBindings((c, dx, dy) => visualMove(c.S, dx, dy)),
  {
    keys: ["^"],
    label: "^",
    kind: "move",
    run: (c) => visualEdge(c.S, -1, 0),
  },
  {
    keys: ["$"],
    label: "$",
    kind: "move",
    run: (c) => visualEdge(c.S, 1, 0),
  },
  {
    keys: ["G"],
    label: "G",
    kind: "move",
    run: (c) => visualEdge(c.S, 0, 1),
  },
  {
    keys: ["<CR>"],
    label: "RET",
    kind: "fire",
    // A volley is repeated at these exact tiles.
    run: (c) => {
      c.S.ui.lastFire = {
        cells: c.S.ui.visual.rect.map((tile) => ({ ...tile })),
        visual: true,
      };
      return fireVisual(c.S);
    },
  },
  {
    keys: ["o"],
    label: "o",
    kind: "move",
    // Swap to the opposite corner, like vim: the rectangle stays,
    // further moves resize from the other end.
    run: (c) => visualSwapCorner(c.S),
  },
  {
    keys: ["O"],
    label: "O",
    kind: "move",
    // Vim's parallel shift: the cursor jumps to the other corner on its
    // own row and the anchor follows, so the rectangle is unchanged.
    run: (c) => visualParallelCorner(c.S),
  },
  {
    keys: ["<Esc>"],
    label: "ESC",
    kind: "other",
    run: lowerShotgun,
  },
  {
    keys: ["q", "Q"],
    label: "q",
    kind: "other",
    run: lowerShotgun,
  },
];

/** Play, target, and visual each get a table; menu modes have none. */
const PLAY_KEYS: KeyTable = {
  bindings: PLAY_BINDINGS,
  sequences: [
    {
      leader: "g",
      tail: "v",
      label: "gv",
      kind: "fire",
      help: "reselect last visual block",
      helpAfter: "^V",
      run: (c) => gvReselect(c.S),
    },
  ],
  countMoves: COUNT_MOVES,
};

/** The command pager, generated from the play-mode bindings. */
export const COMMANDS_LINES: string[] = commandsLines(PLAY_KEYS);

/** Target-mode key table, including its `gv` reselect sequence. */
const TARGET_KEYS: KeyTable = {
  bindings: TARGET_BINDINGS,
  sequences: [
    {
      leader: "g",
      tail: "v",
      label: "gv",
      kind: "fire",
      run: (c) => gvReselect(c.S),
    },
  ],
};

/** Visual-mode key table, including its `gg` top-edge sequence. */
const VISUAL_KEYS: KeyTable = {
  bindings: VISUAL_BINDINGS,
  sequences: [
    {
      leader: "g",
      tail: "g",
      label: "gg",
      kind: "move",
      run: (c) => visualEdge(c.S, 0, -1),
    },
  ],
};

/** Mode to its key table; only the gameplay modes record commands. */
const MODE_KEYS: Partial<Record<Mode, KeyTable>> = {
  play: PLAY_KEYS,
  target: TARGET_KEYS,
  visual: VISUAL_KEYS,
};

/**
 * Every token the gameplay tables match, for the canonical-notation check.
 * Covers bindings, sequence leaders and tails, and counted moves.
 */
export const GAMEPLAY_TOKENS: string[] = Object.values(MODE_KEYS).flatMap(
  (table) =>
    table === undefined
      ? []
      : [
          ...table.bindings.flatMap((binding) => binding.keys),
          ...table.sequences.flatMap((sequence) => [
            sequence.leader,
            sequence.tail,
          ]),
          ...Object.keys(table.countMoves ?? {}),
        ],
);

/**
 * The tally entry a key would record in a table, or null when it is a bare
 * prefix (a lone `g`) or does nothing. Shared by `commandLabel` (readers)
 * and `runKey` (writers), so the label and bucket a key runs with cannot
 * drift apart.
 */
function tableEntry(
  table: KeyTable,
  S: GameState,
  chunk: string,
): CommandEntry | null {
  const seq = table.sequences.find(
    (s) => s.leader === S.ui.pendingKeys && s.tail === chunk,
  );
  if (seq !== undefined) {
    return { label: seq.label, kind: seq.kind };
  }
  const binding = bindingFor(table.bindings, chunk);
  if (binding === undefined) {
    return null;
  }
  const label = labelFor(binding, S);
  return label === null ? null : { label, kind: binding.kind };
}

/**
 * Label one gameplay keypress, or null when the key is a bare prefix (a
 * lone `g`) or does nothing in the current mode. Menu modes never label.
 * Reads the same tables the handlers run, so labels cannot drift.
 */
export function commandLabel(S: GameState, chunk: string): string | null {
  const table = MODE_KEYS[activeMode(S.ui)];
  return table === undefined
    ? null
    : (tableEntry(table, S, chunk)?.label ?? null);
}

/**
 * Run one gameplay key through a mode's table. A pending leader (`g`)
 * finishes a sequence or cancels and lets the key act fresh; then a count
 * prefix (play only) accumulates or runs a move; then a leader key arms
 * itself; and finally a single-key binding fires. A returned animation is
 * handed back for the presenter to play.
 */
function runKey(
  table: KeyTable,
  ctx: GameplayCtx,
  chunk: string,
): Animation | null {
  const { S } = ctx;
  // A pending leader either completes a sequence or cancels first.
  if (S.ui.pendingKeys !== "") {
    const leader = S.ui.pendingKeys;
    S.ui.pendingKeys = "";
    const seq = table.sequences.find(
      (s) => s.leader === leader && s.tail === chunk,
    );
    if (seq !== undefined) {
      recordCommand(S, { label: seq.label, kind: seq.kind });
      return seq.run(ctx) ?? null;
    }
  }
  // A count prefix: digits pile up, then a lowercase move runs that many
  // steps. Any other key drops the count and is handled normally.
  if (table.countMoves !== undefined) {
    if (isDigit(chunk)) {
      if (S.ui.count !== "" || chunk !== "0") {
        if (S.ui.count.length < COUNT_MAX_DIGITS) {
          S.ui.count += chunk;
        }
      }
      return null;
    }
    if (S.ui.count !== "") {
      const count = S.ui.count;
      S.ui.count = "";
      const dir = table.countMoves[chunk];
      if (dir !== undefined) {
        recordCommand(S, { label: `${count}${chunk}`, kind: "move" });
        if (count === "1") {
          move(S, ctx.deps.fov, dir.x, dir.y);
          return null;
        }
        run(S, ctx.deps.fov, dir.x, dir.y, Number(count));
        return null;
      }
    }
  }
  // A leader key arms a sequence, echoed by the renderer until its tail.
  if (table.sequences.some((s) => s.leader === chunk)) {
    S.ui.pendingKeys = chunk;
    return null;
  }
  // Otherwise a single-key binding, recording its label first.
  const binding = bindingFor(table.bindings, chunk);
  recordCommand(S, tableEntry(table, S, chunk));
  if (binding === undefined) {
    return null; // ignore unknown keys
  }
  // A non-move, non-shot action forgets the last shot: `.` repeats only
  // while the last thing you did was a fire sequence.
  if (binding.forgets) {
    S.ui.lastFire = null;
  }
  return binding.run(ctx) ?? null;
}

/** Visual-block keys: move the cursor, swap corners, and fire. */
export function visualKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  return runKey(VISUAL_KEYS, { S, deps }, chunk);
}

/** Target keys: move the aim cursor, select a target, and fire. */
export function targetKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  return runKey(TARGET_KEYS, { S, deps }, chunk);
}

/** Play-mode keys: movement, combat, travel, and the menus. */
export function playKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  return runKey(PLAY_KEYS, { S, deps }, chunk);
}

/** Menu keys shared by inventory, equip, scripts, help, and details. */
export function menuKey(
  S: GameState,
  _deps: InputDeps,
  chunk: string,
): Animation | null {
  inventoryKeyMod(S, chunk, COMMANDS_LINES);
  return null;
}

/** Pager keys: scroll, search, and close the archive. */
export function pagerModeKey(
  S: GameState,
  _deps: InputDeps,
  chunk: string,
): Animation | null {
  pagerKeyMod(S, chunk);
  return null;
}

/** Look keys: move the inspector, jump targets, and show details. */
export function lookModeKey(
  S: GameState,
  _deps: InputDeps,
  chunk: string,
): Animation | null {
  lookKeyMod(S, chunk);
  return null;
}

/** Splash keys: start, open recordings or scores, or quit. */
export function titleModeKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  titleKey(S, chunk, deps.quit);
  return null;
}

/** Lore keys: any key dismisses the splash and enters the run. */
export function loreModeKey(
  S: GameState,
  _deps: InputDeps,
  _chunk: string,
): Animation | null {
  S.ui.mode = "play";
  markCorruptionWarning(S);
  return null;
}

/** Recording-picker keys: move, watch, or return to the splash. */
export function recordingsModeKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  recordingsKey(S, chunk, deps.onReplayPath ?? (() => {}), () =>
    closeRecordings(S),
  );
  return null;
}

/** High-score keys: close the table and return to the splash. */
export function scoresModeKey(
  S: GameState,
  _deps: InputDeps,
  chunk: string,
): Animation | null {
  scoresKey(chunk, () => closeScores(S));
  return null;
}

/** Confirmation keys: accept or cancel the pending action. */
export function confirmModeKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  confirmKeyMod(S, chunk, deps.quit);
  return null;
}

/** End-screen keys: replay the run or quit the game. */
export function overModeKey(
  S: GameState,
  deps: InputDeps,
  chunk: string,
): Animation | null {
  endScreenKey(S, chunk, deps.quit, deps.onReplay);
  return null;
}

/**
 * Take the service elevator: `=` from anywhere on the floor (walking to it
 * first when it is known), or `>` when already standing on it. The shaft
 * is out of service until the GIL-less dev preview falls.
 */
function useElevator(S: GameState, deps: InputDeps): Animation | null {
  const ev = S.sim.level.elevator;
  if (ev === null) {
    note(S, NOTE.noElevator);
    return null;
  }
  if (S.sim.player.x !== ev.x || S.sim.player.y !== ev.y) {
    if (!isExplored(S, ev.x, ev.y)) {
      note(S, NOTE.noElevatorFound);
      return null;
    }
    travelTo(S, deps.fov, ev, LABEL.elevator);
    return null;
  }
  if (!S.sim.gilGone) {
    note(S, ELEVATOR_BROKEN);
    return null;
  }
  return rideElevator(S, deps.fov);
}
