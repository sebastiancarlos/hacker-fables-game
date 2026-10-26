/**
 * Screen: the renderer's contract.
 *
 * The game renders into structured cells and styled spans. Platform modules
 * implement this contract; the ANSI implementation lives in
 * `platform/terminal/ansi-screen.ts`.
 */
import type { Cell, RichText } from "./style.ts";

/** The renderer's contract: structured cells, styled text. */
export interface Screen {
  /** Enter the terminal's "alternate screen", hide the cursor. */
  begin: () => void;
  /** Move the cursor to zero-based screen coords (x, y). */
  park: (x: number, y: number) => void;
  /** Draw one map cell at zero-based screen coords (x, y). */
  cell: (x: number, y: number, cell: Cell) => void;
  /** Draw one styled row, clipped or padded to exactly `width` cells. */
  text: (x: number, y: number, text: RichText, width: number) => void;
  /** Forget the last frame: the next paint re-emits every cell. */
  invalidate: () => void;
  /** Diff the collected frame, send it, and keep it as the new front. */
  flush: () => void;
}
