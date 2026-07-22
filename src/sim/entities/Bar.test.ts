import { describe, expect, it } from 'vitest';
import { BAR_BALANCE } from '../../data/balance';
import { Bar } from './Bar';

describe('Bar', () => {
  it('starts with zero stock', () => {
    const bar = new Bar('b-1');
    expect(bar.stock).toBe(0);
    expect(bar.hasStock()).toBe(false);
  });

  it('brew() increments stock up to the cap', () => {
    const bar = new Bar('b-1');
    for (let i = 0; i < BAR_BALANCE.maxStock + 3; i++) bar.brew();
    expect(bar.stock).toBe(BAR_BALANCE.maxStock);
  });

  it('takeDrink() decrements stock and returns true; false when empty', () => {
    const bar = new Bar('b-1');
    expect(bar.takeDrink()).toBe(false);
    bar.brew();
    expect(bar.hasStock()).toBe(true);
    expect(bar.takeDrink()).toBe(true);
    expect(bar.stock).toBe(0);
    expect(bar.takeDrink()).toBe(false);
  });

  it('round-trips through toJSON/fromJSON', () => {
    const bar = new Bar('b-1');
    bar.brew();
    bar.brew();
    const restored = Bar.fromJSON(bar.toJSON());
    expect(restored.id).toBe('b-1');
    expect(restored.stock).toBe(2);
  });
});
