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

// B8 — the career scenarios' own shells.

// Lucky Strike Lanes: a converted bowling alley on a 32×24 lot — one long
// hall, a restroom and a snack counter at the far end, a lobby on the street.
const LUCKY_STRIKE: Layout = {
  lot: { cols: 32, rows: 24 },
  rooms: [
    { rect: rect(2, 3, 24, 20), floor: 'carpet-blue', zone: 'gaming' },
    { rect: rect(2, 3, 6, 7), floor: 'tile', zone: 'restrooms' },
    { rect: rect(2, 16, 6, 20), floor: 'wood', zone: 'foodCourt' },
    { rect: rect(25, 8, 31, 15), floor: 'marble', zone: 'none' },
  ],
  partitions: [
    { from: { col: 7, row: 3 }, to: { col: 7, row: 8 } },
    { from: { col: 2, row: 8 }, to: { col: 7, row: 8 } },
    { from: { col: 7, row: 16 }, to: { col: 7, row: 21 } },
    { from: { col: 2, row: 16 }, to: { col: 7, row: 16 } },
    { from: { col: 25, row: 3 }, to: { col: 25, row: 21 } },
  ],
  doors: [
    { col: 7, row: 5, edge: 'w', len: 2 },
    { col: 7, row: 18, edge: 'w', len: 2 },
    { col: 25, row: 9, edge: 'w', len: 6 },
    { col: 32, row: 10, edge: 'w', len: 3 },
  ],
  entrance: { col: 31, row: 11 },
};

// The Velvet Rope: the standard shell with a roped-off salon in the south.
const VELVET_ROPE: Layout = {
  ...STANDARD,
  rooms: [...STANDARD.rooms, { rect: rect(20, 19, 33, 25), floor: 'marble', zone: 'highLimit' }],
  partitions: [
    ...STANDARD.partitions,
    { from: { col: 20, row: 18 }, to: { col: 20, row: 26 } },
    { from: { col: 20, row: 18 }, to: { col: 34, row: 18 } },
  ],
  doors: [...STANDARD.doors, { col: 26, row: 18, edge: 'n', len: 3 }],
};

// House Rules: a slot arcade on a 36×26 lot.
const HOUSE_RULES: Layout = {
  lot: { cols: 36, rows: 26 },
  rooms: [
    { rect: rect(3, 3, 28, 22), floor: 'carpet-blue', zone: 'gaming' },
    { rect: rect(3, 3, 7, 7), floor: 'tile', zone: 'restrooms' },
    { rect: rect(3, 18, 7, 22), floor: 'wood', zone: 'foodCourt' },
    { rect: rect(29, 9, 35, 16), floor: 'marble', zone: 'none' },
  ],
  partitions: [
    { from: { col: 8, row: 3 }, to: { col: 8, row: 8 } },
    { from: { col: 3, row: 8 }, to: { col: 8, row: 8 } },
    { from: { col: 8, row: 18 }, to: { col: 8, row: 23 } },
    { from: { col: 3, row: 18 }, to: { col: 8, row: 18 } },
    { from: { col: 29, row: 3 }, to: { col: 29, row: 23 } },
  ],
  doors: [
    { col: 8, row: 5, edge: 'w', len: 2 },
    { col: 8, row: 20, edge: 'w', len: 2 },
    { col: 29, row: 10, edge: 'w', len: 6 },
    { col: 36, row: 11, edge: 'w', len: 3 },
  ],
  entrance: { col: 35, row: 12 },
};

// The Salon: a 48×32 floor with an empty marble room in the north-east,
// walled and floored but not zoned. Making it a high-limit room is the job.
const THE_SALON: Layout = {
  lot: { cols: 48, rows: 32 },
  rooms: [
    { rect: rect(4, 4, 39, 27), floor: 'carpet-red', zone: 'gaming' },
    { rect: rect(4, 4, 9, 9), floor: 'tile', zone: 'restrooms' },
    { rect: rect(4, 22, 9, 27), floor: 'wood', zone: 'foodCourt' },
    { rect: rect(26, 4, 39, 11), floor: 'marble', zone: 'none' },
    { rect: rect(40, 10, 47, 21), floor: 'marble', zone: 'none' },
  ],
  partitions: [
    { from: { col: 10, row: 4 }, to: { col: 10, row: 10 } },
    { from: { col: 4, row: 10 }, to: { col: 10, row: 10 } },
    { from: { col: 10, row: 22 }, to: { col: 10, row: 28 } },
    { from: { col: 4, row: 22 }, to: { col: 10, row: 22 } },
    { from: { col: 26, row: 4 }, to: { col: 26, row: 12 } },
    { from: { col: 26, row: 12 }, to: { col: 40, row: 12 } },
    { from: { col: 40, row: 4 }, to: { col: 40, row: 28 } },
  ],
  doors: [
    { col: 10, row: 6, edge: 'w', len: 2 },
    { col: 10, row: 24, edge: 'w', len: 2 },
    { col: 31, row: 12, edge: 'n', len: 3 },
    { col: 40, row: 13, edge: 'w', len: 7 },
    { col: 48, row: 14, edge: 'w', len: 3 },
  ],
  entrance: { col: 47, row: 15 },
};

// The Strip: the flagship, on a 64×44 lot — a big floor, a high-limit salon,
// two restroom blocks and a food court.
const THE_STRIP: Layout = {
  lot: { cols: 64, rows: 44 },
  rooms: [
    { rect: rect(4, 4, 51, 39), floor: 'carpet-red', zone: 'gaming' },
    { rect: rect(36, 4, 51, 13), floor: 'marble', zone: 'highLimit' },
    { rect: rect(4, 4, 11, 11), floor: 'tile', zone: 'restrooms' },
    { rect: rect(24, 34, 31, 39), floor: 'tile', zone: 'restrooms' },
    { rect: rect(4, 30, 15, 39), floor: 'wood', zone: 'foodCourt' },
    { rect: rect(52, 15, 63, 28), floor: 'marble', zone: 'none' },
  ],
  partitions: [
    { from: { col: 36, row: 4 }, to: { col: 36, row: 14 } },
    { from: { col: 36, row: 14 }, to: { col: 52, row: 14 } },
    { from: { col: 12, row: 4 }, to: { col: 12, row: 12 } },
    { from: { col: 4, row: 12 }, to: { col: 12, row: 12 } },
    { from: { col: 24, row: 34 }, to: { col: 24, row: 40 } },
    { from: { col: 32, row: 34 }, to: { col: 32, row: 40 } },
    { from: { col: 24, row: 34 }, to: { col: 32, row: 34 } },
    { from: { col: 16, row: 30 }, to: { col: 16, row: 40 } },
    { from: { col: 4, row: 30 }, to: { col: 16, row: 30 } },
    { from: { col: 52, row: 4 }, to: { col: 52, row: 40 } },
  ],
  doors: [
    { col: 42, row: 14, edge: 'n', len: 4 },
    { col: 12, row: 7, edge: 'w', len: 2 },
    { col: 27, row: 34, edge: 'n', len: 2 },
    { col: 16, row: 33, edge: 'w', len: 4 },
    { col: 52, row: 18, edge: 'w', len: 8 },
    { col: 64, row: 20, edge: 'w', len: 4 },
  ],
  entrance: { col: 63, row: 22 },
};

// B12: Opening Night. The standard shell, except that the east half of the
// gaming hall has carpet and no zone yet: the first lesson is zoning it.
const OPENING_NIGHT: Layout = {
  ...STANDARD,
  rooms: [
    STANDARD.rooms[0]!,
    { rect: rect(20, 4, 33, 25), floor: 'carpet-red', zone: 'none' },
    ...STANDARD.rooms.slice(1),
  ],
};

const LAYOUTS: Record<string, Layout> = {
  'opening-night': OPENING_NIGHT,
  'dusty-dime': DUSTY_DIME,
  'high-roller': HIGH_ROLLER,
  sandbox: SANDBOX,
  'lucky-strike': LUCKY_STRIKE,
  'velvet-rope': VELVET_ROPE,
  'house-rules': HOUSE_RULES,
  'the-salon': THE_SALON,
  'the-strip': THE_STRIP,
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
