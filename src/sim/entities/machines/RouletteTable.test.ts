import { describe, expect, it } from 'vitest';
import { ROULETTE_BALANCE, rouletteExpectedRtp } from '../../../data/balance';
import { Rng } from '../../rng';
import { createMachine } from './factory';
import { RouletteTable } from './RouletteTable';

describe('RouletteTable', () => {
  it('declares six seats', () => {
    const t = new RouletteTable('r1');
    for (let i = 0; i < 6; i++) expect(t.claimSeat(`g${i}`)).not.toBeNull();
    expect(t.claimSeat('g6')).toBeNull();
  });

  it('has an 8% house edge by construction', () => {
    expect(rouletteExpectedRtp()).toBeCloseTo(0.92, 5);
  });

  it('pays out within 5% of the expected RTP over 10k plays', () => {
    const t = new RouletteTable('r2');
    const rng = new Rng(12345);
    let wagered = 0;
    let paid = 0;
    for (let i = 0; i < 10000; i++) {
      t.reliability = 100; // isolate RTP from wear-driven breakdown
      t.broken = false;
      const res = t.play(rng);
      wagered += res.wager;
      paid += res.payout;
    }
    expect(paid / wagered).toBeGreaterThan(0.92 * 0.95);
    expect(paid / wagered).toBeLessThan(0.92 * 1.05);
  });

  it('can pay a jackpot large enough to trigger the winner strut', () => {
    // The 20x branch must clear STRUT_BALANCE.payoutMultiplier (5x).
    const best = Math.max(...ROULETTE_BALANCE.payoutTable.map((o) => o.multiplier));
    expect(best).toBeGreaterThanOrEqual(5);
  });

  it('is buildable through the machine factory', () => {
    const m = createMachine('roulette-table', 'r3');
    expect(m).toBeInstanceOf(RouletteTable);
    expect(m!.defId).toBe('roulette-table');
    expect(m!.costToPlay).toBe(ROULETTE_BALANCE.costToPlay);
  });
});
