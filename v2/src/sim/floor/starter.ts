// Pre-built starting floors. A new game should open on a casino that already
// works — a lobby guests can enter, somewhere to gamble and somewhere to
// relieve themselves — so the first thing the player does is build on it,
// not lay carpet. Each scenario gets its own shell, drawn for its lot; the
// sandbox gets the most generous one, on the biggest lot.

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
  /** The lot this layout was drawn for. */
  lot: { cols: number; rows: number };
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

// The standard 40×30 shell (the default boot floor, and any campaign without
// its own): a 6-wide lobby on the east edge, a big gaming floor, and a
// restroom block and food court in the two western corners.
const STANDARD: Layout = {
  lot: { cols: 40, rows: 30 },
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
  lot: { cols: 40, rows: 30 },
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
  ...STANDARD,
  rooms: [...STANDARD.rooms, { rect: rect(22, 4, 33, 10), floor: 'marble', zone: 'highLimit' }],
  partitions: [
    ...STANDARD.partitions,
    { from: { col: 22, row: 4 }, to: { col: 22, row: 11 } },
    { from: { col: 22, row: 11 }, to: { col: 34, row: 11 } },
  ],
  doors: [...STANDARD.doors, { col: 27, row: 11, edge: 'n', len: 2 }],
};

// Sandbox, on a 96×64 lot (SPEC §9.7 wants room for 2,000 objects): an 80×56
// gaming floor with a walled high-limit salon in its north-east corner, two
// restroom blocks and a food court off it, a lobby on the street, and two
// back-of-house rooms either side of the lobby.
const SANDBOX: Layout = {
  lot: { cols: 96, rows: 64 },
  rooms: [
    { rect: rect(4, 4, 83, 59), floor: 'carpet-red', zone: 'gaming' },
    { rect: rect(58, 4, 83, 17), floor: 'marble', zone: 'highLimit' },
    { rect: rect(4, 4, 13, 13), floor: 'tile', zone: 'restrooms' },
    { rect: rect(44, 50, 53, 59), floor: 'tile', zone: 'restrooms' },
    { rect: rect(4, 44, 23, 59), floor: 'wood', zone: 'foodCourt' },
    { rect: rect(84, 24, 95, 40), floor: 'marble', zone: 'none' },
    { rect: rect(84, 4, 95, 19), floor: 'tile', zone: 'backOfHouse' },
    { rect: rect(84, 45, 95, 59), floor: 'tile', zone: 'backOfHouse' },
  ],
  partitions: [
    // The gaming floor's east wall: lobby and both back-of-house rooms.
    { from: { col: 84, row: 4 }, to: { col: 84, row: 60 } },
    // High-limit salon: west and south walls.
    { from: { col: 58, row: 4 }, to: { col: 58, row: 18 } },
    { from: { col: 58, row: 18 }, to: { col: 84, row: 18 } },
    // North-west restrooms: east and south walls.
    { from: { col: 14, row: 4 }, to: { col: 14, row: 14 } },
    { from: { col: 4, row: 14 }, to: { col: 14, row: 14 } },
    // South restrooms: three walls, open to the lot edge behind.
    { from: { col: 44, row: 50 }, to: { col: 44, row: 60 } },
    { from: { col: 54, row: 50 }, to: { col: 54, row: 60 } },
    { from: { col: 44, row: 50 }, to: { col: 54, row: 50 } },
    // Food court: east and north walls.
    { from: { col: 24, row: 44 }, to: { col: 24, row: 60 } },
    { from: { col: 4, row: 44 }, to: { col: 24, row: 44 } },
  ],
  doors: [
    // An 11-wide archway from the lobby so a 500-guest rush never queues.
    { col: 84, row: 27, edge: 'w', len: 11 },
    { col: 84, row: 10, edge: 'w', len: 2 },
    { col: 84, row: 51, edge: 'w', len: 2 },
    { col: 69, row: 18, edge: 'n', len: 4 },
    { col: 14, row: 8, edge: 'w', len: 2 },
    { col: 48, row: 50, edge: 'n', len: 2 },
    { col: 24, row: 50, edge: 'w', len: 4 },
    { col: 12, row: 44, edge: 'n', len: 4 },
    // Street doors on the lot boundary behind the entrance cell.
    { col: 96, row: 30, edge: 'w', len: 5 },
  ],
  entrance: { col: 95, row: 32 },
};

const LAYOUTS: Record<string, Layout> = {
  'dusty-dime': DUSTY_DIME,
  'high-roller': HIGH_ROLLER,
  sandbox: SANDBOX,
};

/** A lot no layout was drawn for: one walled gaming hall with a two-cell
 *  margin, and street doors behind the usual east-edge entrance. */
function plainHall(cols: number, rows: number): Layout {
  const mid = Math.floor(rows / 2);
  return {
    lot: { cols, rows },
    rooms: [{ rect: rect(2, 2, cols - 1, rows - 3), floor: 'carpet-red', zone: 'gaming' }],
    partitions: [],
    doors: [{ col: cols, row: mid - 1, edge: 'w', len: 3 }],
    entrance: { col: cols - 1, row: mid },
  };
}

export function starterFloorPlan(scenarioId: string | null, cols: number, rows: number): FloorPlan {
  const named = (scenarioId && LAYOUTS[scenarioId]) || STANDARD;
  const fits = named.lot.cols === cols && named.lot.rows === rows;
  const layout = fits ? named : plainHall(cols, rows);
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
