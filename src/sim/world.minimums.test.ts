import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import {
  BLACKJACK_BALANCE,
  SLOT_BALANCE,
  supportsTableMinimum,
  TABLE_MINIMUMS,
  wagerForMinimum,
} from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

function tableWorld(defId = 'blackjack-table') {
  const world = new CasinoWorld({ seed: 11, autoSpawn: false });
  world.startScenario(null);
  world.state.cash = 100000;
  const po = world.place(defId, 6, 6)!;
  return { world, machine: world.machines.get(po.id)! };
}

describe('P4 — per-instance table minimums', () => {
  it('opens every table at its default tier', () => {
    for (const defId of Object.keys(TABLE_MINIMUMS.defaultByType)) {
      const { machine } = tableWorld(defId);
      expect(machine.supportsMinimum).toBe(true);
      expect(machine.tableMinimum).toBe(TABLE_MINIMUMS.defaultByType[defId]);
    }
  });

  it('leaves the tuned wager untouched at the default tier', () => {
    // A2 must add a dial, not silently rebalance the economy underneath it.
    const { machine } = tableWorld('blackjack-table');
    expect(machine.costToPlay).toBe(BLACKJACK_BALANCE.costToPlay);
  });

  it('does not give a fixed-denomination game a minimum', () => {
    const { machine } = tableWorld('slot-machine');
    expect(supportsTableMinimum('slot-machine')).toBe(false);
    expect(machine.supportsMinimum).toBe(false);
    expect(machine.tableMinimum).toBeNull();
    expect(machine.costToPlay).toBe(SLOT_BALANCE.costToPlay);
    expect(machine.setTableMinimum(25)).toBe(false);
  });

  it('scales the wager proportionally with the minimum', () => {
    const { machine } = tableWorld('blackjack-table');
    const base = machine.costToPlay;
    machine.setTableMinimum(50); // one tier above the $25 default
    expect(machine.costToPlay).toBe(base * 2);
    machine.setTableMinimum(100);
    expect(machine.costToPlay).toBe(base * 4);
    machine.setTableMinimum(25);
    expect(machine.costToPlay).toBe(base);
  });

  it('rejects a minimum off the tier ladder rather than inventing a denomination', () => {
    const { machine } = tableWorld('blackjack-table');
    const before = machine.tableMinimum;
    for (const bad of [7, 0, -5, 1000, 26]) {
      expect(machine.setTableMinimum(bad)).toBe(false);
    }
    expect(machine.tableMinimum).toBe(before);
  });

  it('sets each instance independently', () => {
    const world = new CasinoWorld({ seed: 11, autoSpawn: false });
    world.startScenario(null);
    world.state.cash = 100000;
    const a = world.machines.get(world.place('blackjack-table', 6, 6)!.id)!;
    const b = world.machines.get(world.place('blackjack-table', 12, 6)!.id)!;
    a.setTableMinimum(100);
    expect(a.tableMinimum).toBe(100);
    // The whole point of "per-instance": a high-limit corner and a $25 pit on
    // the same floor.
    expect(b.tableMinimum).toBe(TABLE_MINIMUMS.defaultByType['blackjack-table']);
    expect(b.costToPlay).not.toBe(a.costToPlay);
  });

  it('survives a save round-trip without reverting to the default', () => {
    const { world, machine } = tableWorld('blackjack-table');
    machine.setTableMinimum(200);
    const wager = machine.costToPlay;

    const restored = new CasinoWorld({ seed: 1 });
    restored.loadJSON(JSON.parse(JSON.stringify(world.toJSON())));
    const loaded = restored.machines.get(machine.id)!;
    expect(loaded.tableMinimum).toBe(200);
    expect(loaded.costToPlay).toBe(wager);
  });

  it('loads a pre-A2 save at the default tier instead of throwing', () => {
    const { world } = tableWorld('blackjack-table');
    const snapshot = JSON.parse(JSON.stringify(world.toJSON()));
    for (const m of snapshot.machines) delete m.tableMinimum;
    const restored = new CasinoWorld({ seed: 1 });
    expect(() => restored.loadJSON(snapshot)).not.toThrow();
    const loaded = [...restored.machines.values()][0]!;
    expect(loaded.tableMinimum).toBe(TABLE_MINIMUMS.defaultByType['blackjack-table']);
  });

  it('ignores a corrupt minimum in a save and keeps the default', () => {
    const { world } = tableWorld('blackjack-table');
    const snapshot = JSON.parse(JSON.stringify(world.toJSON()));
    for (const m of snapshot.machines) m.tableMinimum = 37;
    const restored = new CasinoWorld({ seed: 1 });
    restored.loadJSON(snapshot);
    const loaded = [...restored.machines.values()][0]!;
    expect(loaded.tableMinimum).toBe(TABLE_MINIMUMS.defaultByType['blackjack-table']);
  });
});

describe('A2 — the bankroll gate', () => {
  it('adds no gate at the house minimum', () => {
    // Landing A2 must not make the base game harder before the player touches
    // anything — measured, a gate here cost four campaign seeds.
    for (const defId of Object.keys(TABLE_MINIMUMS.defaultByType)) {
      const { machine } = tableWorld(defId);
      if (defId === 'high-limit-table') continue; // keeps its own bespoke gate
      expect(machine.minWallet).toBe(0);
    }
  });

  it('raises the gate as the table is raised', () => {
    const { machine } = tableWorld('blackjack-table');
    machine.setTableMinimum(50);
    const atOneTier = machine.minWallet;
    expect(atOneTier).toBeGreaterThan(0);
    machine.setTableMinimum(100);
    expect(machine.minWallet).toBeGreaterThan(atOneTier);
  });

  // P16 — the gate rises in step with the wager, not faster than it.
  //
  // It used to be a multiple of the *raised* wager times (ratio - 1), which is
  // quadratic in the tier while revenue per hand is only linear. Raising a
  // table therefore lost occupancy faster than it gained stake, at every rung
  // and for every crowd, so the only sensible minimum was the default one.
  // That is what made the dial inert: `tuned`, `mistuned` and a bot that never
  // touched it finished within one seed of each other across 21 runs.
  it('gates in proportion to the tier, not to its square', () => {
    const { machine } = tableWorld('blackjack-table');
    const base = TABLE_MINIMUMS.defaultByType['blackjack-table']!;
    machine.setTableMinimum(base * 2);
    const atDouble = machine.minWallet;
    machine.setTableMinimum(base * 4);
    const atQuadruple = machine.minWallet;
    // Linear in (ratio - 1): 2x is one step above default, 4x is three.
    expect(atQuadruple).toBeCloseTo(atDouble * 3, 6);
  });

  it('keeps a raised table worth raising for a guest who can afford it', () => {
    // The trade has to be two-sided or there is no decision. At double the
    // minimum the stake doubles, so the gate must cost less than double the
    // occupancy it buys — otherwise the rung is dominated and never chosen.
    const { machine } = tableWorld('blackjack-table');
    const base = TABLE_MINIMUMS.defaultByType['blackjack-table']!;
    const wagerAtDefault = machine.costToPlay;
    machine.setTableMinimum(base * 2);
    expect(machine.costToPlay).toBe(wagerAtDefault * 2);
    expect(machine.minWallet).toBeLessThan(wagerAtDefault * TABLE_MINIMUMS.minWalletMultiple * 2);
  });

  it('turns away a guest who cannot show a stake at a raised table', () => {
    const { world, machine } = tableWorld('blackjack-table');
    machine.setTableMinimum(100);
    const gate = machine.minWallet;
    expect(world.reserveMachine('g-poor', gate - 1)).toBeNull();
    expect(world.reserveMachine('g-rich', gate + 1000)).not.toBeNull();
  });

  it('seats anyone who can afford a hand at the house minimum', () => {
    const { world, machine } = tableWorld('blackjack-table');
    expect(world.reserveMachine('g-modest', machine.costToPlay)).not.toBeNull();
  });
});

describe('wagerForMinimum', () => {
  it('is the identity at the default tier for every table type', () => {
    for (const [defId, tier] of Object.entries(TABLE_MINIMUMS.defaultByType)) {
      const { machine } = tableWorld(defId);
      expect(wagerForMinimum(defId, tier)).toBe(machine.costToPlay);
    }
  });

  it('never returns a free hand, however low the tier', () => {
    for (const tier of TABLE_MINIMUMS.tiers) {
      for (const defId of Object.keys(TABLE_MINIMUMS.defaultByType)) {
        expect(wagerForMinimum(defId, tier)).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
