// Practical light (A8): the casino's own fixtures lighting the room.
//
// - Light pools: every chandelier, lamp, stage can, table lamp and glowing
//   fixture splats a soft pool of its colour into one lot-sized texture, which
//   the floor shader adds to the carpet. Rebuilt when objects or the floor
//   change; this is the god-view look, on every quality tier.
// - Real lights: on High, a fixed pool of point lights follows the practicals
//   nearest the camera, so brass, felt and faces pick up the light up close.
//   The count never changes while running (three.js recompiles every lit
//   shader when it does); unused lights sit at intensity 0.

import * as THREE from 'three';
import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { FloorPlanView, ObjectView } from '../shared/contracts';
import type { AssetLight } from './assets/AssetLibrary';
import { DECOR_FOOTPRINTS } from './assets/decor';

/** Pool texels per metre. Pools are soft, so 4 is plenty (a 96×64 lot is 384×256). */
export const POOL_RES = 4;
/** Chandeliers hang on this lattice (FloorLayer.buildCeiling), at this height. */
const CHANDELIER_EVERY = 6;
const CHANDELIER_Y = 2.4;
/** Real point lights on High. */
export const REAL_LIGHTS = 8;
/** How strongly pools add to the floor (they multiply the floor's albedo). */
const POOL_GAIN = 1.6;
/** Only cameras below this height get real lights (avatar and low god views). */
const REAL_LIGHT_MAX_Y = 9;
const REAL_LIGHT_RANGE = 22;
/** Candela per unit pool intensity (decay 2, so ~1.5 lux on a felt 2 m below a chandelier). */
const REAL_GAIN = 7;

export interface PoolLight {
  x: number;
  /** Height of the fixture (for real lights; pools ignore it). */
  y: number;
  z: number;
  /** Linear RGB. */
  color: [number, number, number];
  radius: number;
  intensity: number;
  /** A fixture a real light may stand in for; spill only colours the floor. */
  practical: boolean;
}

const WARM = 0xffd9a0;

function linear(hex: number): [number, number, number] {
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/** Unrotated footprint-local (x, z) of an object → world, matching ObjectLayer's transform. */
export function toWorld(o: Pick<ObjectView, 'col' | 'row' | 'rot'>, w: number, h: number, x: number, z: number) {
  const odd = o.rot % 2 === 1;
  const cx = o.col + (odd ? h : w) / 2;
  const cz = o.row + (odd ? w : h) / 2;
  const t = (-o.rot * Math.PI) / 2;
  const lx = x - w / 2;
  const lz = z - h / 2;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

/** What lights a floor: fixtures from objects, plus the ceiling's chandeliers. */
export function collectLights(
  floor: FloorPlanView | null,
  objects: readonly ObjectView[],
  lightsOf: (asset: string) => readonly AssetLight[],
): PoolLight[] {
  const out: PoolLight[] = [];
  if (floor) {
    const warm = linear(WARM);
    for (let r = 3; r < floor.rows; r += CHANDELIER_EVERY)
      for (let c = 3; c < floor.cols; c += CHANDELIER_EVERY)
        if (floor.floor[r * floor.cols + c])
          out.push({ x: c + 0.5, y: CHANDELIER_Y, z: r + 0.5, color: warm, radius: 3.4, intensity: 1.1, practical: true });
  }
  for (const o of objects) {
    if (o.broken) continue; // a broken machine goes dark (A12 adds its fault light)
    const d3 = get3D(o.defId);
    const fp = getObjectDef(o.defId)?.footprint ?? DECOR_FOOTPRINTS[o.defId] ?? { w: 1, h: 1 };
    const { w, h } = fp;
    const own = lightsOf(d3.asset);
    for (const l of own) {
      const p = toWorld(o, w, h, l.x, l.z);
      out.push({ x: p.x, y: l.y, z: p.z, color: linear(l.color), radius: l.radius, intensity: 1, practical: true });
    }
    if (own.length) continue;
    const seats = d3.seats?.length ?? 0;
    if (d3.game && d3.game !== 'slots' && seats > 1) {
      // A pit lamp over every table: warm, centred, a little wider than the felt.
      const p = toWorld(o, w, h, w / 2, h / 2);
      out.push({ x: p.x, y: 2.6, z: p.z, color: linear(0xffe2b8), radius: Math.max(w, h) * 0.95 + 0.6, intensity: 0.8, practical: true });
    } else if (d3.glow) {
      // Coloured spill in front of whatever glows: toppers, screens, neon, the bar back.
      const big = o.defId === 'neon-sign' || o.defId === 'marquee';
      const p = toWorld(o, w, h, w / 2, h + (big ? 0.2 : 0.35));
      out.push({
        x: p.x,
        y: d3.height * 0.8,
        z: p.z,
        color: linear(d3.glow),
        radius: big ? 2.6 : 1.2,
        intensity: big ? 0.7 : 0.14,
        practical: false,
      });
    }
  }
  return out;
}

/** Splat pools into an RGB float buffer of (cols·res) × (rows·res) texels. */
export function splatPools(lights: readonly PoolLight[], cols: number, rows: number, res = POOL_RES): Float32Array {
  const W = cols * res;
  const H = rows * res;
  const buf = new Float32Array(W * H * 3);
  for (const l of lights) {
    const r = l.radius * res;
    const px = l.x * res;
    const pz = l.z * res;
    const x0 = Math.max(0, Math.floor(px - r));
    const x1 = Math.min(W - 1, Math.ceil(px + r));
    const z0 = Math.max(0, Math.floor(pz - r));
    const z1 = Math.min(H - 1, Math.ceil(pz + r));
    const inv = 1 / (r * r);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - px;
        const dz = z + 0.5 - pz;
        const q = 1 - (dx * dx + dz * dz) * inv;
        if (q <= 0) continue;
        const f = q * q * l.intensity;
        const i = (z * W + x) * 3;
        buf[i] = buf[i]! + l.color[0] * f;
        buf[i + 1] = buf[i + 1]! + l.color[1] * f;
        buf[i + 2] = buf[i + 2]! + l.color[2] * f;
      }
  }
  return buf;
}

/** Shared with FloorMaterial: the pool texture, its size in metres, and the gain. */
export const poolUniforms = {
  uPools: { value: null as THREE.Texture | null },
  uPoolSize: { value: new THREE.Vector2(1, 1) },
  uPoolGain: { value: 0 },
};

export class Practicals {
  readonly group = new THREE.Group();
  /** The last built light list (for the lab and tests in the browser). */
  lights: PoolLight[] = [];
  private floor: FloorPlanView | null = null;
  private objects: readonly ObjectView[] = [];
  private dirty = false;
  private objectsHash = 0;
  private tex: THREE.DataTexture | null = null;
  private real: THREE.PointLight[] = [];
  private realOn = false;
  private nextPick = 0;
  /** Build time of the last pool bake, ms. */
  lastBakeMs = 0;

  constructor(private lightsOf: (asset: string) => readonly AssetLight[]) {
    this.group.name = 'practicals';
    poolUniforms.uPoolGain.value = POOL_GAIN;
  }

  setFloor(f: FloorPlanView): void {
    this.floor = f;
    this.dirty = true;
  }

  setObjects(o: readonly ObjectView[]): void {
    this.objects = o;
    // Snapshots resend the object list when anything changes (occupants too);
    // only placement and broken state move the light, so rebake on those.
    let h = o.length;
    for (const v of o) {
      h = (h * 31 + v.col * 977 + v.row * 131 + v.rot * 7 + (v.broken ? 1 : 0)) | 0;
      for (let i = 0; i < v.defId.length; i++) h = (h * 31 + v.defId.charCodeAt(i)) | 0;
    }
    if (h === this.objectsHash) return;
    this.objectsHash = h;
    this.dirty = true;
  }

  /** An asset finished loading (its light_<n> empties are known now). */
  markDirty(): void {
    this.dirty = true;
  }

  /** High: real lights on. Changing it recompiles lit shaders once. */
  setRealLights(on: boolean): void {
    if (on === this.realOn) return;
    this.realOn = on;
    if (on && !this.real.length)
      for (let i = 0; i < REAL_LIGHTS; i++) {
        const p = new THREE.PointLight(0xffffff, 0, 5, 2);
        p.castShadow = false;
        this.real.push(p);
      }
    for (const p of this.real) {
      if (on) this.group.add(p);
      else this.group.remove(p);
    }
  }

  get realLights(): readonly THREE.PointLight[] {
    return this.realOn ? this.real : [];
  }

  update(cam: THREE.Camera, now: number): void {
    if (this.dirty) this.bake();
    if (!this.realOn || now < this.nextPick) return;
    this.nextPick = now + 0.2;
    const pos = cam.position;
    const fade = 1 - THREE.MathUtils.smoothstep(pos.y, REAL_LIGHT_MAX_Y * 0.6, REAL_LIGHT_MAX_Y);
    const near: { l: PoolLight; d: number }[] = [];
    if (fade > 0)
      for (const l of this.lights) {
        if (!l.practical) continue;
        const d = Math.hypot(l.x - pos.x, l.y - pos.y, l.z - pos.z);
        if (d < REAL_LIGHT_RANGE) near.push({ l, d });
      }
    near.sort((a, b) => a.d - b.d);
    this.real.forEach((p, i) => {
      const n = near[i];
      if (!n) {
        p.intensity = 0;
        return;
      }
      p.position.set(n.l.x, n.l.y, n.l.z);
      p.color.setRGB(n.l.color[0], n.l.color[1], n.l.color[2]);
      p.distance = n.l.radius * 1.6;
      // Fade the furthest in the set so swapping a light in or out doesn't pop.
      const edge = 1 - THREE.MathUtils.smoothstep(n.d, REAL_LIGHT_RANGE * 0.6, REAL_LIGHT_RANGE);
      p.intensity = REAL_GAIN * n.l.intensity * fade * edge;
    });
  }

  private bake(): void {
    this.dirty = false;
    const f = this.floor;
    if (!f) return;
    const t0 = performance.now();
    this.lights = collectLights(f, this.objects, this.lightsOf);
    const rgb = splatPools(this.lights, f.cols, f.rows);
    const W = f.cols * POOL_RES;
    const H = f.rows * POOL_RES;
    const data = new Uint16Array(W * H * 4);
    for (let i = 0, j = 0; i < W * H; i++, j += 3) {
      data[i * 4] = THREE.DataUtils.toHalfFloat(rgb[j]!);
      data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(rgb[j + 1]!);
      data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(rgb[j + 2]!);
      data[i * 4 + 3] = 15360; // 1.0
    }
    if (!this.tex || this.tex.image.width !== W || this.tex.image.height !== H) {
      this.tex?.dispose();
      this.tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
      this.tex.magFilter = THREE.LinearFilter;
      this.tex.minFilter = THREE.LinearFilter;
      this.tex.colorSpace = THREE.LinearSRGBColorSpace;
    } else this.tex.image.data = data;
    this.tex.needsUpdate = true;
    poolUniforms.uPools.value = this.tex;
    poolUniforms.uPoolSize.value.set(f.cols, f.rows);
    this.lastBakeMs = performance.now() - t0;
  }
}
