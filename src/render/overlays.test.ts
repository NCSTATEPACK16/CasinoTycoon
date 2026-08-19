import { describe, expect, it } from 'vitest';
import { colorFor, OVERLAYS } from './overlays';

const MOOD = OVERLAYS.mood;

describe('colorFor', () => {
  it('returns the exact stop colors at the stop positions', () => {
    for (const stop of MOOD.stops) {
      expect(colorFor(MOOD.stops, stop.at)).toBe(stop.color);
    }
  });

  it('interpolates between stops rather than snapping to the nearest', () => {
    const mid = colorFor(MOOD.stops, 0.25);
    expect(mid).not.toBe(MOOD.stops[0]!.color);
    expect(mid).not.toBe(MOOD.stops[1]!.color);
    // Between miserable-red and fine-amber, green rises monotonically.
    const g = (c: number) => (c >> 8) & 0xff;
    expect(g(mid)).toBeGreaterThan(g(MOOD.stops[0]!.color));
    expect(g(mid)).toBeLessThan(g(MOOD.stops[1]!.color));
  });

  it('clamps outside 0..1 instead of producing a garbage color', () => {
    expect(colorFor(MOOD.stops, -5)).toBe(MOOD.stops[0]!.color);
    expect(colorFor(MOOD.stops, 99)).toBe(MOOD.stops[MOOD.stops.length - 1]!.color);
  });

  it('stays inside the 24-bit range across the whole ramp', () => {
    for (let i = 0; i <= 100; i++) {
      const c = colorFor(MOOD.stops, i / 100);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(0xffffff);
      expect(Number.isInteger(c)).toBe(true);
    }
  });
});

describe('overlay definitions', () => {
  it('gives every overlay a legend that spans the whole scale', () => {
    for (const def of Object.values(OVERLAYS)) {
      expect(def.stops.length).toBeGreaterThanOrEqual(2);
      expect(def.stops[0]!.at).toBe(0);
      expect(def.stops[def.stops.length - 1]!.at).toBe(1);
      // Stops must ascend, or the interpolation walks backwards.
      const positions = def.stops.map((s) => s.at);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // A legend with an unlabeled stop is a legend that explains nothing.
      for (const stop of def.stops) expect(stop.label.length).toBeGreaterThan(0);
      expect(def.max).toBeGreaterThan(def.min);
      expect(def.emptyNote.length).toBeGreaterThan(0);
    }
  });

  it('formats a value as something a player can read', () => {
    expect(MOOD.format(72.4)).toBe('72% happy');
  });
});
