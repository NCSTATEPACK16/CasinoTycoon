import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { RATING_BALANCE } from '../data/balance';
import { CasinoWorld, type RatingBreakdown } from './world';

afterEach(() => eventBus.clear());

// Sums every term structurally rather than by name, so a tenth rating term
// added without updating this file still has to reconcile with the total.
const sumTerms = (b: RatingBreakdown) =>
  Object.entries(b).reduce((sum, [key, value]) => (key === 'total' ? sum : sum + value), 0);

const populate = (world: CasinoWorld) => {
  world.state.cash = 100_000;
  world.place('slot-machine', 4, 4);
  world.place('blackjack-table', 8, 8);
  world.spawnGuest('regular');
  world.spawnGuest('regular');
};

describe('ratingBreakdown', () => {
  it('terms sum to the total', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    populate(world);
    const b = world.ratingBreakdown();
    expect(b.total).toBe(Math.round(Math.min(100, Math.max(0, sumTerms(b)))));
  });

  it('total equals the rating getter', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    populate(world);
    expect(world.ratingBreakdown().total).toBe(world.rating);
  });

  it('awards the variety bonus only with two distinct game types', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.state.cash = 100_000;
    world.place('slot-machine', 4, 4);
    expect(world.ratingBreakdown().variety).toBe(0);
    world.place('blackjack-table', 8, 8);
    expect(world.ratingBreakdown().variety).toBe(RATING_BALANCE.varietyBonus);
  });

  it('caps the machine term', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    world.state.cash = 1_000_000;
    for (let i = 0; i < 12; i++) world.place('slot-machine', 2 + i * 2, 2);
    expect(world.machines.size).toBe(12);
    expect(world.ratingBreakdown().machines).toBe(RATING_BALANCE.machineCap);
  });

  it('reports neutral happiness on an empty floor', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    expect(world.averageHappiness).toBe(RATING_BALANCE.neutralHappiness);
  });

  it('averages happiness across the guests on the floor', () => {
    const world = new CasinoWorld({ seed: 6, autoSpawn: false });
    const a = world.spawnGuest('regular');
    const b = world.spawnGuest('regular');
    a.needs.happiness = 40;
    b.needs.happiness = 80;
    expect(world.averageHappiness).toBe(60);
    expect(world.ratingBreakdown().happiness).toBe(RATING_BALANCE.happinessWeight * 60);
  });

  it('messes and breakdowns show up as cleanliness and broken terms', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    world.state.cash = 100_000;
    const clean = world.ratingBreakdown();
    expect(clean.cleanliness).toBe(RATING_BALANCE.cleanlinessMax);
    expect(clean.broken).toBe(0);

    const po = world.place('slot-machine', 4, 4)!;
    world.dropMess(5, 5, 'trash');
    world.machines.get(po.id)!.broken = true;
    const dirty = world.ratingBreakdown();
    expect(dirty.cleanliness).toBe(RATING_BALANCE.cleanlinessMax - RATING_BALANCE.perMessPenalty);
    expect(dirty.broken).toBe(-RATING_BALANCE.perBrokenPenalty);
  });

  it('carries the rage-quit penalty as its own negative term', () => {
    const world = new CasinoWorld({ seed: 8, autoSpawn: false });
    expect(world.ratingBreakdown().rage).toBe(0);
    world.applyRageQuitPenalty();
    const b = world.ratingBreakdown();
    expect(b.rage).toBeLessThan(0);
    expect(b.total).toBe(world.rating);
  });

  it('keeps total in step with rating as the sim runs', () => {
    const world = new CasinoWorld({ seed: 9, autoSpawn: true });
    world.state.cash = 100_000;
    world.place('slot-machine', 4, 4);
    world.place('blackjack-table', 8, 8);
    world.hireStaff('security');
    for (let t = 0; t < 400; t++) {
      world.tick();
      const b = world.ratingBreakdown();
      expect(b.total).toBe(world.rating);
      expect(b.total).toBe(Math.round(Math.min(100, Math.max(0, sumTerms(b)))));
    }
  });
});
