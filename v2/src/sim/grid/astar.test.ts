import { describe, expect, it } from 'vitest';
import { IsoGrid } from './IsoGrid';
import { FloorPlan } from '../floor/FloorPlan';
import { findPath, type Cell } from './astar';

describe('A* pathfinding', () => {
  it('finds a straight path including both endpoints', () => {
    const grid = new IsoGrid(10, 10);
    const path = findPath(grid, { col: 0, row: 0 }, { col: 3, row: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ col: 0, row: 0 });
    expect(path![path!.length - 1]).toEqual({ col: 3, row: 0 });
    expect(path!.length).toBe(4);
  });

  it('routes around occupied cells', () => {
    const grid = new IsoGrid(5, 5);
    // Wall of occupied cells across col 2 except row 4.
    grid.occupy('wall', 2, 0, 1, 4);
    const path = findPath(grid, { col: 0, row: 0 }, { col: 4, row: 0 });
    expect(path).not.toBeNull();
    for (const cell of path!) {
      expect(grid.isWalkable(cell.col, cell.row), `${cell.col},${cell.row}`).toBe(true);
    }
    // Must detour through row 4.
    expect(path!.some((c) => c.row === 4)).toBe(true);
  });

  it('returns null when the goal is unreachable', () => {
    const grid = new IsoGrid(5, 5);
    grid.occupy('wall', 2, 0, 1, 5); // full column wall
    expect(findPath(grid, { col: 0, row: 0 }, { col: 4, row: 0 })).toBeNull();
  });

  it('returns null when the goal cell itself is occupied', () => {
    const grid = new IsoGrid(5, 5);
    grid.occupy('x', 3, 3);
    expect(findPath(grid, { col: 0, row: 0 }, { col: 3, row: 3 })).toBeNull();
  });

  it('handles start === goal', () => {
    const grid = new IsoGrid(5, 5);
    expect(findPath(grid, { col: 2, row: 2 }, { col: 2, row: 2 })).toEqual([{ col: 2, row: 2 }]);
  });
});

// The Map-based A* this module replaced, kept verbatim as the oracle: seeds
// are only reproducible if every route comes out cell-for-cell the same.
const REF_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const refKey = (col: number, row: number) => `${col},${row}`;

/** Path from `from` to `to` inclusive of both, or null when unreachable. */
function referenceFindPath(grid: IsoGrid, from: Cell, to: Cell): Cell[] | null {
  if (!grid.inBounds(from.col, from.row) || !grid.isWalkable(to.col, to.row)) return null;
  if (from.col === to.col && from.row === to.row) return [{ ...from }];

  const h = (c: Cell) => Math.abs(c.col - to.col) + Math.abs(c.row - to.row);
  const open = new Map<string, Cell>();
  const g = new Map<string, number>();
  const f = new Map<string, number>();
  const cameFrom = new Map<string, Cell>();
  const closed = new Set<string>();

  const startKey = refKey(from.col, from.row);
  open.set(startKey, { ...from });
  g.set(startKey, 0);
  f.set(startKey, h(from));

  while (open.size > 0) {
    let current: Cell | undefined;
    let currentKey = '';
    let best = Infinity;
    for (const [k, c] of open) {
      const score = f.get(k) ?? Infinity;
      if (score < best) {
        best = score;
        current = c;
        currentKey = k;
      }
    }
    if (!current) break;

    if (current.col === to.col && current.row === to.row) {
      const path: Cell[] = [];
      let cursor: Cell | undefined = current;
      while (cursor) {
        path.push(cursor);
        cursor = cameFrom.get(refKey(cursor.col, cursor.row));
      }
      return path.reverse();
    }

    open.delete(currentKey);
    closed.add(currentKey);

    for (const [dc, dr] of REF_DIRS) {
      const col = current.col + dc;
      const row = current.row + dr;
      const nKey = refKey(col, row);
      if (closed.has(nKey) || !grid.canStep(current.col, current.row, col, row)) continue;
      const tentative = (g.get(currentKey) ?? Infinity) + 1;
      if (tentative < (g.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, current);
        g.set(nKey, tentative);
        f.set(nKey, tentative + h({ col, row }));
        open.set(nKey, { col, row });
      }
    }
  }
  return null;
}

describe('A* matches the original search exactly', () => {
  it('on random floors with objects, holes and walls', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const int = (n: number) => Math.floor(rnd() * n);
    let compared = 0;
    for (let trial = 0; trial < 60; trial++) {
      const cols = 8 + int(33);
      const rows = 8 + int(23);
      const grid = new IsoGrid(cols, rows);
      const plan = FloorPlan.open(cols, rows, { col: 0, row: 0 });
      grid.floor = plan;
      for (let i = int(cols * rows * 0.25); i > 0; i--) {
        const c = int(cols);
        const r = int(rows);
        if (grid.canPlace(c, r, 2, 2)) grid.occupy(`o${i}`, c, r, 2, 2);
      }
      for (let i = int(cols * 2); i > 0; i--) {
        plan.setWall(int(cols), int(rows), rnd() < 0.5 ? 'n' : 'w', true, rnd() < 0.2);
      }
      for (let q = 0; q < 40; q++) {
        const a: Cell = { col: int(cols), row: int(rows) };
        const b: Cell = { col: int(cols), row: int(rows) };
        expect(findPath(grid, a, b), `trial ${trial} ${a.col},${a.row}->${b.col},${b.row}`).toEqual(
          referenceFindPath(grid, a, b),
        );
        compared++;
      }
    }
    expect(compared).toBe(2400);
  });
});
