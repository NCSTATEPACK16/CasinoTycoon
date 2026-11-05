// Seat points. Guests path to a stand cell beside an object; on arrival they
// are parked at the seat the art put there — the `seats` markers in
// shared/catalog.ts, copied from the Blender heroes — facing the way the
// marker faces. Cells with no marker in reach fall back to a little in from
// the cell centre, facing the object (the navmesh itself stops an agent
// radius short of every object). Dealers stand behind the edge opposite the
// players.
//
// Only the pose comes from the art. Which cell a guest walks to is still the
// world's seat-cell enumeration, unchanged: moving those cells moves every
// trajectory, and the campaign measurements with them.

import { getObjectDef } from '../../data/objects';
import { get3D } from '../../shared/catalog';
import type { Rotation } from '../../shared/contracts';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';

const NUDGE = 0.22;
/** A marker further than this from its stand cell's centre would mean a visible
 *  jump on arrival (a stool on the far side of the table, say): that cell keeps
 *  the nudge. */
const SNAP_M = 1.05;
/** How far behind the table edge the dealer stands. */
const DEALER_BACK = 0.3;
/** Games played on your feet at a rail: their art has no stools. */
const STANDING = new Set(['craps-table', 'big-six-wheel']);
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

export interface SeatSpot {
  cell: Cell;
  pose: Pose;
}

/** A footprint-local point after `rot` clockwise quarter turns, re-anchored at the
 *  rotated footprint's min corner. Same maths as input/tools/gridMath.rotateLocal,
 *  which places the avatar on these markers; the sim can't import from input. */
function rotateLocal(x: number, z: number, facing: number, w: number, h: number, rot: Rotation) {
  let px = x;
  let pz = z;
  let pw = w;
  let ph = h;
  for (let i = 0; i < rot; i++) {
    [px, pz] = [ph - pz, px];
    [pw, ph] = [ph, pw];
  }
  return { x: px, z: pz, facing: facing - (Math.PI / 2) * rot };
}

function toWorld(
  defId: string,
  col: number,
  row: number,
  rot: Rotation,
  x: number,
  z: number,
  facing: number,
): Pose {
  const { w, h } = getObjectDef(defId)?.footprint ?? { w: 1, h: 1 };
  const p = rotateLocal(x, z, facing, w, h, rot);
  return { x: col + p.x, z: row + p.z, heading: p.facing };
}

/** A placed object's seat markers in world metres; empty without seat art. */
export function artSeats(defId: string, col: number, row: number, rot: Rotation): Pose[] {
  return (get3D(defId).seats ?? []).map((m) => toWorld(defId, col, row, rot, m.x, m.z, m.facing));
}

const reach = (c: Cell, p: Pose) => Math.hypot(c.col + 0.5 - p.x, c.row + 0.5 - p.z);

/**
 * The stool for each stand cell, in seat order: each cell in turn takes the
 * nearest marker no earlier cell took, if one is in reach; null where none is.
 * Seat 0 gets first pick, so a table's first guest always lands on art.
 */
export function fitSeats(markers: Pose[], cells: Cell[]): (Pose | null)[] {
  const taken = new Set<number>();
  return cells.map((c) => {
    let best = -1;
    let bestD = SNAP_M;
    for (let i = 0; i < markers.length; i++) {
      if (taken.has(i)) continue;
      const d = reach(c, markers[i]!);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
      }
    }
    if (best < 0) return null;
    taken.add(best);
    return markers[best]!;
  });
}

/**
 * Where a dealer stands at a dealt table (a game at least 2×2): behind the edge
 * opposite the stools, facing them. Null for anything else.
 */
export function dealerPose(defId: string, col: number, row: number, rot: Rotation): Pose | null {
  const markers = get3D(defId).seats;
  const { w, h } = getObjectDef(defId)?.footprint ?? { w: 1, h: 1 };
  if (!markers?.length || get3D(defId).game === undefined || w < 2 || h < 2) return null;
  const dx = markers.reduce((s, m) => s + m.x, 0) / markers.length - w / 2;
  const dz = markers.reduce((s, m) => s + m.z, 0) / markers.length - h / 2;
  const local =
    Math.abs(dz) >= Math.abs(dx)
      ? dz >= 0
        ? { x: w / 2, z: -DEALER_BACK, facing: 0 }
        : { x: w / 2, z: h + DEALER_BACK, facing: Math.PI }
      : dx >= 0
        ? { x: -DEALER_BACK, z: h / 2, facing: Math.PI / 2 }
        : { x: w + DEALER_BACK, z: h / 2, facing: -Math.PI / 2 };
  return toWorld(defId, col, row, rot, local.x, local.z, local.facing);
}

/** Seats a table deals to (0 for anything that isn't a seated game). */
function seatCount(world: CasinoWorld, id: string): number {
  const machine = world.machines.get(id);
  return machine && 'seatCount' in machine ? (machine.seatCount as number) : 0;
}

/** Whether guests play `defId` standing (the renderer's standplay clip) rather than seated. */
export function playsStanding(defId: string | null | undefined): boolean {
  return defId != null && STANDING.has(defId);
}

/**
 * Where a dealer stands at a table: the walkable non-seat perimeter cell
 * nearest the dealer edge, and the pose to park in. Null when the table has no
 * dealer edge or nothing near it is free (a table pushed against a wall).
 */
export function dealerSpot(world: CasinoWorld, tableId: string): SeatSpot | null {
  const po = world.state.getObject(tableId);
  if (!po) return null;
  const pose = dealerPose(po.defId, po.col, po.row, po.rot ?? 0);
  if (!pose) return null;
  let best: Cell | null = null;
  let bestD = SNAP_M;
  for (const c of world.seatCellsForTest(po).slice(seatCount(world, tableId))) {
    if (!world.grid.isWalkable(c.col, c.row)) continue;
    const d = reach(c, pose);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = c;
    }
  }
  return best ? { cell: best, pose } : null;
}

/** The art's seat for a guest standing at `stand` to use `objectId`, if any. */
function artPose(world: CasinoWorld, stand: Cell, objectId: string): Pose | null {
  const po = world.state.getObject(objectId);
  if (!po) return null;
  const markers = artSeats(po.defId, po.col, po.row, po.rot ?? 0);
  if (!markers.length) return null;
  const seats = seatCount(world, objectId);
  if (seats > 0) {
    // A seated table: stools are dealt out over its seat cells in seat order,
    // so two guests at one table never share a stool.
    const cells = world.seatCellsForTest(po).slice(0, seats);
    const i = cells.findIndex((c) => c.col === stand.col && c.row === stand.row);
    return i < 0 ? null : fitSeats(markers, cells)[i]!;
  }
  return fitSeats(markers, [stand])[0]!;
}

/** Pose for using whatever object stands next to `stand`. Prefers `objectId`'s
 *  cells when given; null when nothing is adjacent (a plain floor cell). */
export function approachPose(world: CasinoWorld, stand: Cell, objectId?: string): Pose | null {
  if (objectId !== undefined) {
    const art = artPose(world, stand, objectId);
    if (art) return art;
  }
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
