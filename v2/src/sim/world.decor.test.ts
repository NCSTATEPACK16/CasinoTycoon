// B6: decor with real effects. A decorated floor beats a bare one on guest
// happiness and on how long guests stay; the lounge rests guests and staff;
// the ATM tops up wallets for a fee; the stage opens the concert.

import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { ATM_BALANCE, CASHIER_BALANCE, LOUNGE_BALANCE } from '../data/balance';
import { SANDBOX } from '../data/campaigns';
import { furnish } from './agents/testkit';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const TICKS_PER_DAY = 50 * 24;

/** Decor along the aisles of testkit's furnished floor. */
function decorate(world: CasinoWorld): number {
  let placed = 0;
  const tryPut = (defId: string, col: number, row: number) => {
    if (world.place(defId, col, row)) placed++;
  };
  tryPut('fountain', 14, 26);
  for (let col = 11; col <= 22; col += 3) {
    tryPut('statue', col, 3);
    tryPut('lamp-post', col, 25);
  }
  for (let row = 4; row <= 24; row += 4) {
    tryPut('lamp-post', 10, row);
    tryPut('plant', 23, row);
    tryPut('neon-sign', 33, row);
  }
  return placed;
}

function run(decor: boolean, seed: number) {
  const world = new CasinoWorld({ seed, autoSpawn: true });
  world.state.cash = 1_000_000;
  // testkit's furnished floor, less its restrooms, food and bar: with every
  // need met, guests sit at ~92% happy and nothing has room to lift them.
  // Without services their needs go critical and sour them, which is where a
  // pleasant floor shows (and where a guest who sours slower stays longer).
  furnish(world);
  for (const po of [...world.state.allObjects()])
    if (['toilet', 'food-stall', 'bar'].includes(po.defId)) world.sell(po.id);
  const pieces = decor ? decorate(world) : 0;
  let guestTicks = 0;
  let departures = 0;
  let happySum = 0;
  let happyN = 0;
  eventBus.on('guestLeft', () => departures++);
  for (let t = 0; t < 2 * TICKS_PER_DAY; t++) {
    world.tick();
    guestTicks += world.guests.size;
    if (t % 25 === 0 && world.guests.size > 0) {
      happySum += world.averageHappiness;
      happyN++;
    }
  }
  return {
    pieces,
    happiness: happySum / happyN,
    dwell: guestTicks / Math.max(1, departures + world.guests.size),
    appeal: world.appeal.mean,
    decorTerm: world.ratingBreakdown().signage,
  };
}

describe('B6: a decorated floor beats a bare one', () => {
  it('on happiness and dwell time (three seeds, summed)', { timeout: 300_000 }, () => {
    const seeds = [11, 12, 13];
    const bare = seeds.map((s) => run(false, s));
    const decked = seeds.map((s) => run(true, s));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const r = {
      pieces: decked[0]!.pieces,
      happiness: [mean(bare.map((x) => x.happiness)), mean(decked.map((x) => x.happiness))],
      dwell: [mean(bare.map((x) => x.dwell)), mean(decked.map((x) => x.dwell))],
      appeal: [bare[0]!.appeal, decked[0]!.appeal],
      decorTerm: [bare[0]!.decorTerm, decked[0]!.decorTerm],
    };
    console.log('B6 bare → decorated', JSON.stringify(r));
    expect(r.pieces).toBeGreaterThanOrEqual(20);
    expect(r.decorTerm[1]!).toBeGreaterThan(r.decorTerm[0]! + 3);
    expect(r.happiness[1]!).toBeGreaterThan(r.happiness[0]!);
    expect(r.dwell[1]!).toBeGreaterThan(r.dwell[0]!);
  });
});

describe('B6: lounge seating', () => {
  it('a tired guest rests there: energy back to full and a happier guest', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.place('lounge-seating', 10, 10);
    const g = world.spawnGuest();
    g.needs.energy = 20;
    const happy0 = g.needs.happiness;
    let rested = false;
    for (let t = 0; t < 600 && !rested; t++) {
      world.tick();
      if (g.needs.energy > 90) rested = true;
    }
    expect(rested).toBe(true);
    expect(g.needs.happiness).toBeGreaterThanOrEqual(happy0 + LOUNGE_BALANCE.happinessOnRest - 1);
  });

  it('lets staff take breaks, which keeps morale up over a day', () => {
    // Fatigue and morale run only in a scenario (B11), so this is the sandbox.
    const day = (lounge: boolean) => {
      const world = new CasinoWorld({ seed: 6, autoSpawn: false });
      world.startScenario(SANDBOX);
      world.state.cash = 1_000_000;
      if (lounge) expect(world.place('lounge-seating', 40, 30)).not.toBeNull();
      // Three janitors (one a shift) against a floor that keeps getting
      // messier: short-handed, they tire at twice the rate and reach the
      // break threshold mid-shift, which only a lounge lets them take.
      for (let i = 0; i < 3; i++) world.hireStaff('janitor');
      for (let t = 0; t < TICKS_PER_DAY; t++) {
        while (world.messes.size < 30) world.dropMess(20 + (t % 30), 20 + (world.messes.size % 10), 'trash');
        world.tick();
      }
      const staff = [...world.staff.values()];
      return staff.reduce((s, m) => s + m.morale, 0) / staff.length;
    };
    expect(world0RestCheck()).toBe(true);
    expect(day(true)).toBeGreaterThan(day(false));
  });
});

/** The hook B11 reads: a lounge is a place to rest. */
function world0RestCheck(): boolean {
  const world = new CasinoWorld({ seed: 1, autoSpawn: false });
  const before = world.staffRestAvailable();
  world.place('lounge-seating', 4, 4);
  return !before && world.staffRestAvailable();
}

describe('B6: the ATM', () => {
  it('tops up a guest running dry, once, and the house keeps the fee', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const atm = world.place('atm', 10, 10)!;
    world.place('slot-machine', 20, 20);
    const g = world.spawnGuest();
    g.wallet = CASHIER_BALANCE.walletThreshold - 5;
    const cash0 = world.state.cash;
    const wallet0 = g.wallet;
    let topped = false;
    for (let t = 0; t < 400 && !topped; t++) {
      world.tick();
      if (g.wallet > wallet0 + 10) topped = true;
    }
    expect(topped).toBe(true);
    expect(world.state.cash).toBeGreaterThanOrEqual(cash0 + ATM_BALANCE.fee);
    expect(world.ledger.toJSON()).toBeDefined();
    void atm;
  });
});

describe('B6: the stage opens the concert', () => {
  it('is blocked without a stage and bookable with one', () => {
    const world = new CasinoWorld({ seed: 8, autoSpawn: false });
    world.state.cash = 100_000;
    world.startScenario(SANDBOX);
    world.state.cash = 100_000;
    expect(() => world.runEvent('concert')).toThrow(/stage/i);
    world.place('stage', 10, 10);
    expect(() => world.runEvent('concert')).not.toThrow();
  });
});
