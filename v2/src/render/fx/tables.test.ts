import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BIG_SIX_SEGMENTS, segmentFor, segmentValue } from '../../sim/fx/bigSix';
import { dieAt, diceReveal, FACES, restingQuat, valueUp } from './dice';
import {
  AMERICAN,
  ballAt,
  EUROPEAN,
  headAngle,
  pocketAngle,
  pocketAt,
  POCKET_R,
  rouletteReveal,
  sixAngle,
  sixRestAngle,
  sixReveal,
  sixSegmentAt,
  type SixSpin,
  type Spin,
} from './wheel';

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

describe('roulette', () => {
  it('has every number once, in the real wheel orders', () => {
    expect([...EUROPEAN].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect([...AMERICAN].sort((a, b) => a - b)).toEqual(Array.from({ length: 38 }, (_, i) => i));
    // Neighbours a dealer would recognise: 0 between 26 and 32; 00 opposite 0.
    expect(EUROPEAN.slice(0, 2)).toEqual([0, 32]);
    expect(EUROPEAN.at(-1)).toBe(26);
    expect(AMERICAN.indexOf(37) - AMERICAN.indexOf(0)).toBe(19);
  });

  it('maps each pocket angle back to its own number', () => {
    for (const wheel of ['single', 'double'] as const)
      for (const n of wheel === 'single' ? EUROPEAN : AMERICAN)
        expect(pocketAt(pocketAngle(n, wheel), wheel)).toBe(n);
  });

  it('settles the ball in the pocket of the result and keeps it there', () => {
    for (const wheel of ['single', 'double'] as const)
      for (const pocket of [0, 17, 32, 36, ...(wheel === 'double' ? [37] : [])]) {
        const s: Spin = { t0: 5, dur: 1, head0: 1.2, ball0: 4, pocket, wheel };
        for (const dt of [0, 0.5, 3]) {
          const t = rouletteReveal(s) + dt;
          const b = ballAt(s, t);
          expect(b.settled).toBe(true);
          expect(b.radius).toBe(POCKET_R);
          expect(pocketAt(b.angle - headAngle(s, t), wheel)).toBe(pocket);
        }
        // Just before the reveal it is already over the right pocket.
        const just = ballAt(s, rouletteReveal(s) - 1e-6);
        expect(pocketAt(just.angle - headAngle(s, rouletteReveal(s)), wheel)).toBe(pocket);
      }
  });

  it('launches the ball from where it lay and runs it against the head', () => {
    const s: Spin = { t0: 0, dur: 1, head0: 0, ball0: 2.5, pocket: 7, wheel: 'single' };
    expect(wrap(ballAt(s, 0).angle)).toBeCloseTo(2.5, 6);
    let last = Infinity;
    for (let t = 0.01; t < rouletteReveal(s); t += 0.05) {
      const a = ballAt(s, t).angle;
      expect(a).toBeLessThan(last);
      last = a;
      expect(ballAt(s, t).lift).toBeGreaterThanOrEqual(0);
    }
    // The head turns the other way and keeps turning.
    expect(headAngle(s, 2)).toBeGreaterThan(headAngle(s, 1));
    expect(headAngle(s, 20)).toBeGreaterThan(headAngle(s, 19));
  });
});

describe('dice', () => {
  it('puts each value on top in its resting orientation', () => {
    for (const { v } of FACES)
      for (const yaw of [0, 1, 2.5]) expect(valueUp(restingQuat(v, yaw))).toBe(v);
  });

  it('lands showing the rolled faces, and only then', () => {
    for (const faces of [
      [1, 6],
      [3, 4],
      [5, 5],
      [2, 6],
    ] as [number, number][]) {
      const th = { t0: 10, dur: 1, faces, seed: faces[0] * 7 + faces[1] };
      for (const i of [0, 1]) {
        const end = dieAt(th, i, diceReveal(th) + 0.01);
        expect(end.resting).toBe(true);
        expect(valueUp(end.quat)).toBe(faces[i]);
        // Continuous into the rest: the last frame of the tumble is the final pose.
        const before = dieAt(th, i, diceReveal(th) - 1e-4);
        expect(before.quat.angleTo(end.quat)).toBeLessThan(0.01);
        expect(before.pos.distanceTo(end.pos)).toBeLessThan(0.005);
        // In the air mid-flight, above the felt.
        expect(dieAt(th, i, 10.35).pos.y).toBeGreaterThan(1.0);
      }
    }
  });

  it('never stacks the two dice on top of each other', () => {
    const th = { t0: 0, dur: 1, faces: [2, 3] as [number, number], seed: 4 };
    const a = dieAt(th, 0, 5).pos;
    const b = dieAt(th, 1, 5).pos;
    expect(a.distanceTo(b)).toBeGreaterThan(0.04);
    expect(new THREE.Vector3().copy(a).y).toBeCloseTo(b.y, 6);
  });
});

describe('big six', () => {
  it('stops on a segment that agrees with what was paid', () => {
    for (let seq = 0; seq < 50; seq++) {
      expect(BIG_SIX_SEGMENTS[segmentFor(5, 10, seq)]).toBe(1);
      expect(BIG_SIX_SEGMENTS[segmentFor(5, 0, seq)]).not.toBe(1);
      expect(BIG_SIX_SEGMENTS[segmentFor(5, 20, seq)]).toBe(2);
    }
    expect(segmentValue(5, 0)).toBe(0);
    // Losses spread over the wheel rather than always one spot.
    expect(new Set(Array.from({ length: 40 }, (_, s) => segmentFor(5, 0, s))).size).toBeGreaterThan(
      5,
    );
  });
});

describe('big six motion', () => {
  it('slows onto the segment of the result and stays there', () => {
    for (const segment of [0, 7, 13, 29]) {
      const s: SixSpin = { t0: 2, dur: 1, angle0: 1.1, segment };
      // Starts where the face last stood (whole turns aside).
      expect(wrap(sixAngle(s, 2))).toBeCloseTo(1.1, 6);
      expect(sixSegmentAt(sixAngle(s, sixReveal(s)))).toBe(segment);
      expect(sixSegmentAt(sixAngle(s, sixReveal(s) + 5))).toBe(segment);
      // Just before the stop it is already on the segment: no jump at the end.
      expect(sixSegmentAt(sixAngle(s, sixReveal(s) - 1e-4))).toBe(segment);
      // Always turning the same way, slower and slower.
      let last = Infinity;
      let lastStep = Infinity;
      for (let t = 2.01; t < sixReveal(s); t += 0.05) {
        const a = sixAngle(s, t);
        expect(a).toBeLessThanOrEqual(last);
        if (last !== Infinity) {
          expect(last - a).toBeLessThanOrEqual(lastStep + 1e-9);
          lastStep = last - a;
        }
        last = a;
      }
    }
  });

  it('maps every segment rest angle back to its segment', () => {
    for (let i = 0; i < BIG_SIX_SEGMENTS.length; i++) expect(sixSegmentAt(sixRestAngle(i))).toBe(i);
  });
});
