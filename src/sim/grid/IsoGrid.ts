// Occupancy/walkability grid for the casino floor. Pure TS — no Phaser.
// P1 uses it for bounds checks; P3 build mode and P4 pathfinding build on it.

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

  /** A cell is walkable when it exists and nothing occupies it. */
  isWalkable(col: number, row: number): boolean {
    return this.inBounds(col, row) && this.occupantAt(col, row) === null;
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

  /** Empty every cell (scenario reset) — the grid object itself stays aliased. */
  clear(): void {
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
