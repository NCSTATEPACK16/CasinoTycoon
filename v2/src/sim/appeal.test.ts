import { describe, expect, it } from 'vitest';
import { APPEAL_BALANCE } from '../data/balance';
import type { FloorType } from '../shared/contracts';
import {
  AppealField,
  decorRatingTerm,
  distanceToSource,
  saturate,
  sourceShare,
  type AppealSource,
} from './appeal';

const floorOf = (cols: number, rows: number, f: FloorType = 'carpet-red') => ({
  cols,
  rows,
  floorAt: () => f,
});

const src = (col: number, row: number, w = 1, h = 1, strength = 40, radius = 4): AppealSource => ({
  col,
  row,
  w,
  h,
  strength,
  radius,
});

describe('appeal radius and falloff', () => {
  it('is full strength on the footprint and zero at the radius', () => {
    const s = src(5, 5, 3, 3, 40, 4);
    for (const [c, r] of [
      [5, 5],
      [6, 6],
      [7, 7],
    ] as const)
      expect(sourceShare(s, c, r)).toBe(40);
    expect(distanceToSource(s, 8, 6)).toBeCloseTo(0.5);
    expect(sourceShare(s, 8, 6)).toBeCloseTo(40 * (1 - 0.5 / 4));
    // 3.5 cells past the edge (centre 11.5, edge 8): an eighth left; 4.5: none.
    expect(sourceShare(s, 11, 6)).toBeCloseTo(40 * (1 - 3.5 / 4));
    expect(sourceShare(s, 12, 6)).toBe(0);
    expect(sourceShare(s, 20, 20)).toBe(0);
  });

  it('falls off monotonically with distance', () => {
    const s = src(10, 10);
    let last = Infinity;
    for (let c = 10; c <= 16; c++) {
      const v = sourceShare(s, c, 10);
      expect(v).toBeLessThanOrEqual(last);
      last = v;
    }
  });
});

describe('diminishing returns', () => {
  it('saturates toward the cap', () => {
    expect(saturate(0)).toBe(0);
    expect(saturate(10)).toBeGreaterThan(9);
    expect(saturate(10_000)).toBeLessThanOrEqual(APPEAL_BALANCE.cellCap);
  });

  it('a second fountain beside the first adds less than the first', () => {
    const fountain = APPEAL_BALANCE.items.fountain!;
    const f = (x: number) => src(x, 10, 3, 3, fountain.strength, fountain.radius);
    const bare = new AppealField(floorOf(40, 30), []);
    const one = new AppealField(floorOf(40, 30), [f(10)]);
    const two = new AppealField(floorOf(40, 30), [f(10), f(13)]);
    const first = one.at(12, 11) - bare.at(12, 11);
    const second = two.at(12, 11) - one.at(12, 11);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
  });

  it('the rating term rises fast, then flattens under its ceiling', () => {
    const b = APPEAL_BALANCE;
    expect(decorRatingTerm(0)).toBe(0);
    const early = decorRatingTerm(b.ratingScale) - decorRatingTerm(0);
    const late = decorRatingTerm(4 * b.ratingScale) - decorRatingTerm(3 * b.ratingScale);
    expect(early).toBeGreaterThan(5 * late);
    expect(decorRatingTerm(1000)).toBeLessThanOrEqual(b.ratingMax);
    expect(b.ratingMax).toBeGreaterThanOrEqual(9);
    expect(b.ratingMax).toBeLessThanOrEqual(11);
  });
});

describe('floor prestige', () => {
  it('marble and wood count for more than tile and carpet', () => {
    const p = APPEAL_BALANCE.floorPrestige;
    expect(p.marble).toBeGreaterThan(p.wood);
    expect(p.wood).toBeGreaterThan(p.tile);
    expect(p.wood).toBeGreaterThan(p['carpet-red']);
    const marble = new AppealField(floorOf(10, 10, 'marble'), []);
    const tile = new AppealField(floorOf(10, 10, 'tile'), []);
    expect(marble.mean).toBeGreaterThan(tile.mean);
  });

  it('cells with no floor are zero and do not count toward the mean', () => {
    const half = {
      cols: 10,
      rows: 10,
      floorAt: (c: number) => (c < 5 ? ('marble' as FloorType) : ('none' as FloorType)),
    };
    const f = new AppealField(half, [src(7, 5)]);
    expect(f.at(7, 5)).toBe(0);
    expect(f.flooredCells).toBe(50);
    expect(f.mean).toBeCloseTo(new AppealField(floorOf(5, 10, 'marble'), [src(7, 5)]).mean, 5);
  });
});
