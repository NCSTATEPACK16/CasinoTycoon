import type { FloorPlan } from '../floor/FloorPlan';

// Occupancy/walkability grid for the casino floor. Pure TS — no Phaser.
// P1 uses it for bounds checks; P3 build mode and P4 pathfinding build on it.
// v2: walkability also asks the floor plan — no floor is no footing, and a
// solid wall between two cells is no step — so grid A* and every stand-tile
// search respect the same walls the navmesh does.

export interface IsoGridJSON {
  cols: number;
  rows: number;
  occupants: (string | null)[];
}

export class IsoGrid {
  cols: number;
  rows: number;
  /** Occupant id per cell, null = empty. Index = row * cols + col. */
  private occupants: (string | null)[];
  /** The lot this grid sits on. Null for a bare grid (unit tests), which
   *  behaves as v1 did: every in-bounds cell is floor and nothing is walled. */
  floor: FloorPlan | null = null;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.occupants = new Array<string | null>(cols * rows).fill(null);
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }

  occupantAt(col: number, row: number): string | null {
    return this.inBounds(col, row) ? (this.occupants[row * this.cols + col] ?? null) : null;
  }

  /** A cell is walkable when it exists, is floored and nothing occupies it. */
  isWalkable(col: number, row: number): boolean {
    return (
      this.inBounds(col, row) &&
      this.occupantAt(col, row) === null &&
      (this.floor === null || this.floor.isFloored(col, row))
    );
  }

  /** One 4-neighbour step: the target must be walkable and no solid wall may
   *  stand on the shared edge. */
  canStep(c0: number, r0: number, c1: number, r1: number): boolean {
    return this.isWalkable(c1, r1) && !(this.floor?.blocksStep(c0, r0, c1, r1) ?? false);
  }

  /** True when a footprint of w×h cells anchored at (col,row) fits entirely on empty cells. */
  canPlace(col: number, row: number, w = 1, h = 1): boolean {
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (!this.inBounds(c, r) || this.occupantAt(c, r) !== null) return false;
      }
    }
    return true;
  }

  /** Mark a footprint as occupied by `id`. Returns false (and changes nothing) if blocked. */
  occupy(id: string, col: number, row: number, w = 1, h = 1): boolean {
    if (!this.canPlace(col, row, w, h)) return false;
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        this.occupants[r * this.cols + c] = id;
      }
    }
    return true;
  }

  /** Empty every cell (scenario reset), resizing to a new lot if one is given —
   *  the grid object itself stays aliased. */
  clear(cols = this.cols, rows = this.rows): void {
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      this.occupants = new Array<string | null>(cols * rows).fill(null);
      return;
    }
    this.occupants.fill(null);
  }

  /** Free every cell held by `id`. Returns the number of cells freed. */
  free(id: string): number {
    let freed = 0;
    for (let i = 0; i < this.occupants.length; i++) {
      if (this.occupants[i] === id) {
        this.occupants[i] = null;
        freed++;
      }
    }
    return freed;
  }

  toJSON(): IsoGridJSON {
    return { cols: this.cols, rows: this.rows, occupants: [...this.occupants] };
  }

  static fromJSON(data: IsoGridJSON): IsoGrid {
    const grid = new IsoGrid(data.cols, data.rows);
    grid.occupants = [...data.occupants];
    return grid;
  }

  /** In-place restore — the grid object itself stays aliased (mirrors clear()). */
  load(data: IsoGridJSON): void {
    this.cols = data.cols;
    this.rows = data.rows;
    this.occupants = [...data.occupants];
  }
}
