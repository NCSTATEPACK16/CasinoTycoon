import { describe, expect, it } from 'vitest';
import { DEALER_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

describe('Big Six happiness sting', () => {
  it('reports the extra penalty for a big six wheel and zero for a slot', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    // place() fails silently on insufficient funds, so assert it succeeded
    // rather than inferring the machines from an empty map below.
    expect(world.place('big-six-wheel', 4, 4)).not.toBeNull();
    expect(world.place('slot-machine', 8, 8)).not.toBeNull();
    const machines = [...world.machines.values()];
    const wheel = machines.find((m) => m.defId === 'big-six-wheel');
    const slot = machines.find((m) => m.defId === 'slot-machine');
    expect(wheel).toBeDefined();
    expect(slot).toBeDefined();
    expect(world.machineExtraHappinessOnLoss(wheel!.id)).toBe(-2);
    expect(world.machineExtraHappinessOnLoss(slot!.id)).toBe(0);
  });

  it('returns zero for an unknown machine id', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    expect(world.machineExtraHappinessOnLoss('nope')).toBe(0);
  });
});

describe('High-limit wallet gate', () => {
  it('admits a guest at the threshold and rejects one below it', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    // STARTING_CASH is 2000 and the table costs 2500, so place() would fail
    // silently on funds; top up first and assert the placement landed.
    world.state.cash = 100000;
    expect(world.place('high-limit-table', 6, 6)).not.toBeNull();
    expect(world.reserveMachine('rich', 400)).not.toBeNull();
    world.releaseMachines('rich');
    expect(world.reserveMachine('poor', 399)).toBeNull();
  });

  it('leaves games without a gate reachable by a thin wallet', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    expect(world.place('slot-machine', 6, 6)).not.toBeNull();
    // Exactly the slot's cost to play: affordable, and no wallet floor to trip.
    expect(world.reserveMachine('thin', 10)).not.toBeNull();
  });
});

describe('Dealers at the new seated tables', () => {
  it('assigns a dealer to a roulette table but never to the standing big six', () => {
    const world = new CasinoWorld({ seed: 8, autoSpawn: false });
    world.state.cash = 100000;
    expect(world.place('big-six-wheel', 4, 4)).not.toBeNull();
    expect(world.place('roulette-table', 8, 8)).not.toBeNull();
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 500 && dealer.state !== 'stationed'; i++) world.tick();
    expect(dealer.state).toBe('stationed');
    const roulette = [...world.machines.values()].find((m) => m.defId === 'roulette-table');
    expect(dealer.assignedTableId).toBe(roulette!.id);
  });

  it('assigns a dealer to a high-limit table', () => {
    const world = new CasinoWorld({ seed: 9, autoSpawn: false });
    world.state.cash = 100000;
    const table = world.place('high-limit-table', 8, 8);
    expect(table).not.toBeNull();
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 500 && dealer.state !== 'stationed'; i++) world.tick();
    expect(dealer.assignedTableId).toBe(table!.id);
  });

  it('caps the dealer rating contribution however many tables are dealt', () => {
    const world = new CasinoWorld({ seed: 10, autoSpawn: false });
    world.state.cash = 1000000;
    // 6 dealt tables imply 12 bonus points uncapped, so the cap has to bite.
    for (const [col, row] of [
      [4, 4],
      [8, 8],
      [12, 12],
      [16, 16],
      [20, 20],
      [4, 20],
    ] as const) {
      expect(world.place('poker-table', col, row)).not.toBeNull();
    }
    const dealers = [];
    for (let i = 0; i < 6; i++) dealers.push(world.hireStaff('dealer'));
    for (let i = 0; i < 800 && dealers.some((d) => d.state !== 'stationed'); i++) world.tick();
    expect(dealers.every((d) => d.state === 'stationed')).toBe(true);
    expect(world.ratingBreakdown().dealers).toBe(DEALER_BALANCE.dealerBonusCap);
  });
});
