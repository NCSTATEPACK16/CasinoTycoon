// Big-win celebrations (A12). When FxDirector reveals a big win (a real round
// the sim paid), the machine gets a spinning beacon on top, a burst of
// confetti, a bell after the jackpot sting, and the standing guests nearby
// cheer. Nothing moves the camera.
//
// Everything is pooled and capped. Beacons are two instanced meshes (dome and
// light beam), and confetti is one instanced quad mesh. They cost 0 draw calls
// at rest, and 3 while anything is celebrating.

import * as THREE from 'three';

/** How long a beacon spins after the win lands, s. */
export const BEACON_S = 6;
/** Concurrent beacons; a fifth win reuses the oldest. */
export const MAX_BEACONS = 4;
/** Confetti quads alive at once, and per burst. */
export const MAX_CONFETTI = 600;
export const CONFETTI_PER_WIN = 150;
const CONFETTI_LIFE_S = 4.5;
const GRAVITY = 3.2;
const PALETTE = [0xffd34d, 0xff4f7a, 0x46d1ff, 0x7dff6a, 0xffffff, 0xc77dff];

/** A render event Track B's news line can show (see Stage.onRenderEvent). */
export interface BigWinEvent {
  type: 'bigWin';
  objectId: string;
  defId: string;
  amount: number;
  x: number;
  z: number;
}

interface Beacon {
  x: number;
  y: number;
  z: number;
  t0: number;
  phase: number;
}

/** One confetti burst's start state: pure, so a test can check it stays in bounds. */
export function burst(
  n: number,
  x: number,
  y: number,
  z: number,
  rand: () => number = Math.random,
): { p: [number, number, number]; v: [number, number, number]; spin: number; color: number }[] {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    // A pop of 0.2–0.8 m over the topper, then a slow flutter down: it stays under the ceiling.
    const up = 1.1 + rand() * 1.1;
    const out_ = 0.5 + rand() * 1.1;
    out.push({
      p: [x + (rand() - 0.5) * 0.3, y, z + (rand() - 0.5) * 0.3] as [number, number, number],
      v: [Math.cos(a) * out_, up, Math.sin(a) * out_] as [number, number, number],
      spin: (rand() - 0.5) * 14,
      color: PALETTE[Math.floor(rand() * PALETTE.length)]!,
    });
  }
  return out;
}

/** Beacon brightness over its life: on at once, steady, then a 1 s fade. */
export function beaconLevel(age: number): number {
  if (age < 0 || age >= BEACON_S) return 0;
  return Math.min(1, (BEACON_S - age) / 1);
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();
const col = new THREE.Color();

export class Celebrations {
  readonly group = new THREE.Group();
  private domes: THREE.InstancedMesh;
  private beams: THREE.InstancedMesh;
  private confetti: THREE.InstancedMesh;
  private beacons: Beacon[] = [];
  // Confetti state, struct-of-arrays.
  private cp = new Float32Array(MAX_CONFETTI * 3);
  private cv = new Float32Array(MAX_CONFETTI * 3);
  private crot = new Float32Array(MAX_CONFETTI * 3);
  private cspin = new Float32Array(MAX_CONFETTI);
  private cage = new Float32Array(MAX_CONFETTI).fill(Infinity);
  private next = 0;
  private live = 0;

  constructor() {
    this.group.name = 'celebrations';
    // A red-amber dome, bright enough to bloom.
    const dome = new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.domes = new THREE.InstancedMesh(
      dome,
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.16, 0.04), toneMapped: false }),
      MAX_BEACONS,
    );
    // Two opposed light beams per beacon, additive, fading along their length.
    const beam = beamGeometry();
    this.beams = new THREE.InstancedMesh(
      beam,
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.3, 0.18, 0.05),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      MAX_BEACONS,
    );
    const quad = new THREE.PlaneGeometry(0.055, 0.032);
    this.confetti = new THREE.InstancedMesh(
      quad,
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      MAX_CONFETTI,
    );
    this.confetti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CONFETTI * 3), 3);
    for (const m of [this.domes, this.beams, this.confetti]) {
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false; // instances span the lot; the bounds would be the first instance's
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }
  }

  /** A big win landed on top of a machine `height` m tall at (x, z). */
  start(x: number, z: number, height: number, now: number): void {
    const b = { x, y: height + 0.02, z, t0: now, phase: Math.random() * Math.PI * 2 };
    const same = this.beacons.findIndex((o) => Math.hypot(o.x - x, o.z - z) < 0.3);
    if (same >= 0) this.beacons[same] = b;
    else {
      if (this.beacons.length >= MAX_BEACONS) this.beacons.shift();
      this.beacons.push(b);
    }
    for (const c of burst(CONFETTI_PER_WIN, x, height + 0.15, z)) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_CONFETTI;
      this.cp.set(c.p, i * 3);
      this.cv.set(c.v, i * 3);
      this.crot.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
      this.cspin[i] = c.spin;
      this.cage[i] = 0;
      this.confetti.setColorAt(i, col.setHex(c.color));
    }
    this.confetti.instanceColor!.needsUpdate = true;
  }

  /** Beacons still spinning (for tests in the browser). */
  get activeBeacons(): number {
    return this.beacons.length;
  }

  get liveConfetti(): number {
    return this.live;
  }

  update(now: number, dt: number): void {
    this.beacons = this.beacons.filter((b) => now - b.t0 < BEACON_S);
    this.beacons.forEach((b, i) => {
      const level = beaconLevel(now - b.t0);
      q.setFromEuler(e.set(0, b.phase + (now - b.t0) * 7, 0));
      m4.compose(p3.set(b.x, b.y, b.z), q, s3.setScalar(0.6 + 0.4 * level));
      this.domes.setMatrixAt(i, m4);
      m4.compose(p3.set(b.x, b.y + 0.06, b.z), q, s3.set(level, level, level));
      this.beams.setMatrixAt(i, m4);
    });
    this.domes.count = this.beams.count = this.beacons.length;
    this.domes.visible = this.beams.visible = this.beacons.length > 0;
    this.domes.instanceMatrix.needsUpdate = this.beams.instanceMatrix.needsUpdate = true;

    // Confetti: ballistic with drag, flutters, settles on the floor, then drops out.
    const h = Math.min(dt, 0.05);
    let n = 0;
    for (let i = 0; i < MAX_CONFETTI; i++) {
      if (this.cage[i]! >= CONFETTI_LIFE_S) continue;
      this.cage[i] = this.cage[i]! + h;
      const o = i * 3;
      const onFloor = this.cp[o + 1]! <= 0.01;
      if (!onFloor) {
        const drag = Math.exp(-h * 1.6);
        this.cv[o] = this.cv[o]! * drag;
        this.cv[o + 2] = this.cv[o + 2]! * drag;
        // Paper falls at a terminal speed; the flutter rocks it sideways.
        this.cv[o + 1] = Math.max(-0.9, this.cv[o + 1]! - GRAVITY * h) * (this.cv[o + 1]! < 0 ? 0.985 : 1);
        this.cp[o] = this.cp[o]! + (this.cv[o]! + Math.sin(this.cage[i]! * 6 + i) * 0.25) * h;
        this.cp[o + 1] = Math.max(0.005, this.cp[o + 1]! + this.cv[o + 1]! * h);
        this.cp[o + 2] = this.cp[o + 2]! + this.cv[o + 2]! * h;
        this.crot[o] = this.crot[o]! + this.cspin[i]! * h;
        this.crot[o + 1] = this.crot[o + 1]! + this.cspin[i]! * 0.6 * h;
      } else {
        // Lie flat on the carpet.
        this.crot[o] = -Math.PI / 2;
        this.crot[o + 1] = 0;
      }
      const fade = Math.min(1, (CONFETTI_LIFE_S - this.cage[i]!) / 0.6);
      q.setFromEuler(e.set(this.crot[o]!, this.crot[o + 1]!, this.crot[o + 2]!));
      m4.compose(p3.set(this.cp[o]!, this.cp[o + 1]!, this.cp[o + 2]!), q, s3.setScalar(fade));
      this.confetti.setMatrixAt(n, m4);
      if (n !== i) this.confetti.setColorAt(n, col.fromArray(this.confetti.instanceColor!.array, i * 3));
      n++;
    }
    // Compacting reorders colours, so the next pass reads them from their new slots:
    // simplest is to keep state and slots aligned by compacting the state too.
    if (n > 0) this.compact();
    this.live = n;
    this.confetti.count = n;
    this.confetti.visible = n > 0;
    this.confetti.instanceMatrix.needsUpdate = true;
    if (n > 0) this.confetti.instanceColor!.needsUpdate = true;
  }

  /** Move live particles to the front so the drawn range is [0, live). */
  private compact(): void {
    let w = 0;
    for (let r = 0; r < MAX_CONFETTI; r++) {
      if (this.cage[r]! >= CONFETTI_LIFE_S) continue;
      if (w !== r) {
        this.cp.copyWithin(w * 3, r * 3, r * 3 + 3);
        this.cv.copyWithin(w * 3, r * 3, r * 3 + 3);
        this.crot.copyWithin(w * 3, r * 3, r * 3 + 3);
        this.cspin[w] = this.cspin[r]!;
        this.cage[w] = this.cage[r]!;
        this.cage[r] = Infinity;
      }
      w++;
    }
    this.next = w % MAX_CONFETTI;
  }
}

/** Two flat beams pointing ±x from the dome, bright at the root, gone at the tip. */
function beamGeometry(): THREE.BufferGeometry {
  const L = 1.6;
  const w0 = 0.04;
  const w1 = 0.3;
  const pos: number[] = [];
  const colr: number[] = [];
  for (const s of [1, -1]) {
    // A vertical and a horizontal fin per beam reads as a cone from any angle.
    for (const [ax, ay] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const quad = [
        [0, -w0, 1],
        [0, w0, 1],
        [L, w1, 0],
        [L, -w1, 0],
      ];
      const v = quad.map(([x, w, a]) => [s * x!, ay ? w! : 0, ax ? w! : 0, a!] as const);
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const [x, y, z, a] = v[k]!;
        pos.push(x, y, z);
        colr.push(a * 0.9, a * 0.9, a * 0.9);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  return g;
}
