// Blackjack rule sets and the published house edge of each.

import type { BaseRules } from '../../../shared/games';
import { asRecord, readChoice, readLimits, readNumber, type RulesIssue } from '../types';

export interface BlackjackRules extends BaseRules {
  decks: 1 | 2 | 6 | 8;
  /** Dealer hits soft 17. */
  h17: boolean;
  blackjackPays: '3:2' | '6:5';
  /** Double after split. */
  das: boolean;
  /** Re-split aces. */
  rsa: boolean;
  surrender: 'none' | 'late';
  /** Most hands a player may split into. */
  maxSplitHands: 2 | 3 | 4;
  /** Fraction of the shoe dealt before the cut card comes out. */
  penetration: number;
}

export const DEFAULT_BLACKJACK_RULES: BlackjackRules = {
  minBet: 25,
  maxBet: 1000,
  decks: 6,
  h17: false,
  blackjackPays: '3:2',
  das: true,
  rsa: false,
  surrender: 'none',
  maxSplitHands: 4,
  penetration: 0.75,
};

export function validateBlackjackRules(
  raw: unknown,
  base: BlackjackRules = DEFAULT_BLACKJACK_RULES,
): { rules: BlackjackRules; issues: RulesIssue[] } {
  const src = asRecord(raw);
  const issues: RulesIssue[] = [];
  const rules: BlackjackRules = {
    ...readLimits(src, base, issues),
    decks: readChoice(src, 'decks', base.decks, [1, 2, 6, 8] as const, issues),
    h17: readChoice(src, 'h17', base.h17, [true, false] as const, issues),
    blackjackPays: readChoice(src, 'blackjackPays', base.blackjackPays, ['3:2', '6:5'] as const, issues),
    das: readChoice(src, 'das', base.das, [true, false] as const, issues),
    rsa: readChoice(src, 'rsa', base.rsa, [true, false] as const, issues),
    surrender: readChoice(src, 'surrender', base.surrender, ['none', 'late'] as const, issues),
    maxSplitHands: readChoice(src, 'maxSplitHands', base.maxSplitHands, [2, 3, 4] as const, issues),
    // Below half the shoe a dealer is shuffling more than dealing; above 90%
    // the last round can run the shoe dry.
    penetration: readNumber(src, 'penetration', base.penetration, 0.5, 0.9, issues),
  };
  return { rules, issues };
}

/**
 * Rule-adjustment table: each entry is the change in HOUSE edge, in percentage
 * points, against the reference game — one deck, dealer stands on soft 17,
 * double on any first two cards, no double after split, split to four hands,
 * no re-split aces, no surrender, blackjack 3:2, dealer peeks. That reference
 * game is almost exactly even (Wizard of Odds puts it at a 0.00–0.02% house
 * edge), so the table's sum is the edge.
 *
 * Values are the Wizard of Odds "Blackjack rule variations" figures for basic
 * strategy players (wizardofodds.com/games/blackjack/rule-variations/), which
 * agree with Griffin's *Theory of Blackjack* to a hundredth of a point:
 *   decks: 2 +0.32, 6 +0.54, 8 +0.57 (1 deck is the reference)
 *   dealer hits soft 17 +0.22
 *   blackjack pays 6:5 +1.39
 *   double after split −0.14
 *   re-split aces −0.08
 *   late surrender −0.08 (−0.10 when the dealer hits soft 17, since the extra
 *     dealer hits make giving up half the bet against an ace more useful)
 *   split to 3 hands +0.01, to 2 hands (no re-split) +0.03
 * The Monte Carlo suite (blackjack.mc.test.ts) checks the sum against 2M
 * dealt hands of the engine's own basic strategy for three rule sets.
 */
export const BJ_RULE_EFFECTS = {
  decks: { 1: 0, 2: 0.32, 6: 0.54, 8: 0.57 } as Record<BlackjackRules['decks'], number>,
  h17: 0.22,
  sixToFive: 1.39,
  das: -0.14,
  rsa: -0.08,
  lateSurrenderS17: -0.08,
  lateSurrenderH17: -0.1,
  maxSplitHands: { 2: 0.03, 3: 0.01, 4: 0 } as Record<BlackjackRules['maxSplitHands'], number>,
} as const;

/** House edge (fraction of the initial bet) for a basic-strategy player. */
export function blackjackEdge(rules: BlackjackRules): number {
  const e = BJ_RULE_EFFECTS;
  let pct = e.decks[rules.decks];
  if (rules.h17) pct += e.h17;
  if (rules.blackjackPays === '6:5') pct += e.sixToFive;
  if (rules.das) pct += e.das;
  if (rules.rsa) pct += e.rsa;
  if (rules.surrender === 'late') pct += rules.h17 ? e.lateSurrenderH17 : e.lateSurrenderS17;
  pct += e.maxSplitHands[rules.maxSplitHands];
  return pct / 100;
}
