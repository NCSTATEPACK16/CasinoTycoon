// Pre-built starting floors. A new game should open on a casino that already
// works — a lobby guests can enter, somewhere to gamble and somewhere to
// relieve themselves — so the first thing the player does is build on it,
// not lay carpet. Each scenario gets its own shell; the sandbox gets the
// most generous one.

import type { CellRect, FloorType, Zone } from '../../shared/contracts';
import { FloorPlan } from './FloorPlan';

interface Room {
  rect: CellRect;
  floor: FloorType;
  zone: Zone;
}

interface Doorway {
  /** Edge cell and orientation, as in WallSegment; `len` cells along the edge. */
  col: number;
  row: number;
  edge: 'n' | 'w';
  len: number;
}

interface Layout {
  rooms: Room[];
  /** Interior partitions as corner-to-corner wall drags (see FloorPlan.wallLine). */
  partitions: { from: { col: number; row: number }; to: { col: number; row: number } }[];
  doors: Doorway[];
  entrance: { col: number; row: number };
}

const rect = (col0: number, row0: number, col1: number, row1: number): CellRect => ({
  col0,
  row0,
  col1,
  row1,
});

// The sandbox: a 6-wide lobby on the east edge, a big gaming floor, and a
// restroom block and food court in the two western corners.
const SANDBOX: Layout = {
  rooms: [
    { rect: rect(4, 4, 33, 25), floor: 'carpet-red', zone: 'gaming' },
    { rect: rect(4, 4, 9, 9), floor: 'tile', zone: 'restrooms' },
    { rect: rect(4, 20, 9, 25), floor: 'wood', zone: 'foodCourt' },
    { rect: rect(34, 9, 39, 21), floor: 'marble', zone: 'none' },
  ],
  partitions: [
    // Restrooms: east wall and south wall.
    { from: { col: 10, row: 4 }, to: { col: 10, row: 10 } },
    { from: { col: 4, row: 10 }, to: { col: 10, row: 10 } },
    // Food court: east wall and north wall.
    { from: { col: 10, row: 20 }, to: { col: 10, row: 26 } },
    { from: { col: 4, row: 20 }, to: { col: 10, row: 20 } },
    // Lobby ↔ gaming floor.
    { from: { col: 34, row: 9 }, to: { col: 34, row: 22 } },
  ],
  doors: [
    { col: 10, row: 6, edge: 'w', len: 2 },
    { col: 10, row: 22, edge: 'w', len: 2 },
    // A wide archway so the arrival rush never queues in a doorway.
    { col: 34, row: 12, edge: 'w', len: 7 },
    // Street doors on the lot boundary behind the entrance cell.
    { col: 40, row: 14, edge: 'w', len: 3 },
  ],
  entrance: { col: 39, row: 15 },
};

// The Dusty Dime: a small room off a lobby — the run is about growing it.
const DUSTY_DIME: Layout = {
  rooms: [
    { rect: rect(20, 8, 33, 22), floor: 'carpet-blue', zone: 'gaming' },
    { rect: rect(20, 8, 24, 11), floor: 'tile', zone: 'restrooms' },
    { rect: rect(34, 11, 39, 19), floor: 'wood', zone: 'none' },
  ],
  partitions: [
    { from: { col: 25, row: 8 }, to: { col: 25, row: 12 } },
    { from: { col: 20, row: 12 }, to: { col: 25, row: 12 } },
    { from: { col: 34, row: 11 }, to: { col: 34, row: 20 } },
  ],
  doors: [
    { col: 25, row: 10, edge: 'w', len: 1 },
    { col: 34, row: 13, edge: 'w', len: 5 },
    { col: 40, row: 14, edge: 'w', len: 3 },
  ],
  entrance: { col: 39, row: 15 },
};

// The High Roller Club starts with a walled high-limit salon off the floor.
const HIGH_ROLLER: Layout = {
  ...SANDBOX,
  rooms: [...SANDBOX.rooms, { rect: rect(22, 4, 33, 10), floor: 'marble', zone: 'highLimit' }],
  partitions: [
    ...SANDBOX.partitions,
    { from: { col: 22, row: 4 }, to: { col: 22, row: 11 } },
    { from: { col: 22, row: 11 }, to: { col: 34, row: 11 } },
  ],
  doors: [...SANDBOX.doors, { col: 27, row: 11, edge: 'n', len: 2 }],
};

const LAYOUTS: Record<string, Layout> = {
  'dusty-dime': DUSTY_DIME,
  'high-roller': HIGH_ROLLER,
};

export function starterFloorPlan(scenarioId: string | null, cols: number, rows: number): FloorPlan {
  const layout = (scenarioId && LAYOUTS[scenarioId]) || SANDBOX;
  const plan = new FloorPlan(cols, rows, layout.entrance);
  for (const room of layout.rooms) {
    plan.paintFloor(room.rect, room.floor);
    plan.paintZone(room.rect, room.zone);
  }
  plan.enclose();
  for (const p of layout.partitions) {
    for (const e of FloorPlan.wallLine(p.from, p.to)) plan.setWall(e.col, e.row, e.edge, true);
  }
  for (const d of layout.doors) {
    for (let i = 0; i < d.len; i++) {
      const col = d.edge === 'n' ? d.col + i : d.col;
      const row = d.edge === 'w' ? d.row + i : d.row;
      plan.setWall(col, row, d.edge, true, true);
    }
  }
  plan.version = 0;
  return plan;
}
