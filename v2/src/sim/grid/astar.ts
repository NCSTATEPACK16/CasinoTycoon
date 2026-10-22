import type { IsoGrid } from './IsoGrid';

// Grid A*, 4-directional, no dependencies. Typed arrays indexed by cell and a
// binary heap: the guest brain tries several candidates per decision, and a
// candidate that turns out unreachable floods the whole lot, so the search has
// to stay cheap even when it fails.
//
// Ties break exactly as the original Map-based version did — lowest f, then
// the cell that entered the open set first — so every seed walks the same
// routes it always has.

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

const OPEN = 1;
const CLOSED = 2;

/** Scratch reused across calls; a stamp per cell marks what this call touched,
 *  so nothing needs clearing between searches. */
let size = 0;
let stamp = new Uint32Array(0);
let gen = 0;
let state = new Uint8Array(0);
let gScore = new Int32Array(0);
let fScore = new Int32Array(0);
let seqOf = new Int32Array(0);
let parent = new Int32Array(0);
// Heap entries (f, seq, cell), lazily deleted: a cell whose f dropped is
// pushed again and the stale entry skipped when it surfaces.
let heapF = new Int32Array(64);
let heapSeq = new Int32Array(64);
let heapCell = new Int32Array(64);
let heapLen = 0;

function ensure(cells: number): void {
  if (cells <= size) return;
  size = cells;
  stamp = new Uint32Array(cells);
  gen = 0;
  state = new Uint8Array(cells);
  gScore = new Int32Array(cells);
  fScore = new Int32Array(cells);
  seqOf = new Int32Array(cells);
  parent = new Int32Array(cells);
}

const less = (i: number, j: number) =>
  heapF[i]! < heapF[j]! || (heapF[i] === heapF[j] && heapSeq[i]! < heapSeq[j]!);

function swap(i: number, j: number): void {
  let t = heapF[i]!;
  heapF[i] = heapF[j]!;
  heapF[j] = t;
  t = heapSeq[i]!;
  heapSeq[i] = heapSeq[j]!;
  heapSeq[j] = t;
  t = heapCell[i]!;
  heapCell[i] = heapCell[j]!;
  heapCell[j] = t;
}

function push(f: number, seq: number, cell: number): void {
  if (heapLen === heapF.length) {
    const grow = (a: Int32Array) => {
      const b = new Int32Array(a.length * 2);
      b.set(a);
      return b;
    };
    heapF = grow(heapF);
    heapSeq = grow(heapSeq);
    heapCell = grow(heapCell);
  }
  let i = heapLen++;
  heapF[i] = f;
  heapSeq[i] = seq;
  heapCell[i] = cell;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!less(i, p)) break;
    swap(i, p);
    i = p;
  }
}

/** Remove the top entry; the caller reads it first. */
function pop(): void {
  heapLen--;
  if (heapLen === 0) return;
  swap(0, heapLen);
  let i = 0;
  for (;;) {
    const l = 2 * i + 1;
    const r = l + 1;
    let m = i;
    if (l < heapLen && less(l, m)) m = l;
    if (r < heapLen && less(r, m)) m = r;
    if (m === i) break;
    swap(i, m);
    i = m;
  }
}

/** Path from `from` to `to` inclusive of both, or null when unreachable. */
export function findPath(grid: IsoGrid, from: Cell, to: Cell): Cell[] | null {
  if (!grid.inBounds(from.col, from.row) || !grid.isWalkable(to.col, to.row)) return null;
  if (from.col === to.col && from.row === to.row) return [{ ...from }];

  const cols = grid.cols;
  ensure(cols * grid.rows);
  if (++gen === 0xffffffff) {
    stamp.fill(0);
    gen = 1;
  }
  heapLen = 0;
  let seq = 0;
  const h = (col: number, row: number) => Math.abs(col - to.col) + Math.abs(row - to.row);

  const start = from.row * cols + from.col;
  const goal = to.row * cols + to.col;
  stamp[start] = gen;
  state[start] = OPEN;
  gScore[start] = 0;
  fScore[start] = h(from.col, from.row);
  seqOf[start] = seq++;
  parent[start] = -1;
  push(fScore[start]!, seqOf[start]!, start);

  while (heapLen > 0) {
    const cur = heapCell[0]!;
    const f = heapF[0]!;
    pop();
    if (state[cur] !== OPEN || fScore[cur] !== f) continue; // stale entry

    if (cur === goal) {
      const path: Cell[] = [];
      for (let c = cur; c !== -1; c = parent[c]!) {
        path.push({ col: c % cols, row: (c / cols) | 0 });
      }
      return path.reverse();
    }

    state[cur] = CLOSED;
    const ccol = cur % cols;
    const crow = (cur / cols) | 0;
    const tentative = gScore[cur]! + 1;
    for (const [dc, dr] of DIRS) {
      const col = ccol + dc;
      const row = crow + dr;
      if (!grid.canStep(ccol, crow, col, row)) continue; // also rejects out of bounds
      const n = row * cols + col;
      const seen = stamp[n] === gen;
      if (seen && state[n] === CLOSED) continue;
      if (seen && tentative >= gScore[n]!) continue;
      if (!seen) {
        stamp[n] = gen;
        state[n] = OPEN;
        seqOf[n] = seq++;
      }
      parent[n] = cur;
      gScore[n] = tentative;
      fScore[n] = tentative + h(col, row);
      push(fScore[n]!, seqOf[n]!, n);
    }
  }
  return null;
}
