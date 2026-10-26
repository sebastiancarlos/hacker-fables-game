/**
 * Keymap: the one key-binding shape every mode shares.
 *
 * A mode lists bindings (keys to the keys they answer, and the action to
 * run). Gameplay modes (play, target, visual) layer on tally labels, a
 * leader echo, and counted moves in input.ts; menu modes are plain lists
 * run through `dispatch`. Either way a key is answered by a row, never a
 * hand-rolled switch.
 */
import type { Animation, CommandKind, GameState } from "../game/state.ts";

/** The minimum every binding context carries: the state. */
export interface KeyCtx {
  S: GameState;
}

/** A fixed label, a label read from the state, or nothing to record. */
export type KeyLabel = string | ((S: GameState) => string | null) | null;

/**
 * One bound key: the keys it answers to, the tally label and bucket it
 * records (read only by the gameplay tables), and the action it runs.
 */
export interface Binding<C = KeyCtx> {
  keys: string[];
  label?: KeyLabel;
  /** Tally bucket for gameplay bindings; menus leave it unset. */
  kind?: CommandKind;
  /** Play-mode actions that are neither a move nor a shot: `.` forgets. */
  forgets?: true;
  /** A binding may hand back an animation for the presenter to play. */
  run: (ctx: C) => void | Animation | null;
}

/**
 * Run the first binding whose keys include `chunk`, and report whether one
 * matched. Menus with a catch-all (a letter hotkey) fall through to their
 * own default when false; unknown keys are otherwise ignored.
 */
export function dispatch<C>(
  bindings: Binding<C>[],
  ctx: C,
  chunk: string,
): boolean {
  const binding = bindings.find((b) => b.keys.includes(chunk));
  if (binding === undefined) {
    return false;
  }
  binding.run(ctx);
  return true;
}
