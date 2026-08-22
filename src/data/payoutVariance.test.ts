import { describe, expect, it } from 'vitest';
import { SLOT_BALANCE, slotExpectedRtp, type PayoutOutcome } from './balance';

/**
 * P16 — the daily-profit coin flip is a payout-table property.
 *
 * A day's takings are the sum of a few hundred pulls, so the house edge only
 * shows through once the number of pulls is large next to the payout variance.
 * The shipped slot table had a per-pull standard deviation 21 times the edge,
 * which needs roughly 450 pulls before the edge dominates — far more than a
 * small floor sees in a day. That is why daily profit read as a coin flip and
 * why lag-1 autocorrelation sat near zero: not the modifiers, the maths.
 *
 * The fix has to leave RTP exactly where it was. Cutting variance by taking
 * money off the players is not a difficulty-curve change, it is a nerf.
 */
function moments(table: readonly PayoutOutcome[]) {
  const rtp = table.reduce((s, o) => s + o.p * o.multiplier, 0);
  const pLoss = 1 - table.reduce((s, o) => s + o.p, 0);
  const variance =
    table.reduce((s, o) => s + o.p * (o.multiplier - rtp) ** 2, 0) + pLoss * (0 - rtp) ** 2;
  return { rtp, sd: Math.sqrt(variance), edge: 1 - rtp, pLoss };
}

describe('slot payout table', () => {
  it('holds the shipped 8% house edge exactly', () => {
    expect(slotExpectedRtp()).toBeCloseTo(0.92, 10);
  });

  it('is a well-formed distribution', () => {
    const { pLoss } = moments(SLOT_BALANCE.payoutTable);
    expect(pLoss).toBeGreaterThan(0);
    expect(pLoss).toBeLessThan(1);
  });

  it('keeps per-pull variance low enough for a day to mean something', () => {
    // The shipped table sat at 21.1. Anything above ~12 needs more pulls than a
    // day provides, and the difficulty curve dissolves into noise.
    const { sd, edge } = moments(SLOT_BALANCE.payoutTable);
    expect(sd / edge).toBeLessThan(12);
  });

  it('still pays a jackpot worth strutting about', () => {
    // P11's strut and the reputation bump both key off a big multiplier, so
    // flattening the tail entirely would quietly delete a feature.
    const best = Math.max(...SLOT_BALANCE.payoutTable.map((o) => o.multiplier));
    expect(best).toBeGreaterThanOrEqual(15);
  });
});
