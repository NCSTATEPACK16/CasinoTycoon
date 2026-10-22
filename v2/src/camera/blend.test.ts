import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { damp, dampAngle, hermite, smootherstep, wrapAngle } from './blend';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('hermite', () => {
  const p0 = v(10, 30, 20);
  const p1 = v(4, 1.6, 7);
  const m0 = v(0, 12, 0);
  const m1 = v(-3, 0, -5);

  it('hits both endpoints exactly', () => {
    expect(hermite(v(0, 0, 0), p0, m0, p1, m1, 0).toArray()).toEqual(p0.toArray());
    const end = hermite(v(0, 0, 0), p0, m0, p1, m1, 1);
    expect(end.distanceTo(p1)).toBeLessThan(1e-12);
  });

  it('leaves and arrives along the given tangents', () => {
    const e = 1e-5;
    const a = hermite(v(0, 0, 0), p0, m0, p1, m1, e);
    const slope0 = a.sub(p0).divideScalar(e);
    expect(slope0.distanceTo(m0)).toBeLessThan(1e-2);
    const b = hermite(v(0, 0, 0), p0, m0, p1, m1, 1 - e);
    const slope1 = p1.clone().sub(b).divideScalar(e);
    expect(slope1.distanceTo(m1)).toBeLessThan(1e-2);
  });

  it('is a straight lerp with chord tangents', () => {
    const chord = p1.clone().sub(p0);
    const mid = hermite(v(0, 0, 0), p0, chord, p1, chord, 0.5);
    expect(mid.distanceTo(p0.clone().lerp(p1, 0.5))).toBeLessThan(1e-12);
  });
});

describe('easing', () => {
  it('smootherstep has fixed, flat endpoints', () => {
    expect(smootherstep(0)).toBe(0);
    expect(smootherstep(1)).toBe(1);
    expect(smootherstep(0.5)).toBeCloseTo(0.5, 12);
    expect(smootherstep(-1)).toBe(0);
    expect(smootherstep(2)).toBe(1);
    expect(smootherstep(1e-4)).toBeLessThan(1e-10);
  });

  it('damp is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 5, 1 / 60);
    let b = 0;
    for (let i = 0; i < 20; i++) b = damp(b, 1, 5, 1 / 20);
    expect(a).toBeCloseTo(b, 10);
  });

  it('angles take the short way round', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 12);
    const near = dampAngle(0.1, Math.PI * 2 - 0.1, 1000, 1);
    expect(near).toBeCloseTo(-0.1, 6);
  });
});
