import { describe, expect, it } from 'vitest';
import { BEACON_S, beaconLevel, burst } from './Celebrations';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('confetti burst', () => {
  it('starts on the machine top and pops upward and outward, gently', () => {
    const parts = burst(500, 4, 2, 7, seeded(1));
    expect(parts).toHaveLength(500);
    for (const p of parts) {
      expect(Math.abs(p.p[0] - 4)).toBeLessThanOrEqual(0.15);
      expect(p.p[1]).toBe(2);
      expect(Math.abs(p.p[2] - 7)).toBeLessThanOrEqual(0.15);
      const up = p.v[1];
      expect(up).toBeGreaterThan(1);
      // Apex under 1 m above the topper at the burst's gravity: stays under a 3 m ceiling.
      expect((up * up) / (2 * 3.2)).toBeLessThan(1);
      expect(Math.hypot(p.v[0], p.v[2])).toBeLessThanOrEqual(1.6 + 1e-9);
    }
    // All palette colours turn up.
    expect(new Set(parts.map((p) => p.color)).size).toBe(6);
  });
});

describe('beacon level', () => {
  it('is on at once, holds, fades over the last second and ends', () => {
    expect(beaconLevel(-0.1)).toBe(0);
    expect(beaconLevel(0)).toBe(1);
    expect(beaconLevel(BEACON_S - 2)).toBe(1);
    expect(beaconLevel(BEACON_S - 0.5)).toBeCloseTo(0.5);
    expect(beaconLevel(BEACON_S)).toBe(0);
  });
});
