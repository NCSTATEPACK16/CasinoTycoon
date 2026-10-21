import type { IsoGrid } from './IsoGrid';

// Grid A*, 4-directional, no dependencies. Small enough grids (40×30) that a
// linear open-set scan beats the bookkeeping of a heap.

export interface Cell {
  col: number;
  row: number;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const key = (col: number, row: number) => `${col},${row}`;

/** Path from `from` to `to` inclusive of both, or null when unreachable. */
export function findPath(grid: IsoGrid, from: Cell, to: Cell): Cell[] | null {
  if (!grid.inBounds(from.col, from.row) || !grid.isWalkable(to.col, to.row)) return null;
  if (from.col === to.col && from.row === to.row) return [{ ...from }];

  const h = (c: Cell) => Math.abs(c.col - to.col) + Math.abs(c.row - to.row);
  const open = new Map<string, Cell>();
  const g = new Map<string, number>();
  const f = new Map<string, number>();
  const cameFrom = new Map<string, Cell>();
  const closed = new Set<string>();

  const startKey = key(from.col, from.row);
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
        cursor = cameFrom.get(key(cursor.col, cursor.row));
      }
      return path.reverse();
    }

    open.delete(currentKey);
    closed.add(currentKey);

    for (const [dc, dr] of DIRS) {
      const col = current.col + dc;
      const row = current.row + dr;
      const nKey = key(col, row);
      if (closed.has(nKey) || !grid.isWalkable(col, row)) continue;
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
