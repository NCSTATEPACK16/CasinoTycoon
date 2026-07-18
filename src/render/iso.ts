import { TILE_W, TILE_H, GRID_COLS, GRID_ROWS } from '../config';

// 2:1 isometric diamond math. Pure functions (no Phaser) so they are unit-testable,
// but they live in render/ because grid↔screen conversion is a presentation concern.

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GridPoint {
  col: number;
  row: number;
}

/** Screen position of the CENTER of tile (col,row). Grid origin (0,0) maps to screen (0,0). */
export function gridToScreen(col: number, row: number): ScreenPoint {
  return {
    x: ((col - row) * TILE_W) / 2,
    y: ((col + row) * TILE_H) / 2,
  };
}

/** Exact (fractional) grid coordinates for a world-space screen point. */
export function screenToGridFloat(x: number, y: number): { col: number; row: number } {
  return {
    col: x / TILE_W + y / TILE_H,
    row: y / TILE_H - x / TILE_W,
  };
}

/** Nearest tile under a world-space screen point (may be out of grid bounds — caller checks). */
export function screenToGrid(x: number, y: number): GridPoint {
  const f = screenToGridFloat(x, y);
  return { col: Math.round(f.col), row: Math.round(f.row) };
}

/** Axis-aligned world-space bounds of the whole diamond map, with optional padding. */
export function worldBounds(
  cols: number = GRID_COLS,
  rows: number = GRID_ROWS,
  pad: number = TILE_W,
): { x: number; y: number; width: number; height: number } {
  const left = gridToScreen(0, rows - 1).x - TILE_W / 2;
  const right = gridToScreen(cols - 1, 0).x + TILE_W / 2;
  const top = gridToScreen(0, 0).y - TILE_H / 2;
  const bottom = gridToScreen(cols - 1, rows - 1).y + TILE_H / 2;
  return {
    x: left - pad,
    y: top - pad,
    width: right - left + pad * 2,
    height: bottom - top + pad * 2,
  };
}
