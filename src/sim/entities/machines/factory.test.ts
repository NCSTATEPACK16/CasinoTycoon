import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../EventBus';
import { SLOT_BALANCE } from '../../../data/balance';
import { OBJECT_CATALOG } from '../../../data/objects';
import { BigSixWheel } from './BigSixWheel';
import { BingoHall } from './BingoHall';
import { BlackjackTable } from './BlackjackTable';
import { CrapsTable } from './CrapsTable';
import { HighLimitTable } from './HighLimitTable';
import { KenoLounge } from './KenoLounge';
import { PachinkoMachine } from './PachinkoMachine';
import { PaiGowTable } from './PaiGowTable';
import { PennySlots } from './PennySlots';
import { PokerTable } from './PokerTable';
import { RouletteTable } from './RouletteTable';
import { SicBoTable } from './SicBoTable';
import { SlotMachine } from './SlotMachine';
import { ThreeCardPokerTable } from './ThreeCardPokerTable';
import { VideoPokerBank } from './VideoPokerBank';
import { CasinoWorld } from '../../world';
import { createMachine, createMachineOrThrow, isMachineDefId } from './factory';

afterEach(() => eventBus.clear());

// Derived from the catalog rather than hand-listed: a new game added to the
// catalog and the factory but forgotten here would otherwise go untested.
const GAME_CLASSES: Record<string, unknown> = {
  'slot-machine': SlotMachine,
  'blackjack-table': BlackjackTable,
  'craps-table': CrapsTable,
  'roulette-table': RouletteTable,
  'big-six-wheel': BigSixWheel,
  'poker-table': PokerTable,
  'high-limit-table': HighLimitTable,
  // P17 Part B Tier 1 — throughput.
  'penny-slots': PennySlots,
  pachinko: PachinkoMachine,
  'keno-lounge': KenoLounge,
  'video-poker': VideoPokerBank,
  // P17 Part B Tier 2 — the working floor.
  'sic-bo': SicBoTable,
  'three-card-poker': ThreeCardPokerTable,
  'pai-gow': PaiGowTable,
  'bingo-hall': BingoHall,
};

describe('createMachine', () => {
  const gameDefIds = OBJECT_CATALOG.filter((d) => d.category === 'game').map((d) => d.id);

  it('can build every catalog game, and every buildable defId is a catalog game', () => {
    for (const defId of gameDefIds) {
      expect(isMachineDefId(defId), defId).toBe(true);
    }
    // The other direction: nothing the factory can build is missing from the
    // catalog, or it would be unplaceable and unsaveable.
    for (const defId of Object.keys(GAME_CLASSES)) {
      expect(gameDefIds, defId).toContain(defId);
    }
  });

  it.each(Object.keys(GAME_CLASSES))('builds %s as its own class', (defId) => {
    expect(createMachine(defId, 'm-' + defId)).toBeInstanceOf(
      GAME_CLASSES[defId] as new (...args: never[]) => unknown,
    );
  });

  it('has a class mapping for every catalog game', () => {
    for (const defId of gameDefIds) {
      expect(GAME_CLASSES[defId], defId).toBeDefined();
    }
  });

  it('returns null for a non-game object', () => {
    expect(createMachine('toilet', 'm4')).toBeNull();
  });

  it('honours an explicit costToPlay', () => {
    expect(createMachine('slot-machine', 'm5', 42)?.costToPlay).toBe(42);
  });

  it('falls back to the balance default when cost is omitted', () => {
    expect(createMachine('slot-machine', 'm6')?.costToPlay).toBe(SLOT_BALANCE.costToPlay);
  });

  it('throws on an unknown defId instead of substituting a slot machine', () => {
    expect(() => createMachineOrThrow('not-a-game', 'm7')).toThrow(/not-a-game/);
  });

  // A plain object literal inherits Object.prototype, so a truthy lookup would
  // resolve these to real values and hand back a non-CasinoGame that then
  // sails past createMachineOrThrow's guard.
  it.each(['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'])(
    'treats the inherited key %s as unknown, not a machine',
    (key) => {
      expect(createMachine(key, 'm8')).toBeNull();
      expect(() => createMachineOrThrow(key, 'm9')).toThrow(new RegExp(key));
    },
  );
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

  // The blackjack case above was an explicit branch of the old ternary, so it
  // passed even with the bug. Only *unlisted* defIds fell through to
  // `new SlotMachine`, which is the case this covers.
  it('rejects a save naming an unregistered machine instead of loading a slot machine', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const saved = JSON.parse(JSON.stringify(world.toJSON()));
    saved.machines[0].defId = 'roulette-table-from-a-newer-build';

    const restored = new CasinoWorld({ seed: 1, autoSpawn: false });
    expect(() => restored.loadJSON(saved)).toThrow(/roulette-table-from-a-newer-build/);
  });

  it('leaves the live session untouched when a save fails to load', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.place('blackjack-table', 5, 5);
    const cashBefore = world.state.cash;
    const objectsBefore = world.state.allObjects().length;

    const corrupt = JSON.parse(JSON.stringify(world.toJSON()));
    corrupt.machines[0].defId = 'not-a-game';
    corrupt.state.cash = 1; // would be obvious if the wipe had begun

    expect(() => world.loadJSON(corrupt)).toThrow(/not-a-game/);

    const machines = [...world.machines.values()];
    expect(machines).toHaveLength(1);
    expect(machines[0]).toBeInstanceOf(BlackjackTable);
    expect(world.state.cash).toBe(cashBefore);
    expect(world.state.allObjects()).toHaveLength(objectsBefore);
  });
});
