import { describe, expect, it } from 'vitest';
import { sparkPath } from './Sparkline';
import { cascadeSpot, freeSpot } from './WindowManager';

describe('window placement', () => {
  it('puts the first window in the top-left corner', () => {
    expect(freeSpot(1000, 600, 300, 400, [])).toEqual({ x: 8, y: 8 });
  });

  it('puts the next window beside the first, clear of it', () => {
    const first = { x: 8, y: 8, r: 308, b: 408 };
    expect(freeSpot(1000, 600, 300, 400, [first])).toEqual({ x: 316, y: 8 });
  });

  it('steps clear of Settings on the left too', () => {
    const settings = { x: 8, y: 8, r: 300, b: 500 };
    const spot = freeSpot(1000, 600, 300, 400, [settings])!;
    expect(spot.x).toBeGreaterThanOrEqual(300);
  });

  it('goes below a row when the row is full', () => {
    const a = { x: 8, y: 8, r: 308, b: 208 };
    const b = { x: 316, y: 8, r: 616, b: 208 };
    expect(freeSpot(620, 600, 300, 200, [a, b])).toEqual({ x: 8, y: 216 });
  });

  it('returns null when nothing is free, and the cascade steps from the last window', () => {
    const big = { x: 0, y: 0, r: 1000, b: 600 };
    expect(freeSpot(1000, 600, 300, 400, [big])).toBeNull();
    expect(cascadeSpot(1000, 600, 300, { x: 8, y: 8 })).toEqual({ x: 36, y: 36 });
    expect(cascadeSpot(1000, 600, 300, null)).toEqual({ x: 8, y: 8 });
  });

  it('wraps the cascade back to the corner at the layer edges', () => {
    expect(cascadeSpot(1000, 600, 300, { x: 690, y: 500 })).toEqual({ x: 8, y: 8 });
  });
});

describe('sparkPath', () => {
  it('needs two points', () => {
    expect(sparkPath([])).toBe('');
    expect(sparkPath([3])).toBe('');
  });

  it('runs left to right with the highest value at the top', () => {
    expect(sparkPath([0, 10], 0, 10)).toBe('M0.00,30.00 L100.00,0.00');
  });

  it('draws a flat series without dividing by zero', () => {
    expect(sparkPath([5, 5, 5])).not.toContain('NaN');
  });
});
