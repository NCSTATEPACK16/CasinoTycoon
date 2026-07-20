import { describe, expect, it } from 'vitest';
import { TILE_VARIANT_COUNT, tileVariantIndex } from './tileVariant';

describe('tileVariantIndex', () => {
  it('is deterministic for the same cell', () => {
    expect(tileVariantIndex(5, 12)).toBe(tileVariantIndex(5, 12));
    expect(tileVariantIndex(0, 0)).toBe(tileVariantIndex(0, 0));
  });

  it('always returns a value in [0, TILE_VARIANT_COUNT)', () => {
    for (let col = 0; col < 40; col++) {
      for (let row = 0; row < 30; row++) {
        const v = tileVariantIndex(col, row);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(TILE_VARIANT_COUNT);
      }
    }
  });

  it('distributes roughly evenly across a 40x30 grid (no variant starved)', () => {
    const counts = new Array(TILE_VARIANT_COUNT).fill(0);
    for (let col = 0; col < 40; col++) {
      for (let row = 0; row < 30; row++) {
        counts[tileVariantIndex(col, row)]++;
      }
    }
    const total = 40 * 30;
    for (const c of counts) {
      expect(c / total).toBeGreaterThan(0.15); // ~25% each if uniform; allow slack
    }
  });

  it('neighboring cells are not all forced to the same variant', () => {
    const row = 10;
    const variants = new Set<number>();
    for (let col = 0; col < 8; col++) variants.add(tileVariantIndex(col, row));
    expect(variants.size).toBeGreaterThan(1);
  });
});
