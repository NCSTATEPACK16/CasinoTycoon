import { describe, expect, it } from 'vitest';
import { REPUTATION } from '../data/balance';
import { Reputation } from './reputation';

describe('Reputation', () => {
  it('starts neutral, with every archetype unbiased', () => {
    const rep = new Reputation();
    expect(rep.value).toBe(REPUTATION.start);
    expect(rep.archetypeMultiplier('highRoller')).toBeCloseTo(1, 5);
    expect(rep.archetypeMultiplier('tourist')).toBeCloseTo(1, 5);
    expect(rep.archetypeMultiplier('biker')).toBeCloseTo(1, 5);
    // 'regular' has no entry, so it is never biased directly — it absorbs
    // whatever the other three leave behind.
    expect(rep.archetypeMultiplier('regular')).toBe(1);
  });

  it('accrues the day’s events and applies them at midnight', () => {
    const rep = new Reputation();
    rep.onJackpotPayout();
    rep.onJackpotPayout();
    expect(rep.value).toBe(REPUTATION.start); // nothing lands mid-day
    const applied = rep.closeDay();
    expect(applied).toBeCloseTo(2 * REPUTATION.deltaPerJackpotPayout, 5);
    expect(rep.value).toBeGreaterThan(REPUTATION.start);
  });

  it('caps one day’s movement however bad the day was', () => {
    const rep = new Reputation();
    for (let i = 0; i < 500; i++) rep.onRageQuit();
    expect(rep.cappedDelta).toBe(-REPUTATION.maxDailyDelta);
    const before = rep.value;
    rep.closeDay();
    // Post-drift, so strictly less than the cap — but never worse than it.
    expect(before - rep.value).toBeLessThanOrEqual(REPUTATION.maxDailyDelta);
  });

  it('clears the accrual so yesterday is not charged twice', () => {
    const rep = new Reputation();
    rep.onRageQuit();
    rep.closeDay();
    const quiet = rep.value;
    rep.closeDay();
    // Second close moves only by drift, back toward the mean.
    expect(rep.value).toBeGreaterThan(quiet);
    expect(rep.value).toBeLessThan(REPUTATION.start);
  });

  it('drifts toward the mean on a day with no events', () => {
    const rep = new Reputation();
    rep.value = 90;
    rep.closeDay();
    expect(rep.value).toBeLessThan(90);
    expect(rep.value).toBeGreaterThan(REPUTATION.start);

    rep.value = 10;
    rep.closeDay();
    expect(rep.value).toBeGreaterThan(10);
    expect(rep.value).toBeLessThan(REPUTATION.start);
  });

  it('escapes a floored reputation given clean days — no death spiral', () => {
    const rep = new Reputation();
    rep.value = REPUTATION.min;
    // Pure drift, no positive events at all: the player merely stops being
    // terrible. That alone has to be a way back.
    for (let day = 0; day < 40; day++) rep.closeDay();
    expect(rep.value).toBeGreaterThan(25);
  });

  it('stays inside its bounds under sustained pressure in both directions', () => {
    const rep = new Reputation();
    for (let day = 0; day < 200; day++) {
      for (let i = 0; i < 50; i++) rep.onRageQuit();
      rep.closeDay();
    }
    expect(rep.value).toBeGreaterThanOrEqual(REPUTATION.min);
    for (let day = 0; day < 200; day++) {
      for (let i = 0; i < 50; i++) rep.onJackpotPayout();
      rep.closeDay();
    }
    expect(rep.value).toBeLessThanOrEqual(REPUTATION.max);
  });

  it('biases the arrival mix toward the listed archetypes at high reputation', () => {
    const rep = new Reputation();
    rep.value = REPUTATION.max;
    expect(rep.archetypeMultiplier('highRoller')).toBeCloseTo(
      REPUTATION.archetypeBiasAtMax.highRoller,
      5,
    );
    expect(rep.archetypeMultiplier('tourist')).toBeCloseTo(
      REPUTATION.archetypeBiasAtMax.tourist,
      5,
    );
    // Bikers are the one archetype a good reputation drives away.
    expect(rep.archetypeMultiplier('biker')).toBeCloseTo(
      REPUTATION.archetypeBiasAtMax.biker,
      5,
    );
  });

  it('inverts the mix at rock bottom rather than merely flattening it', () => {
    const rep = new Reputation();
    rep.value = REPUTATION.min;
    expect(rep.archetypeMultiplier('highRoller')).toBeLessThan(1);
    expect(rep.archetypeMultiplier('tourist')).toBeLessThan(1);
    // The archetype a *good* reputation repels is the one a ruined one attracts.
    expect(rep.archetypeMultiplier('biker')).toBeGreaterThan(1);
  });

  it('moves the bias monotonically with the scalar', () => {
    const at = (v: number) => {
      const rep = new Reputation();
      rep.value = v;
      return rep.archetypeMultiplier('highRoller');
    };
    expect(at(0)).toBeLessThan(at(25));
    expect(at(25)).toBeLessThan(at(50));
    expect(at(50)).toBeLessThan(at(75));
    expect(at(75)).toBeLessThan(at(100));
  });

  it('round-trips through JSON, accrual included', () => {
    const rep = new Reputation();
    rep.value = 71.5;
    rep.onRageQuit();
    const restored = Reputation.fromJSON(rep.toJSON());
    expect(restored.value).toBe(71.5);
    expect(restored.cappedDelta).toBeCloseTo(rep.cappedDelta, 5);
  });

  it('tolerates a null or out-of-range payload', () => {
    expect(Reputation.fromJSON(null).value).toBe(REPUTATION.start);
    expect(Reputation.fromJSON({ value: 9999, pendingDelta: 0 }).value).toBe(REPUTATION.max);
    expect(Reputation.fromJSON({ value: -50, pendingDelta: 0 }).value).toBe(REPUTATION.min);
  });

  it('labels every band the scalar can reach', () => {
    const rep = new Reputation();
    const labels = new Set<string>();
    for (let v = REPUTATION.min; v <= REPUTATION.max; v++) {
      rep.value = v;
      labels.add(rep.label);
    }
    expect(labels.size).toBe(5);
  });
});
