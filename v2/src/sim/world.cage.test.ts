import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { CASHIER_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — cage', () => {
  it('placing a cage does not require a cashier to exist as a placed object', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('cage', 5, 5);
    expect(po).not.toBeNull();
    world.sell(po!.id);
    expect(world.state.getObject(po!.id)).toBeUndefined();
  });

  it('findCage returns null with no cashier stationed, a stand cell once one is', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const po = world.place('cage', 10, 10)!;
    expect(world.findCage()).toBeNull();
    world.hireStaff('cashier');
    for (let i = 0; i < 500 && world.findCage() === null; i++) world.tick();
    expect(world.findCage()?.cageId).toBe(po.id);
  });

  it('useCage tops up the wallet net of the fee and books revenue', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const revenueBefore = world.ledger.todayRevenue;
    const result = world.useCage(1000);
    expect(result).toEqual({ advance: CASHIER_BALANCE.advanceAmount });
    expect(world.ledger.todayRevenue).toBe(revenueBefore + CASHIER_BALANCE.fee);
  });

  it('useCage returns null when the wallet cannot cover the fee', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    expect(world.useCage(1)).toBeNull();
  });
});
