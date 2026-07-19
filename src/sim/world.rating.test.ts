import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { CasinoWorld, spawnChance } from './world';

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
    expect(spawnChance(90, 0)).toBe(0);
    expect(spawnChance(80, 3)).toBeGreaterThan(spawnChance(40, 3));
    expect(spawnChance(100, 5)).toBeLessThanOrEqual(0.08);
  });
});
