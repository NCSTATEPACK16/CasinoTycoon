// Spreading guests over the sides of a service object. v1's findService hands
// every guest the same first free cell, which on a grid was harmless — guests
// shared tiles — but on a crowd it is a scrum at one corner of the restroom
// block. Here each guest takes the least-used side, nearest first.

import { footprintOf } from '../build';
import type { Guest } from '../entities/Guest';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';
import { AI } from './aiBalance';

export const standKey = (c: Cell) => `${c.col},${c.row}`;

/** Walkable cells sharing an edge with the object's footprint. */
export function sideCells(world: CasinoWorld, objectId: string): Cell[] {
  const po = world.state.getObject(objectId);
  if (!po) return [];
  const { w, h } = footprintOf(po.defId, po.rot);
  const out: Cell[] = [];
  const push = (col: number, row: number) => {
    if (world.grid.isWalkable(col, row)) out.push({ col, row });
  };
  for (let i = 0; i < w; i++) {
    push(po.col + i, po.row - 1);
    push(po.col + i, po.row + h);
  }
  for (let i = 0; i < h; i++) {
    push(po.col - 1, po.row + i);
    push(po.col + w, po.row + i);
  }
  return out;
}

/**
 * The best stand among these objects for a guest at `from`: fewest other
 * guests already using or heading to it, then nearest. Null when every side
 * is at AI.serviceStandCap.
 */
export function spreadStand(
  world: CasinoWorld,
  from: Cell,
  objectIds: string[],
  self: Guest,
): { objectId: string; stand: Cell } | null {
  const load = new Map<string, number>();
  for (const g of world.guests.values()) {
    if (g !== self && g.serviceStand) load.set(g.serviceStand, (load.get(g.serviceStand) ?? 0) + 1);
  }
  let best: { objectId: string; stand: Cell } | null = null;
  let bestLoad = Infinity;
  let bestDist = Infinity;
  for (const id of objectIds) {
    for (const c of sideCells(world, id)) {
      const n = load.get(standKey(c)) ?? 0;
      const d = Math.abs(c.col - from.col) + Math.abs(c.row - from.row);
      if (n < bestLoad || (n === bestLoad && d < bestDist)) {
        [best, bestLoad, bestDist] = [{ objectId: id, stand: c }, n, d];
      }
    }
  }
  // Every side already has its fill: the service is full, and the guest is
  // better off doing something else than joining a scrum at the door.
  return bestLoad < AI.serviceStandCap ? best : null;
}
