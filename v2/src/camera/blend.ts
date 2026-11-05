// Small, allocation-free easing helpers shared by the god rig, the avatar
// spring arm and the mode transitions. Everything here is pure so the blend
// endpoints can be unit-tested without a renderer.

import * as THREE from 'three';

/** Frame-rate independent exponential approach: the fraction of the remaining
 *  gap to close this frame for a spring that settles in ~4/`rate` seconds. */
export function dampFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * dampFactor(rate, dt);
}

/** Shortest-arc damping for angles, so a yaw of 359° → 1° turns 2°, not 358°. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + wrapAngle(target - current) * dampFactor(rate, dt);
}

export function wrapAngle(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

/** C1-continuous ease (zero velocity at both ends), so a transition never
 *  starts or lands with a visible kick. */
export function smootherstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Cubic Hermite between p0 and p1 with tangents m0, m1 (per unit t).
 *  Writes into `out` and returns it. */
export function hermite(
  out: THREE.Vector3,
  p0: THREE.Vector3,
  m0: THREE.Vector3,
  p1: THREE.Vector3,
  m1: THREE.Vector3,
  t: number,
): THREE.Vector3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return out.set(
    h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
    h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
    h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z,
  );
}
