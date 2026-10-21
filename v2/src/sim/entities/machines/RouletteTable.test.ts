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

  // 100k plays, not 10k — please don't lower it. The 1.5%/20x branch dominates
  // the variance (Var ≈ 6.63, σ ≈ 2.58 per play), so σ of the sample mean is
  // ≈0.0258 at 10k: the flat ±5% band would be a mere ±1.79σ, wide enough to
  // wave through a table whose true RTP were 0.88 or 0.96, and narrow enough to
  // fail spuriously on a different seed. At 100k, σ of the mean is ≈0.00815 and
  // the same band is >5σ — safe under any seed. The exact-RTP claim is the
  // rouletteExpectedRtp() test above; this test's job is proving the payout
  // table is actually wired into play() and that wager === costToPlay. It's a
  // tight LCG loop, so the extra samples cost tens of milliseconds.
  it('pays out within 5% of the expected RTP over 100k plays', () => {
    const t = new RouletteTable('r2');
    const rng = new Rng(12345);
    let wagered = 0;
    let paid = 0;
    for (let i = 0; i < 100000; i++) {
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
