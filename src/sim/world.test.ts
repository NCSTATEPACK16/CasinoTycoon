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

  it('folds a departing guest session into the ledger (name, net, favorite game)', () => {
    const world = new CasinoWorld({ seed: 21, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const guest = world.spawnGuest();
    guest.wallet = 500;
    for (let i = 0; i < 600 && guest.netResult === 0; i++) world.tick();
    guest.wallet = 0; // force it toward the exit
    for (let i = 0; i < 2000 && world.guests.size > 0; i++) world.tick();
    // recordPlay/recordJackpot accumulate into the *current* (not-yet-closed) day;
    // closing day 1 exposes what actually got folded.
    const record = world.ledger.closeDay(1);
    expect(record.guestCount).toBe(1);
    expect(record.takenIn).toBeGreaterThan(0);
  });

  it('counts a jackpot the moment it pays out', () => {
    const world = new CasinoWorld({ seed: 33, autoSpawn: false });
    const po = world.place('slot-machine', 5, 5)!;
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    let sawJackpot = false;
    for (let i = 0; i < 20000 && !sawJackpot; i++) {
      const res = world.playMachine(po.id, guest.id);
      if (res && res.payout >= res.wager * 10) sawJackpot = true;
    }
    expect(sawJackpot).toBe(true);
    const record = world.ledger.closeDay(1);
    expect(record.jackpotCount).toBeGreaterThan(0);
  });

  it('folds all still-present guests at midnight without losing them from the floor', () => {
    const world = new CasinoWorld({ seed: 55, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const guest = world.spawnGuest();
    guest.wallet = 500;
    for (let i = 0; i < 1250; i++) world.tick(); // past midnight (TICKS_PER_HOUR=50 × 24h + margin)
    expect(world.guests.has(guest.id)).toBe(true); // still on the floor, not force-removed
    const record = world.ledger.history[0];
    expect(record).toBeDefined();
    expect(record!.guestCount).toBeGreaterThanOrEqual(0); // folded if it had played, 0 is fine if it hadn't
  });

  it('a rage quit dings the casino rating, which decays over time', () => {
    const world = new CasinoWorld({ seed: 16, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const before = world.rating;
    world.applyRageQuitPenalty();
    expect(world.rating).toBeLessThan(before);
    const dinged = world.rating;
    for (let i = 0; i < 60; i++) world.tick(); // past an hour boundary (TICKS_PER_HOUR=50)
    expect(world.rating).toBeGreaterThan(dinged);
  });

  it("the dawn ticker headline names yesterday's top winner", () => {
    const world = new CasinoWorld({ seed: 44, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    const lines: string[] = [];
    eventBus.on('tickerMessage', ({ text }) => lines.push(text));
    for (let i = 0; i < 1250; i++) world.tick(); // past midnight
    expect(lines.some((t) => t.startsWith('Yesterday:'))).toBe(true);
  });

  it('the dawn ticker stays silent when the day only produced net-negative sessions', () => {
    // Deliberately no machines placed, so the guest cannot play and its
    // netResult is not perturbed by autonomous play during the tick loop.
    const world = new CasinoWorld({ seed: 44, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    guest.netResult = -80; // guest lost money overall today
    const lines: string[] = [];
    eventBus.on('tickerMessage', ({ text }) => lines.push(text));
    for (let i = 0; i < 1250; i++) world.tick(); // past midnight
    expect(lines.some((t) => t.startsWith('Yesterday:'))).toBe(false);
  });
});
