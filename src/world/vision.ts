/**
 * Vision: shadowcasting sight and memory.
 *
 * Pure state: computeVision fills S.sim.visible and S.sim.level.explored. Repainting is
 * the renderer's job, run once per key over the whole frame.
 */
import * as ROT from "rot-js";
import { HEIGHT, WIDTH } from "../ui/theme.ts";
import type { GameState } from "../game/state.ts";
import { isWall } from "./queries.ts";
import { gridAdd, gridClear } from "./grid.ts";

/** The rot-js shadowcasting type used by this module. */
export type Fov = InstanceType<typeof ROT.FOV.RecursiveShadowcasting>;

/** Build the shadowcasting field of view instance for this game state. */
export function createFov(S: GameState): Fov {
  return new ROT.FOV.RecursiveShadowcasting(
    (x: number, y: number) =>
      x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT && !isWall(S, x, y),
  );
}

/** Recompute visible cells and add them to the explored map. */
export function computeVision(S: GameState, fov: Fov): void {
  gridClear(S.sim.visible);
  fov.compute(S.sim.player.x, S.sim.player.y, 100, (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) {
      gridAdd(S.sim.visible, x, y);
      gridAdd(S.sim.level.explored, x, y);
    }
  });
}
