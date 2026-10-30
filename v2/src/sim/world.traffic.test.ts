// B3: traffic with a daily rhythm, and a cap that grows with the casino. The
// tuned campaigns keep their flat rate and fixed cap; Sandbox follows the
// clock and fills to what its floor can hold.

import { afterEach, describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../config';
import { eventBus } from '../EventBus';
import { GUEST_BALANCE } from '../data/balance';
import { CAMPAIGNS, SANDBOX } from '../data/campaigns';
import { dayFactor, hourFactor, TRAFFIC_BALANCE } from '../data/traffic';
import { navWorld } from './agents/testkit';
import { CasinoWorld, spawnChance } from './world';

afterEach(() => eventBus.clear());

function at(world: CasinoWorld, day: number, hour: number) {
  world.time.day = day;
  world.time.hour = hour;
  world.time.tickInHour = 0;
  return world.arrivalChance();
}

describe('the campaigns keep the traffic they were tuned on', () => {
  for (const def of CAMPAIGNS) {
    it(`${def.name}: flat arrivals at any hour, a cap of ${GUEST_BALANCE.maxGuests}, no planned stays`, () => {
      const world = new CasinoWorld({ seed: 3, autoSpawn: false });
      world.startScenario(def);
      world.place('slot-machine', 10, 10);
      world.place('slot-machine', 12, 10);
      const flat =
        spawnChance(world.rating, world.machines.size, world.reputation.value) *
        world.modifiers.spawnMult();
      expect(at(world, 1, 4)).toBe(flat);
      expect(at(world, 6, 21)).toBe(flat);
      expect(world.guestCap()).toBe(GUEST_BALANCE.maxGuests);
      expect(world.spawnGuest().leaveAtTick).toBeNull();
    });
  }

  it('a world with no scenario (the test default) is flat too', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    expect(world.trafficProfile).toEqual({ curve: 'flat', cap: GUEST_BALANCE.maxGuests });
  });
});

describe('Sandbox follows the clock', () => {
  function sandbox() {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(SANDBOX);
    for (let col = 10; col < 30; col++) world.place('slot-machine', col, 10);
    return world;
  }

  it('shapes arrivals by hour and weekday', () => {
    const world = sandbox();
    const evening = at(world, 1, 21);
    const lull = at(world, 1, 4);
    expect(evening / lull).toBeCloseTo(hourFactor(21) / hourFactor(4), 6);
    expect(at(world, 6, 21) / evening).toBeCloseTo(dayFactor(6), 6); // a Saturday
  });

  it('grows its cap with seats, services and rating, and draws more people for it', () => {
    const world = sandbox();
    expect(world.floorCapacity()).toBe(20);
    const before = { cap: world.guestCap(), chance: at(world, 1, 21) };
    for (let col = 10; col < 70; col++) world.place('slot-machine', col, 14);
    for (let col = 10; col < 70; col++) world.place('slot-machine', col, 18);
    world.place('toilet', 10, 24);
    expect(world.floorCapacity()).toBe(140 + TRAFFIC_BALANCE.serviceSeats);
    for (let i = 0; i < 10; i++) world.tick(); // the cap refreshes every few ticks
    expect(world.guestCap()).toBeGreaterThan(before.cap);
    const after = at(world, 1, 21);
    expect(after).toBeGreaterThan(before.chance);
  });

  it('gives each guest a planned visit of a few hours', () => {
    const world = sandbox();
    const { min, max } = TRAFFIC_BALANCE.stayHours;
    for (let i = 0; i < 50; i++) {
      const g = world.spawnGuest();
      const stay = g.leaveAtTick! - world.tickCount;
      expect(stay).toBeGreaterThanOrEqual(min * TICKS_PER_HOUR);
      expect(stay).toBeLessThanOrEqual(max * TICKS_PER_HOUR);
    }
  });
});

describe('a Sandbox floor built for ~300 guests, on the crowd', () => {
  it('fills to about its cap by the evening peak and empties toward late morning', async () => {
    const world = await navWorld(5, { scenario: SANDBOX });
    const put = (d: string, c: number, r: number) => world.place(d, c, r) !== null;
    for (let col = 30; col <= 54; col += 4) put('blackjack-table', col, 22);
    for (let row = 5; row <= 12; row += 2) put('toilet', 5, row);
    for (let col = 6; col <= 15; col += 3) put('food-stall', col, 58);
    put('bar', 6, 46);
    put('bar', 10, 46);
    // Slot banks two deep with two-cell aisles, clear of the lobby doors.
    banks: for (let row = 28; row < 48; row++) {
      if ((row - 28) % 4 > 1) continue;
      for (let col = 20; col < 78; col++) {
        if (col % 7 <= 1) continue;
        if (world.floorCapacity() >= 210) break banks;
        put('slot-machine', col, row);
      }
    }
    for (const k of ['janitor', 'janitor', 'janitor', 'janitor', 'mechanic'] as const)
      world.hireStaff(k);
    world.autoSpawn = true;
    const byHour = new Map<string, number>();
    // Day 1 opens at noon; run to day 2, 16:00.
    for (let t = 0; t < 28 * TICKS_PER_HOUR; t++) {
      world.tick();
      if (world.time.tickInHour === 0)
        byHour.set(`${world.time.day}/${world.time.hour}`, world.guests.size);
    }
    const cap = world.guestCap();
    expect(cap).toBeGreaterThan(260);
    expect(cap).toBeLessThan(340);
    const evening = Math.max(...[20, 21, 22, 23].map((h) => byHour.get(`1/${h}`)!));
    const morning = Math.min(...[9, 10, 11, 12].map((h) => byHour.get(`2/${h}`)!));
    expect(evening).toBeGreaterThanOrEqual(cap * 0.9);
    expect(evening).toBeLessThanOrEqual(cap);
    expect(morning).toBeLessThan(evening * 0.6);
  }, 120_000);
});
