import { describe, expect, it } from 'vitest';
import type { FloorPlanView } from '../../shared/contracts';
import { ChunkGrid, chunkKey } from './ChunkGrid';

function plan(cols = 20, rows = 12): FloorPlanView {
  return {
    cols,
    rows,
    floor: new Uint8Array(cols * rows),
    zone: new Uint8Array(cols * rows),
    walls: [],
    entrance: { col: 0, row: 0 },
  };
}

const keys = (s: Set<number>) => [...s].sort((a, b) => a - b);

describe('ChunkGrid', () => {
  it('marks every chunk dirty on the first plan or a resize', () => {
    const g = new ChunkGrid();
    const r = g.apply(plan());
    expect(r.resized).toBe(true);
    expect(r.dirty.size).toBe(3 * 2); // ceil(20/8) × ceil(12/8)
    expect(g.apply(plan(24, 12)).dirty.size).toBe(3 * 2);
    expect(g.apply(plan(25, 12)).dirty.size).toBe(4 * 2);
  });

  it('an unchanged plan dirties nothing', () => {
    const g = new ChunkGrid();
    g.apply(plan());
    const r = g.apply(plan());
    expect(r.dirty.size).toBe(0);
    expect(r.zonesChanged).toBe(false);
  });

  it('a floor paint dirties only the chunks it touches', () => {
    const g = new ChunkGrid();
    const p = plan();
    g.apply(p);
    const q = plan();
    q.floor[3 * 20 + 7] = 1; // (7,3)  → chunk 0,0
    q.floor[3 * 20 + 8] = 1; // (8,3)  → chunk 1,0
    q.floor[9 * 20 + 17] = 2; // (17,9) → chunk 2,1
    expect(keys(g.apply(q).dirty)).toEqual(keys(new Set([0, 1, chunkKey(2, 1)])));
    expect(g.floorTypeAt(17, 9)).toBe('carpet-blue');
  });

  it('zone changes flag the overlay without dirtying chunks', () => {
    const g = new ChunkGrid();
    g.apply(plan());
    const q = plan();
    q.zone[5] = 2;
    const r = g.apply(q);
    expect(r.dirty.size).toBe(0);
    expect(r.zonesChanged).toBe(true);
    expect(g.zoneAt(5, 0)).toBe(2);
  });

  it('walls dirty their owning chunk on add, door toggle and removal', () => {
    const g = new ChunkGrid();
    g.apply(plan());
    const q = plan();
    q.walls = [{ col: 9, row: 2, edge: 'n', door: false }];
    expect(keys(g.apply(q).dirty)).toEqual([chunkKey(1, 0)]);
    expect(g.wallsIn(1, 0)).toHaveLength(1);
    q.walls = [{ col: 9, row: 2, edge: 'n', door: true }];
    expect(keys(g.apply(q).dirty)).toEqual([chunkKey(1, 0)]);
    expect(g.apply(q).dirty.size).toBe(0);
    q.walls = [];
    expect(keys(g.apply(q).dirty)).toEqual([chunkKey(1, 0)]);
    expect(g.wallsIn(1, 0)).toHaveLength(0);
  });
});
