import { describe, expect, it } from 'vitest';
import {
  footprintOrigin,
  nearestEdge,
  nearestVertex,
  normaliseRect,
  rectArea,
  rotateLocal,
  rotatedSize,
  wallPath,
} from './gridMath';

describe('normaliseRect', () => {
  it('orders corners whichever way the drag went', () => {
    const want = { col0: 2, row0: 3, col1: 6, row1: 8 };
    expect(normaliseRect({ col: 2, row: 3 }, { col: 6, row: 8 }, 40, 30)).toEqual(want);
    expect(normaliseRect({ col: 6, row: 8 }, { col: 2, row: 3 }, 40, 30)).toEqual(want);
    expect(normaliseRect({ col: 6, row: 3 }, { col: 2, row: 8 }, 40, 30)).toEqual(want);
    expect(normaliseRect({ col: 2, row: 8 }, { col: 6, row: 3 }, 40, 30)).toEqual(want);
  });

  it('handles a single-cell click', () => {
    const r = normaliseRect({ col: 4, row: 4 }, { col: 4, row: 4 }, 40, 30)!;
    expect(r).toEqual({ col0: 4, row0: 4, col1: 4, row1: 4 });
    expect(rectArea(r)).toBe(1);
  });

  it('clips to the lot and rejects drags wholly outside it', () => {
    expect(normaliseRect({ col: -5, row: 28 }, { col: 3, row: 35 }, 40, 30)).toEqual({
      col0: 0,
      row0: 28,
      col1: 3,
      row1: 29,
    });
    expect(normaliseRect({ col: 41, row: 2 }, { col: 45, row: 4 }, 40, 30)).toBeNull();
  });
});

describe('wallPath', () => {
  it('rasterises a straight horizontal run into n edges', () => {
    const p = wallPath({ x: 2, z: 5 }, { x: 5, z: 5 });
    expect(p.legs).toEqual([{ from: { col: 2, row: 5 }, to: { col: 5, row: 5 } }]);
    expect(p.edges).toEqual([
      { col: 2, row: 5, edge: 'n' },
      { col: 3, row: 5, edge: 'n' },
      { col: 4, row: 5, edge: 'n' },
    ]);
  });

  it('rasterises a vertical run (dragged upward) into w edges', () => {
    const p = wallPath({ x: 7, z: 4 }, { x: 7, z: 1 });
    expect(p.edges).toEqual([
      { col: 7, row: 1, edge: 'w' },
      { col: 7, row: 2, edge: 'w' },
      { col: 7, row: 3, edge: 'w' },
    ]);
  });

  it('turns an L along the longer axis first', () => {
    const p = wallPath({ x: 0, z: 0 }, { x: 3, z: 2 });
    expect(p.legs).toEqual([
      { from: { col: 0, row: 0 }, to: { col: 3, row: 0 } },
      { from: { col: 3, row: 0 }, to: { col: 3, row: 2 } },
    ]);
    expect(p.edges).toHaveLength(5);
    const tall = wallPath({ x: 0, z: 0 }, { x: 1, z: 4 });
    expect(tall.legs[0]).toEqual({ from: { col: 0, row: 0 }, to: { col: 0, row: 4 } });
  });

  it('produces nothing for a zero-length drag', () => {
    expect(wallPath({ x: 3, z: 3 }, { x: 3, z: 3 })).toEqual({ legs: [], edges: [] });
  });

  it('never emits the same edge twice', () => {
    const p = wallPath({ x: 9, z: 2 }, { x: 1, z: 7 });
    const keys = p.edges.map((e) => `${e.col},${e.row},${e.edge}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(8 + 5);
  });
});

describe('vertex and edge snapping', () => {
  it('snaps to the nearest corner, clamped to the lot', () => {
    expect(nearestVertex(3.4, 6.6, 40, 30)).toEqual({ x: 3, z: 7 });
    expect(nearestVertex(-2, 31, 40, 30)).toEqual({ x: 0, z: 30 });
  });

  it('finds the closest owned edge', () => {
    expect(nearestEdge(4.5, 6.05, 0.3)).toEqual({ col: 4, row: 6, edge: 'n' });
    expect(nearestEdge(4.5, 6.95, 0.3)).toEqual({ col: 4, row: 7, edge: 'n' });
    expect(nearestEdge(4.9, 6.5, 0.3)).toEqual({ col: 5, row: 6, edge: 'w' });
    expect(nearestEdge(4.5, 6.5, 0.3)).toBeNull();
  });
});

describe('footprint rotation', () => {
  it('swaps w/h on odd quarter turns', () => {
    expect(rotatedSize(3, 1, 0)).toEqual({ w: 3, h: 1 });
    expect(rotatedSize(3, 1, 1)).toEqual({ w: 1, h: 3 });
    expect(rotatedSize(3, 1, 2)).toEqual({ w: 3, h: 1 });
  });

  it('rotates a seat clockwise and keeps it inside the rotated footprint', () => {
    // Slot seat: in front (+z) of a 1×1 cabinet, facing it (π).
    const r1 = rotateLocal(0.5, 1.1, Math.PI, 1, 1, 1);
    expect(r1.x).toBeCloseTo(-0.1, 6); // in front is now west
    expect(r1.z).toBeCloseTo(0.5, 6);
    // Facing must still point at the cabinet centre (0.5, 0.5).
    expect(Math.sin(r1.facing)).toBeCloseTo(1, 6);
    expect(Math.cos(r1.facing)).toBeCloseTo(0, 6);
    const r4 = rotateLocal(0.5, 1.1, Math.PI, 1, 1, 0);
    expect(r4).toEqual({ x: 0.5, z: 1.1, facing: Math.PI });
  });

  it('centres a footprint on the cursor', () => {
    expect(footprintOrigin(5.7, 5.7, 1, 1)).toEqual({ col: 5, row: 5 });
    expect(footprintOrigin(6.1, 6.1, 2, 2)).toEqual({ col: 5, row: 5 });
  });
});
