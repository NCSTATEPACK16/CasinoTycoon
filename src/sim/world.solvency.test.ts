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

describe('forced liquidation', () => {
  /** A stocked sandbox floor pushed below an artificially tight limit. */
  function overdrawnFloor(): CasinoWorld {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    world.startScenario(null);
    world.place('slot-machine', 6, 6);
    world.place('slot-machine', 8, 6);
    world.place('plant', 10, 6);
    world.place('toilet', 6, 12);
    return world;
  }

  it('sells the decor first and says so', () => {
    const world = overdrawnFloor();
    const lines: string[] = [];
    eventBus.on('tickerMessage', (e) => lines.push((e as { text: string }).text));
    world.state.cash = -DEBT.defaultCreditLimit - 5000;
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    const stillThere = world.state.allObjects().map((o) => o.defId);
    expect(stillThere).not.toContain('plant');
    // A silent balance correction teaches nothing. Matches the copy this task
    // specifies below — keep the two in step if you reword the ticker line.
    expect(lines.some((l) => /forced a sale/i.test(l))).toBe(true);
  });

  it('never sells the last toilet or the last revenue object', () => {
    const world = overdrawnFloor();
    world.state.cash = -DEBT.defaultCreditLimit - 500_000;
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    const left = world.state.allObjects().map((o) => o.defId);
    expect(left).toContain('toilet');
    expect(left.filter((d) => d === 'slot-machine').length).toBeGreaterThanOrEqual(1);
  });

  it('stops once the balance is back above the limit, rather than stripping the floor', () => {
    const world = overdrawnFloor();
    const objectsBefore = world.state.allObjects().length;
    // Start just *above* the limit; the day's upkeep and interest are what
    // push it under. Do not assert an exact number of sales — upkeep and
    // interest are both charged before liquidation runs, so the size of the
    // shortfall is not the number you set here.
    world.state.cash = -DEBT.defaultCreditLimit + 400;
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    expect(world.state.cash).toBeGreaterThanOrEqual(-DEBT.defaultCreditLimit);
    expect(world.state.allObjects().length).toBeLessThan(objectsBefore);
    expect(world.state.allObjects().length).toBeGreaterThan(1);
  });

  it('leaves a solvent floor completely alone', () => {
    const world = overdrawnFloor();
    const objectsBefore = world.state.allObjects().length;
    world.state.cash = 5000;
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    expect(world.state.allObjects().length).toBe(objectsBefore);
  });
});
