import { describe, expect, it } from 'vitest';
import { BIG_SIX_BALANCE, bigSixExpectedRtp } from '../../../data/balance';
import { Rng } from '../../rng';
import { BigSixWheel } from './BigSixWheel';
import { createMachine } from './factory';
import { SlotMachine } from './SlotMachine';

describe('BigSixWheel', () => {
  it('holds about 15% on the guests\' spread (sim/games/bigsix)', () => {
    expect(bigSixExpectedRtp()).toBeGreaterThan(0.84);
    expect(bigSixExpectedRtp()).toBeLessThan(0.86);
  });

  // 100k plays of several spins each: the long shots (45 to 1) make a spin
  // swing, and ±5% of the RTP is still many standard errors at this size.
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
    expect(paid / wagered).toBeGreaterThan(bigSixExpectedRtp() * 0.95);
    expect(paid / wagered).toBeLessThan(bigSixExpectedRtp() * 1.05);
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
