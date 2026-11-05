// Feeds the ambience mix (ambience.ts) from the game: the guest count and
// speed from each snapshot, the camera's height, and what stands around the
// ears, gathered a few times a second from the latest objects and floor.

import type { Camera } from 'three';
import { Vector3 } from 'three';
import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import { ZONES, type FloorPlanView, type ObjectView } from '../shared/contracts';
import type { AudioEngine } from './AudioEngine';
import { ambienceMix, type AmbienceMix, type Surroundings } from './ambience';

/** What counts within this distance of the ears, fading linearly to it. */
const NEAR_M = 12;
/** A food-court cell weighs this much against one object. */
const FOOD_CELL = 0.15;
const LOUNGE = new Set(['bar', 'food-stall']);
const FOOD_COURT = ZONES.indexOf('foodCourt');
/** Recomputed this often (s); the engine glides between mixes. */
const EVERY_S = 0.25;

type Kind = keyof Surroundings;

/** How an object colours the room's sound, if it does. */
export function soundKind(defId: string): Kind | null {
  if (LOUNGE.has(defId)) return 'lounge';
  if (getObjectDef(defId)?.category !== 'game') return null;
  return (get3D(defId).seats?.length ?? 0) > 1 ? 'tables' : 'machines';
}

export class AmbienceFeed {
  /** The last mix sent, for tests in the browser. */
  last: AmbienceMix | null = null;
  private placed: { x: number; z: number; kind: Kind }[] = [];
  private floor: FloorPlanView | null = null;
  private guests = 0;
  private speed = 1;
  private next = 0;
  private cam = new Vector3();

  constructor(private audio: AudioEngine) {}

  setObjects(objects: ObjectView[]): void {
    this.placed = [];
    for (const o of objects) {
      const kind = soundKind(o.defId);
      if (!kind) continue;
      const def = getObjectDef(o.defId);
      const w = def?.footprint.w ?? 1;
      const h = def?.footprint.h ?? 1;
      const odd = o.rot % 2 === 1;
      this.placed.push({
        x: o.col + (odd ? h : w) / 2,
        z: o.row + (odd ? w : h) / 2,
        kind,
      });
    }
  }

  setFloor(floor: FloorPlanView): void {
    this.floor = floor;
  }

  setHud(guests: number, speed: number): void {
    this.guests = guests;
    this.speed = speed;
  }

  /** Once a frame; does the work a few times a second. */
  update(camera: Camera, now: number): void {
    if (now < this.next) return;
    this.next = now + EVERY_S;
    camera.getWorldPosition(this.cam);
    this.last = ambienceMix({
      guests: this.guests,
      camY: this.cam.y,
      speed: this.speed,
      near: this.surroundings(),
      music: this.audio.settings.music,
    });
    this.audio.setAmbience(this.last);
  }

  /** Distance-weighted counts of what stands around the ears' floor point. */
  surroundings(): Surroundings {
    const ear = this.audio.earPoint;
    const out: Surroundings = { machines: 0, tables: 0, lounge: 0 };
    for (const p of this.placed) {
      const d = Math.hypot(p.x - ear.x, p.z - ear.z);
      if (d < NEAR_M) out[p.kind] += 1 - d / NEAR_M;
    }
    const f = this.floor;
    if (f && FOOD_COURT >= 0) {
      const c0 = Math.max(0, Math.floor(ear.x - NEAR_M));
      const c1 = Math.min(f.cols - 1, Math.floor(ear.x + NEAR_M));
      const r0 = Math.max(0, Math.floor(ear.z - NEAR_M));
      const r1 = Math.min(f.rows - 1, Math.floor(ear.z + NEAR_M));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          if (f.zone[r * f.cols + c] !== FOOD_COURT) continue;
          const d = Math.hypot(c + 0.5 - ear.x, r + 0.5 - ear.z);
          if (d < NEAR_M) out.lounge += FOOD_CELL * (1 - d / NEAR_M);
        }
    }
    return out;
  }
}
