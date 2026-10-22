// Adapts the world's floor plan and occupancy grid to what the baker reads.

import type { FloorPlan } from '../floor/FloorPlan';
import type { IsoGrid } from '../grid/IsoGrid';
import type { NavSource } from './NavBaker';

export function floorNavSource(plan: FloorPlan, grid: IsoGrid | null): NavSource {
  return {
    cols: plan.cols,
    rows: plan.rows,
    walkable: (col, row) =>
      plan.isFloored(col, row) && (grid === null || grid.occupantAt(col, row) === null),
    // Zone index + 1: Recast reserves area 0 for "not walkable".
    area: (col, row) => plan.zone[row * plan.cols + col]! + 1,
    solidWall: (col, row, edge) => {
      const w = plan.wallAt(col, row, edge);
      return w !== null && !w.door;
    },
  };
}
