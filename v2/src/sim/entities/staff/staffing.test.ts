import { describe, expect, it } from 'vitest';
import { STAFF_DEPTH } from '../../../data/balance';
import {
  cleanRadius,
  dealerSkillSpeed,
  detectChance,
  misPayChance,
  moraleSpeed,
  onShiftAt,
  quitChance,
  repairTimeFactor,
  SHIFTS,
  workHour,
} from './staffing';

describe('skill effects', () => {
  it('dealers deal 0.8× at skill 0 to 1.15× at 100, and mis-pay less', () => {
    expect(dealerSkillSpeed(0)).toBeCloseTo(0.8, 12);
    expect(dealerSkillSpeed(100)).toBeCloseTo(1.15, 12);
    expect(dealerSkillSpeed(40)).toBeCloseTo(0.94, 12);
    expect(dealerSkillSpeed(150)).toBeCloseTo(1.15, 12); // clamped
    expect(misPayChance(0)).toBeCloseTo(0.001, 12);
    expect(misPayChance(40)).toBeCloseTo(0.0006, 12);
    expect(misPayChance(100)).toBe(0);
  });

  it('mechanics repair faster and janitors sweep wider with skill', () => {
    expect(repairTimeFactor(0)).toBeCloseTo(1.4, 12);
    expect(repairTimeFactor(100)).toBeCloseTo(0.7, 12);
    expect(cleanRadius(0)).toBe(0);
    expect(cleanRadius(40)).toBe(1);
    expect(cleanRadius(100)).toBe(3);
  });
});

describe('shifts', () => {
  it('the three shifts cover every hour exactly once', () => {
    for (let h = 0; h < 24; h++)
      expect(
        SHIFTS.filter((s) => onShiftAt(s, h)),
        `hour ${h}`,
      ).toHaveLength(1);
    expect(onShiftAt('day', 8)).toBe(true);
    expect(onShiftAt('day', 16)).toBe(false);
    expect(onShiftAt('swing', 23)).toBe(true);
    expect(onShiftAt('graveyard', 0)).toBe(true);
    expect(onShiftAt('graveyard', 8)).toBe(false);
  });
});

describe('fatigue and morale', () => {
  const shift = (wageRatio: number, short: boolean, hours = 8) => {
    const m = { morale: 70, fatigue: 0 };
    for (let i = 0; i < hours; i++) workHour(m, wageRatio, short);
    return m;
  };

  it('fatigue builds per hour on shift, faster when short-handed', () => {
    expect(shift(1, false).fatigue).toBe(8 * STAFF_DEPTH.fatiguePerHour);
    expect(shift(1, true).fatigue).toBe(
      8 * (STAFF_DEPTH.fatiguePerHour + STAFF_DEPTH.fatigueUnderstaffed),
    );
    expect(shift(1, true, 40).fatigue).toBe(100);
  });

  it('a fair wage on a normal shift keeps morale near 70', () => {
    const m = shift(1, false);
    expect(m.morale).toBeGreaterThan(65);
    expect(m.morale).toBeLessThanOrEqual(70);
  });

  it('pay moves morale; short-handed shifts wear it down', () => {
    expect(shift(1.5, false).morale).toBeGreaterThan(shift(1, false).morale + 20);
    expect(shift(0.5, false).morale).toBeLessThan(shift(1, false).morale - 20);
    expect(shift(1, true).morale).toBeLessThan(shift(1, false).morale);
    // Four underpaid shifts in a row push a member under the low line.
    const m = { morale: 70, fatigue: 0 };
    for (let d = 0; d < 4; d++) {
      m.fatigue = 0;
      for (let h = 0; h < 8; h++) workHour(m, 0.5, false);
    }
    expect(m.morale).toBeLessThan(STAFF_DEPTH.lowMorale);
  });

  it('low morale slows work and risks a quit', () => {
    expect(moraleSpeed(29)).toBe(0.8);
    expect(moraleSpeed(30)).toBe(1);
    expect(quitChance(30)).toBe(0);
    expect(quitChance(15)).toBeCloseTo(0.2, 12);
    expect(quitChance(0)).toBeCloseTo(0.4, 12);
  });
});

describe('the pit', () => {
  it('a pit boss spots an advantage player in range 20% to 100% of hours by skill', () => {
    expect(detectChance(0)).toBeCloseTo(0.2, 12);
    expect(detectChance(50)).toBeCloseTo(0.6, 12);
    expect(detectChance(100)).toBeCloseTo(1, 12);
  });
});
