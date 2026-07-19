import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { BlackjackTable } from './entities/machines/BlackjackTable';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — blackjack tables', () => {
  it('placing a blackjack table registers a BlackjackTable machine; selling removes it', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('blackjack-table', 5, 5);
    expect(po).not.toBeNull();
    expect(world.machines.get(po!.id)).toBeInstanceOf(BlackjackTable);
    world.sell(po!.id);
    expect(world.machines.has(po!.id)).toBe(false);
  });

  it('seats four guests at one table on distinct stand tiles; a fifth is refused', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const po = world.place('blackjack-table', 10, 10)!;
    const stands = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const res = world.reserveMachine(`g-${i}`, 500);
      expect(res).not.toBeNull();
      expect(res!.machineId).toBe(po.id);
      expect(world.grid.isWalkable(res!.stand.col, res!.stand.row)).toBe(true);
      stands.add(`${res!.stand.col},${res!.stand.row}`);
    }
    expect(stands.size).toBe(4);
    expect(world.reserveMachine('g-late', 500)).toBeNull();
  });

  it('guests walk to the table, sit, and rounds move cash guest↔casino', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const po = world.place('blackjack-table', 10, 10)!;
    const guest = world.spawnGuest();
    guest.wallet = 1000;

    const cashAfterBuild = world.state.cash;
    let net = 0;
    let plays = 0;
    eventBus.on('machinePlayed', ({ machineId, wager, payout }) => {
      expect(machineId).toBe(po.id);
      plays++;
      net += wager - payout;
    });
    for (let i = 0; i < 3000 && plays === 0; i++) world.tick();
    for (let i = 0; i < 300; i++) world.tick();

    expect(plays).toBeGreaterThan(0);
    expect(world.state.cash).toBe(cashAfterBuild + net);
    expect(guest.wallet).toBe(1000 - net);
  });

  it('selling the table mid-session strands no seated guests', () => {
    const world = new CasinoWorld({ seed: 11, autoSpawn: false });
    const po = world.place('blackjack-table', 10, 10)!;
    const guest = world.spawnGuest();
    guest.wallet = 1000;
    for (let i = 0; i < 300; i++) world.tick();
    world.sell(po.id);
    for (let i = 0; i < 500; i++) world.tick();
    expect(guest.state).not.toBe('play');
  });

  it('serializes table type and condition through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('blackjack-table', 4, 4)!;
    const table = world.machines.get(po.id)!;
    table.reliability = 40;
    table.lifetimeProfit = 250;
    table.broken = true;
    const restored = CasinoWorld.fromJSON(world.toJSON());
    const restoredTable = restored.machines.get(po.id)!;
    expect(restoredTable).toBeInstanceOf(BlackjackTable);
    expect(restoredTable.reliability).toBe(40);
    expect(restoredTable.lifetimeProfit).toBe(250);
    expect(restoredTable.broken).toBe(true);
  });
});
