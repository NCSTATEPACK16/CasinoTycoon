// Deterministic floor-brightness variant per cell: the same (col, row)
// always picks the same variant, stable across pans, reloads, and saves —
// never Math.random() at render time (see PLAN.md P10).

export const TILE_VARIANT_COUNT = 4;

/** A cheap, well-distributed integer hash (xorshift-style mix, no external deps). */
export function tileVariantIndex(col: number, row: number): number {
  let h = (col * 374761393 + row * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) | 0;
  return Math.abs(h) % TILE_VARIANT_COUNT;
}
