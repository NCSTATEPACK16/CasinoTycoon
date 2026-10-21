import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { FoodStall } from './entities/FoodStall';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — food stalls', () => {
  it('placing a food stall registers a FoodStall; selling removes it', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('food-stall', 5, 5);
    expect(po).not.toBeNull();
    expect(world.foodStalls.get(po!.id)).toBeInstanceOf(FoodStall);
    world.sell(po!.id);
    expect(world.foodStalls.has(po!.id)).toBe(false);
  });

  it('findFoodStall skips stalls with nothing affordable or unlocked', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const po = world.place('food-stall', 10, 10)!;
    const stall = world.foodStalls.get(po.id)!;
    for (const item of stall.items) stall.toggle(item.id); // lock everything
    expect(world.findFoodStall(1000)).toBeNull();
    stall.toggle('soda'); // unlock just soda ($2.50)
    expect(world.findFoodStall(1)).toBeNull(); // can't afford it
    expect(world.findFoodStall(1000)?.standId).toBe(po.id);
  });

  it('buyFoodItem moves cash by price-minus-baseCost and books revenue/expense separately', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('food-stall', 10, 10)!;
    const cashBefore = world.state.cash;
    const revenueBefore = world.ledger.todayRevenue;
    const expenseBefore = world.ledger.todayExpenses;
    const purchase = world.buyFoodItem(po.id, 1000);
    expect(purchase).not.toBeNull();
    expect(world.state.cash).toBe(cashBefore + purchase!.price - purchase!.baseCost);
    expect(world.ledger.todayRevenue).toBe(revenueBefore + purchase!.price);
    expect(world.ledger.todayExpenses).toBe(expenseBefore + purchase!.baseCost);
  });

  it('buyFoodItem returns null once nothing on the stall is affordable', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    const po = world.place('food-stall', 10, 10)!;
    expect(world.buyFoodItem(po.id, 0)).toBeNull();
  });

  it('a hungry guest walks to an operational stall and buys, restoring hunger', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    world.place('food-stall', 10, 10);
    const guest = world.spawnGuest();
    guest.wallet = 1000;
    guest.needs.hunger = 5;

    let bought = false;
    eventBus.on('moneyChanged', () => {
      bought = true;
    });
    for (let i = 0; i < 3000 && guest.needs.hunger < 50; i++) world.tick();

    expect(guest.needs.hunger).toBeGreaterThan(50);
    expect(bought).toBe(true);
  });

  it('an abnormally marked-up item drops happiness and fires the rip-off thought', () => {
    const world = new CasinoWorld({ seed: 6, autoSpawn: false });
    const po = world.place('food-stall', 10, 10)!;
    const stall = world.foodStalls.get(po.id)!;
    for (const item of stall.items) if (item.id !== 'burger') stall.toggle(item.id);
    stall.setPrice('burger', 12); // 6x baseCost — a ripoff

    const guest = world.spawnGuest();
    guest.wallet = 1000;
    guest.needs.hunger = 5;

    let sawRipoffThought = false;
    eventBus.on('guestThought', ({ thoughtId }) => {
      if (thoughtId === 'ripoff') sawRipoffThought = true;
    });
    const happinessBefore = guest.needs.happiness;
    for (let i = 0; i < 3000 && !sawRipoffThought; i++) world.tick();

    expect(sawRipoffThought).toBe(true);
    expect(guest.needs.happiness).toBeLessThan(happinessBefore);
  });

  it('serializes per-item price and unlocked state through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const po = world.place('food-stall', 4, 4)!;
    const stall = world.foodStalls.get(po.id)!;
    stall.setPrice('burger', 6.5);
    stall.toggle('soda');
    const restored = CasinoWorld.fromJSON(world.toJSON());
    const restoredStall = restored.foodStalls.get(po.id)!;
    expect(restoredStall.items.find((m) => m.id === 'burger')!.currentPrice).toBe(6.5);
    expect(restoredStall.items.find((m) => m.id === 'soda')!.isUnlocked).toBe(false);
  });
});
