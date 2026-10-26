/**
 * Grid: dense byte maps for walls, sight, and memory.
 *
 * A fixed WIDTH x HEIGHT map fits a row-major `Uint8Array`, so membership
 * is one indexed load instead of hashing an `"x,y"` string. Callers keep
 * `Vec` at their boundaries; only the storage is flat. Grids stay plain
 * arrays so they serialize and hand straight to a future canvas renderer.
 */
import { HEIGHT, WIDTH } from "../ui/theme.ts";

/** A dense row-major grid of bytes. */
export type Grid = Uint8Array;

/** Index of (x, y) in a WIDTH x HEIGHT grid. */
export function gridIndex(x: number, y: number): number {
  return y * WIDTH + x;
}

/** True when a point lies inside the fixed grid. */
export function inGrid(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
}

/** An empty WIDTH x HEIGHT grid. */
export function createGrid(): Grid {
  return new Uint8Array(WIDTH * HEIGHT);
}

/** True when the cell holds a non-zero value. Out-of-bounds reads false. */
export function gridHas(grid: Grid, x: number, y: number): boolean {
  return inGrid(x, y) && grid[gridIndex(x, y)] !== 0;
}

/** Write a cell; out-of-bounds writes are ignored. */
export function gridSet(grid: Grid, x: number, y: number, value: number): void {
  if (inGrid(x, y)) {
    grid[gridIndex(x, y)] = value;
  }
}

/** Mark a cell, the typed replacement for `Set.add`. */
export function gridAdd(grid: Grid, x: number, y: number): void {
  gridSet(grid, x, y, 1);
}

/** Clear a cell; out-of-bounds deletes are ignored. */
export function gridDelete(grid: Grid, x: number, y: number): void {
  gridSet(grid, x, y, 0);
}

/** Empty a grid in place, keeping its allocation. */
export function gridClear(grid: Grid): void {
  grid.fill(0);
}

/** A copy that shares no cells with the original. */
export function cloneGrid(grid: Grid): Grid {
  return grid.slice();
}

/** Build a grid from `"x,y"` keys, for fixtures and imports. */
export function gridFromKeys(keys: Iterable<string>): Grid {
  const grid = createGrid();
  for (const key of keys) {
    const comma = key.indexOf(",");
    if (comma < 0) {
      continue;
    }
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    gridAdd(grid, x, y);
  }
  return grid;
}

/** The marked cells as `"x,y"` keys, for snapshots and fixtures. */
export function gridKeys(grid: Grid): string[] {
  const keys: string[] = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (grid[gridIndex(x, y)] !== 0) {
        keys.push(`${x},${y}`);
      }
    }
  }
  return keys;
}

/** Count marked cells. */
export function gridCount(grid: Grid): number {
  let count = 0;
  for (const value of grid) {
    if (value !== 0) {
      count++;
    }
  }
  return count;
}

/** Visit every marked cell, in reading order. */
export function forEachGridCell(
  grid: Grid,
  visit: (x: number, y: number) => void,
): void {
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (grid[gridIndex(x, y)] !== 0) {
        visit(x, y);
      }
    }
  }
}
