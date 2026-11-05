// Craps dice on the floor: thrown from the shooter's end of the table, they
// arc, hit the felt, hop and tumble to rest showing the roll the sim made.
// Scripted, not simulated: the end state is fixed first (position, face up)
// and the flight is drawn backwards from it, so a die can never land on a
// number that wasn't rolled.

import * as THREE from 'three';

/** Face values by outward normal: opposite faces sum to seven. */
export const FACES: readonly { v: number; n: THREE.Vector3 }[] = [
  { v: 1, n: new THREE.Vector3(0, 1, 0) },
  { v: 6, n: new THREE.Vector3(0, -1, 0) },
  { v: 2, n: new THREE.Vector3(1, 0, 0) },
  { v: 5, n: new THREE.Vector3(-1, 0, 0) },
  { v: 3, n: new THREE.Vector3(0, 0, 1) },
  { v: 4, n: new THREE.Vector3(0, 0, -1) },
];

/** Die edge (m) and the felt height in a craps table's local frame. */
export const DIE = 0.03;
const FELT_Y = 0.955;
/** Throw timeline (s, before the speed scale): flight, then a hop and a roll. */
export const FLIGHT_S = 0.75;
export const REST_S = 1.35;
const UP = new THREE.Vector3(0, 1, 0);

/** The rotation that turns face `v` to the top, then spins it about the vertical. */
export function restingQuat(v: number, yaw: number): THREE.Quaternion {
  const face = FACES.find((f) => f.v === v) ?? FACES[0]!;
  const q = new THREE.Quaternion().setFromUnitVectors(face.n, UP);
  return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(q);
}

/** Which value a die shows on top in orientation q. */
export function valueUp(q: THREE.Quaternion): number {
  let best = 0;
  let bestY = -Infinity;
  for (const f of FACES) {
    const y = f.n.clone().applyQuaternion(q).y;
    if (y > bestY) {
      bestY = y;
      best = f.v;
    }
  }
  return best;
}

export interface Throw {
  t0: number;
  dur: number;
  /** The two faces rolled. */
  faces: [number, number];
  /** A per-throw seed for where they land and how they tumble. */
  seed: number;
}

export interface DieState {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  resting: boolean;
}

function rand(seed: number, k: number): number {
  const s = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Die i (0 or 1) at time t, in the table's local frame. */
export function dieAt(th: Throw, i: number, t: number): DieState {
  const r = (k: number) => rand(th.seed, i * 10 + k);
  const start = new THREE.Vector3(0.75 + i * 0.07, 1.15, 1.42);
  const bounce = new THREE.Vector3(
    1.05 + r(1) * 0.3 + i * 0.05,
    FELT_Y + DIE / 2,
    0.62 + r(2) * 0.12,
  );
  const rest = bounce
    .clone()
    .add(new THREE.Vector3(0.05 + r(3) * 0.08, 0, 0.05 + r(4) * 0.06 + i * 0.06));
  const final = restingQuat(th.faces[i]!, r(5) * Math.PI * 2);
  const tau = Math.max(0, t - th.t0);
  const tf = FLIGHT_S * th.dur;
  const tr = REST_S * th.dur;
  if (tau >= tr) return { pos: rest, quat: final, resting: true };
  const pos = new THREE.Vector3();
  if (tau < tf) {
    const x = tau / tf;
    pos.lerpVectors(start, bounce, x);
    pos.y = start.y + (bounce.y - start.y) * x + Math.sin(Math.PI * x) * 0.22;
  } else {
    const x = (tau - tf) / (tr - tf);
    pos.lerpVectors(bounce, rest, 1 - (1 - x) ** 2);
    pos.y = FELT_Y + DIE / 2 + Math.abs(Math.sin(Math.PI * Math.min(1, x * 1.8))) * 0.035 * (1 - x);
  }
  // Tumble about a fixed axis, unwinding to exactly the final orientation.
  const axis = new THREE.Vector3(r(6) - 0.5, r(7) - 0.5, r(8) - 0.5).normalize();
  const spin = (1 - tau / tr) ** 2 * (14 + r(9) * 8);
  const quat = final.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axis, spin));
  return { pos, quat, resting: false };
}

export function diceReveal(th: Pick<Throw, 't0' | 'dur'>): number {
  return th.t0 + REST_S * th.dur;
}
