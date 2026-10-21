import { describe, expect, it } from 'vitest';
import { DEFAULT_MENU } from '../../data/foodMenu';
import { Rng } from '../rng';
import { FoodStall } from './FoodStall';

describe('FoodStall', () => {
  it('clones the default menu with the documented starting values', () => {
    const stall = new FoodStall('obj-1');
    const burger = stall.items.find((m) => m.id === 'burger')!;
    expect(burger.baseCost).toBe(2.0);
    expect(burger.currentPrice).toBe(5.0);
    expect(burger.hungerSatisfaction).toBe(40);
    expect(burger.isUnlocked).toBe(true);
    // Each stall gets its own copy — mutating one never touches the template or another stall.
    stall.setPrice('burger', 9);
    expect(DEFAULT_MENU.find((m) => m.id === 'burger')!.currentPrice).toBe(5.0);
    expect(new FoodStall('obj-2').items.find((m) => m.id === 'burger')!.currentPrice).toBe(5.0);
  });

  it('clamps setPrice to the configured floor/ceiling factors', () => {
    const stall = new FoodStall('obj-1');
    stall.setPrice('soda', 0); // baseCost 0.50 → floor 0.25
    expect(stall.items.find((m) => m.id === 'soda')!.currentPrice).toBe(0.25);
    stall.setPrice('soda', 100); // ceiling 0.50*6 = 3
    expect(stall.items.find((m) => m.id === 'soda')!.currentPrice).toBe(3);
  });

  it('toggle flips isUnlocked', () => {
    const stall = new FoodStall('obj-1');
    expect(stall.items.find((m) => m.id === 'fries')!.isUnlocked).toBe(true);
    stall.toggle('fries');
    expect(stall.items.find((m) => m.id === 'fries')!.isUnlocked).toBe(false);
    stall.toggle('fries');
    expect(stall.items.find((m) => m.id === 'fries')!.isUnlocked).toBe(true);
  });

  it('pickAffordableItem only returns unlocked, affordable items', () => {
    const stall = new FoodStall('obj-1');
    const rng = new Rng(1);
    for (const item of stall.items) if (item.id !== 'soda') stall.toggle(item.id); // lock everything but soda
    const picked = stall.pickAffordableItem(10, rng);
    expect(picked?.id).toBe('soda');
    expect(stall.pickAffordableItem(0.1, rng)).toBeNull(); // can't afford soda either
  });

  it('buy reports ripoff once price crosses the configured multiplier', () => {
    const stall = new FoodStall('obj-1');
    const rng = new Rng(1);
    for (const item of stall.items) if (item.id !== 'burger') stall.toggle(item.id);
    stall.setPrice('burger', 5); // 2.5x baseCost — not a ripoff
    expect(stall.buy(100, rng)?.ripoff).toBe(false);
    stall.setPrice('burger', 12); // clamps to ceiling 12 = 6x baseCost — a ripoff
    expect(stall.buy(100, rng)?.ripoff).toBe(true);
  });

  it('round-trips price and unlocked state through toJSON/fromJSON', () => {
    const stall = new FoodStall('obj-1');
    stall.setPrice('burger', 7);
    stall.toggle('soda');
    const restored = FoodStall.fromJSON(stall.toJSON());
    expect(restored.items.find((m) => m.id === 'burger')!.currentPrice).toBe(7);
    expect(restored.items.find((m) => m.id === 'soda')!.isUnlocked).toBe(false);
    // Definition fields (name/baseCost/hungerSatisfaction) are re-hydrated from the catalog.
    expect(restored.items.find((m) => m.id === 'fries')!.hungerSatisfaction).toBe(25);
  });
});
