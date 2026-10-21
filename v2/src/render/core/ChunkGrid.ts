// The floor is cut into CHUNK×CHUNK-cell chunks so a paint stroke rebuilds a
// handful of merged meshes rather than the whole floor. This file only
// decides *which* chunks a FloorPlanView change touched; FloorLayer builds
// the geometry. Pure, so the dirtiness rules are unit-tested.

import { FLOOR_TYPES, type FloorPlanView, type WallSegment } from '../../shared/contracts';

export const CHUNK = 8;

export function chunkKey(cx: number, cz: number): number {
  return cz * 4096 + cx;
}

export function chunkOfCell(col: number, row: number): { cx: number; cz: number } {
  return { cx: Math.floor(col / CHUNK), cz: Math.floor(row / CHUNK) };
}

function wallKey(w: WallSegment): string {
  return `${w.col},${w.row},${w.edge}`;
}

/** Walls render from the chunk owning their cell; a wall on a chunk's
 *  north/west border also changes how the neighbour's floor meets it, but the
 *  geometry itself lives in exactly one chunk, so one key per wall suffices. */
function wallChunk(w: WallSegment): number {
  const { cx, cz } = chunkOfCell(w.col, w.row);
  return chunkKey(cx, cz);
}

export class ChunkGrid {
  cols = 0;
  rows = 0;
  private floor = new Uint8Array(0);
  private zone = new Uint8Array(0);
  private walls = new Map<string, WallSegment>();

  get chunksX(): number {
    return Math.ceil(this.cols / CHUNK);
  }
  get chunksZ(): number {
    return Math.ceil(this.rows / CHUNK);
  }

  /** Apply a new plan and return the keys of every chunk whose floor or walls
   *  changed, plus whether any zone changed (the zone overlay is one mesh). */
  apply(plan: FloorPlanView): { dirty: Set<number>; zonesChanged: boolean; resized: boolean } {
    const dirty = new Set<number>();
    const resized = plan.cols !== this.cols || plan.rows !== this.rows;
    let zonesChanged = resized;
    if (resized) {
      this.cols = plan.cols;
      this.rows = plan.rows;
      this.floor = new Uint8Array(plan.cols * plan.rows);
      this.zone = new Uint8Array(plan.cols * plan.rows);
      this.walls.clear();
      for (let cz = 0; cz < this.chunksZ; cz++)
        for (let cx = 0; cx < this.chunksX; cx++) dirty.add(chunkKey(cx, cz));
    }
    for (let i = 0; i < plan.floor.length; i++) {
      if (plan.floor[i] !== this.floor[i]) {
        this.floor[i] = plan.floor[i]!;
        const col = i % plan.cols;
        const row = (i / plan.cols) | 0;
        const { cx, cz } = chunkOfCell(col, row);
        dirty.add(chunkKey(cx, cz));
      }
      if (plan.zone[i] !== this.zone[i]) {
        this.zone[i] = plan.zone[i]!;
        zonesChanged = true;
      }
    }
    const next = new Map<string, WallSegment>();
    for (const w of plan.walls) next.set(wallKey(w), w);
    for (const [k, w] of next) {
      const old = this.walls.get(k);
      if (!old || old.door !== w.door) dirty.add(wallChunk(w));
    }
    for (const [k, w] of this.walls) if (!next.has(k)) dirty.add(wallChunk(w));
    this.walls = next;
    return { dirty, zonesChanged, resized };
  }

  floorAt(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.floor[row * this.cols + col]!;
  }

  floorTypeAt(col: number, row: number): (typeof FLOOR_TYPES)[number] {
    return FLOOR_TYPES[this.floorAt(col, row)] ?? 'none';
  }

  zoneAt(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.zone[row * this.cols + col]!;
  }

  wallsIn(cx: number, cz: number): WallSegment[] {
    const out: WallSegment[] = [];
    const key = chunkKey(cx, cz);
    for (const w of this.walls.values()) if (wallChunk(w) === key) out.push(w);
    return out;
  }

  hasWall(col: number, row: number, edge: 'n' | 'w'): WallSegment | undefined {
    return this.walls.get(`${col},${row},${edge}`);
  }

  allWalls(): IterableIterator<WallSegment> {
    return this.walls.values();
  }
}
