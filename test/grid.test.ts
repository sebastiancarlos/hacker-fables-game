/**
 * Grid suite: dense wall, sight, and memory storage.
 *
 * The grid is deliberately plain bytes, so these tests pin membership,
 * bounds, copying, and the string-key adapters used by fixtures.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cloneGrid,
  createGrid,
  forEachGridCell,
  gridAdd,
  gridClear,
  gridCount,
  gridDelete,
  gridFromKeys,
  gridHas,
  gridKeys,
  gridSet,
  inGrid,
} from "../src/world/grid.ts";
import { HEIGHT, WIDTH } from "../src/ui/theme.ts";

describe("grid", () => {
  it("starts empty and holds marks in place", () => {
    const grid = createGrid();
    assert.equal(grid.length, WIDTH * HEIGHT);
    assert.equal(gridHas(grid, 3, 4), false);
    gridAdd(grid, 3, 4);
    assert.equal(gridHas(grid, 3, 4), true);
    assert.equal(gridHas(grid, 4, 3), false);
    gridDelete(grid, 3, 4);
    assert.equal(gridHas(grid, 3, 4), false);
  });

  it("ignores points outside the fixed map", () => {
    const grid = createGrid();
    assert.equal(inGrid(-1, 0), false);
    assert.equal(inGrid(0, -1), false);
    assert.equal(inGrid(WIDTH, 0), false);
    assert.equal(inGrid(0, HEIGHT), false);
    assert.equal(gridHas(grid, -1, 0), false);
    gridSet(grid, -1, -1, 1);
    assert.equal(gridCount(grid), 0);
  });

  it("round-trips string-coordinate keys", () => {
    const keys = ["1,1", "2,2", `${WIDTH - 1},${HEIGHT - 1}`];
    const grid = gridFromKeys([...keys, "bad"]);
    assert.deepEqual(gridKeys(grid), keys);
    assert.equal(gridCount(grid), keys.length);
  });

  it("visits only marked cells in reading order", () => {
    const grid = gridFromKeys(["2,1", "0,0"]);
    const seen: string[] = [];
    forEachGridCell(grid, (x, y) => {
      seen.push(`${x},${y}`);
    });
    assert.deepEqual(seen, ["0,0", "2,1"]);
  });

  it("copies without sharing cells", () => {
    const grid = gridFromKeys(["1,2"]);
    const copy = cloneGrid(grid);
    gridDelete(grid, 1, 2);
    assert.equal(gridHas(grid, 1, 2), false);
    assert.equal(gridHas(copy, 1, 2), true);
  });

  it("clears in place", () => {
    const grid = gridFromKeys(["1,1", "2,2"]);
    const cells = grid;
    gridClear(grid);
    assert.equal(grid, cells);
    assert.equal(gridCount(grid), 0);
  });
});
