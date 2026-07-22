import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { SECURITY_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — security rating bonus', () => {
  it('hiring a pitBoss or security guard raises rating', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const before = world.rating;
    world.hireStaff('pitBoss');
    expect(world.rating).toBeGreaterThan(before);
  });

  it('bonus caps at SECURITY_BALANCE.bonusCap even with many guards', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    for (let i = 0; i < 10; i++) world.hireStaff('security');
    const withGuardsRating = world.rating;
    world.hireStaff('security');
    // One more guard past the cap must not move rating at all.
    expect(world.rating).toBe(withGuardsRating);
    expect(SECURITY_BALANCE.bonusCap).toBeGreaterThan(0);
  });

  it('firing a pitBoss lowers rating back down', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const before = world.rating;
    const boss = world.hireStaff('pitBoss');
    expect(world.rating).toBeGreaterThan(before);
    world.fireStaff(boss.id);
    expect(world.rating).toBe(before);
  });
});
