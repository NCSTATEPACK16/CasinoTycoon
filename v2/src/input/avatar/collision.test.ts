import { describe, expect, it } from 'vitest';
import type { FloorPlanView, ObjectView, WallSegment } from '../../shared/contracts';
import { AVATAR_RADIUS, CollisionWorld, WALL_HALF_THICKNESS, type Vec2 } from './collision';

const COLS = 20;
const ROWS = 20;

function plan(walls: WallSegment[]): FloorPlanView {
  return {
    cols: COLS,
    rows: ROWS,
    floor: new Uint8Array(COLS * ROWS),
    zone: new Uint8Array(COLS * ROWS),
    walls,
    entrance: { col: 19, row: 10 },
  };
}

/** A straight wall along x = 10 from row 0 to row ROWS, optionally with a door at `doorRow`. */
function wallX10(doorRow?: number): WallSegment[] {
  return Array.from({ length: ROWS }, (_, row) => ({
    col: 10,
    row,
    edge: 'w' as const,
    door: row === doorRow,
  }));
}

function obj(id: string, defId: string, col: number, row: number): ObjectView {
  return { id, defId, col, row, rot: 0, broken: false, open: true, occupants: 0 };
}

/** Walk at `speed` m/s toward `dir` for `seconds`, stepping at `fps`. */
function walk(
  world: CollisionWorld,
  start: Vec2,
  dir: Vec2,
  speed: number,
  seconds: number,
  fps: number,
): Vec2 {
  const pos = { ...start };
  const len = Math.hypot(dir.x, dir.z);
  const dt = 1 / fps;
  for (let t = 0; t < seconds; t += dt) {
    const vel = { x: (dir.x / len) * speed, z: (dir.z / len) * speed };
    world.move(pos, vel, dt);
  }
  return pos;
}

const STOP = 10 - AVATAR_RADIUS - WALL_HALF_THICKNESS;

describe('CollisionWorld — walls', () => {
  it('stops the capsule at a wall', () => {
    const w = new CollisionWorld();
    w.rebuild(plan(wallX10()), [], COLS, ROWS);
    const p = walk(w, { x: 5, z: 5.5 }, { x: 1, z: 0 }, 3, 4, 60);
    expect(p.x).toBeCloseTo(STOP, 3);
    expect(p.z).toBeCloseTo(5.5, 6);
  });

  it.each([60, 20, 5])('never tunnels through a wall at %i fps, even running', (fps) => {
    const w = new CollisionWorld();
    w.rebuild(plan(wallX10()), [], COLS, ROWS);
    const p = walk(w, { x: 9, z: 5.5 }, { x: 1, z: 0 }, 3, 2, fps);
    expect(p.x).toBeLessThanOrEqual(STOP + 1e-6);
  });

  it('never tunnels a single huge frame (a hitch of half a second)', () => {
    const w = new CollisionWorld();
    w.rebuild(plan(wallX10()), [], COLS, ROWS);
    const pos = { x: 8, z: 5.5 };
    w.move(pos, { x: 10, z: 0 }, 0.5);
    expect(pos.x).toBeLessThanOrEqual(STOP + 1e-6);
  });

  it('passes through a door gap', () => {
    const w = new CollisionWorld();
    w.rebuild(plan(wallX10(5)), [], COLS, ROWS);
    const p = walk(w, { x: 7, z: 5.5 }, { x: 1, z: 0 }, 1.4, 4, 60);
    expect(p.x).toBeGreaterThan(11);
  });

  it('slides along a wall when walking into it diagonally', () => {
    const w = new CollisionWorld();
    w.rebuild(plan(wallX10()), [], COLS, ROWS);
    const p = walk(w, { x: 9, z: 5 }, { x: 1, z: 1 }, 1.4, 2, 60);
    expect(p.x).toBeCloseTo(STOP, 3);
    // Started at z=5; the along-wall component keeps it moving (≈1.4/√2 · 2 s).
    expect(p.z).toBeGreaterThan(6.5);
  });

  it('slides around an outside corner (wall end)', () => {
    const w = new CollisionWorld();
    // A short wall stub along x=10, rows 0..4 (ends at z=5).
    w.rebuild(
      plan(Array.from({ length: 5 }, (_, row) => ({ col: 10, row, edge: 'w' as const, door: false }))),
      [],
      COLS,
      ROWS,
    );
    const p = walk(w, { x: 9.5, z: 4.5 }, { x: 1, z: 0.2 }, 1.4, 4, 60);
    expect(p.x).toBeGreaterThan(11); // rounded the end of the stub
  });

  it('settles into an inside corner without jitter or escape', () => {
    const w = new CollisionWorld();
    w.rebuild(plan([]), [], COLS, ROWS);
    const p = walk(w, { x: 2, z: 2 }, { x: -1, z: -1 }, 3, 3, 60);
    const min = AVATAR_RADIUS + WALL_HALF_THICKNESS;
    expect(p.x).toBeCloseTo(min, 3);
    expect(p.z).toBeCloseTo(min, 3);
  });

  it('keeps the capsule inside the lot boundary', () => {
    const w = new CollisionWorld();
    w.rebuild(null, [], COLS, ROWS);
    const p = walk(w, { x: 18, z: 10 }, { x: 1, z: 0 }, 3, 3, 20);
    expect(p.x).toBeLessThanOrEqual(COLS - AVATAR_RADIUS - WALL_HALF_THICKNESS + 1e-6);
  });
});

describe('CollisionWorld — footprints', () => {
  it('blocks a table footprint', () => {
    const w = new CollisionWorld();
    w.rebuild(null, [obj('o1', 'blackjack-table', 10, 5)], COLS, ROWS); // 2×2 at x∈[10,12]
    const p = walk(w, { x: 7, z: 6 }, { x: 1, z: 0 }, 3, 3, 20);
    expect(p.x).toBeLessThanOrEqual(10.04 - AVATAR_RADIUS + 1e-6);
  });

  it('respects rotation when sizing a footprint', () => {
    const w = new CollisionWorld();
    w.rebuild(null, [{ ...obj('b', 'bar', 4, 4), rot: 1 }], COLS, ROWS);
    const box = w.shapes.find((s) => s.kind === 'box');
    expect(box).toBeDefined();
    if (box?.kind !== 'box') return;
    // bar is 2×1 unrotated → 1×2 after a quarter turn.
    expect(box.x1 - box.x0).toBeCloseTo(1 - 0.08, 6);
    expect(box.z1 - box.z0).toBeCloseTo(2 - 0.08, 6);
  });

  it('slides along a footprint edge and around its corner', () => {
    const w = new CollisionWorld();
    w.rebuild(null, [obj('o1', 'blackjack-table', 10, 5)], COLS, ROWS);
    const p = walk(w, { x: 9, z: 6.5 }, { x: 1, z: 0.3 }, 1.4, 5, 60);
    expect(p.x).toBeGreaterThan(12.3); // slid along the west face and round the SW corner
  });

  it('ejects a capsule an object was placed on top of', () => {
    const w = new CollisionWorld();
    w.rebuild(null, [obj('o1', 'blackjack-table', 10, 5)], COLS, ROWS);
    const pos = { x: 10.3, z: 6 };
    w.move(pos, { x: 0, z: 0 }, 1 / 60);
    expect(pos.x).toBeLessThanOrEqual(10.04 - AVATAR_RADIUS + 1e-6);
  });
});

describe('CollisionWorld — spring-arm raycast', () => {
  it('finds the wall distance along a ray', () => {
    const w = new CollisionWorld();
    w.rebuild(plan(wallX10()), [], COLS, ROWS);
    expect(w.raycastWalls(8, 5, 1, 0, 5)).toBeCloseTo(2, 6);
    expect(w.raycastWalls(8, 5, -1, 0, 3)).toBe(3);
  });
});
