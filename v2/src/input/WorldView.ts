// The main thread's read-only mirror of what the tools and the avatar need
// from the sim: the latest floor plan and object list (both arrive only when
// their version changes), plus a cell → object lookup for CPU picking.

import { GRID_COLS, GRID_ROWS, ENTRANCE_TILE } from '../config';
import { getObjectDef } from '../data/objects';
import type { SimClient } from '../client/SimClient';
import type { FloorPlanView, ObjectView, Snapshot } from '../shared/contracts';
import { rotatedSize, type Cell } from './tools/gridMath';

export class WorldView {
  floor: FloorPlanView | null = null;
  objects: ObjectView[] = [];
  readonly byId = new Map<string, ObjectView>();
  /** Bumps whenever floor or objects change; consumers rebuild lazily on mismatch. */
  version = 0;
  private cellOwner: (ObjectView | undefined)[] = [];

  constructor(sim: SimClient) {
    if (sim.curr) this.ingest(sim.curr);
    sim.onSnapshot((s) => this.ingest(s));
  }

  get cols(): number {
    return this.floor?.cols ?? GRID_COLS;
  }

  get rows(): number {
    return this.floor?.rows ?? GRID_ROWS;
  }

  get entrance(): Cell {
    return this.floor?.entrance ?? ENTRANCE_TILE;
  }

  ingest(s: Pick<Snapshot, 'floor' | 'objects'>): void {
    if (!s.floor && !s.objects) return;
    if (s.floor) this.floor = s.floor;
    if (s.objects) this.objects = s.objects;
    this.byId.clear();
    this.cellOwner = new Array(this.cols * this.rows);
    for (const o of this.objects) {
      this.byId.set(o.id, o);
      const fp = footprintOf(o);
      for (let r = o.row; r < o.row + fp.h; r++)
        for (let c = o.col; c < o.col + fp.w; c++)
          if (c >= 0 && r >= 0 && c < this.cols && r < this.rows)
            this.cellOwner[r * this.cols + c] = o;
    }
    this.version++;
  }

  objectAt(col: number, row: number): ObjectView | undefined {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return undefined;
    return this.cellOwner[row * this.cols + col];
  }

  /** Whether a floor plan says this edge holds a wall (and whether it is a door). */
  wallAt(col: number, row: number, edge: 'n' | 'w'): { door: boolean } | null {
    const w = this.floor?.walls.find((s) => s.col === col && s.row === row && s.edge === edge);
    return w ? { door: w.door } : null;
  }
}

/** Rotated footprint size of a placed object. */
export function footprintOf(o: Pick<ObjectView, 'defId' | 'rot'>): { w: number; h: number } {
  const def = getObjectDef(o.defId);
  return rotatedSize(def?.footprint.w ?? 1, def?.footprint.h ?? 1, o.rot);
}
