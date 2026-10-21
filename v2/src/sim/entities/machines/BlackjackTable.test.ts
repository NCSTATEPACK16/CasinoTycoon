import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../EventBus';
import { BLACKJACK_BALANCE, blackjackExpectedRtp } from '../../../data/balance';
import { Rng } from '../../rng';
import { BlackjackTable } from './BlackjackTable';

afterEach(() => eventBus.clear());

describe('BlackjackTable', () => {
  it('pays out close to the configured RTP over 10k test rounds', () => {
    const table = new BlackjackTable('obj-1');
    const rng = new Rng(1234);
    let paid = 0;
    const rounds = 10_000;
    for (let i = 0; i < rounds; i++) paid += table.testSpin(rng);
    const rtp = paid / (rounds * table.costToPlay);
    expect(rtp).toBeGreaterThan(blackjackExpectedRtp() - 0.05);
    expect(rtp).toBeLessThan(blackjackExpectedRtp() + 0.05);
  });

  it('testSpin causes no wear, profit, or breakage', () => {
    const table = new BlackjackTable('obj-1');
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) table.testSpin(rng);
    expect(table.reliability).toBe(100);
    expect(table.lifetimeProfit).toBe(0);
    expect(table.broken).toBe(false);
  });

  it('seats up to 4 guests, each in a distinct seat; a 5th is refused', () => {
    const table = new BlackjackTable('obj-1');
    const seats = ['a', 'b', 'c', 'd'].map((g) => table.claimSeat(g));
    expect(seats).not.toContain(null);
    expect(new Set(seats).size).toBe(4);
    expect(table.claimSeat('e')).toBeNull();
    expect(table.seatedCount).toBe(4);
  });

  it('is playable only by seated guests', () => {
    const table = new BlackjackTable('obj-1');
    table.claimSeat('a');
    expect(table.isPlayableBy('a')).toBe(true);
    expect(table.isPlayableBy('b')).toBe(false);
  });

  it('release frees the guest seat so another can sit', () => {
    const table = new BlackjackTable('obj-1');
    for (const g of ['a', 'b', 'c', 'd']) table.claimSeat(g);
    table.release('b');
    expect(table.seatedCount).toBe(3);
    expect(table.isPlayableBy('b')).toBe(false);
    expect(table.claimSeat('e')).not.toBeNull();
  });

  it('isAvailable while a seat is free and not broken; unavailable when full', () => {
    const table = new BlackjackTable('obj-1');
    expect(table.isAvailable).toBe(true);
    for (const g of ['a', 'b', 'c', 'd']) table.claimSeat(g);
    expect(table.isAvailable).toBe(false);
    table.release('a');
    expect(table.isAvailable).toBe(true);
    table.broken = true;
    expect(table.isAvailable).toBe(false);
  });

  it('wears down with real rounds and breaks at zero reliability', () => {
    const table = new BlackjackTable('obj-1');
    const rng = new Rng(42);
    let broke = false;
    eventBus.on('machineBroke', ({ machineId }) => {
      if (machineId === 'obj-1') broke = true;
    });
    const roundsToBreak = Math.ceil(100 / BLACKJACK_BALANCE.wearPerPlay);
    for (let i = 0; i < roundsToBreak; i++) table.play(rng);
    expect(table.reliability).toBe(0);
    expect(table.broken).toBe(true);
    expect(broke).toBe(true);
    // Broken tables refuse further rounds.
    expect(table.play(rng)).toEqual({ wager: 0, payout: 0 });
  });

  it('exposes a slower, higher-stakes cadence than slots', () => {
    const table = new BlackjackTable('obj-1');
    expect(table.costToPlay).toBe(BLACKJACK_BALANCE.costToPlay);
    expect(table.cadence.intervalTicks).toBe(BLACKJACK_BALANCE.playIntervalTicks);
    expect(table.cadence.playsMin).toBe(BLACKJACK_BALANCE.playsMin);
    expect(table.cadence.playsMax).toBe(BLACKJACK_BALANCE.playsMax);
  });
});
