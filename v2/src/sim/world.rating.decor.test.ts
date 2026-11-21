import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { APPEAL_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

// B6: the rating's decor term is the floor's appeal (sim/appeal.ts). It was a
// sum of signs' ratingBonus with a flat +10 cap.
describe('CasinoWorld — decor rating term', () => {
  it('placing a neon sign raises the decor term and the rating', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const before = world.ratingBreakdown().signage;
    world.place('neon-sign', 5, 5);
    expect(world.ratingBreakdown().signage).toBeGreaterThan(before);
  });

  it('each extra sign adds less, and the term never passes its ceiling', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const steps: number[] = [];
    let last = world.ratingBreakdown().signage;
    for (let i = 0; i < 400; i++) {
      if (!world.place('neon-sign', 2 + (i % 40), 2 + Math.floor(i / 40) * 2)) continue;
      const now = world.ratingBreakdown().signage;
      steps.push(now - last);
      last = now;
    }
    expect(steps.length).toBeGreaterThan(30);
    expect(steps.at(-1)!).toBeLessThan(steps[0]! / 4);
    expect(last).toBeLessThanOrEqual(APPEAL_BALANCE.ratingMax);
  });

  it('selling a sign puts the term back', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const before = world.ratingBreakdown().signage;
    const po = world.place('neon-sign', 5, 5)!;
    expect(world.ratingBreakdown().signage).toBeGreaterThan(before);
    world.sell(po.id);
    expect(world.ratingBreakdown().signage).toBeCloseTo(before, 9);
  });
});
