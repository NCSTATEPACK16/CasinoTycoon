// B4: loans in the world, and the finance views the Finances tab reads.

import { afterEach, describe, expect, it } from 'vitest';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { eventBus } from '../EventBus';
import { LOANS } from '../data/balance';
import { CAMPAIGNS } from '../data/campaigns';
import { runCommand } from '../worker/commands';
import type { DayReport, FinanceHistory, LoansView } from '../worker/finance';
import { SnapshotBuilder } from '../worker/snapshot';
import { installmentFor } from './economy/loans';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const DAY = HOURS_PER_DAY * TICKS_PER_HOUR;

/** Tick to just after the next midnight close. */
function toMidnight(world: CasinoWorld) {
  const day = world.time.day;
  while (world.time.day === day) world.tick();
}

function floor(world: CasinoWorld) {
  world.place('slot-machine', 10, 10);
  world.place('slot-machine', 12, 10);
  world.place('blackjack-table', 16, 10);
  world.place('toilet', 4, 4);
}

describe('loans in the world', () => {
  it('moves cash but not the P&L, and books interest only at midnight', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    world.startScenario(null);
    const cash = world.state.cash;
    const revenue = world.ledger.todayRevenue;
    const expenses = world.ledger.todayExpenses;
    const loan = world.takeLoan(10_000, 14)!;
    expect(loan.principal).toBe(10_000);
    expect(world.state.cash).toBe(cash + 10_000);
    expect(world.ledger.todayRevenue).toBe(revenue);
    expect(world.ledger.todayExpenses).toBe(expenses);

    const before = world.state.cash;
    toMidnight(world);
    const rec = world.ledger.history.at(-1)!;
    const rate = LOANS.terms.find((t) => t.days === 14)!.rate;
    expect(rec.loanInterest).toBeCloseTo(10_000 * rate, 2);
    expect(rec.debt).toBeCloseTo(10_000 - (installmentFor(10_000, rate, 14) - 10_000 * rate), 4);
    expect(rec.notes).toContain('Borrowed $10,000 over 14 days.');
    // An empty floor with no staff has no other costs: cash fell by exactly
    // the installment, and only its interest part reached the books.
    expect(before - world.state.cash).toBeCloseTo(loan.installment, 2);
    expect(rec.expenses).toBeCloseTo(rec.loanInterest!, 2);
  });

  it('runs a loan to zero over its term, and repays early from cash', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    world.startScenario(null);
    world.takeLoan(7000, 7);
    for (let d = 0; d < 7; d++) toMidnight(world);
    expect(world.loans.loans).toHaveLength(0);
    expect(world.ledger.history.at(-1)!.notes).toContain('A loan is paid off.');

    const loan = world.takeLoan(5000, 28)!;
    expect(world.repayLoan(loan.id, 2000)).toBe(2000);
    expect(world.loans.outstanding).toBe(3000);
    world.state.cash = 1000;
    expect(world.repayLoan(loan.id, 3000)).toBe(1000); // only what's on hand
    world.state.cash = 0;
    expect(world.repayLoan(loan.id, 3000)).toBe(0);
  });

  it('holds each campaign to its own loan limit, and saves the book', () => {
    for (const def of CAMPAIGNS) {
      const world = new CasinoWorld({ seed: 4, autoSpawn: false });
      world.startScenario(def);
      expect(world.loanLimit).toBe(def.loanLimit);
      expect(world.takeLoan(def.loanLimit! + LOANS.step, 7)).toBeNull();
      expect(world.takeLoan(def.loanLimit!, 7)).not.toBeNull();
      const back = CasinoWorld.fromJSON(world.toJSON());
      expect(back.loans.outstanding).toBe(def.loanLimit);
    }
    const sandbox = new CasinoWorld({ seed: 4, autoSpawn: false });
    sandbox.startScenario(null);
    expect(sandbox.loanLimit).toBe(LOANS.defaultLimit);
  });

  it('puts a midnight forced sale in the report of the day that caused it', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    world.startScenario(CAMPAIGNS[0]!);
    floor(world);
    world.state.cash = -world.creditLimit - 10;
    toMidnight(world);
    const closed = world.ledger.history.at(-1)!;
    expect(closed.notes!.some((n) => n.startsWith('The bank forced a sale'))).toBe(true);
    expect(world.ledger.toJSON().dayNotes).toEqual([]); // nothing leaks into the new day
  });
});

describe('finance views', () => {
  it('serves loan offers, and borrows and repays through commands', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    world.startScenario(CAMPAIGNS[0]!);
    const snap = new SnapshotBuilder();
    const view = () => (runCommand(world, snap, { type: 'loans' }) as { data: LoansView }).data;
    expect(view()).toMatchObject({ limit: 2000, outstanding: 0, available: 2000 });
    expect(view().offers.map((o) => o.days)).toEqual([7, 14, 28]);
    expect(view().offers[0]!.installment).toBeCloseTo(installmentFor(2000, 0.015, 7), 6);
    const r = runCommand(world, snap, { type: 'takeLoan', amount: 1500, days: 14 });
    expect(r.ok).toBe(true);
    expect(view()).toMatchObject({ outstanding: 1500, available: 500 });
    expect(runCommand(world, snap, { type: 'takeLoan', amount: 1000, days: 7 }).ok).toBe(false);
    const id = view().loans[0]!.id;
    expect(runCommand(world, snap, { type: 'repayLoan', loanId: id, amount: 1500 })).toEqual({
      ok: true,
      data: 1500,
    });
    expect(view().loans).toEqual([]);
  });

  it('charts hours and days with cash, hold and guests, and reports a closed day', () => {
    const world = new CasinoWorld({ seed: 9, autoSpawn: true });
    world.startScenario(null);
    floor(world);
    world.hireStaff('dealer');
    const snap = new SnapshotBuilder();
    expect(runCommand(world, snap, { type: 'dayReport' }).ok).toBe(false); // nothing closed yet
    for (let t = 0; t < 2 * DAY; t++) world.tick();
    const h = (runCommand(world, snap, { type: 'financeHistory' }) as { data: FinanceHistory })
      .data;
    expect(h.hours.length).toBeGreaterThanOrEqual(47);
    expect(h.hours.every((p) => p.cash !== null)).toBe(true);
    expect(h.hours.some((p) => p.handle > 0 && p.hold !== null)).toBe(true);
    const closed = h.days.filter((d) => !d.partial);
    expect(closed.length).toBe(2);
    expect(h.days.at(-1)!.partial).toBe(true);
    const sumWin = h.hours.filter((p) => p.day === closed[1]!.day).reduce((a, p) => a + p.win, 0);
    expect(sumWin).toBeCloseTo(closed[1]!.win, 4); // the hours add up to the day

    const rep = (runCommand(world, snap, { type: 'dayReport' }) as { data: DayReport }).data;
    const last = world.ledger.history.at(-1)!;
    expect(rep.day).toBe(last.day);
    expect(rep.pnl.profit).toBeCloseTo(last.profit, 6);
    expect(rep.previousProfit).toBe(world.ledger.history.at(-2)!.profit);
    expect(rep.rating).toEqual({
      value: last.rating,
      delta: last.rating! - world.ledger.history.at(-2)!.rating!,
    });
    expect(rep.best).not.toBeNull();
    expect(rep.worst).not.toBeNull();
    expect(rep.best!.net).toBeGreaterThanOrEqual(rep.worst!.net);
    expect(rep.cash).toBe(last.cash);
    const first = (
      runCommand(world, snap, { type: 'dayReport', day: world.ledger.history[0]!.day }) as {
        data: DayReport;
      }
    ).data;
    expect(first.previousProfit).toBeNull();
  });
});
