import { describe, it, expect } from 'vitest';
import { gridToScreen, screenToGrid, screenToGridFloat, worldBounds } from './iso';
import { TILE_W, TILE_H, GRID_COLS, GRID_ROWS } from '../config';

describe('iso math', () => {
  it('round-trips every tile on the grid exactly', () => {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const s = gridToScreen(col, row);
        expect(screenToGrid(s.x, s.y)).toEqual({ col, row });
      }
    }
  });

  it('maps grid origin to screen origin', () => {
    expect(gridToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('steps by half-tile offsets along each grid axis', () => {
    expect(gridToScreen(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(gridToScreen(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it('snaps points inside a tile diamond to that tile', () => {
    const c = gridToScreen(5, 7);
    // Points just inside the diamond edges (diamond half-extents are W/2, H/2).
    expect(screenToGrid(c.x + TILE_W * 0.24, c.y)).toEqual({ col: 5, row: 7 });
    expect(screenToGrid(c.x - TILE_W * 0.24, c.y)).toEqual({ col: 5, row: 7 });
    expect(screenToGrid(c.x, c.y + TILE_H * 0.24)).toEqual({ col: 5, row: 7 });
    expect(screenToGrid(c.x, c.y - TILE_H * 0.24)).toEqual({ col: 5, row: 7 });
  });

  it('returns fractional coordinates from screenToGridFloat', () => {
    const between = gridToScreen(3, 3);
    // +W/4 screen-x adds +0.25 col / -0.25 row; +H/4 screen-y adds +0.25 to both.
    const f = screenToGridFloat(between.x + TILE_W / 4, between.y + TILE_H / 4);
    expect(f.col).toBeCloseTo(3.5);
    expect(f.row).toBeCloseTo(3.0);
  });

  it('computes world bounds containing every tile center', () => {
    const b = worldBounds(GRID_COLS, GRID_ROWS, 0);
    for (const [col, row] of [
      [0, 0],
      [GRID_COLS - 1, 0],
      [0, GRID_ROWS - 1],
      [GRID_COLS - 1, GRID_ROWS - 1],
    ] as const) {
      const s = gridToScreen(col, row);
      expect(s.x).toBeGreaterThanOrEqual(b.x);
      expect(s.x).toBeLessThanOrEqual(b.x + b.width);
      expect(s.y).toBeGreaterThanOrEqual(b.y);
      expect(s.y).toBeLessThanOrEqual(b.y + b.height);
    }
  });
});
