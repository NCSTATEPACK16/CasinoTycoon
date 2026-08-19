import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { GRID_COLS, GRID_ROWS, HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { REPUTATION } from '../data/balance';
import { CasinoWorld } from './world';
import { ModifierSystem } from './modifiers';

afterEach(() => eventBus.clear());

const TICKS_PER_DAY = HOURS_PER_DAY * TICKS_PER_HOUR;

/** Force a known condition set, bypassing the draw. */
function force(world: CasinoWorld, ids: string[]) {
  world.modifiers = ModifierSystem.fromJSON({ activeIds: ids, drawnForDay: world.time.day });
}

describe('A5 modifiers in the world', () => {
  it('draws for day 1 at scenario start, so the first day is not always quiet', () => {
    let drew = false;
    // Across seeds, at least some day-1s must come with conditions.
    for (let seed = 0; seed < 40 && !drew; seed++) {
      const world = new CasinoWorld({ seed, autoSpawn: false });
      world.startScenario(null);
      if (world.modifiers.activeModifiers.length > 0) drew = true;
    }
    expect(drew).toBe(true);
  });

  it('does not perturb the shared stream — payouts are identical with and without', () => {
    // The whole reason modifiers own a separate Rng: landing A5 must not
    // silently re-roll every other system for a given world seed.
    const cashAfter = (patch: boolean) => {
      const world = new CasinoWorld({ seed: 4242, autoSpawn: false });
      if (patch) (world.modifiers as unknown as { drawForDay: () => void }).drawForDay = () => {};
      world.startScenario(null);
      force(world, []);
      world.place('slot-machine', 6, 6);
      const guest = world.spawnGuest('regular');
      guest.wallet = 4000;
      for (let t = 0; t < 1500; t++) world.tick();
      return world.state.cash;
    };
    expect(cashAfter(true)).toBe(cashAfter(false));
  });

  it('fines a failed health inspection at midnight and says which condition cost it', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    force(world, ['health-inspection']);
    // A filthy floor all day: five messes is well under the 80% bar.
    for (let i = 0; i < 5; i++) world.dropMess(6 + i, 6, 'trash');
    const messages: string[] = [];
    eventBus.on('tickerMessage', ({ text }) => messages.push(text));
    const cashBefore = world.state.cash;

    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();

    expect(world.state.cash).toBeLessThan(cashBefore);
    expect(messages.some((m) => m.includes('Health inspection'))).toBe(true);
  });

  it('spares a clean floor the fine', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    force(world, ['health-inspection']);
    const cashBefore = world.state.cash;
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    // Upkeep and wages still move cash; the point is that no fine landed.
    expect(world.ledger.history[0]?.modifierIds).toEqual(['health-inspection']);
    expect(world.state.cash).toBe(cashBefore);
  });

  it('grades cleanliness over the day, not at the midnight instant', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    force(world, ['health-inspection']);
    // Clean all day, then one spill in the final minutes. A snapshot would
    // fine this player for a mess the janitor had no chance to reach.
    for (let t = 0; t < TICKS_PER_DAY - 20; t++) world.tick();
    world.dropMess(6, 6, 'spill');
    world.dropMess(7, 6, 'spill');
    const cashBefore = world.state.cash;
    for (let t = 0; t < 25; t++) world.tick();
    expect(world.state.cash).toBe(cashBefore);
  });

  it('thins the cage advance under a chip shortage', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    const full = world.useCage(500)?.advance ?? 0;
    force(world, ['chip-shortage']);
    const short = world.useCage(500)?.advance ?? 0;
    expect(short).toBe(Math.round(full * 0.5));
  });

  it('never spawns a guest broke on arrival, however the wallet penalties stack', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    force(world, ['bus-junket']);
    for (let i = 0; i < 50; i++) expect(world.spawnGuest('regular').wallet).toBeGreaterThan(0);
  });

  it('records the day’s conditions on the daily report', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    force(world, ['heat-wave', 'convention']);
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    expect(world.ledger.history[0]?.modifierIds).toEqual(['heat-wave', 'convention']);
  });
});

describe('A12 reputation in the world', () => {
  it('holds steady through a quiet day', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    expect(world.reputation.value).toBeCloseTo(REPUTATION.start, 5);
  });

  it('falls after a day of rage quits and shows up in the report', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    for (let i = 0; i < 12; i++) world.applyRageQuitPenalty();
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();

    expect(world.reputation.value).toBeLessThan(REPUTATION.start);
    const record = world.ledger.history[0]!;
    expect(record.reputationDelta).toBeLessThan(0);
    expect(record.reputation).toBe(world.reputation.value);
  });

  it('announces the roll for the UI', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(null);
    let seen: { value: number; delta: number } | null = null;
    eventBus.on('reputationChanged', (e) => (seen = e));
    world.applyRageQuitPenalty();
    for (let t = 0; t < TICKS_PER_DAY + 5; t++) world.tick();
    expect(seen).not.toBeNull();
    expect(seen!.delta).toBeLessThan(0);
  });

  it('shifts the next day’s arrival mix — a terrible reputation is visible', () => {
    const mix = (reputation: number) => {
      const world = new CasinoWorld({ seed: 99, autoSpawn: false });
      world.startScenario(null);
      world.reputation.value = reputation;
      let highRollers = 0;
      for (let i = 0; i < 4000; i++) {
        if (world.spawnGuest().archetype === 'highRoller') highRollers++;
      }
      return highRollers;
    };
    // This is A12's entire acceptance bar: a ruined reputation has to change
    // who walks through the door, not just a number in a panel.
    expect(mix(REPUTATION.max)).toBeGreaterThan(mix(REPUTATION.start));
    expect(mix(REPUTATION.min)).toBeLessThan(mix(REPUTATION.start));
  });
});

describe('Track 2 persistence', () => {
  it('round-trips conditions, reputation, and comp spend through a save', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    force(world, ['heat-wave', 'convention']);
    world.reputation.value = 73.25;
    const guest = world.spawnGuest('regular');
    (guest as unknown as { wagersByGame: Map<string, number> }).wagersByGame = new Map([
      ['slot-machine', 800],
    ]);
    world.sendComp(guest.id, 'drink');
    const compSpend = world.ledger.todayCompSpend;
    expect(compSpend).toBeGreaterThan(0);

    const snapshot = JSON.parse(JSON.stringify(world.toJSON()));
    const restored = new CasinoWorld({ seed: 1 });
    restored.loadJSON(snapshot);

    expect(restored.modifiers.activeModifiers.map((m) => m.id)).toEqual([
      'heat-wave',
      'convention',
    ]);
    expect(restored.reputation.value).toBe(73.25);
    expect(restored.ledger.todayCompSpend).toBe(compSpend);
  });

  it('does not reroll the day’s conditions when a mid-day save is loaded', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    force(world, ['chip-shortage']);
    const restored = new CasinoWorld({ seed: 1 });
    restored.loadJSON(JSON.parse(JSON.stringify(world.toJSON())));
    // Ticking on within the same day must leave the set alone.
    for (let t = 0; t < 100; t++) restored.tick();
    expect(restored.modifiers.activeModifiers.map((m) => m.id)).toEqual(['chip-shortage']);
  });

  it('resets both systems when a new scenario starts', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.startScenario(null);
    world.reputation.value = 12;
    world.startScenario(null);
    expect(world.reputation.value).toBe(REPUTATION.start);
  });
});

describe('B3-mood sampling in the world', () => {
  it('learns where guests are and how they feel', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(null);
    // Guests wander, so the field is asserted over the map rather than at one
    // pinned tile — where they walked is the sim's business, not the test's.
    const guest = world.spawnGuest('regular');
    guest.needs.happiness = 84;
    for (let t = 0; t < 200; t++) {
      guest.needs.happiness = 84;
      world.tick();
    }

    const readings: number[] = [];
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const m = world.mood.moodAt(col, row);
        if (m !== null) readings.push(m);
      }
    }
    expect(readings.length).toBeGreaterThan(0);
    // Only one guest walked, and it was at a steady 84.
    for (const m of readings) expect(m).toBeCloseTo(84, 0);
    // Nowhere near where a single guest could have walked from the entrance.
    expect(world.mood.moodAt(0, 0)).toBeNull();
  });

  it('samples on a cadence rather than every tick', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(null);
    const guest = world.spawnGuest('regular');
    guest.pos.col = 5;
    guest.pos.row = 5;
    let samples = 0;
    const real = world.mood.sample.bind(world.mood);
    world.mood.sample = (c: number, r: number, h: number) => {
      samples++;
      real(c, r, h);
    };
    for (let t = 0; t < 100; t++) world.tick();
    // 100 ticks at one pass every 5 is 20 samples for one guest — not 100.
    expect(samples).toBeGreaterThan(0);
    expect(samples).toBeLessThan(40);
  });

  it('round-trips the mood field through a save', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(null);
    const guest = world.spawnGuest('regular');
    guest.pos.col = 8;
    guest.pos.row = 8;
    guest.needs.happiness = 55;
    for (let t = 0; t < 40; t++) world.tick();
    const before = world.mood.moodAt(8, 8)!;

    const restored = new CasinoWorld({ seed: 1 });
    restored.loadJSON(JSON.parse(JSON.stringify(world.toJSON())));
    expect(restored.mood.moodAt(8, 8)).toBeCloseTo(before, 5);
  });

  it('clears the field when a new scenario starts', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.startScenario(null);
    const guest = world.spawnGuest('regular');
    guest.pos.col = 8;
    guest.pos.row = 8;
    for (let t = 0; t < 40; t++) world.tick();
    expect(world.mood.isEmpty).toBe(false);
    world.startScenario(null);
    expect(world.mood.isEmpty).toBe(true);
  });
});
