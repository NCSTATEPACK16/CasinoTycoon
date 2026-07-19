import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { STARTING_CASH } from '../config';
import { getObjectDef } from '../data/objects';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld', () => {
  it('placing a slot machine registers a machine entity; selling removes it', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('slot-machine', 5, 5);
    expect(po).not.toBeNull();
    expect(world.machines.has(po!.id)).toBe(true);
    world.sell(po!.id);
    expect(world.machines.has(po!.id)).toBe(false);
  });

  it('placing decor does not create a machine', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('plant', 3, 3);
    expect(po).not.toBeNull();
    expect(world.machines.size).toBe(0);
  });

  it('spawns guests over time when machines exist', () => {
    const world = new CasinoWorld({ seed: 99, autoSpawn: true });
    world.place('slot-machine', 5, 5);
    const spawned: string[] = [];
    eventBus.on('guestSpawned', ({ id }) => spawned.push(id));
    for (let i = 0; i < 3000 && spawned.length === 0; i++) world.tick();
    expect(spawned.length).toBeGreaterThan(0);
    expect(world.guests.size).toBeGreaterThan(0);
  });

  it('guests play machines and money is conserved guest↔casino', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const guest = world.spawnGuest();
    guest.wallet = 200;
    guest.needs.bladder = 100;
    guest.needs.hunger = 100;

    const cashAfterBuild = world.state.cash;
    expect(cashAfterBuild).toBe(STARTING_CASH - getObjectDef('slot-machine')!.cost);

    let netFromPlays = 0;
    let plays = 0;
    eventBus.on('machinePlayed', ({ wager, payout }) => {
      plays++;
      netFromPlays += wager - payout;
    });
    for (let i = 0; i < 2000 && plays === 0; i++) world.tick();
    for (let i = 0; i < 200; i++) world.tick(); // let a few more spins land

    expect(plays).toBeGreaterThan(0);
    expect(world.state.cash).toBe(cashAfterBuild + netFromPlays);
    expect(guest.wallet).toBe(200 - netFromPlays);
  });

  it('selling a machine mid-reservation strands no guests (they re-evaluate)', () => {
    const world = new CasinoWorld({ seed: 11, autoSpawn: false });
    const po = world.place('slot-machine', 5, 5)!;
    const guest = world.spawnGuest();
    guest.wallet = 200;
    for (let i = 0; i < 50; i++) world.tick();
    world.sell(po.id);
    for (let i = 0; i < 500; i++) world.tick();
    expect(guest.state).not.toBe('play');
  });

  it('serializes machine state through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('slot-machine', 4, 4)!;
    const machine = world.machines.get(po.id)!;
    machine.reliability = 55;
    machine.lifetimeProfit = 123;
    const restored = CasinoWorld.fromJSON(world.toJSON());
    const restoredMachine = restored.machines.get(po.id)!;
    expect(restoredMachine.reliability).toBe(55);
    expect(restoredMachine.lifetimeProfit).toBe(123);
    expect(restored.state.cash).toBe(world.state.cash);
  });
});
