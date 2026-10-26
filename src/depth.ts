/**
 * Depth constants and depth-keyed table helpers shared by the game.
 *
 * This module has no imports, so content can name the bottom without
 * pulling in the enemy tables.
 */

/** The bottom of the dive, where the GIL-less dev preview waits. */
export const BOSS_DEPTH = 15;

/** Player level that unlocks the visual block. */
export const VISUAL_UNLOCK_LEVEL = 2;

/** A point on a depth-keyed table: depth and the value at that depth. */
export type KeyPoint = readonly [depth: number, value: number];

/**
 * A clamped piecewise-linear curve through keypoints sorted by depth.
 *
 * @param points Keypoints sorted by depth.
 * @param round Rounding rule for interpolated values. Defaults to
 *   `Math.round`, but can get passed others like `Math.floor`.
 * @returns A function that maps a depth to its interpolated value.
 */
export function curve(
  points: readonly KeyPoint[],
  round: (n: number) => number = Math.round,
): (depth: number) => number {
  return (depth) => {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    if (depth <= first[0]) {
      return first[1];
    }
    if (depth >= last[0]) {
      return last[1];
    }
    for (let i = 1; i < points.length; i++) {
      const [d1, v1] = points[i]!;
      if (depth > d1) {
        continue;
      }
      const [d0, v0] = points[i - 1]!;
      const t = (depth - d0) / (d1 - d0);
      return round(v0 + t * (v1 - v0));
    }
    return last[1];
  };
}

/**
 * A clamped step function through milestones sorted by depth. Each value
 * holds until the next milestone, with no interpolation.
 *
 * @param points Milestones sorted by depth.
 * @returns A function that maps a depth to the value of the last milestone
 *   at or above it.
 */
export function steps(points: readonly KeyPoint[]): (depth: number) => number {
  return (depth) => {
    let value = points[0]![1];
    for (const [at, next] of points) {
      if (depth < at) {
        break;
      }
      value = next;
    }
    return value;
  };
}
