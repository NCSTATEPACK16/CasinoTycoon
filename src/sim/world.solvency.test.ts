import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { DEBT } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const DAY_TICKS = HOURS_PER_DAY * TICKS_PER_HOUR;

/** A floor with running costs and no takings, driven straight into debt. */
function indebtedWorld(cash: number): CasinoWorld {
  const world = new CasinoWorld({ seed: 99, autoSpawn: false });
  world.startScenario(null);
  world.state.cash = cash;
  return world;
}

describe('debt interest at midnight', () => {
  it('charges nothing on a day that closes in the black', () => {
    const world = indebtedWorld(5000);
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    const record = world.ledger.history.at(-1)!;
    expect(record.interestPaid).toBe(0);
  });

  it('charges the rate on a day that closes under, and books it to the house', () => {
    const world = indebtedWorld(-2000);
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    const record = world.ledger.history.at(-1)!;
    expect(record.interestPaid).toBeGreaterThan(0);
    const interestSource = record.sources.find((s) => s.defId === 'interest');
    expect(interestSource).toBeDefined();
    expect(interestSource!.upkeep).toBe(record.interestPaid);
  });

  it('still reconciles: the day is exactly the sum of its sources', () => {
    // P1's guarantee. Interest must not open a parallel path.
    const world = indebtedWorld(-2000);
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    const record = world.ledger.history.at(-1)!;
    const summed = record.sources.reduce((n, s) => n + s.revenue - s.upkeep, 0);
    expect(summed).toBeCloseTo(record.profit, 6);
  });

  it('takes the interest out of the house cash', () => {
    const world = indebtedWorld(-2000);
    const before = world.state.cash;
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    const record = world.ledger.history.at(-1)!;
    expect(world.state.cash).toBeLessThanOrEqual(before - record.interestPaid);
  });

  it('exposes the credit limit, defaulting in sandbox', () => {
    expect(indebtedWorld(0).creditLimit).toBe(DEBT.defaultCreditLimit);
  });
});
