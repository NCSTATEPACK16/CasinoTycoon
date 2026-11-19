import { describe, expect, it } from 'vitest';
import type { FloorPlanView, WallSegment } from '../shared/contracts';
import { CollisionWorld } from '../input/avatar/collision';
import { ARM_FLOOR, armAllowance } from './arm';

function world(walls: WallSegment[]): CollisionWorld {
  const plan: FloorPlanView = {
    cols: 20,
    rows: 20,
    floor: new Uint8Array(400),
    zone: new Uint8Array(400),
    walls,
    entrance: { col: 19, row: 10 },
  };
  const w = new CollisionWorld();
  w.rebuild(plan, [], 20, 20);
  return w;
}

/** A lobby partition: a short wall along x = 10 from z = 5 to z = 8. */
const partition = world([5, 6, 7].map((row) => ({ col: 10, row, edge: 'w' as const, door: false })));

describe('armAllowance', () => {
  it('gives the full arm in the open', () => {
    expect(armAllowance(partition, 3, 3, 0, 1, 3.4, 0.9, 0.25)).toBe(3.4);
  });

  it('catches a wall end the centre ray passes beside (the lobby partition case)', () => {
    // The avatar stands 0.15 m short of the partition's end, arm pointing across
    // its line. The centre ray slips past the end; the camera's near plane,
    // ~0.2 m to the side, would cut into the wall.
    const px = 9;
    const pz = 4.85;
    const reach = 3.4 * 0.9 + 0.25;
    expect(partition.raycastWalls(px, pz, 1, 0, reach)).toBeCloseTo(reach); // the old single ray saw nothing
    const arm = armAllowance(partition, px, pz, 1, 0, 3.4, 0.9, 0.25);
    // The wall is 1 m away: keep the clearance on the shoulder ray.
    expect(arm).toBeCloseTo((1 - 0.25) / 0.9);
  });

  it('lets the arm shrink to near the head when backed against a wall', () => {
    // Avatar 0.35 m from the wall, arm pointing straight into it.
    const arm = armAllowance(partition, 9.65, 6.5, 1, 0, 3.4, 0.9, 0.25);
    expect(arm).toBe(ARM_FLOOR);
  });

  it('accounts for pitch: a steep arm reaches less far across the floor', () => {
    const flat = armAllowance(partition, 8, 6.5, 1, 0, 3.4, 1, 0.25);
    const steep = armAllowance(partition, 8, 6.5, 1, 0, 3.4, 0.5, 0.25);
    expect(steep).toBeGreaterThan(flat);
  });
});
