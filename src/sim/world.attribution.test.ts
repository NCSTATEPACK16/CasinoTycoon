import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { HOUSE_SOURCES } from './economy';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const TICKS_PER_DAY = HOURS_PER_DAY * TICKS_PER_HOUR;

/** A floor with something of every earning kind on it, plus staff to pay. */
function busyWorld(seed = 21) {
  const world = new CasinoWorld({ seed, autoSpawn: true });
  world.startScenario(null);
  world.state.cash = 500000;
  world.place('slot-machine', 8, 8);
  world.place('slot-machine', 10, 8);
  world.place('blackjack-table', 14, 10);
  world.place('food-stall', 18, 8);
  world.place('bar', 22, 8);
  world.place('toilet', 26, 8);
  world.hireStaff('janitor');
  world.hireStaff('bartender');
  return world;
}

describe('P1 — revenue attribution', () => {
  it('starts with nothing attributed', () => {
    const world = busyWorld();
    expect(world.ledger.sources.size).toBe(0);
  });

  it('books a machine play to that machine', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    world.state.cash = 100000;
    const po = world.place('slot-machine', 8, 8)!;
    const guest = world.spawnGuest('regular');
    guest.wallet = 5000;

    const result = world.playMachine(po.id, guest.id)!;
    const row = world.ledger.sources.get(po.id)!;
    expect(row).toBeDefined();
    expect(row.defId).toBe('slot-machine');
    expect(row.wagered).toBe(result.wager);
    expect(row.won).toBe(result.payout);
    expect(row.revenue).toBe(result.wager - result.payout);
  });

  it('keeps handle and hold as separate questions', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    world.state.cash = 100000;
    const po = world.place('slot-machine', 8, 8)!;
    const guest = world.spawnGuest('regular');
    guest.wallet = 100000;
    for (let i = 0; i < 200; i++) world.playMachine(po.id, guest.id);

    const row = world.ledger.sources.get(po.id)!;
    // A machine can move a lot of money and keep only a slice of it; the two
    // numbers must not collapse into one.
    expect(row.wagered).toBeGreaterThan(0);
    expect(row.won).toBeGreaterThan(0);
    expect(row.revenue).toBe(row.wagered - row.won);
    expect(row.wagered).toBeGreaterThan(row.revenue);
  });

  it('books upkeep to the object that owes it', () => {
    const world = busyWorld();
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    const record = world.ledger.history[0]!;
    const withUpkeep = record.sources.filter((r) => r.upkeep > 0 && !r.id.startsWith('house:'));
    expect(withUpkeep.length).toBeGreaterThan(0);
    for (const row of withUpkeep) expect(world.state.getObject(row.id)).toBeDefined();
  });

  it('books wages, comps, and fines to the house rather than inventing an owner', () => {
    const world = busyWorld();
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    const wages = world.ledger.history[0]!.sources.find((r) => r.id === HOUSE_SOURCES.wages.id);
    expect(wages).toBeDefined();
    expect(wages!.upkeep).toBeGreaterThan(0);
    // Attributing a janitor's pay to a slot machine would be an allocation
    // nobody asked for; it stays where it can be defended.
    expect(wages!.revenue).toBe(0);
  });

  it('reconciles exactly with the day it closed', () => {
    // The whole point of accruing at the existing addRevenue/addExpense sites
    // rather than through a parallel path: the parts must sum to the whole, or
    // the drill-down quietly lies about where the money went.
    const world = busyWorld();
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    const record = world.ledger.history[0]!;
    const revenue = record.sources.reduce((sum, r) => sum + r.revenue, 0);
    const upkeep = record.sources.reduce((sum, r) => sum + r.upkeep, 0);
    expect(record.sources.length).toBeGreaterThan(0);
    expect(revenue).toBeCloseTo(record.revenue, 6);
    expect(upkeep).toBeCloseTo(record.expenses, 6);
    expect(revenue - upkeep).toBeCloseTo(record.profit, 6);
  });

  it('reconciles over several days, each attributed to its own day', () => {
    const world = busyWorld(77);
    for (let t = 0; t < TICKS_PER_DAY * 3 + 5; t++) world.tick();
    expect(world.ledger.history.length).toBe(3);
    for (const record of world.ledger.history) {
      const net =
        record.sources.reduce((s, r) => s + r.revenue, 0) -
        record.sources.reduce((s, r) => s + r.upkeep, 0);
      expect(net).toBeCloseTo(record.profit, 6);
    }
  });

  it('clears the live accrual at midnight so a day is not double-counted', () => {
    const world = busyWorld();
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    // Straight after the roll the new day has at most the fresh day's activity,
    // never the closed day's rows.
    const closed = world.ledger.history[0]!.sources.reduce((s, r) => s + r.revenue, 0);
    const live = [...world.ledger.sources.values()].reduce((s, r) => s + r.revenue, 0);
    expect(closed).not.toBe(0);
    expect(Math.abs(live)).toBeLessThan(Math.abs(closed));
  });

  it('answers the net-per-source question the overlay asks', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    world.state.cash = 100000;
    const po = world.place('slot-machine', 8, 8)!;
    expect(world.ledger.netForSource(po.id)).toBeNull();
    const guest = world.spawnGuest('regular');
    guest.wallet = 100000;
    for (let i = 0; i < 50; i++) world.playMachine(po.id, guest.id);
    const row = world.ledger.sources.get(po.id)!;
    expect(world.ledger.netForSource(po.id)).toBe(row.revenue - row.upkeep);
  });

  it('round-trips the live accrual through a save', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    world.state.cash = 100000;
    const po = world.place('slot-machine', 8, 8)!;
    const guest = world.spawnGuest('regular');
    guest.wallet = 100000;
    for (let i = 0; i < 30; i++) world.playMachine(po.id, guest.id);
    const before = world.ledger.netForSource(po.id);

    const restored = new CasinoWorld({ seed: 1 });
    restored.loadJSON(JSON.parse(JSON.stringify(world.toJSON())));
    expect(restored.ledger.netForSource(po.id)).toBe(before);
  });

  it('loads a pre-P1 save with no attribution rather than throwing', () => {
    const world = busyWorld();
    for (let t = 0; t < 400; t++) world.tick();
    const snapshot = JSON.parse(JSON.stringify(world.toJSON()));
    delete snapshot.ledger.daySources;
    for (const r of snapshot.ledger.history) delete r.sources;
    const restored = new CasinoWorld({ seed: 1 });
    expect(() => restored.loadJSON(snapshot)).not.toThrow();
    expect(restored.ledger.sources.size).toBe(0);
    for (const r of restored.ledger.history) expect(r.sources).toEqual([]);
  });
});
