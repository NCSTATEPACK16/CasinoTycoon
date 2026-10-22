import { describe, expect, it } from 'vitest';
import { POKER_BALANCE } from '../../../data/balance';
import { Rng } from '../../rng';
import { CasinoWorld } from '../../world';
import { createMachine } from './factory';
import { PokerTable } from './PokerTable';

// v2: the poker table deals Ultimate Texas Hold'em against the house. The v1
// rake model — guests playing each other, a table that cannot deal below two
// players — is gone, and so are the tests that pinned it.
describe("PokerTable (Ultimate Texas Hold'em)", () => {
  it('deals to a lone guest', () => {
    const t = new PokerTable('p1');
    t.claimSeat('g0');
    const res = t.play(new Rng(1));
    expect(res.wager).toBeGreaterThanOrEqual(2 * t.costToPlay);
    expect(res.rounds).toBeGreaterThanOrEqual(1);
  });

  it('wears with every play', () => {
    const t = new PokerTable('p3');
    t.claimSeat('g0');
    const before = t.reliability;
    t.play(new Rng(7));
    expect(t.reliability).toBeLessThan(before);
  });

  it('declares six seats', () => {
    const t = new PokerTable('p6');
    for (let i = 0; i < 6; i++) expect(t.claimSeat(`g${i}`)).not.toBeNull();
    expect(t.claimSeat('g6')).toBeNull();
  });

  it('is buildable through the machine factory', () => {
    const m = createMachine('poker-table', 'p7');
    expect(m).toBeInstanceOf(PokerTable);
    expect(m!.defId).toBe('poker-table');
    expect(m!.costToPlay).toBe(POKER_BALANCE.costToPlay);
  });
});

describe('world.isTableWaitingForPlayers', () => {
  it('is false everywhere: a house-banked table never waits for a second player', () => {
    const world = new CasinoWorld({ seed: 11, autoSpawn: false });
    const po = world.place('poker-table', 4, 4);
    expect(po).not.toBeNull();
    const table = world.machines.get(po!.id) as PokerTable;
    table.claimSeat('guest-a');
    expect(world.isTableWaitingForPlayers(po!.id)).toBe(false);
    expect(world.isTableWaitingForPlayers('nope')).toBe(false);
  });
});

describe('PokerTable.testSpin', () => {
  it('moves no money and applies no wear, unlike play()', () => {
    const t = new PokerTable('p-free');
    const rng = new Rng(9);
    for (let i = 0; i < 100; i++) t.testSpin(rng);
    expect(t.reliability).toBe(100);
    expect(t.lifetimeProfit).toBe(0);
  });
});
