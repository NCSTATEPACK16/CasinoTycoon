// Monte Carlo check of the rule-adjustment table: the engine deals real shoes
// with cut cards and plays its own generated basic strategy, so this is the
// whole stack — shoe, dealer, splits, doubles, payouts, strategy — measured
// against the published edges.

import { describe, expect, it } from 'vitest';
import { Rng } from '../../rng';
import { blackjackEngine, Shoe, type BlackjackView } from './blackjack';
import { validateBlackjackRules, type BlackjackRules } from './rules';

const HANDS = 2_000_000;

function measure(rules: BlackjackRules, seed: number): { edge: number; se: number } {
  const rng = new Rng(seed);
  const shoe = new Shoe(rules.decks, rules.penetration, rng);
  let net = 0;
  let sq = 0;
  for (let i = 0; i < HANDS; i++) {
    const r = blackjackEngine.begin(rng, rules, [{ spot: 'main', amount: 1 }], shoe);
    for (let o = r.options(); o; o = r.options()) {
      r.act(blackjackEngine.strategyFor(rules, r.view() as BlackjackView, o));
    }
    const res = r.result()!;
    const d = res.wagered - res.returned;
    net += d;
    sq += d * d;
  }
  const mean = net / HANDS;
  return { edge: mean, se: Math.sqrt((sq / HANDS - mean * mean) / HANDS) };
}

const RULE_SETS = [
  { name: '6D S17 DAS 3:2', raw: {} },
  { name: '8D H17 DAS LS 3:2', raw: { decks: 8, h17: true, surrender: 'late' } },
  { name: '6D H17 DAS 6:5', raw: { h17: true, blackjackPays: '6:5' } },
];

describe('blackjack edge, Monte Carlo (2M hands per rule set)', () => {
  it.each(RULE_SETS)(
    '$name lands within ±0.15% of the table',
    ({ raw }) => {
      const { rules } = validateBlackjackRules(raw);
      const { edge, se } = measure(rules, 2026);
      // σ per hand is ~1.15 units, so the standard error is ~0.08%: the
      // ±0.15% band is ~1.9σ and the fixed seed makes the check repeatable.
      expect(se).toBeLessThan(0.001);
      expect(Math.abs(edge - blackjackEngine.theoreticalEdge(rules))).toBeLessThan(0.0015);
    },
    180_000,
  );

  it('6:5 costs the player about 1.39%', () => {
    // Same seed, same shoes, same decisions: the only difference between the
    // two runs is what a natural pays, so the noise cancels.
    const { rules: full } = validateBlackjackRules({});
    const { rules: short } = validateBlackjackRules({ blackjackPays: '6:5' });
    const diff = measure(short, 77).edge - measure(full, 77).edge;
    expect(Math.abs(diff - 0.0139)).toBeLessThan(0.0006);
  }, 180_000);
});
