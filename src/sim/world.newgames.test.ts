import { describe, expect, it } from 'vitest';
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
