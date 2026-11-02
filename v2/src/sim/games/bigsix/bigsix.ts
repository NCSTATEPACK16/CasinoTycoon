// Big six: a 54-segment money wheel. Guests back a symbol; the wheel lands on
// one segment and every bet on that symbol pays its number to 1. Every edge is
// exact over the 54 segments.
//
// Spots: `sym:1`, `sym:2`, `sym:5`, `sym:10`, `sym:20`, `sym:joker`,
// `sym:logo`; a plain `main` bet backs $1. One action, `spin`.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import {
  asRecord,
  clampBet,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

export const BIG_SIX_SYMBOLS = ['1', '2', '5', '10', '20', 'joker', 'logo'] as const;
export type BigSixSymbol = (typeof BIG_SIX_SYMBOLS)[number];

/**
 * Segments per symbol. Standard (Wizard of Odds, "Big Six"): $1 ×24, $2 ×15,
 * $5 ×7, $10 ×4, $20 ×2, joker and logo ×1 each. The Atlantic City wheel
 * swaps one $1 segment for a $5 ($1 ×23, $5 ×8).
 */
export const BIG_SIX_LAYOUTS: Readonly<
  Record<BigSixLayout, Readonly<Record<BigSixSymbol, number>>>
> = {
  standard: { '1': 24, '2': 15, '5': 7, '10': 4, '20': 2, joker: 1, logo: 1 },
  'atlantic-city': { '1': 23, '2': 15, '5': 8, '10': 4, '20': 2, joker: 1, logo: 1 },
};
export type BigSixLayout = 'standard' | 'atlantic-city';

export interface BigSixRules extends BaseRules {
  /** What the joker and logo pay, to 1: 45 (most rooms) or 40. */
  jokerPays: 45 | 40;
  segments: BigSixLayout;
}

/** What a symbol pays, to 1. */
export function paysFor(rules: BigSixRules, sym: BigSixSymbol): number {
  return sym === 'joker' || sym === 'logo' ? rules.jokerPays : Number(sym);
}

/**
 * The wheel, segment by segment: each symbol's segments spread evenly round
 * the rim (every symbol's k-th segment sits at (k + ½) / count of the way
 * round, then the wheel is read in that order), joker and logo opposite.
 */
export function wheelOf(layout: BigSixLayout): BigSixSymbol[] {
  const counts = BIG_SIX_LAYOUTS[layout];
  const slots: { at: number; sym: BigSixSymbol }[] = [];
  for (const sym of BIG_SIX_SYMBOLS) {
    const n = counts[sym];
    const offset = sym === 'logo' ? 0.5 : sym === 'joker' ? 0 : 0.5 / BIG_SIX_SYMBOLS.length;
    for (let k = 0; k < n; k++) slots.push({ at: (k + offset) / n, sym });
  }
  slots.sort(
    (a, b) => a.at - b.at || BIG_SIX_SYMBOLS.indexOf(a.sym) - BIG_SIX_SYMBOLS.indexOf(b.sym),
  );
  return slots.map((s) => s.sym);
}
const WHEELS: Readonly<Record<BigSixLayout, readonly BigSixSymbol[]>> = {
  standard: wheelOf('standard'),
  'atlantic-city': wheelOf('atlantic-city'),
};

function symbolOf(spot: string): BigSixSymbol | null {
  if (spot === 'main') return '1';
  const m = /^sym:(.+)$/.exec(spot);
  return m && (BIG_SIX_SYMBOLS as readonly string[]).includes(m[1]!)
    ? (m[1] as BigSixSymbol)
    : null;
}

/** Exact edge of a spot: 1 − (segments × (pays + 1)) / 54. */
export function bigSixSpotEdge(rules: BigSixRules, spot: string): number {
  const sym = symbolOf(spot);
  if (!sym) return 0;
  const n = BIG_SIX_LAYOUTS[rules.segments][sym];
  return 1 - (n * (paysFor(rules, sym) + 1)) / 54;
}

/** The guests' spread, like sic bo's: mostly $1, a tail of long shots. */
export const BIG_SIX_GUEST_MIX: Readonly<Record<BigSixSymbol, number>> = {
  '1': 0.45,
  '2': 0.2,
  '5': 0.12,
  '10': 0.08,
  '20': 0.06,
  joker: 0.045,
  logo: 0.045,
};

export interface BigSixView {
  segment: number | null;
}

class BigSixRound implements Round {
  private settled: RoundResult | null = null;
  private readonly segment: number;

  constructor(
    rng: RngLike,
    private readonly rules: BigSixRules,
    private readonly bets: readonly Bet[],
    preset?: number,
  ) {
    this.segment = preset ?? Math.floor(rng.next() * 54);
  }

  options(): string[] | null {
    return this.settled ? null : ['spin'];
  }

  act(action: string): void {
    if (this.settled || action !== 'spin') return;
    const symbol = WHEELS[this.rules.segments][this.segment]!;
    let wagered = 0;
    let returned = 0;
    for (const b of this.bets) {
      wagered += b.amount;
      if (symbolOf(b.spot) === symbol) returned += b.amount * (paysFor(this.rules, symbol) + 1);
    }
    this.settled = {
      wagered,
      returned,
      summary: `${symbol === 'joker' || symbol === 'logo' ? symbol : `$${symbol}`}${returned > 0 ? ' pays' : ''}`,
      detail: { segment: this.segment, symbol },
    };
  }

  view(): BigSixView {
    return { segment: this.settled ? this.segment : null };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A spin that lands on a fixed segment, for tests and replays. */
export function bigSixRoundAt(rules: BigSixRules, bets: readonly Bet[], segment: number): Round {
  return new BigSixRound({ next: () => 0 }, rules, bets, segment);
}

export const bigSixEngine: CasinoEngine<BigSixRules> = {
  kind: 'bigsix',

  defaultRules: () => ({ minBet: 1, maxBet: 100, jokerPays: 45, segments: 'standard' }),

  validateRules(raw, base = bigSixEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        jokerPays: readChoice(src, 'jokerPays', base.jokerPays, [45, 40], issues),
        segments: readChoice(src, 'segments', base.segments, ['standard', 'atlantic-city'], issues),
      },
      issues,
    };
  },

  /** The guest mix's stake-weighted edge (each bet is one unit). */
  theoreticalEdge(rules) {
    let edge = 0;
    for (const sym of BIG_SIX_SYMBOLS)
      edge += BIG_SIX_GUEST_MIX[sym] * bigSixSpotEdge(rules, `sym:${sym}`);
    return edge;
  },

  roundsPerHour(_rules, seated) {
    // A wheel man spins about 40 times an hour; a crowd at the layout slows it.
    return 40 / (1 + 0.03 * Math.max(1, seated));
  },

  begin(rng, rules, bets) {
    return new BigSixRound(rng, rules, bets);
  },

  strategy: (_view, options) => options[0]!,

  appeal(rules) {
    return (
      (rules.jokerPays === 45 ? 1.0 : 0.95) * (rules.segments === 'atlantic-city' ? 1.03 : 1.0)
    );
  },

  spotEdge: bigSixSpotEdge,

  guestBets(rules, unit, rng) {
    const amount = clampBet(rules, unit);
    let r = rng.next();
    for (const sym of BIG_SIX_SYMBOLS) {
      if (r < BIG_SIX_GUEST_MIX[sym]) return [{ spot: `sym:${sym}`, amount }];
      r -= BIG_SIX_GUEST_MIX[sym];
    }
    return [{ spot: 'sym:1', amount }];
  },
};
