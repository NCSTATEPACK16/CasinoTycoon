// The third-person spring arm's length (A12 fix). It used to cast one ray
// down the arm's centre line and never shorten the arm below 0.7 m. Near a
// lobby partition, a ray at a grazing angle passed beside the wall while the
// camera's near plane, a few cm to the side, went through it. With the avatar
// backed against a wall, the 0.7 m floor put the camera behind the wall.
// This casts three parallel rays (centre and both shoulders, a near-plane
// width apart), keeps clear of the wall on the shortest one, and lets the arm
// shrink to near the head.

export interface WallCaster {
  raycastWalls(px: number, pz: number, dx: number, dz: number, maxDist: number): number;
}

/** Half the width of the camera's near-plane footprint, plus a margin. */
export const ARM_SHOULDER = 0.22;
/** Shortest arm: just behind the head; the view is then near first person. */
export const ARM_FLOOR = 0.3;

/** Longest arm (m, along the arm) the walls allow, from the avatar at (px, pz)
 *  toward (dx, dz) (unit, ground plane), with the arm pitched at `cosPitch`. */
export function armAllowance(
  walls: WallCaster,
  px: number,
  pz: number,
  dx: number,
  dz: number,
  length: number,
  cosPitch: number,
  clearance: number,
): number {
  const reach = length * cosPitch + clearance;
  // Shoulder rays start beside the avatar, offset perpendicular to the arm.
  const sx = -dz * ARM_SHOULDER;
  const sz = dx * ARM_SHOULDER;
  const free = Math.min(
    walls.raycastWalls(px, pz, dx, dz, reach),
    walls.raycastWalls(px + sx, pz + sz, dx, dz, reach),
    walls.raycastWalls(px - sx, pz - sz, dx, dz, reach),
  );
  return Math.max(ARM_FLOOR, Math.min(length, (free - clearance) / Math.max(cosPitch, 0.2)));
}
