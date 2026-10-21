// Queues at full tables. One book per world, held beside it rather than on it
// so the world needs no new state: guests wait in arrival order behind a
// table and the head of the line takes the next free seat.

import { footprintOf } from '../build';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';

const books = new WeakMap<CasinoWorld, Map<string, string[]>>();

function book(world: CasinoWorld): Map<string, string[]> {
  let b = books.get(world);
  if (!b) books.set(world, (b = new Map()));
  return b;
}

/** Join (idempotent); returns the 0-based place in line. */
export function joinQueue(world: CasinoWorld, machineId: string, guestId: string): number {
  const b = book(world);
  const line = b.get(machineId) ?? [];
  if (!line.includes(guestId)) line.push(guestId);
  b.set(machineId, line);
  return line.indexOf(guestId);
}

export function leaveQueue(world: CasinoWorld, machineId: string, guestId: string): void {
  const line = book(world).get(machineId);
  if (!line) return;
  const i = line.indexOf(guestId);
  if (i !== -1) line.splice(i, 1);
}

export function queuePlace(world: CasinoWorld, machineId: string, guestId: string): number {
  return book(world).get(machineId)?.indexOf(guestId) ?? -1;
}

export function queueLength(world: CasinoWorld, machineId: string): number {
  // Lazily drop guests who left the world without leaving the line.
  const line = book(world).get(machineId);
  if (!line) return 0;
  for (let i = line.length - 1; i >= 0; i--) if (!world.guests.has(line[i]!)) line.splice(i, 1);
  return line.length;
}

/**
 * Where the n-th guest in line stands: walkable cells on the ring two cells
 * out from the footprint, so the line never blocks the seats themselves.
 */
export function queueSpot(world: CasinoWorld, machineId: string, place: number): Cell | null {
  const po = world.state.getObject(machineId);
  if (!po) return null;
  const { w, h } = footprintOf(po.defId, po.rot);
  const ring: Cell[] = [];
  for (let col = po.col - 2; col <= po.col + w + 1; col++) {
    for (let row = po.row - 2; row <= po.row + h + 1; row++) {
      const edge =
        col === po.col - 2 ||
        col === po.col + w + 1 ||
        row === po.row - 2 ||
        row === po.row + h + 1;
      if (edge && world.grid.isWalkable(col, row)) ring.push({ col, row });
    }
  }
  if (ring.length === 0) return null;
  return ring[place % ring.length]!;
}
