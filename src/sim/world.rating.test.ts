import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { CasinoWorld, spawnChance } from './world';
import { GUEST_BALANCE, REPUTATION } from '../data/balance';

afterEach(() => eventBus.clear());

describe('CasinoWorld — rating & spawning', () => {
  it('an empty casino rates below 50', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    expect(world.rating).toBeGreaterThan(0);
    expect(world.rating).toBeLessThan(50);
  });

  it('more games and game variety raise the rating', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const empty = world.rating;
    world.place('slot-machine', 5, 5);
    const oneSlot = world.rating;
    world.place('blackjack-table', 10, 10);
    const withTable = world.rating;
    expect(oneSlot).toBeGreaterThan(empty);
    expect(withTable).toBeGreaterThan(oneSlot);
  });

  it('messes drag the rating down', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const clean = world.rating;
    world.dropMess(5, 5, 'trash');
    world.dropMess(6, 6, 'spill');
    expect(world.rating).toBeLessThan(clean);
  });

  it('broken machines drag the rating down', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('slot-machine', 5, 5)!;
    const working = world.rating;
    world.machines.get(po.id)!.broken = true;
    expect(world.rating).toBeLessThan(working);
  });

  it('rating is clamped to 0..100', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    for (let i = 0; i < 30; i++) world.dropMess(3, 3, 'trash');
    expect(world.rating).toBeGreaterThanOrEqual(0);
    let col = 2;
    for (let i = 0; i < 12; i++) world.place('slot-machine', (col += 2), 4);
    const guest = world.spawnGuest();
    guest.needs.happiness = 100;
    expect(world.rating).toBeLessThanOrEqual(100);
  });

  it('nobody visits a casino with no games', () => {
    const world = new CasinoWorld({ seed: 42, autoSpawn: true });
    for (let i = 0; i < 3000; i++) world.tick();
    expect(world.guests.size).toBe(0);
  });

  it('spawn chance is zero without machines and rises with rating', () => {
    expect(spawnChance(90, 0, REPUTATION.start)).toBe(0);
    expect(spawnChance(80, 3, REPUTATION.start)).toBeGreaterThan(
      spawnChance(40, 3, REPUTATION.start),
    );
    expect(spawnChance(100, 5, REPUTATION.max)).toBeLessThanOrEqual(0.08);
  });

  // P16 — word of mouth carries between days.
  //
  // Traffic used to key on the instantaneous rating alone, so a day's takings
  // were near-independent of the day before it: lag-1 autocorrelation across
  // the tournament was +0.20, and the daily standard deviation ran two to three
  // times the mean. That is a coin-flip wearing a difficulty curve. Reputation
  // was already the persistent, capped, drifting scalar this needs — it simply
  // never reached the arrival *rate*, only the archetype mix.
  describe('reputation carries traffic between days', () => {
    it('draws better than an identical floor with a worse name', () => {
      expect(spawnChance(70, 3, 90)).toBeGreaterThan(spawnChance(70, 3, 20));
    });

    it('still cannot conjure a crowd with nothing to play', () => {
      expect(spawnChance(100, 0, 100)).toBe(0);
    });

    it('leaves the shipped calibration alone at a neutral reputation', () => {
      // The blend has to be a redistribution of word of mouth, not a buff: a
      // casino with an average name draws exactly what it drew before, or every
      // tuning number downstream of this silently moves.
      const b = GUEST_BALANCE;
      const neutral = spawnChance(60, 3, REPUTATION.start);
      expect(neutral).toBeCloseTo(b.spawnBasePerTick + 0.6 * b.spawnRatingScalePerTick, 10);
    });

    it('respects the cap however good the name gets', () => {
      expect(spawnChance(100, 5, 100)).toBeLessThanOrEqual(GUEST_BALANCE.spawnCapPerTick);
    });
  });
});
