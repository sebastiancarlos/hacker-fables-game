/**
 * Modes: one table pairing each mode's key handler with its painter.
 *
 * The table is the scene stack: a mode is added in one place, so input and
 * rendering can never drift apart. `handleKey` also folds arrows and resets
 * the per-key event queue; `presentPendingEffects` opens simulation-queued
 * popups, and `presentAfterKey` adds run settlement after a key.
 */
import type { Screen } from "./screen.ts";
import { foldArrow, keyToken, type Key } from "./key.ts";
import {
  activeMode,
  LOG_LIMIT,
  type Animation,
  type GameState,
  type Mode,
} from "./game-state.ts";
import { formatLog, formatLastMessage } from "./messages.ts";
import { settle } from "./endgame.ts";
import { openConfirm, openCorruptionWarning } from "./pager.ts";
import {
  confirmModeKey,
  lookModeKey,
  loreModeKey,
  menuKey,
  overModeKey,
  pagerModeKey,
  playKey,
  recordingsModeKey,
  scoresModeKey,
  targetKey,
  titleModeKey,
  visualKey,
  type InputDeps,
} from "./input.ts";
import {
  paintConfirmMode,
  paintLookMode,
  paintLoreMode,
  paintMenuMode,
  paintOverMode,
  paintPagerMode,
  paintPlayMode,
  paintRecordingsMode,
  paintScoresMode,
  paintTargetMode,
  paintTitleMode,
  paintVisualMode,
} from "./render.ts";

/** What one mode does with a key and with the frame. */
export interface ModeSpec {
  key: (S: GameState, deps: InputDeps, chunk: string) => Animation | null;
  paint: (S: GameState, screen: Screen) => void;
}

/** Every mode, paired with its handler and painter in one row. */
export const MODES: Record<Mode, ModeSpec> = {
  title: { key: titleModeKey, paint: paintTitleMode },
  recordings: { key: recordingsModeKey, paint: paintRecordingsMode },
  scores: { key: scoresModeKey, paint: paintScoresMode },
  play: { key: playKey, paint: paintPlayMode },
  target: { key: targetKey, paint: paintTargetMode },
  visual: { key: visualKey, paint: paintVisualMode },
  look: { key: lookModeKey, paint: paintLookMode },
  lore: { key: loreModeKey, paint: paintLoreMode },
  over: { key: overModeKey, paint: paintOverMode },
  menu: { key: menuKey, paint: paintMenuMode },
  pager: { key: pagerModeKey, paint: paintPagerMode },
  confirm: { key: confirmModeKey, paint: paintConfirmMode },
};

/** Modes that own the whole screen even after the run has ended. */
const END_MODES: ReadonlySet<Mode> = new Set([
  "title",
  "recordings",
  "scores",
  "over",
]);

/**
 * Modes where h/j/k/l mean direction, so arrows fold onto them. Menu modes
 * with letter hotkeys (a menu's `a)` items, pager search) are left out and
 * see the arrow itself, which is simply not one of those letters.
 */
const ARROW_MODES: ReadonlySet<Mode> = new Set([
  "play",
  "target",
  "visual",
  "look",
  "recordings",
  "scores",
]);

/** Dispatch one normalized key through its mode's handler. */
export function handleKey(
  S: GameState,
  deps: InputDeps,
  key: Key,
): Animation | null {
  // A key owns one fresh event queue. The previous key's events are already
  // on the message line, so dropping them keeps the queue bounded.
  S.sim.events.length = 0;
  const mode = activeMode(S.ui);
  if (!END_MODES.has(mode) && (S.sim.dead || S.sim.won)) {
    // First key after the run ended: reveal the end screen and swallow it.
    presentAfterKey(S, deps);
    return null;
  }
  // Only the directional modes fold arrows onto vim letters; the hotkey
  // menus see the arrow itself, so Left/Right never become their h/l keys.
  const logical = ARROW_MODES.has(mode) ? foldArrow(key) : key;
  const anim = MODES[mode].key(S, deps, keyToken(logical));
  presentMessages(S);
  return anim;
}

/**
 * Turn this key's events into the message line. A run that took several
 * turns keeps its last non-empty line; earlier lines stay in the log.
 */
function presentMessages(S: GameState): void {
  if (S.sim.events.length === 0) {
    return;
  }
  // Archive every rendered event before the one-line trim drops any.
  S.ui.log.push(...formatLog(S.sim.events));
  if (S.ui.log.length > LOG_LIMIT) {
    S.ui.log.splice(0, S.ui.log.length - LOG_LIMIT);
  }
  S.ui.message = formatLastMessage(S.sim.events);
}

/**
 * Turn flags the simulation queued into modals. This runs after boot and
 * after every key, so simulation modules never reach into the UI.
 */
export function presentPendingEffects(S: GameState): void {
  const ended = S.sim.dead || S.sim.won;
  if (S.sim.pendingCorruption) {
    S.sim.pendingCorruption = false;
    if (!ended) {
      openCorruptionWarning(S);
    }
  }
  if (S.sim.pendingUnlock) {
    S.sim.pendingUnlock = false;
    if (!ended) {
      openConfirm(S);
    }
  }
}

/** Present queued popups after a key, then file a finished run. */
export function presentAfterKey(S: GameState, deps: InputDeps): void {
  presentPendingEffects(S);
  settle(S, deps);
}

/** Paint the frame the current mode names. */
export function render(S: GameState, screen: Screen): void {
  MODES[activeMode(S.ui)].paint(S, screen);
}
