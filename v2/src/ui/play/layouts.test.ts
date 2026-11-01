import { describe, expect, it } from 'vitest';
import { parseSpot } from '../../sim/games/roulette/roulette';
import { fromSheet, rouletteSpotAt, rouletteSpotCentre, toSheet, trayChips } from './layouts';

/** Every bet the engine takes on a double-zero wheel. */
function allSpots(): string[] {
  const out = ['straight:0', 'straight:00', 'basket'];
  for (let n = 1; n <= 36; n++) out.push(`straight:${n}`);
  for (let a = 1; a <= 35; a++) if (a % 3 !== 0) out.push(`split:${a}-${a + 1}`);
  for (let a = 1; a <= 33; a++) out.push(`split:${a}-${a + 3}`);
  for (let a = 1; a <= 34; a += 3) out.push(`street:${a}`);
  for (let a = 1; a <= 32; a++) if (a % 3 !== 0) out.push(`corner:${a}`);
  for (let a = 1; a <= 31; a += 3) out.push(`sixline:${a}`);
  for (const k of [1, 2, 3]) out.push(`column:${k}`, `dozen:${k}`);
  out.push('red', 'black', 'odd', 'even', 'low', 'high');
  return out;
}

describe('roulette layout', () => {
  it('reaches every bet the engine takes, each at its own chip spot', () => {
    const spots = allSpots();
    expect(spots.every((s) => parseSpot(s, 'double') !== null)).toBe(true);
    for (const s of spots) {
      const c = rouletteSpotCentre(s)!;
      expect(rouletteSpotAt(c.u, c.v, 'double'), s).toBe(s);
    }
  });

  it('maps clicks the way the printed layout reads', () => {
    // Cell centres: 1 bottom-left, 3 top-left, 36 top-right.
    expect(rouletteSpotAt(60 + 16.75, 10 + 48 * 2.5, 'single')).toBe('straight:1');
    expect(rouletteSpotAt(60 + 16.75, 10 + 24, 'single')).toBe('straight:3');
    expect(rouletteSpotAt(60 + 33.5 * 11.5, 34, 'single')).toBe('straight:36');
    // On the line between 1 and 2, and between 1 and 4; the corner of 1, 2, 4, 5.
    expect(rouletteSpotAt(76, 106, 'single')).toBe('split:1-2');
    expect(rouletteSpotAt(93.5, 130, 'single')).toBe('split:1-4');
    expect(rouletteSpotAt(93.5, 106, 'single')).toBe('corner:1');
    // The players' edge: street 1-2-3, six-line 1-6, the basket at the zero end.
    expect(rouletteSpotAt(76, 152, 'single')).toBe('street:1');
    expect(rouletteSpotAt(93.5, 152, 'single')).toBe('sixline:1');
    expect(rouletteSpotAt(61, 152, 'single')).toBe('basket');
    // The zero box splits into 00 above and 0 below on a double-zero wheel only.
    expect(rouletteSpotAt(40, 40, 'double')).toBe('straight:00');
    expect(rouletteSpotAt(40, 40, 'single')).toBe('straight:0');
    expect(rouletteSpotAt(40, 120, 'double')).toBe('straight:0');
    // Outside: columns at the far end, dozens, then the even-money row.
    expect(rouletteSpotAt(480, 30, 'single')).toBe('column:3');
    expect(rouletteSpotAt(480, 130, 'single')).toBe('column:1');
    expect(rouletteSpotAt(300, 168, 'single')).toBe('dozen:2');
    expect(rouletteSpotAt(70, 200, 'single')).toBe('low');
    expect(rouletteSpotAt(300, 200, 'single')).toBe('black');
    expect(rouletteSpotAt(450, 200, 'single')).toBe('high');
    // Off the layout.
    expect(rouletteSpotAt(5, 100, 'single')).toBeNull();
    expect(rouletteSpotAt(300, 222, 'single')).toBeNull();
  });

  it('converts between the felt and the sheet both ways', () => {
    const p = fromSheet(256, 112);
    const s = toSheet(p.x, p.z);
    expect(s.u).toBeCloseTo(256);
    expect(s.v).toBeCloseTo(112);
  });

  it('offers standard chips inside the limits, the minimum first', () => {
    expect(trayChips(5, 1000)).toEqual([5, 25, 100, 500, 1000]);
    expect(trayChips(2, 500)).toEqual([2, 5, 25, 100, 500]);
    expect(trayChips(25, 10000)).toEqual([25, 100, 500, 1000, 5000]);
  });
});
