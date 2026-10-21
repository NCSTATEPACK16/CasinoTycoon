// Kinematic capsule collision for the player avatar, in the ground plane.
// The capsule is a circle in x/z (it never jumps, and nothing it can hit
// overhangs), so a wall is a thick segment and an object footprint is an
// axis-aligned box. Statics live in a uniform spatial hash rebuilt whenever
// the floor plan or the object set changes; no physics library.

import { getObjectDef } from '../../data/objects';
import type { FloorPlanView, ObjectView } from '../../shared/contracts';
import { rotatedSize } from '../tools/gridMath';

export const AVATAR_RADIUS = 0.3;
export const AVATAR_HEIGHT = 1.75;
/** Half the rendered wall thickness: the capsule stops this far short of the edge line. */
export const WALL_HALF_THICKNESS = 0.08;
/** Footprints are drawn slightly inset (Stage uses 0.9); collide a little inside the cell edge too. */
const FOOTPRINT_INSET = 0.04;
/** Largest single move between overlap resolutions. Well under the thinnest
 *  obstacle band (wall: 2 × (radius + half thickness)), so nothing tunnels. */
const MAX_STEP = 0.12;
const HASH_CELL = 2;

export interface Segment {
  kind: 'seg';
  ax: number;
  az: number;
  bx: number;
  bz: number;
}
export interface Box {
  kind: 'box';
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  objectId?: string;
}
export type Shape = Segment | Box;

export interface Vec2 {
  x: number;
  z: number;
}

export class CollisionWorld {
  readonly shapes: Shape[] = [];
  private buckets = new Map<number, number[]>();
  // Per-query dedupe without allocating a Set: a shape is visited once per stamp.
  private seen: number[] = [];
  private stamp = 0;

  /** Rebuild from the latest floor plan and objects. `cols`/`rows` bound the lot
   *  when no floor plan has arrived yet. */
  rebuild(
    floor: FloorPlanView | null,
    objects: readonly ObjectView[],
    cols: number,
    rows: number,
  ): void {
    this.shapes.length = 0;
    this.buckets.clear();
    const c = floor?.cols ?? cols;
    const r = floor?.rows ?? rows;
    // The lot boundary is always solid.
    this.addSegment(0, 0, c, 0);
    this.addSegment(0, r, c, r);
    this.addSegment(0, 0, 0, r);
    this.addSegment(c, 0, c, r);
    for (const w of floor?.walls ?? []) {
      if (w.door) continue; // door gaps are passable
      if (w.edge === 'n') this.addSegment(w.col, w.row, w.col + 1, w.row);
      else this.addSegment(w.col, w.row, w.col, w.row + 1);
    }
    for (const o of objects) {
      const def = getObjectDef(o.defId);
      const fp = rotatedSize(def?.footprint.w ?? 1, def?.footprint.h ?? 1, o.rot);
      this.add({
        kind: 'box',
        x0: o.col + FOOTPRINT_INSET,
        z0: o.row + FOOTPRINT_INSET,
        x1: o.col + fp.w - FOOTPRINT_INSET,
        z1: o.row + fp.h - FOOTPRINT_INSET,
        objectId: o.id,
      });
    }
  }

  addSegment(ax: number, az: number, bx: number, bz: number): void {
    this.add({ kind: 'seg', ax, az, bx, bz });
  }

  add(s: Shape): void {
    const i = this.shapes.push(s) - 1;
    this.seen.push(0);
    const [x0, z0, x1, z1] =
      s.kind === 'seg'
        ? [Math.min(s.ax, s.bx), Math.min(s.az, s.bz), Math.max(s.ax, s.bx), Math.max(s.az, s.bz)]
        : [s.x0, s.z0, s.x1, s.z1];
    // Pad by the wall thickness so a shape lands in every bucket it can touch.
    const pad = WALL_HALF_THICKNESS;
    for (let bx = cellOf(x0 - pad); bx <= cellOf(x1 + pad); bx++)
      for (let bz = cellOf(z0 - pad); bz <= cellOf(z1 + pad); bz++) {
        const k = key(bx, bz);
        const b = this.buckets.get(k);
        if (b) b.push(i);
        else this.buckets.set(k, [i]);
      }
  }

  /** Visit each shape whose hash buckets overlap the disc's bounds, once. */
  query(x: number, z: number, radius: number, visit: (s: Shape) => void): void {
    const st = ++this.stamp;
    for (let bx = cellOf(x - radius); bx <= cellOf(x + radius); bx++)
      for (let bz = cellOf(z - radius); bz <= cellOf(z + radius); bz++) {
        const b = this.buckets.get(key(bx, bz));
        if (!b) continue;
        for (const i of b) {
          if (this.seen[i] === st) continue;
          this.seen[i] = st;
          visit(this.shapes[i]!);
        }
      }
  }

  /** Push a disc out of every overlapping shape. Returns the summed push
   *  normal (zero if nothing touched) so the caller can cancel velocity into it. */
  resolve(pos: Vec2, radius: number, outNormal: Vec2): boolean {
    let touched = false;
    outNormal.x = 0;
    outNormal.z = 0;
    // A few relaxation passes settle wedges (a corner between a wall and a table).
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      this.query(pos.x, pos.z, radius + WALL_HALF_THICKNESS, (s) => {
        const n = s.kind === 'seg' ? pushFromSegment(pos, radius, s) : pushFromBox(pos, radius, s);
        if (!n) return;
        pos.x += n.x;
        pos.z += n.z;
        outNormal.x += n.x;
        outNormal.z += n.z;
        moved = touched = true;
      });
      if (!moved) break;
    }
    return touched;
  }

  /** Move a disc by vel·dt, sliding along whatever it hits. `vel` is updated
   *  in place: the component driving into a surface is removed. */
  move(pos: Vec2, vel: Vec2, dt: number, radius = AVATAR_RADIUS): void {
    const dist = Math.hypot(vel.x, vel.z) * dt;
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
    const h = dt / steps;
    const n: Vec2 = { x: 0, z: 0 };
    for (let i = 0; i < steps; i++) {
      pos.x += vel.x * h;
      pos.z += vel.z * h;
      if (this.resolve(pos, radius, n)) {
        const len = Math.hypot(n.x, n.z);
        if (len > 1e-9) {
          const nx = n.x / len;
          const nz = n.z / len;
          const into = vel.x * nx + vel.z * nz;
          if (into < 0) {
            vel.x -= into * nx;
            vel.z -= into * nz;
          }
        }
      }
    }
  }

  /** Distance along a ground ray (from p, direction d unit, up to maxDist)
   *  before it meets a wall segment. Used by the 3rd-person spring arm. */
  raycastWalls(px: number, pz: number, dx: number, dz: number, maxDist: number): number {
    let best = maxDist;
    const st = ++this.stamp;
    // March the hash along the ray; the arm is a few metres, so this is a handful of buckets.
    const n = Math.ceil(maxDist / HASH_CELL) + 1;
    for (let i = 0; i <= n; i++) {
      const cx = px + dx * i * HASH_CELL;
      const cz = pz + dz * i * HASH_CELL;
      for (let bx = cellOf(cx) - 1; bx <= cellOf(cx) + 1; bx++)
        for (let bz = cellOf(cz) - 1; bz <= cellOf(cz) + 1; bz++) {
          const b = this.buckets.get(key(bx, bz));
          if (!b) continue;
          for (const idx of b) {
            if (this.seen[idx] === st) continue;
            this.seen[idx] = st;
            const s = this.shapes[idx]!;
            if (s.kind !== 'seg') continue;
            const t = raySegment(px, pz, dx, dz, s);
            if (t !== null && t < best) best = t;
          }
        }
    }
    return best;
  }
}

function cellOf(v: number): number {
  return Math.floor(v / HASH_CELL);
}

function key(bx: number, bz: number): number {
  // Lots are well under 2k cells a side; offset keeps negative buckets distinct.
  return (bx + 1024) * 4096 + (bz + 1024);
}

function pushFromSegment(p: Vec2, r: number, s: Segment): Vec2 | null {
  const ex = s.bx - s.ax;
  const ez = s.bz - s.az;
  const len2 = ex * ex + ez * ez;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.ax) * ex + (p.z - s.az) * ez) / len2)) : 0;
  const cx = s.ax + ex * t;
  const cz = s.az + ez * t;
  return pushOut(p, cx, cz, r + WALL_HALF_THICKNESS, -ez, ex);
}

function pushFromBox(p: Vec2, r: number, b: Box): Vec2 | null {
  const cx = Math.max(b.x0, Math.min(b.x1, p.x));
  const cz = Math.max(b.z0, Math.min(b.z1, p.z));
  if (cx === p.x && cz === p.z) {
    // Centre inside the box (an object was placed on top of us): leave by the nearest face.
    const exits = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
    const m = Math.min(...exits);
    const i = exits.indexOf(m);
    return i === 0
      ? { x: -(m + r), z: 0 }
      : i === 1
        ? { x: m + r, z: 0 }
        : i === 2
          ? { x: 0, z: -(m + r) }
          : { x: 0, z: m + r };
  }
  return pushOut(p, cx, cz, r, 0, 0);
}

/** Push p out to distance `minDist` from the closest point c. When p sits
 *  exactly on c, fall back to the supplied normal (fx, fz). */
function pushOut(p: Vec2, cx: number, cz: number, minDist: number, fx: number, fz: number): Vec2 | null {
  let dx = p.x - cx;
  let dz = p.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= minDist * minDist) return null;
  let d = Math.sqrt(d2);
  if (d < 1e-9) {
    const fl = Math.hypot(fx, fz) || 1;
    dx = fx / fl || 1;
    dz = fz / fl;
    d = 0;
    return { x: dx * minDist, z: dz * minDist };
  }
  const k = (minDist - d) / d;
  return { x: dx * k, z: dz * k };
}

/** Ray (origin p, unit dir d) vs segment s; returns distance along the ray or null. */
function raySegment(px: number, pz: number, dx: number, dz: number, s: Segment): number | null {
  const ex = s.bx - s.ax;
  const ez = s.bz - s.az;
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-9) return null;
  const qx = s.ax - px;
  const qz = s.az - pz;
  const t = (qx * ez - qz * ex) / den;
  const u = (qx * dz - qz * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : null;
}
