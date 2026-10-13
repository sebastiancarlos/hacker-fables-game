/**
 * Geometry: grid distances, paths, line walks, and panel placement.
 *
 * Pure functions over cells. No IO and no state, so every layer can share
 * them. `Vec` is the { x, y } cell shape shared by rules and effects;
 * world's `Vec` carries the same fields for terrain.
 */

/** A cell in the shared x/y coordinate shape. */
export interface Vec {
  x: number;
  y: number;
}

/** Chebyshev distance: all 8 surrounding cells are distance 1. */
export function chebyshev(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Chebyshev adjacency: all 8 surrounding cells. */
export function adjacent(a: Vec, b: Vec): boolean {
  return chebyshev(a, b) === 1;
}

/** Nearest free cell by expanding Chebyshev rings, or null if none. */
export function nearestFreeCell(
  from: Vec,
  isBlocked: (x: number, y: number) => boolean,
  width: number,
  height: number,
): Vec | null {
  for (let r = 1; r < Math.max(width, height); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) {
          continue;
        }
        const x = from.x + dx;
        const y = from.y + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) {
          continue;
        }
        if (!isBlocked(x, y)) {
          return { x, y };
        }
      }
    }
  }
  return null;
}

/** Straight line of cells, excluding the start, including the end. */
export function bresenham(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Vec[] {
  const cells: Vec[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    if (x !== x0 || y !== y0) {
      cells.push({ x, y });
    }
    if (x === x1 && y === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return cells;
}

/**
 * Shortest 4-directional path avoiding blocked cells, start excluded.
 * Null when the goal is unreachable.
 */
export function findPath(
  start: Vec,
  goal: Vec,
  isBlocked: (x: number, y: number) => boolean,
  width: number,
  height: number,
): Vec[] | null {
  const key = (p: Vec): string => `${p.x},${p.y}`;
  if (start.x === goal.x && start.y === goal.y) {
    return [];
  }
  const prev = new Map<string, string>();
  const seen = new Set<string>([key(start)]);
  const queue: string[] = [key(start)];
  const target = key(goal);
  const at = (k: string): Vec => {
    const [x, y] = k.split(",").map(Number);
    return { x: x!, y: y! };
  };
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    if (cur === target) {
      break;
    }
    const c = at(cur);
    const steps: Vec[] = [
      { x: c.x - 1, y: c.y },
      { x: c.x + 1, y: c.y },
      { x: c.x, y: c.y - 1 },
      { x: c.x, y: c.y + 1 },
    ];
    for (const next of steps) {
      const k = key(next);
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x >= width ||
        next.y >= height ||
        isBlocked(next.x, next.y) ||
        seen.has(k)
      ) {
        continue;
      }
      seen.add(k);
      prev.set(k, cur);
      queue.push(k);
    }
  }
  if (!prev.has(target)) {
    return null;
  }
  const path: Vec[] = [];
  let cur: string | undefined = target;
  while (cur !== undefined && cur !== key(start)) {
    path.unshift(at(cur));
    cur = prev.get(cur);
  }
  return path;
}

/** Horizontal placement of a right-aligned menu panel. */
export interface PanelGeometry {
  x: number;
  w: number;
}

/** Menu panels fit their longest row, never narrower than the minimum. */
export function panelGeometry(
  rows: { text: string }[],
  minWidth: number,
  totalWidth: number,
): PanelGeometry {
  let need = 0;
  for (const row of rows) {
    need = Math.max(need, row.text.length);
  }
  const w = Math.min(totalWidth, Math.max(minWidth, need));
  return { x: totalWidth - w, w };
}

/** Points of interest for look mode: seen snakes, known ground, known stairs. */
export function lookTargets(
  snakes: Vec[],
  ground: Vec[],
  stairs: Vec[],
  isSeen: (p: Vec) => boolean,
  isKnown: (p: Vec) => boolean,
): Vec[] {
  return [
    ...snakes.filter((s) => isSeen(s)),
    ...ground.filter((g) => isKnown(g)),
    ...stairs.filter((s) => isKnown(s)),
  ];
}
