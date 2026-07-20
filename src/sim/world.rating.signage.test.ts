import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { RATING_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — signage rating bonus', () => {
  it('placing a neon sign raises rating', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const before = world.rating;
    world.place('neon-sign', 5, 5);
    expect(world.rating).toBeGreaterThan(before);
  });

  it('signage bonus caps at RATING_BALANCE.signageBonusCap even with many signs', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    let col = 2;
    for (let i = 0; i < 20; i++) {
      world.place('neon-sign', col, 2);
      col += 1;
    }
    const withSignsRating = world.rating;
    world.place('neon-sign', col, 2);
    // One more sign past the cap must not move rating at all.
    expect(world.rating).toBe(withSignsRating);
    expect(RATING_BALANCE.signageBonusCap).toBeGreaterThan(0);
  });

  it('selling a sign lowers rating back down', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const before = world.rating;
    const po = world.place('neon-sign', 5, 5)!;
    expect(world.rating).toBeGreaterThan(before);
    world.sell(po.id);
    expect(world.rating).toBe(before);
  });
});
