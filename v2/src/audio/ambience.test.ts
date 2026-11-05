import { describe, expect, it } from 'vitest';
import {
  ambienceMix,
  BEDS,
  crowdDensity,
  FOUNTAIN_M,
  fountainWeight,
  heightFactor,
  PAUSE_DUCK,
  type AmbienceInput,
} from './ambience';
import { AmbienceFeed, soundKind } from './AmbienceFeed';

const slotFloor = { machines: 8, tables: 1, lounge: 0 };
const bar = { machines: 1, tables: 0, lounge: 4 };
const base: AmbienceInput = { guests: 200, camY: 1.6, speed: 1, near: slotFloor, music: true };
const mix = (p: Partial<AmbienceInput>) => ambienceMix({ ...base, ...p });

describe('ambience mix', () => {
  it('fills the crowd with guests and leaves an empty floor to the machines', () => {
    const empty = mix({ guests: 0 });
    expect(empty.crowd).toBe(0);
    expect(empty.murmur).toBe(0);
    expect(empty.slots).toBeGreaterThan(0.3);
    let last = -1;
    for (const g of [0, 20, 50, 100, 200, 500, 1000]) {
      const m = mix({ guests: g });
      expect(m.crowd).toBeGreaterThan(last);
      last = m.crowd;
    }
    // Levelling off: doubling a busy floor adds far less than the first hundred.
    expect(crowdDensity(1000) - crowdDensity(500)).toBeLessThan(crowdDensity(100) / 4);
  });

  it('is close and detailed at eye level, quieter and duller from the god view', () => {
    const eye = mix({ camY: 1.6 });
    const god = mix({ camY: 60 });
    expect(heightFactor(1.6)).toBe(0);
    expect(heightFactor(60)).toBe(1);
    // Every bed that sounds at eye level is quieter from above (no fountain near here).
    for (const b of BEDS) if (eye[b] > 0) expect(god[b]).toBeLessThan(eye[b]);
    expect(eye.fountain).toBe(0);
    expect(god.murmur).toBe(0);
    expect(eye.cutoff).toBeCloseTo(16000, 3);
    expect(god.cutoff).toBeCloseTo(2500, 3);
    // Monotonic on the way up.
    let c = Infinity;
    for (const y of [1.6, 5, 10, 20, 30, 45]) {
      const m = mix({ camY: y });
      expect(m.cutoff).toBeLessThan(c);
      c = m.cutoff;
    }
  });

  it('sounds different by the bar than on the slot floor', () => {
    const slots = mix({ near: slotFloor });
    const lounge = mix({ near: bar });
    expect(lounge.music).toBeGreaterThan(slots.music * 2);
    expect(lounge.murmur).toBeGreaterThan(slots.murmur);
    expect(lounge.slots).toBeLessThan(slots.slots);
    // From high up a corner's character mostly fades.
    const hi = (near: AmbienceInput['near']) => mix({ near, camY: 60 }).music;
    expect(hi(bar) / hi(slotFloor)).toBeLessThan(lounge.music / slots.music);
  });

  it('ducks everything while paused, music included', () => {
    const run = mix({});
    const paused = mix({ speed: 0 });
    for (const b of BEDS) expect(paused[b]).toBeCloseTo(run[b] * PAUSE_DUCK, 9);
    expect(paused.cutoff).toBe(run.cutoff);
    expect(mix({ speed: 4 }).slots).toBe(run.slots);
  });

  it('hears a fountain only close by, and barely from the god view', () => {
    expect(fountainWeight(0)).toBe(1);
    expect(fountainWeight(FOUNTAIN_M)).toBe(0);
    expect(fountainWeight(FOUNTAIN_M * 2)).toBe(0);
    expect(fountainWeight(2)).toBeGreaterThan(fountainWeight(5));
    const atRim = mix({ near: { ...slotFloor, fountain: 1 } });
    const across = mix({ near: { ...slotFloor, fountain: fountainWeight(6) } });
    const above = mix({ near: { ...slotFloor, fountain: 1 }, camY: 60 });
    expect(atRim.fountain).toBeGreaterThan(0.4);
    expect(across.fountain).toBeLessThan(atRim.fountain / 4);
    expect(above.fountain).toBeLessThan(atRim.fountain * 0.2);
    // Two fountains side by side don't go past unity gain.
    expect(mix({ near: { ...slotFloor, fountain: 2 } }).fountain).toBeLessThanOrEqual(1);
  });

  it('plays no music when it is switched off', () => {
    expect(mix({ music: false }).music).toBe(0);
    expect(mix({ music: false, near: bar }).music).toBe(0);
  });

  it('stays within unity gain on any input', () => {
    for (const guests of [0, 5000])
      for (const camY of [0, 1.6, 200])
        for (const near of [slotFloor, bar, { machines: 0, tables: 0, lounge: 0 }]) {
          const m = mix({ guests, camY, near });
          for (const b of BEDS) {
            expect(m[b]).toBeGreaterThanOrEqual(0);
            expect(m[b]).toBeLessThanOrEqual(1);
          }
        }
  });
});

describe('what the ears hear around them', () => {
  const feed = (ear: { x: number; z: number }) =>
    new AmbienceFeed({ earPoint: { ...ear, y: 1.6 }, settings: { music: true } } as never);
  const obj = (id: string, defId: string, col: number, row: number) =>
    ({ id, defId, col, row, rot: 0 }) as never;

  it('sorts objects into machines, tables and the lounge', () => {
    expect(soundKind('slot-machine')).toBe('machines');
    expect(soundKind('penny-slots')).toBe('machines');
    expect(soundKind('big-six-wheel')).toBe('machines');
    expect(soundKind('blackjack-table')).toBe('tables');
    expect(soundKind('roulette-table')).toBe('tables');
    expect(soundKind('bar')).toBe('lounge');
    expect(soundKind('food-stall')).toBe('lounge');
    expect(soundKind('plant')).toBeNull();
    expect(soundKind('fountain')).toBe('fountain');
    expect(soundKind('statue')).toBeNull();
  });

  it('weighs what is near the ears more, and nothing past 12 m', () => {
    const f = feed({ x: 10.5, z: 10.5 });
    f.setObjects([
      obj('a', 'slot-machine', 10, 10),
      obj('b', 'slot-machine', 16, 10),
      obj('c', 'slot-machine', 40, 40),
      obj('d', 'bar', 10, 14),
    ]);
    const near = f.surroundings();
    expect(near.machines).toBeCloseTo(1 + (1 - 6 / 12), 6);
    expect(near.tables).toBe(0);
    expect(near.lounge).toBeGreaterThan(0);
    expect(near.lounge).toBeLessThan(1);
    expect(near.fountain).toBe(0);
  });

  it('hears a fountain from its rim, using the agreed 3x3 footprint before B6', () => {
    // Fountain at cells 10..12 → centre (11.5, 11.5), rim about 1.5 m out.
    const at = (x: number) => {
      const f = feed({ x, z: 11.5 });
      f.setObjects([obj('f', 'fountain', 10, 10)]);
      return f.surroundings().fountain ?? 0;
    };
    expect(at(13)).toBeCloseTo(1, 6); // standing at the rim
    expect(at(17)).toBeCloseTo(fountainWeight(4), 6);
    expect(at(11.5 + 1.5 + FOUNTAIN_M + 1)).toBe(0);
  });
});
