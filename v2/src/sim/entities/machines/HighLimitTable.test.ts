import { describe, expect, it } from 'vitest';
import { highLimitExpectedRtp } from '../../../data/balance';
import { Rng } from '../../rng';
import { SlotMachine } from './SlotMachine';
import { HighLimitTable } from './HighLimitTable';

describe('HighLimitTable', () => {
  it('has a 6% house edge by construction', () => {
    expect(highLimitExpectedRtp()).toBeCloseTo(0.94, 5);
  });

  it('declares a minimum wallet', () => {
    expect(new HighLimitTable('h1').minWallet).toBe(400);
  });

  it('leaves other games with no wallet minimum', () => {
    expect(new SlotMachine('s1').minWallet).toBe(0);
  });

  // 100k plays for the same reason as the other RTP tests — see Task 5: a flat
  // +/-5% band is only ~1.8 sigma at 10k plays, which would happily pass a
  // payout table whose true RTP were 0.88 or 0.96.
  it('pays out within 5% of the expected RTP over 100k plays', () => {
    const t = new HighLimitTable('h2');
    const rng = new Rng(31337);
    let wagered = 0;
    let paid = 0;
    for (let i = 0; i < 100000; i++) {
      // Isolate payout math from wear-driven breakdown: a broken machine
      // returns a zero play and would drag the measured RTP to 0.
      t.reliability = 100;
      t.broken = false;
      const res = t.play(rng);
      wagered += res.wager;
      paid += res.payout;
    }
    expect(paid / wagered).toBeGreaterThan(0.94 * 0.95);
    expect(paid / wagered).toBeLessThan(0.94 * 1.05);
  });
});
