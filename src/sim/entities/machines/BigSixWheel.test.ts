import { describe, expect, it } from 'vitest';
import { BIG_SIX_BALANCE, bigSixExpectedRtp } from '../../../data/balance';
import { Rng } from '../../rng';
import { BigSixWheel } from './BigSixWheel';
import { createMachine } from './factory';
import { SlotMachine } from './SlotMachine';

describe('BigSixWheel', () => {
  it('has a 20% house edge by construction', () => {
    expect(bigSixExpectedRtp()).toBeCloseTo(0.8, 5);
  });

  // 100k plays, not 10k: a flat ±5% band is only ~1.8σ at 10k for a
  // high-variance payout table, which would pass a table whose true RTP were
  // 0.88 or 0.96. At 100k the same band is >5σ. Costs a few ms.
  it('pays out within 5% of the expected RTP over 100k plays', () => {
    const w = new BigSixWheel('b1');
    const rng = new Rng(999);
    let wagered = 0;
    let paid = 0;
    for (let i = 0; i < 100000; i++) {
      w.reliability = 100; // isolate RTP from wear-driven breakdown
      w.broken = false;
      const res = w.play(rng);
      wagered += res.wager;
      paid += res.payout;
    }
    expect(paid / wagered).toBeGreaterThan(0.8 * 0.95);
    expect(paid / wagered).toBeLessThan(0.8 * 1.05);
  });

  it('declares an extra happiness penalty', () => {
    expect(new BigSixWheel('b2').extraHappinessOnLoss).toBe(-2);
  });

  it('leaves other games unaffected by the new field', () => {
    expect(new SlotMachine('s1').extraHappinessOnLoss).toBe(0);
  });

  it('is unseated — a plain CasinoGame reservation, no seat cells', () => {
    const w = new BigSixWheel('b3');
    expect(w).not.toHaveProperty('claimSeat');
    expect(w.isAvailable).toBe(true);
    w.reservedBy = 'g1';
    expect(w.isAvailable).toBe(false);
    expect(w.isPlayableBy('g1')).toBe(true);
  });

  it('is buildable through the machine factory', () => {
    const m = createMachine('big-six-wheel', 'b4');
    expect(m).toBeInstanceOf(BigSixWheel);
    expect(m!.defId).toBe('big-six-wheel');
    expect(m!.costToPlay).toBe(BIG_SIX_BALANCE.costToPlay);
  });
});
