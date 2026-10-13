/**
 * Events: the one place simulation modules queue narration.
 *
 * Simulation code appends typed events; the presenter owns the wording.
 * `note` remains the escape hatch for one-off lines. Copy itself lives in
 * content.
 */
import type { GameState, SimEvent } from "./game-state.ts";

/** Queue one event for the presenter. */
export function say(S: GameState, event: SimEvent): void {
  S.sim.events.push(event);
}

/** Queue one free-text note. */
export function note(S: GameState, text: string): void {
  say(S, { type: "note", text });
}
