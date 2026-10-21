import { describe, expect, it } from 'vitest';
import { HOURS_PER_DAY, START_HOUR, TICKS_PER_HOUR } from '../config';
import { TimeSystem } from './TimeSystem';

describe('TimeSystem', () => {
  it('starts at Day 1, noon', () => {
    const time = new TimeSystem();
    expect(time.day).toBe(1);
    expect(time.hour).toBe(START_HOUR);
  });

  it('advances one hour every TICKS_PER_HOUR ticks', () => {
    const time = new TimeSystem();
    for (let i = 0; i < TICKS_PER_HOUR - 1; i++) {
      expect(time.tick()).toEqual({ hourPassed: false, midnight: false });
    }
    expect(time.tick()).toEqual({ hourPassed: true, midnight: false });
    expect(time.hour).toBe(START_HOUR + 1);
    expect(time.day).toBe(1);
  });

  it('rolls into a new day at midnight and reports it', () => {
    const time = new TimeSystem();
    const hoursToMidnight = HOURS_PER_DAY - START_HOUR;
    let midnights = 0;
    for (let i = 0; i < hoursToMidnight * TICKS_PER_HOUR; i++) {
      if (time.tick().midnight) midnights++;
    }
    expect(midnights).toBe(1);
    expect(time.hour).toBe(0);
    expect(time.day).toBe(2);
  });

  it('serializes through toJSON/fromJSON mid-hour', () => {
    const time = new TimeSystem();
    for (let i = 0; i < TICKS_PER_HOUR * 3 + 17; i++) time.tick();
    const restored = TimeSystem.fromJSON(time.toJSON());
    expect(restored.day).toBe(time.day);
    expect(restored.hour).toBe(time.hour);
    // Both should hit the next hour boundary on the same future tick.
    let a = 0;
    let b = 0;
    while (!time.tick().hourPassed) a++;
    while (!restored.tick().hourPassed) b++;
    expect(a).toBe(b);
  });
});
