import { describe, expect, it } from 'vitest';
import { POKER_BALANCE } from '../../../data/balance';
import { Rng } from '../../rng';
import { CasinoWorld } from '../../world';
import { createMachine } from './factory';
import { PokerTable } from './PokerTable';

const seat = (t: PokerTable, n: number) => {
  for (let i = 0; i < n; i++) t.claimSeat(`g${i}`);
};

describe('PokerTable', () => {
  it('refuses to deal below the minimum player count', () => {
    const t = new PokerTable('p1');
    seat(t, 1);
    const res = t.play(new Rng(1));
    expect(res).toEqual({ wager: 0, payout: 0 });
  });

  it('does not wear while it cannot deal', () => {
    const t = new PokerTable('p2');
    seat(t, 1);
    const before = t.reliability;
    for (let i = 0; i < 50; i++) t.play(new Rng(i));
    expect(t.reliability).toBe(before);
  });

  it('wears normally once it can deal', () => {
    const t = new PokerTable('p3');
    seat(t, 2);
    const before = t.reliability;
    t.play(new Rng(7));
    expect(t.reliability).toBeLessThan(before);
  });

  it('takes exactly the rake regardless of player count', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const t = new PokerTable(`p-${n}`);
      seat(t, n);
      const rng = new Rng(4242 + n);
      let wagered = 0;
      let paid = 0;
      // 200k per seat count: the rake band (+/-0.02) is only ~1.3 sigma at
      // 20k, and this asserts across five values of N — five chances to fail
      // spuriously. At 200k it is >4 sigma.
      for (let i = 0; i < 200000; i++) {
        t.reliability = 100;
        t.broken = false;
        const res = t.play(rng);
        wagered += res.wager;
        paid += res.payout;
      }
      const houseTake = (wagered - paid) / wagered;
      expect(houseTake).toBeGreaterThan(POKER_BALANCE.rake - 0.02);
      expect(houseTake).toBeLessThan(POKER_BALANCE.rake + 0.02);
    }
  });

  it('pays a bigger pot at a fuller table', () => {
    const small = new PokerTable('p-small');
    seat(small, 2);
    const big = new PokerTable('p-big');
    seat(big, 6);
    const potOf = (t: PokerTable) => {
      for (let i = 0; i < 500; i++) {
        t.reliability = 100;
        const res = t.play(new Rng(i));
        if (res.payout > 0) return res.payout;
      }
      return 0;
    };
    expect(potOf(big)).toBeGreaterThan(potOf(small));
  });

  it('declares six seats', () => {
    const t = new PokerTable('p-seats');
    for (let i = 0; i < POKER_BALANCE.seats; i++) expect(t.claimSeat(`g${i}`)).not.toBeNull();
    expect(t.claimSeat('overflow')).toBeNull();
  });

  it('is buildable through the machine factory', () => {
    const m = createMachine('poker-table', 'p-factory');
    expect(m).toBeInstanceOf(PokerTable);
    expect(m!.defId).toBe('poker-table');
    expect(m!.costToPlay).toBe(POKER_BALANCE.costToPlay);
  });
});

describe('world.isTableWaitingForPlayers', () => {
  it('is true for an under-populated poker table and false once it can deal', () => {
    const world = new CasinoWorld({ seed: 11, autoSpawn: false });
    // place() fails silently on insufficient funds — assert it succeeded.
    const po = world.place('poker-table', 4, 4);
    expect(po).not.toBeNull();
    const table = world.machines.get(po!.id) as PokerTable;
    expect(table).toBeInstanceOf(PokerTable);

    // An empty table also can't deal; callers ask this about the table a guest
    // is already sitting at, so the seated case is the one that matters.
    expect(world.isTableWaitingForPlayers(po!.id)).toBe(true);
    table.claimSeat('guest-a');
    expect(world.isTableWaitingForPlayers(po!.id)).toBe(true);
    table.claimSeat('guest-b');
    expect(world.isTableWaitingForPlayers(po!.id)).toBe(false);
  });

  it('is false for a non-poker machine and for an unknown id', () => {
    const world = new CasinoWorld({ seed: 11, autoSpawn: false });
    const slot = world.place('slot-machine', 8, 8);
    expect(slot).not.toBeNull();
    expect(world.isTableWaitingForPlayers(slot!.id)).toBe(false);
    expect(world.isTableWaitingForPlayers('nope')).toBe(false);
  });
});
