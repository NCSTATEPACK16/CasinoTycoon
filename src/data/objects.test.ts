import { describe, expect, it } from 'vitest';
import { OBJECT_CATALOG, getObjectDef } from './objects';

describe('object catalog', () => {
  it('has entries', () => {
    expect(OBJECT_CATALOG.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = OBJECT_CATALOG.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has positive costs and non-negative upkeep', () => {
    for (const d of OBJECT_CATALOG) {
      expect(d.cost, d.id).toBeGreaterThan(0);
      expect(d.upkeepPerDay, d.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('has footprints of at least 1×1', () => {
    for (const d of OBJECT_CATALOG) {
      expect(d.footprint.w, d.id).toBeGreaterThanOrEqual(1);
      expect(d.footprint.h, d.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('follows the sprite key contract (placeholder obj- or real img- art)', () => {
    for (const d of OBJECT_CATALOG) {
      expect(d.spriteKey, d.id).toMatch(/^(obj|img)-/);
    }
  });

  it('real-art entries declare a displaySize', () => {
    for (const d of OBJECT_CATALOG) {
      if (d.spriteKey.startsWith('img-')) expect(d.displaySize, d.id).toBeDefined();
    }
  });

  it('includes a 2×2 blackjack table (multi-tile from the start)', () => {
    const bj = getObjectDef('blackjack-table');
    expect(bj?.footprint).toEqual({ w: 2, h: 2 });
  });

  it('getObjectDef resolves known ids and rejects unknown', () => {
    expect(getObjectDef('slot-machine')?.name).toBe('Slot Machine');
    expect(getObjectDef('no-such-thing')).toBeUndefined();
  });
});
