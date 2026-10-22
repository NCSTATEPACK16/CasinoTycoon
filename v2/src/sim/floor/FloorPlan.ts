// The lot: what is floored, how it is zoned, and where the walls and doors
// run. Pure data with no knowledge of objects or money — build.ts charges for
// changes and the world decides what a change invalidates (grid, navmesh,
// the renderer's floor chunks). See docs/SPEC.md §7.

import {
  FLOOR_TYPES,
  ZONES,
  type CellRect,
  type FloorPlanView,
  type FloorType,
  type WallSegment,
  type Zone,
} from '../../shared/contracts';

export type Edge = 'n' | 'w';

export interface FloorPlanJSON {
  cols: number;
  rows: number;
  /** FLOOR_TYPES indices, row-major. Plain arrays so the save stays JSON. */
  floor: number[];
  zone: number[];
  walls: WallSegment[];
  entrance: { col: number; row: number };
  strictZones: boolean;
}

const FLOOR_INDEX = new Map<FloorType, number>(FLOOR_TYPES.map((f, i) => [f, i]));
const ZONE_INDEX = new Map<Zone, number>(ZONES.map((z, i) => [z, i]));

export function zoneIndex(zone: Zone): number {
  return ZONE_INDEX.get(zone) ?? 0;
}

/** Normalise a rect whose corners may come in either order, clipped to the lot. */
export function clipRect(rect: CellRect, cols: number, rows: number): CellRect | null {
  const col0 = Math.max(0, Math.min(rect.col0, rect.col1));
  const col1 = Math.min(cols - 1, Math.max(rect.col0, rect.col1));
  const row0 = Math.max(0, Math.min(rect.row0, rect.row1));
  const row1 = Math.min(rows - 1, Math.max(rect.row0, rect.row1));
  if (col0 > col1 || row0 > row1) return null;
  return { col0, row0, col1, row1 };
}

export class FloorPlan {
  readonly cols: number;
  readonly rows: number;
  readonly floor: Uint8Array;
  readonly zone: Uint8Array;
  /** Edge key → segment. An edge has one owner (see WallSegment), so the key is
   *  unique per physical edge, including the south and east lot boundary. */
  private walls = new Map<number, WallSegment>();
  entrance: { col: number; row: number };
  /**
   * Whether placement enforces catalog zones. The ported v1 suite builds on an
   * unzoned open lot, and a v1 casino had no zones at all; a v2 sandbox or
   * scenario always starts strict.
   */
  strictZones: boolean;
  /** Bumped on every mutation that changes what the floor looks like or
   *  where agents can walk — the world mirrors it into the snapshot. */
  version = 0;

  constructor(cols: number, rows: number, entrance: { col: number; row: number }) {
    this.cols = cols;
    this.rows = rows;
    this.floor = new Uint8Array(cols * rows);
    this.zone = new Uint8Array(cols * rows);
    this.entrance = { ...entrance };
    this.strictZones = true;
  }

  /** Fully floored, unzoned, wall-free lot — v1's world, where every cell was floor. */
  static open(cols: number, rows: number, entrance: { col: number; row: number }): FloorPlan {
    const plan = new FloorPlan(cols, rows, entrance);
    plan.floor.fill(FLOOR_INDEX.get('carpet-red')!);
    plan.strictZones = false;
    return plan;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  floorAt(col: number, row: number): FloorType {
    return this.inBounds(col, row) ? FLOOR_TYPES[this.floor[row * this.cols + col]!]! : 'none';
  }

  zoneAt(col: number, row: number): Zone {
    return this.inBounds(col, row) ? ZONES[this.zone[row * this.cols + col]!]! : 'none';
  }

  isFloored(col: number, row: number): boolean {
    return this.inBounds(col, row) && this.floor[row * this.cols + col] !== 0;
  }

  /** Paint a rect; returns the cells that actually changed (so callers charge only those).
   *  `skip` vetoes individual cells — build.ts uses it to keep floor under objects. */
  paintFloor(
    rect: CellRect,
    type: FloorType,
    skip?: (col: number, row: number) => boolean,
  ): { col: number; row: number }[] {
    const r = clipRect(rect, this.cols, this.rows);
    const value = FLOOR_INDEX.get(type);
    if (!r || value === undefined) return [];
    const changed: { col: number; row: number }[] = [];
    for (let row = r.row0; row <= r.row1; row++) {
      for (let col = r.col0; col <= r.col1; col++) {
        const i = row * this.cols + col;
        if (this.floor[i] === value || skip?.(col, row)) continue;
        this.floor[i] = value;
        // A cell without floor cannot keep a zone: zoning is a property of
        // usable space, and a stale zone would resurface the moment the cell
        // is re-floored with a different intent.
        if (value === 0) this.zone[i] = 0;
        changed.push({ col, row });
      }
    }
    if (changed.length) this.version++;
    return changed;
  }

  /** Zone only floored cells — painting a zone over the void is meaningless. */
  paintZone(
    rect: CellRect,
    zone: Zone,
    skip?: (col: number, row: number) => boolean,
  ): { col: number; row: number }[] {
    const r = clipRect(rect, this.cols, this.rows);
    const value = ZONE_INDEX.get(zone);
    if (!r || value === undefined) return [];
    const changed: { col: number; row: number }[] = [];
    for (let row = r.row0; row <= r.row1; row++) {
      for (let col = r.col0; col <= r.col1; col++) {
        const i = row * this.cols + col;
        if (this.floor[i] === 0 || this.zone[i] === value || skip?.(col, row)) continue;
        this.zone[i] = value;
        changed.push({ col, row });
      }
    }
    if (changed.length) this.version++;
    return changed;
  }

  private edgeKey(col: number, row: number, edge: Edge): number {
    return (row * (this.cols + 1) + col) * 2 + (edge === 'w' ? 1 : 0);
  }

  /** 'n' edges exist for row 0..rows (row === rows is the south boundary),
   *  'w' edges for col 0..cols — the far boundaries have no cell of their own. */
  edgeInBounds(col: number, row: number, edge: Edge): boolean {
    if (edge === 'n') return col >= 0 && col < this.cols && row >= 0 && row <= this.rows;
    return col >= 0 && col <= this.cols && row >= 0 && row < this.rows;
  }

  wallAt(col: number, row: number, edge: Edge): WallSegment | null {
    if (!this.edgeInBounds(col, row, edge)) return null;
    return this.walls.get(this.edgeKey(col, row, edge)) ?? null;
  }

  /** Add or remove one wall segment. Returns whether anything changed. */
  setWall(col: number, row: number, edge: Edge, present: boolean, door = false): boolean {
    if (!this.edgeInBounds(col, row, edge)) return false;
    const key = this.edgeKey(col, row, edge);
    const existing = this.walls.get(key);
    if (!present) {
      if (!existing) return false;
      this.walls.delete(key);
      this.version++;
      return true;
    }
    if (existing && existing.door === door) return false;
    this.walls.set(key, { col, row, edge, door });
    this.version++;
    return true;
  }

  /**
   * The edge segments a drag from corner `from` to corner `to` covers. Corners
   * are grid vertices (x = col, z = row). A diagonal drag becomes an L —
   * along x first, then z — since walls only run on cell edges.
   */
  static wallLine(
    from: { col: number; row: number },
    to: { col: number; row: number },
  ): { col: number; row: number; edge: Edge }[] {
    const out: { col: number; row: number; edge: Edge }[] = [];
    const c0 = Math.min(from.col, to.col);
    const c1 = Math.max(from.col, to.col);
    for (let col = c0; col < c1; col++) out.push({ col, row: from.row, edge: 'n' });
    const r0 = Math.min(from.row, to.row);
    const r1 = Math.max(from.row, to.row);
    for (let row = r0; row < r1; row++) out.push({ col: to.col, row, edge: 'w' });
    return out;
  }

  /** True when a solid wall (not a door) separates two 4-adjacent cells. */
  blocksStep(c0: number, r0: number, c1: number, r1: number): boolean {
    let wall: WallSegment | null = null;
    if (c1 === c0 + 1 && r1 === r0) wall = this.wallAt(c1, r0, 'w');
    else if (c1 === c0 - 1 && r1 === r0) wall = this.wallAt(c0, r0, 'w');
    else if (r1 === r0 + 1 && c1 === c0) wall = this.wallAt(c0, r1, 'n');
    else if (r1 === r0 - 1 && c1 === c0) wall = this.wallAt(c0, r0, 'n');
    return wall !== null && !wall.door;
  }

  /** Any wall segment, door or not, on an edge strictly inside this footprint.
   *  A table cannot straddle a wall, and it cannot sit in a doorway either. */
  wallCrossesInterior(col: number, row: number, w: number, h: number): boolean {
    for (let r = row; r < row + h; r++) {
      for (let c = col + 1; c < col + w; c++) if (this.wallAt(c, r, 'w')) return true;
    }
    for (let r = row + 1; r < row + h; r++) {
      for (let c = col; c < col + w; c++) if (this.wallAt(c, r, 'n')) return true;
    }
    return false;
  }

  /** Wall every edge between floor and no-floor (or the lot boundary). Used to
   *  close a starter plan; doors are punched afterwards. */
  enclose(): void {
    for (let row = 0; row <= this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.isFloored(col, row) !== this.isFloored(col, row - 1))
          this.setWall(col, row, 'n', true);
      }
    }
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col <= this.cols; col++) {
        if (this.isFloored(col, row) !== this.isFloored(col - 1, row))
          this.setWall(col, row, 'w', true);
      }
    }
  }

  allWalls(): WallSegment[] {
    return [...this.walls.values()].map((w) => ({ ...w }));
  }

  toView(): FloorPlanView {
    return {
      cols: this.cols,
      rows: this.rows,
      floor: this.floor.slice(),
      zone: this.zone.slice(),
      walls: this.allWalls(),
      entrance: { ...this.entrance },
    };
  }

  toJSON(): FloorPlanJSON {
    return {
      cols: this.cols,
      rows: this.rows,
      floor: [...this.floor],
      zone: [...this.zone],
      walls: this.allWalls(),
      entrance: { ...this.entrance },
      strictZones: this.strictZones,
    };
  }

  static fromJSON(data: FloorPlanJSON): FloorPlan {
    const plan = new FloorPlan(data.cols, data.rows, data.entrance);
    plan.floor.set(data.floor);
    plan.zone.set(data.zone);
    for (const w of data.walls) plan.setWall(w.col, w.row, w.edge, true, w.door);
    plan.strictZones = data.strictZones;
    plan.version = 0;
    return plan;
  }
}
