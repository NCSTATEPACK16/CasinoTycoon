import { describe, expect, it } from 'vitest';
import { PAR_SHEETS } from '../../sim/games/slots/sheets';
import {
  durationScale,
  outcomeAt,
  packStops,
  reelPosition,
  reelStopTime,
  restingStops,
  revealTime,
  STRIP_MAX,
} from './reels';

describe('reel stop timing', () => {
  it('stops the reels left to right and reveals on the last', () => {
    for (const n of [3, 5]) {
      const times = Array.from({ length: n }, (_, r) => reelStopTime(10, r, n, 1));
      for (let r = 1; r < n; r++) expect(times[r]!).toBeGreaterThan(times[r - 1]!);
      expect(revealTime(10, n, 1)).toBe(times[n - 1]);
      // A watchable spin: the result shows between 1.3 and 2 seconds in.
      expect(times[n - 1]! - 10).toBeGreaterThan(1.3);
      expect(times[n - 1]! - 10).toBeLessThan(2);
    }
  });

  it('runs shorter at 2x and 4x, never slower than at 1x', () => {
    expect(durationScale(1)).toBe(1);
    expect(durationScale(2)).toBeLessThan(1);
    expect(durationScale(4)).toBeLessThan(durationScale(2));
    expect(revealTime(0, 3, durationScale(4))).toBeGreaterThan(0.6);
  });

  it('starts from the old stop, lands exactly on the new one, and scrolls down the whole way', () => {
    const len = 16;
    for (const [prev, target] of [
      [3, 11],
      [11, 3],
      [7, 7],
      [0, 15],
    ] as const) {
      for (let r = 0; r < 3; r++) {
        const ts = reelStopTime(0, r, 3, 1);
        expect(reelPosition(0, 0, 1, r, 3, target, prev, len)).toBe(prev);
        // Continuous into the stop from either side.
        expect(reelPosition(ts - 1e-6, 0, 1, r, 3, target, prev, len)).toBeCloseTo(target, 3);
        expect(reelPosition(ts, 0, 1, r, 3, target, prev, len)).toBeCloseTo(target, 9);
        // Falling position = symbols moving down the window, at least one lap.
        let last = Infinity;
        for (let t = 0.001; t < ts; t += 0.01) {
          const p = reelPosition(t, 0, 1, r, 3, target, prev, len);
          expect(p).toBeLessThanOrEqual(last + 1e-9);
          last = p;
        }
        expect(reelPosition(0.001, 0, 1, r, 3, target, prev, len) - target).toBeGreaterThan(
          len - 0.01,
        );
        // The overshoot rings down onto the stop within half a second.
        const after = (dt: number) => reelPosition(ts + dt, 0, 1, r, 3, target, prev, len);
        expect(after(0.05)).toBeLessThan(target);
        expect(Math.abs(after(0.5) - target)).toBeLessThan(0.01);
      }
    }
  });

  it('starts the start of the spin where the previous position was, mod the strip', () => {
    // A position and position + len show the same symbols, so the first frame
    // of a spin never jumps: (start - prev) is a whole number of strips.
    const start = reelPosition(1e-9, 0, 1, 2, 3, 4, 9, 16);
    expect((start - 9) / 16).toBeCloseTo(Math.round((start - 9) / 16), 6);
  });

  it('packs target and previous stop into one float', () => {
    for (let t = 0; t < STRIP_MAX; t++)
      for (let p = 0; p < STRIP_MAX; p++) {
        const v = Math.fround(packStops(t, p));
        expect(v % 64).toBe(t);
        expect(Math.floor(v / 64)).toBe(p);
      }
  });
});

describe('resting stops', () => {
  it('never shows a paying window on an idle cabinet', () => {
    for (const id of Object.keys(PAR_SHEETS))
      for (let seed = 1; seed < 400; seed++) {
        const stops = restingStops(id, seed * 2654435761);
        const o = outcomeAt(id, stops);
        expect(o.multiplier).toBe(0);
        expect(o.lineWins).toHaveLength(0);
      }
  });

  it('forces the engine onto exactly the stops asked for', () => {
    const sheet = PAR_SHEETS['penny-fortune']!;
    const stops = [2, 5, 7, 11, 13];
    const o = outcomeAt('penny-fortune', stops);
    o.window.forEach((col, r) => {
      const strip = sheet.reels[r]!.stops;
      expect(col).toEqual([0, 1, 2].map((row) => strip[(stops[r]! + row - 1 + 16) % 16]));
    });
  });

  it('varies between cabinets', () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => restingStops('lucky-cherries', i + 1).join(',')),
    );
    expect(seen.size).toBeGreaterThan(10);
  });
});
