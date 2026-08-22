import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { CAMPAIGNS } from '../data/campaigns';
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

  // P16 — the limit is enforced continuously, not only at the close.
  //
  // While the check lived in the day-close block alone, a breach at 3pm that
  // recovered by midnight cost nothing at all, so the ceiling only ever bound
  // the closing balance. Now that the house can expand on credit, that gap is
  // the difference between a limit and a suggestion.
  it('sells the moment the limit is breached, without waiting for midnight', () => {
    const world = overdrawnFloor();
    world.state.cash = -DEBT.defaultCreditLimit - 5000;
    // A handful of ticks — a small fraction of a day, and nowhere near a close.
    for (let i = 0; i < 3; i++) world.tick();
    expect(world.time.day).toBe(1);
    expect(world.state.allObjects().map((o) => o.defId)).not.toContain('plant');
  });

  it('stops selling as soon as the balance is back inside the limit', () => {
    const world = overdrawnFloor();
    // Only just under: one sale covers it, so a continuously-running check must
    // not strip the floor simply because it now runs 1200 times a day.
    world.state.cash = -DEBT.defaultCreditLimit - 1;
    const before = world.state.allObjects().length;
    for (let i = 0; i < 200; i++) world.tick();
    expect(world.state.cash).toBeGreaterThanOrEqual(-DEBT.defaultCreditLimit);
    expect(world.state.allObjects().length).toBe(before - 1);
  });
});

describe('insolvency', () => {
  it('fails a campaign when there is nothing left to sell', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(CAMPAIGNS[0]!);
    let failure: { reason: string } | null = null;
    eventBus.on('scenarioFailed', (e) => (failure = e as { reason: string }));
    // One revenue object, which is protected — so liquidation can free nothing.
    for (const o of world.state.allObjects()) world.sell(o.id);
    world.place('slot-machine', 6, 6);
    world.state.cash = -world.creditLimit - 50_000;
    for (let i = 0; i < DAY_TICKS; i++) world.tick();
    expect(failure).not.toBeNull();
    expect(failure!.reason).toBe('insolvent');
  });

  it('never fails the sandbox — free play has no goal, so it has no fail state', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(null);
    let failed = false;
    eventBus.on('scenarioFailed', () => (failed = true));
    world.place('slot-machine', 6, 6);
    world.state.cash = -world.creditLimit - 50_000;
    for (let i = 0; i < DAY_TICKS * 2; i++) world.tick();
    expect(failed).toBe(false);
  });

  it('lets the day that completes the goal win even if it closed under the limit', () => {
    // Drives `goalConsecutiveDays` qualifying days rather than hard-coding one,
    // so this test stays true when Task 9 raises the streak requirement. The
    // property is ordering: onDayEnded resolves before the insolvency check,
    // so completing the goal wins the run rather than losing it to the bank.
    const def = CAMPAIGNS[0]!;
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(def);
    const outcomes: string[] = [];
    eventBus.on('goalReached', () => outcomes.push('won'));
    eventBus.on('scenarioFailed', () => outcomes.push('failed'));
    world.place('slot-machine', 6, 6);
    // Drives exactly as many qualifying days as the campaign's streak asks for,
    // rather than naming a number, so this stays true if the streak is retuned.
    //
    // Only the day that *completes* the streak is driven under the limit.
    // Sinking an earlier qualifying day would have the bank end the run before
    // the streak can finish — true, but a different property: this test is
    // about onDayEnded resolving before the insolvency check, so the day that
    // wins the run wins it rather than losing it to the bank.
    const need = def.goalConsecutiveDays;
    for (let d = 0; d < need && outcomes.length === 0; d++) {
      world.ledger.addRevenue(def.goalDailyProfit + 20_000);
      world.state.cash = d === need - 1 ? -world.creditLimit - 50_000 : 50_000;
      for (let i = 0; i < DAY_TICKS; i++) world.tick();
    }
    expect(outcomes[0]).toBe('won');
  });
});
