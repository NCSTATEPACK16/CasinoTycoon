// Pure grid geometry for the build tools: drag rectangles, wall lines along
// cell edges, and footprint rotation. No three.js, so it is cheap to test.

import type { CellRect, Rotation, WallSegment } from '../../shared/contracts';

export interface Cell {
  col: number;
  row: number;
}

/** A grid vertex (cell corner). Vertex (x, z) sits at world (x, 0, z). */
export interface Vertex {
  x: number;
  z: number;
}

/** Any two drag corners → an inclusive rect with col0<=col1, row0<=row1,
 *  clipped to the lot. Returns null when the drag lies wholly outside it. */
export function normaliseRect(a: Cell, b: Cell, cols: number, rows: number): CellRect | null {
  const col0 = Math.max(0, Math.min(a.col, b.col));
  const col1 = Math.min(cols - 1, Math.max(a.col, b.col));
  const row0 = Math.max(0, Math.min(a.row, b.row));
  const row1 = Math.min(rows - 1, Math.max(a.row, b.row));
  if (col0 > col1 || row0 > row1) return null;
  return { col0, row0, col1, row1 };
}

export function rectArea(r: CellRect): number {
  return (r.col1 - r.col0 + 1) * (r.row1 - r.row0 + 1);
}

export type EdgeKey = Pick<WallSegment, 'col' | 'row' | 'edge'>;

/** The L-shaped wall path between two grid vertices: run along the longer axis
 *  first, then turn the corner. Returns the straight legs (for `wall`
 *  commands) and every unit edge they cover (for the preview), in edge
 *  ownership terms: a horizontal unit edge at z=row is cell (col,row)'s 'n',
 *  a vertical one at x=col is cell (col,row)'s 'w'. */
export function wallPath(
  a: Vertex,
  b: Vertex,
): { legs: { from: Cell; to: Cell }[]; edges: EdgeKey[] } {
  const corner: Vertex =
    Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? { x: b.x, z: a.z } : { x: a.x, z: b.z };
  const legs: { from: Cell; to: Cell }[] = [];
  const edges: EdgeKey[] = [];
  for (const [p, q] of [
    [a, corner],
    [corner, b],
  ] as const) {
    if (p.x === q.x && p.z === q.z) continue;
    legs.push({ from: { col: p.x, row: p.z }, to: { col: q.x, row: q.z } });
    if (p.z === q.z) {
      for (let x = Math.min(p.x, q.x); x < Math.max(p.x, q.x); x++)
        edges.push({ col: x, row: p.z, edge: 'n' });
    } else {
      for (let z = Math.min(p.z, q.z); z < Math.max(p.z, q.z); z++)
        edges.push({ col: p.x, row: z, edge: 'w' });
    }
  }
  return { legs, edges };
}

/** Nearest grid vertex to a ground point, clamped to the lot's corners. */
export function nearestVertex(x: number, z: number, cols: number, rows: number): Vertex {
  return {
    x: Math.min(cols, Math.max(0, Math.round(x))),
    z: Math.min(rows, Math.max(0, Math.round(z))),
  };
}

/** The cell edge nearest a ground point, if within `maxDist` metres of it. */
export function nearestEdge(x: number, z: number, maxDist: number): EdgeKey | null {
  const col = Math.floor(x);
  const row = Math.floor(z);
  const fx = x - col;
  const fz = z - row;
  // Distance to the four edges of the containing cell; south/east belong to neighbours.
  const cands: [number, EdgeKey][] = [
    [fz, { col, row, edge: 'n' }],
    [1 - fz, { col, row: row + 1, edge: 'n' }],
    [fx, { col, row, edge: 'w' }],
    [1 - fx, { col: col + 1, row, edge: 'w' }],
  ];
  cands.sort((p, q) => p[0] - q[0]);
  return cands[0]![0] <= maxDist ? cands[0]![1] : null;
}

/** Footprint size after `rot` clockwise quarter turns: odd turns swap w and h. */
export function rotatedSize(w: number, h: number, rot: Rotation): { w: number; h: number } {
  return rot % 2 === 0 ? { w, h } : { w: h, h: w };
}

/** A footprint-local point (metres from the unrotated min corner) after `rot`
 *  clockwise quarter turns (+x east → +z south), re-anchored at the rotated
 *  footprint's min corner. Headings follow the contract (0 = +z, direction
 *  (sin h, cos h)), so each quarter turn subtracts π/2. */
export function rotateLocal(
  x: number,
  z: number,
  facing: number,
  w: number,
  h: number,
  rot: Rotation,
): { x: number; z: number; facing: number } {
  let px = x;
  let pz = z;
  let pw = w;
  let ph = h;
  for (let i = 0; i < rot; i++) {
    [px, pz] = [ph - pz, px];
    [pw, ph] = [ph, pw];
  }
  return { x: px, z: pz, facing: facing - (Math.PI / 2) * rot };
}

/** Cell under the centre of a w×h footprint whose centre follows the cursor. */
export function footprintOrigin(x: number, z: number, w: number, h: number): Cell {
  return { col: Math.floor(x - w / 2 + 0.5), row: Math.floor(z - h / 2 + 0.5) };
}
