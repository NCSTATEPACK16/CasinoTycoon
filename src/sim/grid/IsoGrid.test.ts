import { describe, it, expect } from 'vitest';
import { IsoGrid } from './IsoGrid';

describe('IsoGrid', () => {
  it('reports bounds correctly', () => {
    const g = new IsoGrid(4, 3);
    expect(g.inBounds(0, 0)).toBe(true);
    expect(g.inBounds(3, 2)).toBe(true);
    expect(g.inBounds(4, 0)).toBe(false);
    expect(g.inBounds(0, 3)).toBe(false);
    expect(g.inBounds(-1, 0)).toBe(false);
  });

  it('starts fully walkable and empty', () => {
    const g = new IsoGrid(4, 3);
    expect(g.isWalkable(2, 1)).toBe(true);
    expect(g.occupantAt(2, 1)).toBeNull();
    expect(g.canPlace(0, 0, 4, 3)).toBe(true);
  });

  it('occupies a multi-tile footprint and blocks overlap', () => {
    const g = new IsoGrid(10, 10);
    expect(g.occupy('table-1', 2, 2, 2, 2)).toBe(true);
    expect(g.occupantAt(3, 3)).toBe('table-1');
    expect(g.isWalkable(2, 3)).toBe(false);
    expect(g.canPlace(3, 3)).toBe(false);
    expect(g.occupy('slot-1', 3, 1, 1, 2)).toBe(false); // overlaps (3,2)
    expect(g.occupantAt(3, 1)).toBeNull(); // failed occupy changed nothing
    expect(g.occupy('slot-1', 4, 2)).toBe(true);
  });

  it('rejects footprints that spill off the grid', () => {
    const g = new IsoGrid(5, 5);
    expect(g.canPlace(4, 4, 2, 1)).toBe(false);
    expect(g.occupy('x', 4, 4, 1, 2)).toBe(false);
  });

  it('frees all cells held by an id', () => {
    const g = new IsoGrid(10, 10);
    g.occupy('table-1', 2, 2, 2, 2);
    expect(g.free('table-1')).toBe(4);
    expect(g.canPlace(2, 2, 2, 2)).toBe(true);
    expect(g.free('table-1')).toBe(0);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const g = new IsoGrid(6, 4);
    g.occupy('a', 1, 1, 2, 1);
    g.occupy('b', 4, 3);
    const copy = IsoGrid.fromJSON(JSON.parse(JSON.stringify(g.toJSON())) as never);
    expect(copy.cols).toBe(6);
    expect(copy.rows).toBe(4);
    expect(copy.occupantAt(2, 1)).toBe('a');
    expect(copy.occupantAt(4, 3)).toBe('b');
    expect(copy.isWalkable(0, 0)).toBe(true);
  });

  describe('load (in-place restore)', () => {
    it('restores occupancy from JSON without replacing the grid object', () => {
      const a = new IsoGrid(4, 3);
      a.occupy('obj-1', 1, 1, 2, 1);
      const b = new IsoGrid(4, 3);
      const ref = b;
      b.load(a.toJSON());
      expect(b).toBe(ref);
      expect(b.occupantAt(1, 1)).toBe('obj-1');
      expect(b.occupantAt(2, 1)).toBe('obj-1');
      expect(b.occupantAt(0, 0)).toBeNull();
      expect(b.toJSON()).toEqual(a.toJSON());
    });

    it('changes dimensions and occupancy when loading from different source', () => {
      const source = new IsoGrid(4, 3);
      source.occupy('obj-1', 1, 1);
      const target = new IsoGrid(2, 2);
      const ref = target;
      target.load(source.toJSON());
      expect(target).toBe(ref);
      expect(target.cols).toBe(4);
      expect(target.rows).toBe(3);
      expect(target.toJSON()).toEqual(source.toJSON());
    });
  });
});
