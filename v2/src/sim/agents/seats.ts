// Seat points. Guests path to a stand cell beside an object; on arrival they
// are parked a little in from the cell centre, facing the object, so they sit
// at the cabinet or the rail rather than hovering a body-width away from it
// (the navmesh itself stops an agent radius short of every object).

import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';

const NUDGE = 0.22;
const DIRS: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** Pose for using whatever object stands next to `stand`. Prefers `objectId`'s
 *  cells when given; null when nothing is adjacent (a plain floor cell). */
export function approachPose(world: CasinoWorld, stand: Cell, objectId?: string): Pose | null {
  let best: [number, number] | null = null;
  for (const [dc, dr] of DIRS) {
    const occ = world.grid.occupantAt(stand.col + dc, stand.row + dr);
    if (occ === null) continue;
    if (objectId === undefined || occ === objectId) {
      best = [dc, dr];
      break;
    }
    best ??= [dc, dr];
  }
  if (!best) return null;
  const [dc, dr] = best;
  return {
    x: stand.col + 0.5 + dc * NUDGE,
    z: stand.row + 0.5 + dr * NUDGE,
    heading: Math.atan2(dc, dr),
  };
}
