// B6: appeal. Decor and good floors make the cells around them pleasant;
// guests standing there drift happier, games there draw more players, and the
// floor's average feeds the rating's decor term (which replaced the old
// signage sum and its flat cap).
//
// Everything here is pure: sources in, a field out. The world rebuilds the
// field when the floor or its objects change (see CasinoWorld.appeal).
//
// The shape:
//   - A source gives `strength` on its own footprint, falling off linearly to
//     nothing at `radius` cells from the footprint's edge.
//   - A cell sums every source's share plus its floor's prestige, then
//     saturates: appeal = cap · (1 − e^(−sum/cap)). The first piece of decor
//     counts nearly in full; a second fountain beside the first adds less,
//     and no pile of statues takes a cell past `cap`.
//   - The rating term saturates the same way over the floor's mean appeal, so
//     the first few pieces matter and a floor reaches most of the ceiling
//     long before it is wall-to-wall decor.

import { APPEAL_BALANCE } from '../data/balance';
import { getObjectDef } from '../data/objects';
import type { FloorType } from '../shared/contracts';

export interface AppealSource {
  col: number;
  row: number;
  w: number;
  h: number;
  strength: number;
  radius: number;
}

/** Distance in cells from a cell's centre to the nearest point of a source's
 *  footprint; 0 on the footprint itself. */
export function distanceToSource(s: AppealSource, col: number, row: number): number {
  const cx = col + 0.5;
  const cz = row + 0.5;
  const dx = Math.max(s.col - cx, 0, cx - (s.col + s.w));
  const dz = Math.max(s.row - cz, 0, cz - (s.row + s.h));
  return Math.hypot(dx, dz);
}

/** One source's raw share at a cell: full strength on the footprint, linear
 *  falloff to 0 at `radius` cells out. */
export function sourceShare(s: AppealSource, col: number, row: number): number {
  const d = distanceToSource(s, col, row);
  if (d >= s.radius) return 0;
  return s.strength * (1 - d / s.radius);
}

/** Diminishing returns: the raw sum at a cell mapped onto 0..cap. */
export function saturate(sum: number, cap: number = APPEAL_BALANCE.cellCap): number {
  if (sum <= 0) return 0;
  return cap * (1 - Math.exp(-sum / cap));
}

/** The rating's decor term for a floor's mean appeal (0..ratingMax). */
export function decorRatingTerm(meanAppeal: number): number {
  const b = APPEAL_BALANCE;
  if (meanAppeal <= 0) return 0;
  return b.ratingMax * (1 - Math.exp(-meanAppeal / b.ratingScale));
}

/** The appeal an object def radiates, or null if it radiates none. */
export function appealOf(defId: string): { strength: number; radius: number } | null {
  if (!getObjectDef(defId)) return null;
  return APPEAL_BALANCE.items[defId] ?? null;
}

/** What a floor finish adds to the cells it covers before saturation. */
export function floorPrestige(floor: FloorType): number {
  return APPEAL_BALANCE.floorPrestige[floor] ?? 0;
}

/** Cells covered by floor, with what lies on them, as the field reads them. */
export interface AppealFloor {
  cols: number;
  rows: number;
  floorAt(col: number, row: number): FloorType;
}

/**
 * The appeal of every cell, 0..cellCap, row-major. Cells with no floor are 0
 * and don't count toward the mean (a big empty lot is not an ugly casino).
 */
export class AppealField {
  readonly cols: number;
  readonly rows: number;
  readonly values: Float32Array;
  /** Mean over floored cells; 0 for a floor with none. */
  readonly mean: number;
  readonly flooredCells: number;

  constructor(floor: AppealFloor, sources: readonly AppealSource[]) {
    const { cols, rows } = floor;
    this.cols = cols;
    this.rows = rows;
    const raw = new Float32Array(cols * rows);
    for (const s of sources) {
      if (s.strength <= 0 || s.radius <= 0) continue;
      const reach = Math.ceil(s.radius);
      const c0 = Math.max(0, s.col - reach);
      const c1 = Math.min(cols - 1, s.col + s.w - 1 + reach);
      const r0 = Math.max(0, s.row - reach);
      const r1 = Math.min(rows - 1, s.row + s.h - 1 + reach);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) raw[r * cols + c]! += sourceShare(s, c, r);
    }
    let sum = 0;
    let n = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const f = floor.floorAt(c, r);
        if (f === 'none') {
          raw[i] = 0;
          continue;
        }
        raw[i] = saturate(raw[i]! + floorPrestige(f));
        sum += raw[i]!;
        n++;
      }
    this.values = raw;
    this.flooredCells = n;
    this.mean = n ? sum / n : 0;
  }

  at(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.values[row * this.cols + col]!;
  }

  /** Mean appeal over a rectangle's cells (a game's footprint). */
  meanOver(col: number, row: number, w: number, h: number): number {
    let sum = 0;
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) sum += this.at(c, r);
    return sum / Math.max(1, w * h);
  }

  get ratingTerm(): number {
    return decorRatingTerm(this.mean);
  }
}
