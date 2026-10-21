import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { CrapsTable } from './entities/machines/CrapsTable';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — craps tables', () => {
  it('placing a craps table registers a CrapsTable machine; selling removes it', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const po = world.place('craps-table', 5, 5);
    expect(po).not.toBeNull();
    expect(world.machines.get(po!.id)).toBeInstanceOf(CrapsTable);
    world.sell(po!.id);
    expect(world.machines.has(po!.id)).toBe(false);
  });

  it('seats four guests at one table on distinct stand tiles; a fifth is refused', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const po = world.place('craps-table', 10, 10)!;
    const stands = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const res = world.reserveMachine(`g-${i}`, 500);
      expect(res).not.toBeNull();
      expect(res!.machineId).toBe(po.id);
      stands.add(`${res!.stand.col},${res!.stand.row}`);
    }
    expect(stands.size).toBe(4);
    expect(world.reserveMachine('g-late', 500)).toBeNull();
  });

  it('serializes table type and condition through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('craps-table', 4, 4)!;
    const table = world.machines.get(po.id)!;
    table.reliability = 40;
    table.lifetimeProfit = 250;
    table.broken = true;
    const restored = CasinoWorld.fromJSON(world.toJSON());
    const restoredTable = restored.machines.get(po.id)!;
    expect(restoredTable).toBeInstanceOf(CrapsTable);
    expect(restoredTable.reliability).toBe(40);
    expect(restoredTable.lifetimeProfit).toBe(250);
    expect(restoredTable.broken).toBe(true);
  });
});
