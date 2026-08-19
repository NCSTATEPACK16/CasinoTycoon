import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { COMPS, PATRONS } from '../data/balance';
import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

/** A floor that actually takes money, so guests generate real theo. */
function stockedWorld(seed: number, autoSpawn = true): CasinoWorld {
  const world = new CasinoWorld({ seed, autoSpawn });
  world.startScenario(null);
  world.place('slot-machine', 6, 6);
  world.place('slot-machine', 8, 6);
  world.place('slot-machine', 10, 6);
  world.place('toilet', 6, 12);
  world.place('bar', 10, 12);
  return world;
}

const DAY_TICKS = HOURS_PER_DAY * TICKS_PER_HOUR;

/**
 * Spawn one high roller, let them play until they have earned a card, then
 * empty their wallet so they head for the door. Faster and steadier than
 * waiting for a natural bust-out, and the departure path is the real one.
 */
function playOutOneGuest(world: CasinoWorld): void {
  const guest = world.spawnGuest('highRoller');
  for (let i = 0; i < DAY_TICKS * 2 && guest.theo() < PATRONS.cardThresholdTheo; i++) {
    world.tick();
  }
  expect(guest.theo()).toBeGreaterThanOrEqual(PATRONS.cardThresholdTheo);
  guest.wallet = 0;
  for (let i = 0; i < DAY_TICKS && world.guests.size > 0; i++) {
    world.tick();
    guest.wallet = 0;
  }
  expect(world.guests.size).toBe(0);
}

describe('P3 — the registry inside a running sim', () => {
  it('cards guests off their own play, without the player doing anything', () => {
    const world = stockedWorld(4242);
    for (let i = 0; i < DAY_TICKS * 3; i++) world.tick();
    expect(world.patrons.size).toBeGreaterThan(0);
    for (const patron of world.patrons.all()) {
      expect(patron.lifetimeTheo).toBeGreaterThanOrEqual(PATRONS.cardThresholdTheo);
      expect(patron.visits).toBeGreaterThanOrEqual(1);
    }
  });

  it('holds the roster inside its cap over a long run', () => {
    const world = stockedWorld(77);
    for (let i = 0; i < DAY_TICKS * 12; i++) world.tick();
    expect(world.patrons.size).toBeLessThanOrEqual(PATRONS.rosterCap);
  });

  it('brings a carded patron back under their own name', () => {
    const world = stockedWorld(99, false);
    playOutOneGuest(world);
    const patron = world.patrons.all()[0];
    expect(patron).toBeDefined();

    // Force them due, then open the door.
    while (world.patrons.takeDue()) {
      /* drain whatever the midnight draw left */
    }
    world.patrons.drawForDay(world.time.day + 1, {
      chance: () => true,
      next: () => 0,
      int: () => 0,
    } as never);
    const returning = world.spawnGuest();
    expect(returning.patronId).toBe(patron!.id);
    expect(returning.name).toBe(patron!.name);
    expect(returning.patronTier!.id).toBe(patron!.tier.id);
  });

  it('announces a return through the ticker rather than a panel', () => {
    const world = stockedWorld(5150, false);
    const lines: string[] = [];
    eventBus.on('tickerMessage', ({ text }) => lines.push(text));
    playOutOneGuest(world);
    const patron = world.patrons.all()[0]!;
    expect(lines.some((t) => t.includes(patron.name) && t.includes('card'))).toBe(true);

    lines.length = 0;
    world.patrons.drawForDay(world.time.day + 1, { chance: () => true } as never);
    world.spawnGuest();
    expect(lines.some((t) => t.includes(patron.name))).toBe(true);
  });
});

describe('P3 — determinism', () => {
  it('leaves the shared RNG stream byte-identical to a build with no patrons', () => {
    // Same guarantee archetypes and modifiers ship: the registry's only random
    // draw takes its own stream, so landing A1b cannot re-roll every payout
    // and spawn for a given world seed.
    const drawsAfter = (patronsActive: boolean) => {
      const world = stockedWorld(31337);
      for (let i = 0; i < DAY_TICKS * 4; i++) {
        world.tick();
        if (!patronsActive) world.patrons.prune(Number.MAX_SAFE_INTEGER);
      }
      return [world.rng.next(), world.rng.next(), world.rng.next()];
    };
    expect(drawsAfter(true)).toEqual(drawsAfter(false));
  });
});

describe('P3 — tier benefits', () => {
  it('widens a carded patron\'s comp budget and waives the session floor', () => {
    const world = stockedWorld(8, false);
    const walkIn = world.spawnGuest('regular');
    // A walk-in who has not played cannot be comped at all — A1a's floor.
    expect(walkIn.compEligible).toBe(false);

    const black = PATRONS.tiers[2]!;
    const patron = world.patrons.recordDeparture(
      {
        id: 'g-x',
        name: 'Vivian Marchetti',
        archetype: 'regular',
        patronId: null,
        compsReceived: 0,
        theo: () => black.theo,
      },
      world.time.day,
    ).patron!;
    world.patrons.drawForDay(world.time.day + 1, { chance: () => true } as never);
    const regular = world.spawnGuest();
    expect(regular.patronId).toBe(patron.id);
    // Greeting a known regular at the door is the point; making the player
    // wait for them to prove themselves again is the bookkeeping to avoid.
    expect(regular.compEligible).toBe(true);
    const plainBudget = Math.max(
      regular.wallet * COMPS.maxSessionExtensionPct,
      COMPS.compUnit.matchPlay,
    );
    expect(regular.compHeadroom()).toBeCloseTo(plainBudget * (1 + black.compRate), 5);
  });

  it('clears the neglect flag when the player comps a returning patron', () => {
    const world = stockedWorld(60221, false);
    const patron = world.patrons.recordDeparture(
      {
        id: 'g-x',
        name: 'Vivian Marchetti',
        archetype: 'regular',
        patronId: null,
        compsReceived: 0,
        theo: () => PATRONS.tiers[2]!.theo,
      },
      world.time.day,
    ).patron!;
    patron.neglected = true;
    world.patrons.drawForDay(world.time.day + 1, { chance: () => true } as never);
    const guest = world.spawnGuest();
    guest.wallet = 400;
    expect(world.sendComp(guest.id, 'drink')).toBe(true);
    expect(patron.neglected).toBe(false);
  });
});

describe('P3 — persistence', () => {
  it('carries the roster through a save and load', () => {
    const world = stockedWorld(1234);
    for (let i = 0; i < DAY_TICKS * 3; i++) world.tick();
    expect(world.patrons.size).toBeGreaterThan(0);
    const before = world.patrons.toJSON();

    const reloaded = CasinoWorld.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    expect(reloaded.patrons.toJSON()).toEqual(before);
    // Names are the whole feature: a patron whose name changed across a reload
    // is a stranger, and the attachment this system exists for is gone.
    expect(reloaded.patrons.all().map((p) => p.name)).toEqual(
      world.patrons.all().map((p) => p.name),
    );
  });

  it('starts a fresh scenario with an empty roster', () => {
    const world = stockedWorld(1234);
    for (let i = 0; i < DAY_TICKS * 3; i++) world.tick();
    world.startScenario(null);
    expect(world.patrons.size).toBe(0);
  });
});
