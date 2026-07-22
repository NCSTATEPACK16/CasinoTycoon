import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { BAR_BALANCE } from '../data/balance';
import { Bar } from './entities/Bar';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — bar', () => {
  it('placing a bar registers a Bar; selling removes it', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('bar', 5, 5);
    expect(po).not.toBeNull();
    expect(world.bars.get(po!.id)).toBeInstanceOf(Bar);
    world.sell(po!.id);
    expect(world.bars.has(po!.id)).toBe(false);
  });

  it('findBar returns null with no stock, a stand cell once brewed', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const po = world.place('bar', 10, 10)!;
    expect(world.findBar()).toBeNull();
    world.brewDrink(po.id);
    expect(world.findBar()?.barId).toBe(po.id);
  });

  it('brewDrink increments stock and books the drink cost as an expense', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('bar', 10, 10)!;
    const expenseBefore = world.ledger.todayExpenses;
    world.brewDrink(po.id);
    expect(world.bars.get(po.id)!.stock).toBe(1);
    expect(world.ledger.todayExpenses).toBe(expenseBefore + BAR_BALANCE.drinkCost);
  });

  it('buyDrink takes stock, charges the wallet-equivalent price, and books revenue', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    const po = world.place('bar', 10, 10)!;
    world.brewDrink(po.id);
    const revenueBefore = world.ledger.todayRevenue;
    const purchase = world.buyDrink(po.id, 1000);
    expect(purchase).toEqual({ price: BAR_BALANCE.drinkPrice });
    expect(world.bars.get(po.id)!.stock).toBe(0);
    expect(world.ledger.todayRevenue).toBe(revenueBefore + BAR_BALANCE.drinkPrice);
  });

  it('buyDrink returns null when the wallet cannot afford it or stock is empty', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    const po = world.place('bar', 10, 10)!;
    expect(world.buyDrink(po.id, 1000)).toBeNull(); // no stock yet
    world.brewDrink(po.id);
    expect(world.buyDrink(po.id, 1)).toBeNull(); // can't afford drinkPrice
    expect(world.bars.get(po.id)!.stock).toBe(1); // unchanged — no partial charge
  });

  it('serializes bar stock through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 6, autoSpawn: false });
    const po = world.place('bar', 4, 4)!;
    world.brewDrink(po.id);
    world.brewDrink(po.id);
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.bars.get(po.id)!.stock).toBe(2);
  });
});
