import { describe, expect, it } from 'vitest';
import { BlackjackTable } from './BlackjackTable';
import { CrapsTable } from './CrapsTable';
import { SlotMachine } from './SlotMachine';
import { CasinoWorld } from '../../world';
import { createMachine, createMachineOrThrow } from './factory';

describe('createMachine', () => {
  it('builds each known game type', () => {
    expect(createMachine('slot-machine', 'm1')).toBeInstanceOf(SlotMachine);
    expect(createMachine('blackjack-table', 'm2')).toBeInstanceOf(BlackjackTable);
    expect(createMachine('craps-table', 'm3')).toBeInstanceOf(CrapsTable);
  });

  it('returns null for a non-game object', () => {
    expect(createMachine('toilet', 'm4')).toBeNull();
  });

  it('honours an explicit costToPlay', () => {
    expect(createMachine('slot-machine', 'm5', 42)?.costToPlay).toBe(42);
  });

  it('falls back to the balance default when cost is omitted', () => {
    expect(createMachine('slot-machine', 'm6')?.costToPlay).toBe(10);
  });

  it('throws on an unknown defId instead of substituting a slot machine', () => {
    expect(() => createMachineOrThrow('not-a-game', 'm7')).toThrow(/not-a-game/);
  });
});

describe('machine type survives a save round-trip', () => {
  it('restores a blackjack table as a BlackjackTable, not a SlotMachine', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.place('blackjack-table', 5, 5);
    const saved = JSON.parse(JSON.stringify(world.toJSON()));

    const restored = new CasinoWorld({ seed: 1, autoSpawn: false });
    restored.loadJSON(saved);

    const machines = [...restored.machines.values()];
    expect(machines).toHaveLength(1);
    expect(machines[0]).toBeInstanceOf(BlackjackTable);
  });
});
