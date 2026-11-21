// A11: the outside of the casino and the doors.
//
// Street side: the lot edge the entrance sits on. Everything there is built in
// a local "street frame" (x = metres out from the lot edge, z = metres along
// it) and mapped to the world once:
//   - stone cladding on the outer face of the boundary walls (it cuts away
//     with the walls in the god view),
//   - a sidewalk, curb, street with a dashed centre line and a far sidewalk,
//   - street lamps and a few static parked cars,
//   - a marquee canopy over the street doors with a lettered sign and bulbs,
//     and a red carpet across the sidewalk.
// Inside: a welcome mat on the entrance tile; swinging leaves on interior
// doorways up to 2 m wide (wider archways stay open) and sliding glass on the
// street doors, opened by whoever is near.
// Sky: a gradient dome whose colours follow the in-game hour. Lamps, bulbs and
// sign light up at dusk and the outdoor surfaces darken. Interior lights never
// change ("the interior always stays lit").

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AGENT_STRIDE, type FloorPlanView } from '../shared/contracts';
import type { AssetLibrary } from './assets/AssetLibrary';
import { GeoBuilder, at } from './assets/GeoBuilder';
import { PALETTE, surf, type Surface } from './assets/Palette';
import { WALL_H } from './FloorLayer';
import { createObjectMaterial } from './materials/ObjectMaterial';

const DOOR_H = 2.3;
/** Doorway runs this wide or narrower get swinging leaves; wider ones are archways. */
const MAX_LEAF_RUN = 2;
/** How close (m, across the doorway) an agent must be to open a door. */
const DOOR_REACH = 1.3;
export const SIDEWALK = 4;
export const STREET_W = 7.4;
/** How far past the street edge the god camera's focus may go. */
export const STREET_REACH = SIDEWALK + STREET_W + 2;

const STONE: Surface = { color: 0xcfc3ae, rough: 0.8, metal: 0 };
const STONE_DARK: Surface = { color: 0x8f8372, rough: 0.8, metal: 0 };
const CONCRETE: Surface = { color: 0x9a968f, rough: 0.9, metal: 0 };
const CURB: Surface = { color: 0xb8b3a8, rough: 0.85, metal: 0 };
const ASPHALT: Surface = { color: 0x2a2a2e, rough: 0.95, metal: 0 };
const PAINT: Surface = { color: 0xe8e0c0, rough: 0.7, metal: 0 };
const CARPET: Surface = { color: 0x8a1020, rough: 0.95, metal: 0 };
const POLE: Surface = { color: 0x1d1f24, rough: 0.5, metal: 0.6 };
const TYRE: Surface = { color: 0x151515, rough: 0.9, metal: 0 };
const CAR_COLOURS = [0xb3202a, 0x1d3d7a, 0xd8d4c8, 0x2a2a30, 0x2f6b4a, 0xc9a227];

// ---------- pure helpers (tested) ----------

export type StreetSide = 'e' | 'w' | 'n' | 's';

/** The street frame: which lot edge, its length, where the entrance is along
 *  it, and the matrix from frame (x out, z along) to world. */
export interface StreetFrame {
  side: StreetSide;
  length: number;
  entrance: number;
  matrix: THREE.Matrix4;
}

export function streetFrame(plan: Pick<FloorPlanView, 'cols' | 'rows' | 'entrance'>): StreetFrame {
  const { cols, rows, entrance: e } = plan;
  // The entrance tile sits on one lot edge; east is every shipped layout.
  const side: StreetSide =
    e.col >= cols - 1 ? 'e' : e.col <= 0 ? 'w' : e.row <= 0 ? 'n' : e.row >= rows - 1 ? 's' : 'e';
  const m = new THREE.Matrix4();
  switch (side) {
    case 'e':
      return { side, length: rows, entrance: e.row + 0.5, matrix: m.makeTranslation(cols, 0, 0) };
    case 'w':
      return { side, length: rows, entrance: rows - (e.row + 0.5), matrix: at(0, 0, rows, Math.PI) };
    case 'n':
      return { side, length: cols, entrance: e.col + 0.5, matrix: at(0, 0, 0, Math.PI / 2) };
    case 's':
      return { side, length: cols, entrance: cols - (e.col + 0.5), matrix: at(cols, 0, rows, -Math.PI / 2) };
  }
}

/** A straight run of door segments on one wall line. */
export interface DoorRun {
  edge: 'n' | 'w';
  /** Wall line: z for 'n', x for 'w'. */
  line: number;
  /** Start and end along the line (x for 'n', z for 'w'). */
  from: number;
  to: number;
  /** On the lot boundary (street doors: sliding glass). */
  street: boolean;
}

export function doorRuns(plan: Pick<FloorPlanView, 'cols' | 'rows' | 'walls'>): DoorRun[] {
  const segs = plan.walls
    .filter((w) => w.door)
    .map((w) => ({ edge: w.edge, line: w.edge === 'n' ? w.row : w.col, at: w.edge === 'n' ? w.col : w.row }))
    .sort((a, b) => (a.edge < b.edge ? -1 : a.edge > b.edge ? 1 : a.line - b.line || a.at - b.at));
  const runs: DoorRun[] = [];
  for (const s of segs) {
    const last = runs[runs.length - 1];
    if (last && last.edge === s.edge && last.line === s.line && last.to === s.at) {
      last.to = s.at + 1;
      continue;
    }
    const bound = s.edge === 'n' ? plan.rows : plan.cols;
    runs.push({ edge: s.edge, line: s.line, from: s.at, to: s.at + 1, street: s.line === 0 || s.line === bound });
  }
  return runs;
}

/** For each run, 0 when nobody is near, else +1/-1: the side of the wall line
 *  (positive = +z for 'n', +x for 'w') the nearest agent stands on. */
export function doorTriggers(runs: readonly DoorRun[], agents: Float32Array, count: number, stride = AGENT_STRIDE): Int8Array {
  const out = new Int8Array(runs.length);
  const best = new Float32Array(runs.length).fill(Infinity);
  for (let i = 0; i < count; i++) {
    const x = agents[i * stride]!;
    const z = agents[i * stride + 1]!;
    for (let r = 0; r < runs.length; r++) {
      const d = runs[r]!;
      const along = d.edge === 'n' ? x : z;
      const across = (d.edge === 'n' ? z : x) - d.line;
      if (along < d.from - 0.2 || along > d.to + 0.2 || Math.abs(across) > DOOR_REACH) continue;
      if (Math.abs(across) < best[r]!) {
        best[r] = Math.abs(across);
        out[r] = across >= 0 ? 1 : -1;
      }
    }
  }
  return out;
}

const SKY_KEYS: [number, number, number][] = [
  // hour, zenith, horizon
  [0, 0x05070f, 0x111428],
  [4.5, 0x05070f, 0x111428],
  [6, 0x2a3a70, 0xe0905e],
  [8, 0x3f7fd0, 0xa9cdee],
  [12, 0x2f6fd6, 0xc2def6],
  [16.5, 0x3b72c8, 0xb6d2ee],
  [18.5, 0x283a7a, 0xe7915a],
  [20, 0x0b0e22, 0x2a2140],
  [24, 0x05070f, 0x111428],
];

/** Sky colours at an in-game hour (0–24, fractional). */
export function skyAt(hour: number, zenith = new THREE.Color(), horizon = new THREE.Color()): { zenith: THREE.Color; horizon: THREE.Color } {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_KEYS.length - 2 && SKY_KEYS[i + 1]![0] <= h) i++;
  const [h0, z0, r0] = SKY_KEYS[i]!;
  const [h1, z1, r1] = SKY_KEYS[i + 1]!;
  const t = THREE.MathUtils.smoothstep(h, h0, h1);
  const c = new THREE.Color();
  zenith.setHex(z0).lerp(c.setHex(z1), t);
  horizon.setHex(r0).lerp(c.setHex(r1), t);
  return { zenith, horizon };
}

/** 1 at night, 0 by day: lamps on from dusk (18:30–19:30) to dawn (5:30–6:30). */
export function nightAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return Math.max(1 - THREE.MathUtils.smoothstep(h, 5.5, 6.5), THREE.MathUtils.smoothstep(h, 18.5, 19.5));
}

// ---------- the layer ----------

interface Leaf {
  run: number;
  hinge: THREE.Vector3;
  width: number;
  base: number;
  /** Which swing direction moves the free end toward +side (computed once). */
  posSign: number;
  angle: number;
  sign: number;
}

interface Pane {
  run: number;
  rest: THREE.Vector3;
  dir: THREE.Vector3;
  travel: number;
  rotY: number;
  open: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3(1, 1, 1);
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Exterior {
  readonly group = new THREE.Group();
  private outdoorMat: THREE.MeshStandardMaterial;
  private facadeMat: THREE.MeshStandardMaterial;
  /** Inside the lot (the entrance mat): never darkens at night. */
  private interiorMat: THREE.MeshStandardMaterial;
  private glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  private poolMat: THREE.MeshBasicMaterial;
  private signMat: THREE.MeshBasicMaterial;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private built: THREE.Mesh[] = [];
  private leafMesh: THREE.InstancedMesh;
  private paneMesh: THREE.InstancedMesh;
  private runs: DoorRun[] = [];
  private triggers: Int8Array = new Int8Array(0);
  private leaves: Leaf[] = [];
  private panes: Pane[] = [];
  private planKey = '';
  private lastSnap: unknown = null;
  private zen = new THREE.Color();
  private hor = new THREE.Color();
  /** Current night factor (0 day … 1 night), for tests and the lab. */
  night = 0;

  constructor(
    private lib: AssetLibrary,
    private scene: THREE.Scene,
    private ground: THREE.Mesh,
  ) {
    this.group.name = 'exterior';
    this.outdoorMat = createObjectMaterial(lib.atlas.texture, false, false);
    this.facadeMat = createObjectMaterial(lib.atlas.texture, false, true);
    this.interiorMat = createObjectMaterial(lib.atlas.texture, false, false);
    this.poolMat = new THREE.MeshBasicMaterial({
      map: radialTexture(),
      color: 0xffc070,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    });
    this.signMat = new THREE.MeshBasicMaterial({ map: signTexture(), fog: true });
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(380, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith; uniform vec3 uHorizon;
          varying vec3 vDir;
          void main() {
            float t = smoothstep(-0.05, 0.55, vDir.y);
            gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    const leafGeo = new THREE.BoxGeometry(1, DOOR_H - 0.04, 0.05).translate(0.5, (DOOR_H - 0.04) / 2, 0);
    this.leafMesh = new THREE.InstancedMesh(
      leafGeo,
      new THREE.MeshStandardMaterial({ color: 0x5a2616, roughness: 0.55, metalness: 0.05 }),
      256,
    );
    this.leafMesh.castShadow = true;
    this.leafMesh.receiveShadow = true;
    this.leafMesh.frustumCulled = false;
    this.leafMesh.count = 0;
    const paneGeo = new THREE.BoxGeometry(1, DOOR_H - 0.04, 0.035).translate(0, (DOOR_H - 0.04) / 2, 0);
    this.paneMesh = new THREE.InstancedMesh(
      paneGeo,
      new THREE.MeshStandardMaterial({
        color: 0x9cc8d8,
        roughness: 0.05,
        metalness: 0.2,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
      64,
    );
    this.paneMesh.frustumCulled = false;
    this.paneMesh.renderOrder = 5;
    this.paneMesh.count = 0;
    this.group.add(this.leafMesh, this.paneMesh);
    this.setHour(21);
  }

  setFloor(plan: FloorPlanView): void {
    const runs = doorRuns(plan);
    const key = `${plan.cols}x${plan.rows}@${plan.entrance.col},${plan.entrance.row}|${plan.walls.length}|${JSON.stringify(runs)}|${boundaryKey(plan)}`;
    if (key === this.planKey) return;
    this.planKey = key;
    for (const m of this.built) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.built = [];
    this.runs = runs;
    this.triggers = new Int8Array(runs.length);
    this.buildDoors();
    const f = streetFrame(plan);
    this.buildStreet(plan, f);
    this.buildFacade(plan, f);
  }

  /** Doors react to agents; cheap enough per snapshot (runs × agents). */
  setAgents(snap: { agents: Float32Array; agentCount: number }): void {
    if (snap === this.lastSnap) return;
    this.lastSnap = snap;
    this.triggers = doorTriggers(this.runs, snap.agents, snap.agentCount);
  }

  setHour(hour: number): void {
    skyAt(hour, this.zen, this.hor);
    const u = this.sky.material.uniforms;
    (u.uZenith!.value as THREE.Color).copy(this.zen);
    (u.uHorizon!.value as THREE.Color).copy(this.hor);
    const n = nightAt(hour);
    this.night = n;
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.hor);
    if (this.scene.fog) this.scene.fog.color.copy(this.hor).multiplyScalar(0.8);
    // Outdoor surfaces darken at night; the facade a little less (spill from inside).
    this.outdoorMat.color.setScalar(THREE.MathUtils.lerp(1, 0.32, n));
    this.facadeMat.color.setScalar(THREE.MathUtils.lerp(1, 0.5, n));
    (this.ground.material as THREE.MeshStandardMaterial).color
      .setHex(0x1b1720)
      .lerp(new THREE.Color(0x4a4640), 1 - n);
    // Bulbs and lamp heads: pale by day, hot at night (bloom does the rest).
    this.glowMat.color.setScalar(THREE.MathUtils.lerp(0.75, 3.2, n));
    this.signMat.color.setScalar(THREE.MathUtils.lerp(0.9, 2.4, n));
    this.poolMat.opacity = 0.55 * n;
  }

  update(dt: number): void {
    const k = Math.min(1, dt * 7);
    let leafI = 0;
    for (const l of this.leaves) {
      const t = this.triggers[l.run] ?? 0;
      // Swing away from the person: they stand on side t, so the free end goes to -t.
      if (t !== 0 && l.angle < 0.05) l.sign = -t * l.posSign;
      l.angle += ((t !== 0 ? 1.4 : 0) - l.angle) * k;
      tmpQ.setFromAxisAngle(UP, l.base + l.sign * l.angle);
      tmpS.set(l.width, 1, 1);
      this.leafMesh.setMatrixAt(leafI++, tmpM.compose(l.hinge, tmpQ, tmpS));
    }
    this.leafMesh.count = leafI;
    this.leafMesh.instanceMatrix.needsUpdate = true;
    let paneI = 0;
    for (const p of this.panes) {
      const t = this.triggers[p.run] ?? 0;
      p.open += ((t !== 0 ? 1 : 0) - p.open) * k;
      tmpP.copy(p.dir).multiplyScalar(p.travel * p.open).add(p.rest);
      tmpQ.setFromAxisAngle(UP, p.rotY);
      tmpS.set(p.travel / 0.9, 1, 1);
      this.paneMesh.setMatrixAt(paneI++, tmpM.compose(tmpP, tmpQ, tmpS));
    }
    this.paneMesh.count = paneI;
    this.paneMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- builders ----------

  private buildDoors(): void {
    this.leaves = [];
    this.panes = [];
    this.runs.forEach((r, i) => {
      const len = r.to - r.from;
      // Along-line unit vector and the world point of a position on the line.
      const dir = r.edge === 'n' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
      const p = (s: number) => (r.edge === 'n' ? new THREE.Vector3(s, 0, r.line) : new THREE.Vector3(r.line, 0, s));
      const baseAlong = r.edge === 'n' ? 0 : -Math.PI / 2;
      if (r.street) {
        // Two sliding glass panes meeting in the middle.
        const half = len / 2 - 0.12;
        for (const side of [-1, 1]) {
          const rest = p((r.from + r.to) / 2 + (side * len) / 4);
          this.panes.push({ run: i, rest, dir: dir.clone().multiplyScalar(side), travel: half * 0.9, rotY: baseAlong, open: 0 });
        }
        return;
      }
      if (len > MAX_LEAF_RUN) return;
      // One leaf per metre, hinged on the jambs (a 2 m run is a double door).
      const w = 1 - 0.12;
      const hinges: [number, number][] = len === 1 ? [[r.from + 0.1, baseAlong]] : [[r.from + 0.1, baseAlong], [r.to - 0.1, baseAlong + Math.PI]];
      for (const [s, base] of hinges) {
        const hinge = p(s);
        // Which sign of rotation moves the free end toward the +side normal?
        const n = r.edge === 'n' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const tip = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, base + 0.3);
        const posSign = tip.dot(n) > 0 ? 1 : -1;
        this.leaves.push({ run: i, hinge, width: w, base, posSign, angle: 0, sign: 1 });
      }
    });
    this.update(0);
  }

  private add(geo: THREE.BufferGeometry | null, mat: THREE.Material, shadow = true): void {
    if (!geo) return;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    this.group.add(m);
    this.built.push(m);
  }

  private buildStreet(plan: FloorPlanView, f: StreetFrame): void {
    const atlas = this.lib.atlas;
    const solid = new GeoBuilder(atlas);
    const glow = new GeoBuilder(atlas);
    const pools: THREE.BufferGeometry[] = [];
    const L = f.length;
    const z0 = -14;
    const z1 = L + 14;
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    const e = f.entrance;
    const S = SIDEWALK;
    const W = STREET_W;
    // Sidewalk, curb, street, far curb and sidewalk.
    solid.box(S - 0.05, 0.08, len, (S + 0.05) / 2, -0.02, zc, CONCRETE);
    for (let z = z0 + 1.5; z < z1; z += 1.5) solid.box(S - 0.1, 0.004, 0.03, S / 2, 0.06, z, STONE_DARK);
    solid.box(0.18, 0.14, len, S + 0.09, -0.04, zc, CURB);
    solid.box(W, 0.02, len, S + 0.18 + W / 2, -0.03, zc, ASPHALT);
    for (let z = z0 + 1; z < z1; z += 4) solid.box(0.14, 0.006, 2, S + 0.18 + W / 2, -0.01, z, PAINT);
    solid.box(0.18, 0.14, len, S + 0.27 + W, -0.04, zc, CURB);
    solid.box(3, 0.08, len, S + 0.36 + W + 1.5, -0.02, zc, CONCRETE);
    // Red carpet from the street doors to the curb.
    solid.box(S - 0.25, 0.012, 2.2, S / 2, 0.06, e, CARPET);
    solid.box(S - 0.25, 0.014, 0.08, S / 2, 0.06, e - 1.12, PALETTE.gold);
    solid.box(S - 0.25, 0.014, 0.08, S / 2, 0.06, e + 1.12, PALETTE.gold);
    // Marquee canopy over the doors: slab, gold fascia, two posts, bulbs.
    const cw = 6;
    const cd = S - 0.6;
    solid.box(cd, 0.22, cw, 0.2 + cd / 2, 2.75, e, surf('blackGloss'));
    solid.box(0.12, 0.34, cw + 0.12, 0.2 + cd, 2.69, e, PALETTE.gold);
    for (const s of [-1, 1]) {
      solid.box(0.12, 0.34, cd, 0.2 + cd / 2, 2.69, e + (s * (cw + 0.06)) / 2, PALETTE.gold);
      solid.add(new THREE.CylinderGeometry(0.06, 0.07, 2.7, 10), PALETTE.brass, at(cd - 0.1, 1.35, e + s * (cw / 2 - 0.3)));
    }
    for (let i = 0; i <= 20; i++) glow.sphere(0.045, 0.2 + cd + 0.07, 2.86, e - cw / 2 + (i * cw) / 20, PALETTE.bulbWarm, 6);
    for (let i = 0; i <= 12; i++)
      for (const s of [-1, 1]) glow.sphere(0.045, 0.3 + (i * (cd - 0.2)) / 12, 2.86, e + (s * (cw + 0.18)) / 2, PALETTE.bulbWarm, 6);
    // The sign board stands on the canopy, facing the street.
    solid.box(0.14, 1.3, cw - 0.4, 0.2 + cd - 0.1, 2.97, e, surf('blackGloss'));
    solid.box(0.18, 0.08, cw - 0.3, 0.2 + cd - 0.1, 4.27, e, PALETTE.gold);
    const sign = new THREE.PlaneGeometry(cw - 0.6, 1.1).rotateY(Math.PI / 2).translate(0.2 + cd - 0.02, 3.62, e);
    // Street lamps every 8 m on the sidewalk, clear of the canopy.
    for (let z = z0 + 4; z < z1 - 2; z += 8) {
      if (Math.abs(z - e) < cw / 2 + 1.5) continue;
      const x = S - 0.45;
      solid.add(new THREE.CylinderGeometry(0.06, 0.09, 4.4, 8), POLE, at(x, 2.2, z));
      solid.box(0.5, 0.06, 0.06, x - 0.22, 4.3, z, POLE);
      solid.box(0.34, 0.12, 0.24, x - 0.44, 4.2, z, POLE);
      glow.box(0.28, 0.04, 0.2, x - 0.44, 4.14, z, PALETTE.lampWarm);
      pools.push(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2).translate(x - 0.6, 0.07, z));
    }
    // A few parked cars along the near curb, never in front of the doors.
    const slots = [-9, -3.5, 8, 14.5, L - 12, L - 5, L + 6];
    let ci = 0;
    for (const z of slots) {
      if (Math.abs(z - e) < 6 || z < z0 + 3 || z > z1 - 3) continue;
      this.car(solid, S + 1.25, z, CAR_COLOURS[ci++ % CAR_COLOURS.length]!, ci % 2 === 0);
      if (ci >= 5) break;
    }
    const m = f.matrix;
    const sg = solid.build().applyMatrix4(m);
    this.add(sg, this.outdoorMat);
    if (!glow.empty) this.add(glow.build().applyMatrix4(m), this.glowMat, false);
    this.add(sign.applyMatrix4(m), this.signMat, false);
    if (pools.length) this.add(mergeGeometries(pools)!.applyMatrix4(m), this.poolMat, false);
    // The entrance tile: a welcome mat with a gold border, just inside the doors.
    const mat = new GeoBuilder(atlas);
    const c = plan.entrance;
    mat.box(0.96, 0.01, 0.96, c.col + 0.5, 0, c.row + 0.5, PALETTE.gold);
    mat.box(0.84, 0.014, 0.84, c.col + 0.5, 0, c.row + 0.5, CARPET);
    mat.box(0.5, 0.016, 0.06, c.col + 0.5, 0, c.row + 0.5, PALETTE.gold);
    mat.box(0.06, 0.016, 0.5, c.col + 0.5, 0, c.row + 0.5, PALETTE.gold);
    this.add(mat.build(), this.interiorMat, false);
  }

  private car(b: GeoBuilder, x: number, z: number, colour: number, flip: boolean): void {
    const paint: Surface = { color: colour, rough: 0.3, metal: 0.4 };
    const ry = flip ? Math.PI : 0;
    const M = (lx: number, ly: number, lz: number) => at(x + lx, ly, z + (flip ? -lz : lz), ry);
    // Car frame: length along z (the street), width along x.
    b.add(new THREE.BoxGeometry(1.8, 0.62, 4.3), paint, M(0, 0.55, 0));
    b.add(new THREE.BoxGeometry(1.6, 0.55, 2.2), PALETTE.glassDark, M(0, 1.12, -0.2));
    b.add(new THREE.BoxGeometry(1.64, 0.06, 2.0), paint, M(0, 1.42, -0.2));
    for (const sx of [-1, 1])
      for (const sz of [-1.35, 1.35])
        b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 10).rotateZ(Math.PI / 2), TYRE, M(sx * 0.86, 0.33, sz));
    for (const sx of [-0.6, 0.6]) b.add(new THREE.BoxGeometry(0.3, 0.12, 0.04), PALETTE.lampWarm, M(sx, 0.66, 2.16));
  }

  /** Stone cladding on the outside face of the boundary walls, cut away with them. */
  private buildFacade(plan: FloorPlanView, f: StreetFrame): void {
    const parts: THREE.BufferGeometry[] = [];
    for (const w of plan.walls) {
      if (w.door) continue;
      const out = boundaryNormal(w, plan);
      if (!out) continue;
      const street = out.side === f.side;
      const b = new GeoBuilder(this.lib.atlas);
      const H = street ? WALL_H + 0.9 : WALL_H + 0.25;
      // Local frame: segment along +x from 0..1, outward is -z (built as at() maps).
      b.box(1, 0.5, 0.14, 0.5, 0, -0.16, STONE_DARK);
      b.box(1, H - 0.5, 0.1, 0.5, 0.5, -0.14, STONE);
      b.box(1, 0.16, 0.2, 0.5, H - 0.16, -0.18, STONE_DARK);
      if (street) b.box(1, 0.06, 0.16, 0.5, 2.0, -0.2, PALETTE.gold);
      const geo = b.build().applyMatrix4(out.m);
      const x = w.edge === 'n' ? w.col + 0.5 : w.col;
      const z = w.edge === 'n' ? w.row : w.row + 0.5;
      const n = geo.attributes.position!.count;
      const cAttr = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        cAttr[i * 2] = x;
        cAttr[i * 2 + 1] = z;
      }
      geo.setAttribute('aWallC', new THREE.BufferAttribute(cAttr, 2));
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    }
    // A header with a brass frame above each street doorway.
    for (const r of this.runs) {
      if (!r.street) continue;
      const b = new GeoBuilder(this.lib.atlas);
      const len = r.to - r.from;
      b.box(len, 0.1, 0.22, len / 2, DOOR_H, 0, PALETTE.gold);
      b.box(len, WALL_H + 0.9 - DOOR_H - 0.1, 0.12, len / 2, DOOR_H + 0.1, -0.12, STONE);
      const out = boundaryNormal({ edge: r.edge, col: r.edge === 'n' ? r.from : r.line, row: r.edge === 'n' ? r.line : r.from, door: true }, plan, len);
      if (!out) continue;
      const geo = b.build().applyMatrix4(out.m);
      const n = geo.attributes.position!.count;
      const cAttr = new Float32Array(n * 2);
      const mid = (r.from + r.to) / 2;
      for (let i = 0; i < n; i++) {
        cAttr[i * 2] = r.edge === 'n' ? mid : r.line;
        cAttr[i * 2 + 1] = r.edge === 'n' ? r.line : mid;
      }
      geo.setAttribute('aWallC', new THREE.BufferAttribute(cAttr, 2));
      parts.push(geo.index ? geo.toNonIndexed() : geo);
    }
    if (!parts.length) return;
    const merged = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    this.add(merged, this.facadeMat);
  }
}

/** For a wall on the lot boundary: its side and a matrix whose local -z points
 *  out of the lot (segment along local +x from 0 to 1). Null for interior walls. */
function boundaryNormal(w: FloorPlanView['walls'][number], plan: FloorPlanView, len = 1): { side: StreetSide; m: THREE.Matrix4 } | null {
  if (w.edge === 'n') {
    if (w.row === 0) return { side: 'n', m: at(w.col, 0, 0) };
    if (w.row === plan.rows) return { side: 's', m: at(w.col + len, 0, plan.rows, Math.PI) };
    return null;
  }
  if (w.col === 0) return { side: 'w', m: at(0, 0, w.row + len, Math.PI / 2) };
  if (w.col === plan.cols) return { side: 'e', m: at(plan.cols, 0, w.row, -Math.PI / 2) };
  return null;
}

function boundaryKey(plan: FloorPlanView): string {
  let k = '';
  for (const w of plan.walls) if (boundaryNormal(w, plan)) k += `${w.edge}${w.col},${w.row}${w.door ? 'd' : ''};`;
  return k;
}

function radialTexture(): THREE.Texture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
      const a = Math.max(0, 1 - d) ** 2;
      const i = (y * n + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const t = new THREE.DataTexture(data, n, n);
  t.needsUpdate = true;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  return t;
}

/** "CASINO" in marquee letters with a bulb border, drawn once on a canvas. */
function signTexture(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 208;
  const g = c.getContext('2d')!;
  g.fillStyle = '#120a10';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#ffd36b';
  for (let x = 16; x < c.width; x += 28) {
    for (const y of [14, c.height - 14]) {
      g.beginPath();
      g.arc(x, y, 6, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.font = 'bold 132px Georgia, "Times New Roman", serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#b8121e';
  g.strokeText('CASINO', c.width / 2, c.height / 2 + 6);
  g.fillStyle = '#fff1c8';
  g.fillText('CASINO', c.width / 2, c.height / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
