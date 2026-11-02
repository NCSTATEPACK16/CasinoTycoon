// Video poker: Jacks or Better. Five cards from a fresh 52-card deck, hold any
// of them, draw replacements, paid on the final hand. The guest plays a
// strategy chart (Wizard of Odds' simple Jacks or Better strategy), not a
// per-hand enumeration.
//
// Spot: `main` (the coin-in). Options: the 32 hold masks `hold:xxxxx`, one
// character per card, 1 = hold.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import { cardLabel, rankOf, suitOf } from '../cards';
import {
  asRecord,
  clampBet,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

export const VP_HANDS = [
  'royal flush',
  'straight flush',
  'four of a kind',
  'full house',
  'flush',
  'straight',
  'three of a kind',
  'two pair',
  'jacks or better',
  'nothing',
] as const;
export type VpHand = (typeof VP_HANDS)[number];

/** Pays "for 1" per hand. Only the full house and flush move between the
 *  tables, which is how casinos name them: 9/6, 8/5, 7/5, 6/5. */
export const VP_PAYTABLES = {
  '9/6': [800, 50, 25, 9, 6, 4, 3, 2, 1, 0],
  '8/5': [800, 50, 25, 8, 5, 4, 3, 2, 1, 0],
  '7/5': [800, 50, 25, 7, 5, 4, 3, 2, 1, 0],
  '6/5': [800, 50, 25, 6, 5, 4, 3, 2, 1, 0],
} as const;
export type VpPaytable = keyof typeof VP_PAYTABLES;

/** Return with optimal play, as published (Wizard of Odds, "Jacks or Better"). */
export const VP_OPTIMAL_RETURN: Readonly<Record<VpPaytable, number>> = {
  '9/6': 0.995439,
  '8/5': 0.972984,
  '7/5': 0.961472,
  '6/5': 0.950071,
};

/**
 * How often each final hand comes up when the guest plays the strategy chart,
 * from a 40M-hand Monte Carlo of this engine (videopoker.test.ts re-measures
 * 2M). The chart does not depend on the paytable, so one set of frequencies
 * gives the chart's return on every table: 9/6 99.45%, 8/5 97.20%, 7/5 96.05%,
 * 6/5 94.90%, each about 0.1 point under optimal play.
 */
export const VP_CHART_FREQ: readonly number[] = [
  0.00002525, 0.0001129, 0.00236455, 0.011500625, 0.011043775, 0.01063095, 0.074536125, 0.1296091,
  0.2144625, 0.545714225,
];

/** The chart's return on a paytable: Σ frequency × pay. */
export function chartReturn(table: VpPaytable): number {
  const pays = VP_PAYTABLES[table];
  return VP_CHART_FREQ.reduce((a, f, i) => a + f * pays[i]!, 0);
}

/** Index into VP_HANDS for a five-card hand. */
export function handIndex(cards: readonly number[]): number {
  const counts = new Array<number>(13).fill(0);
  for (const c of cards) counts[rankOf(c)]!++;
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]!));
  const ranks = cards.map(rankOf).sort((a, b) => a - b);
  const distinct = counts.filter((n) => n > 0).length;
  const wheel = distinct === 5 && ranks[4] === 12 && ranks[3] === 3;
  const straight = distinct === 5 && (ranks[4]! - ranks[0]! === 4 || wheel);
  if (straight && flush) return ranks[0] === 8 ? 0 : 1;
  const top = Math.max(...counts);
  if (top === 4) return 2;
  if (top === 3 && counts.includes(2)) return 3;
  if (flush) return 4;
  if (straight) return 5;
  if (top === 3) return 6;
  const pairs = counts.filter((n) => n === 2).length;
  if (pairs === 2) return 7;
  if (pairs === 1 && counts.findIndex((n) => n === 2) >= 9) return 8;
  return 9;
}

const isHigh = (c: number) => rankOf(c) >= 9; // J, Q, K, A

/** Index subsets of 0..4 of size k. */
function subsets(k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < 5; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return out;
}
const SUB = [0, 1, 2, 3, 4, 5].map(subsets);

const suited = (cards: readonly number[], idx: number[]) =>
  idx.every((i) => suitOf(cards[i]!) === suitOf(cards[idx[0]!]!));
const distinctRanks = (cards: readonly number[], idx: number[]) =>
  new Set(idx.map((i) => rankOf(cards[i]!))).size === idx.length;

/** Every rank in a five-wide window (ace may play low). */
function inWindow(cards: readonly number[], idx: number[]): boolean {
  if (!distinctRanks(cards, idx)) return false;
  const r = idx.map((i) => rankOf(cards[i]!));
  if (Math.max(...r) - Math.min(...r) <= 4) return true;
  const low = r.map((x) => (x === 12 ? -1 : x));
  return Math.max(...low) - Math.min(...low) <= 4;
}

const royalRank = (c: number) => rankOf(c) >= 8; // T J Q K A

function find(cards: readonly number[], k: number, ok: (idx: number[]) => boolean) {
  return SUB[k]!.find(ok) ?? null;
}

/**
 * The strategy chart: Wizard of Odds' simple Jacks or Better strategy, the
 * first line that matches wins.
 *  1. Royal flush, straight flush, four of a kind
 *  2. 4 to a royal flush
 *  3. Full house, flush, straight, three of a kind
 *  4. 4 to a straight flush
 *  5. Two pair
 *  6. High pair (jacks or better)
 *  7. 3 to a royal flush
 *  8. 4 to a flush
 *  9. Low pair
 * 10. 4 to an outside straight
 * 11. 2 suited high cards
 * 12. 3 to a straight flush
 * 13. 2 unsuited high cards (the lowest two if there are more)
 * 14. Suited 10/J, 10/Q or 10/K
 * 15. One high card
 * 16. Draw five
 */
export function holdFor(cards: readonly number[]): number[] {
  const made = handIndex(cards);
  if (made <= 2) return made === 2 ? pairedIdx(cards, 4) : [0, 1, 2, 3, 4];
  const r4 = find(cards, 4, (i) => suited(cards, i) && i.every((x) => royalRank(cards[x]!)));
  if (r4) return r4;
  if (made === 3 || made === 4 || made === 5) return [0, 1, 2, 3, 4];
  if (made === 6) return pairedIdx(cards, 3);
  const sf4 = find(cards, 4, (i) => suited(cards, i) && inWindow(cards, i));
  if (sf4) return sf4;
  if (made === 7) return pairedIdx(cards, 2);
  if (made === 8) return pairedIdx(cards, 2);
  const r3 = find(cards, 3, (i) => suited(cards, i) && i.every((x) => royalRank(cards[x]!)));
  if (r3) return r3;
  const fl4 = find(cards, 4, (i) => suited(cards, i));
  if (fl4) return fl4;
  const pair = pairedIdx(cards, 2);
  if (pair.length) return pair;
  const outside = find(cards, 4, (i) => {
    if (!distinctRanks(cards, i)) return false;
    const r = i.map((x) => rankOf(cards[x]!));
    return Math.max(...r) - Math.min(...r) === 3 && Math.max(...r) < 12;
  });
  if (outside) return outside;
  const hiSuited = find(cards, 2, (i) => suited(cards, i) && i.every((x) => isHigh(cards[x]!)));
  if (hiSuited) return hiSuited;
  const sf3 = find(cards, 3, (i) => suited(cards, i) && inWindow(cards, i));
  if (sf3) return sf3;
  const highs = [0, 1, 2, 3, 4]
    .filter((i) => isHigh(cards[i]!))
    .sort((a, b) => rankOf(cards[a]!) - rankOf(cards[b]!));
  if (highs.length >= 2) return highs.slice(0, 2).sort((a, b) => a - b);
  const ten = find(
    cards,
    2,
    (i) =>
      suited(cards, i) &&
      i.some((x) => rankOf(cards[x]!) === 8) &&
      i.some((x) => [9, 10, 11].includes(rankOf(cards[x]!))),
  );
  if (ten) return ten;
  if (highs.length === 1) return highs;
  return [];
}

/** The indices of the cards making an n-of-a-kind (or both pairs at n = 2). */
function pairedIdx(cards: readonly number[], n: number): number[] {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  return [0, 1, 2, 3, 4].filter((i) => counts.get(rankOf(cards[i]!)) === n);
}

export const maskOf = (held: readonly number[]): string =>
  'hold:' + [0, 1, 2, 3, 4].map((i) => (held.includes(i) ? '1' : '0')).join('');

export const ALL_HOLDS: readonly string[] = Array.from(
  { length: 32 },
  (_, m) => 'hold:' + [0, 1, 2, 3, 4].map((i) => ((m >> (4 - i)) & 1 ? '1' : '0')).join(''),
);

export interface VideoPokerRules extends BaseRules {
  paytable: VpPaytable;
}

export interface VideoPokerView {
  stage: 'hold' | 'done';
  hand: number[];
}

class VideoPokerRound implements Round {
  private settled: RoundResult | null = null;
  /** 0-4 dealt, 5-9 the draw order for replacements. */
  private readonly cards: number[];
  private hand: number[];

  constructor(
    rng: RngLike,
    private readonly rules: VideoPokerRules,
    private readonly bet: number,
    preset?: readonly number[],
  ) {
    if (preset) this.cards = [...preset];
    else {
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 0; i < 10; i++) {
        const j = i + Math.floor(rng.next() * (52 - i));
        const t = deck[i]!;
        deck[i] = deck[j]!;
        deck[j] = t;
      }
      this.cards = deck.slice(0, 10);
    }
    this.hand = this.cards.slice(0, 5);
  }

  options(): string[] | null {
    return this.settled ? null : [...ALL_HOLDS];
  }

  act(action: string): void {
    if (this.settled || !/^hold:[01]{5}$/.test(action)) return;
    const held = [...action.slice(5)].map((b) => b === '1');
    const dealt = this.cards.slice(0, 5);
    let next = 5;
    this.hand = dealt.map((c, i) => (held[i] ? c : this.cards[next++]!));
    const idx = handIndex(this.hand);
    const pays = VP_PAYTABLES[this.rules.paytable][idx]!;
    this.settled = {
      wagered: this.bet,
      returned: this.bet * pays,
      summary: VP_HANDS[idx]!,
      detail: {
        dealt: dealt.map(cardLabel),
        held,
        final: this.hand.map(cardLabel),
        hand: VP_HANDS[idx]!,
      },
    };
  }

  view(): VideoPokerView {
    return { stage: this.settled ? 'done' : 'hold', hand: [...this.hand] };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A round from fixed cards (five dealt, then five replacements in order). */
export function videoPokerRoundFromCards(
  rules: VideoPokerRules,
  bet: number,
  cards: readonly number[],
): Round {
  return new VideoPokerRound({ next: () => 0 }, rules, bet, cards);
}

export const videoPokerEngine: CasinoEngine<VideoPokerRules> = {
  kind: 'videopoker',

  // 7/5 by default: a 3.85% house, near the old table's 4%, where House
  // Rules' 4–8% hold band was tuned. A 9/6 bank would hold under 1%.
  defaultRules: () => ({ minBet: 1, maxBet: 25, paytable: '7/5' }),

  validateRules(raw, base = videoPokerEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        paytable: readChoice(
          src,
          'paytable',
          base.paytable,
          Object.keys(VP_PAYTABLES) as VpPaytable[],
          issues,
        ),
      },
      issues,
    };
  },

  /** The chart's measured return, not the optimal one: the guest plays the
   *  chart, which gives up about 0.1 points to perfect play. */
  theoreticalEdge: (rules) => 1 - chartReturn(rules.paytable),

  roundsPerHour() {
    // A practised player deals 600 hands an hour; every cabinet runs its own.
    return 600;
  },

  begin(rng, rules, bets: Bet[]) {
    const bet = bets.find((b) => b.spot === 'main')?.amount ?? rules.minBet;
    return new VideoPokerRound(rng, rules, bet);
  },

  strategy(view) {
    return maskOf(holdFor((view as VideoPokerView).hand));
  },

  appeal(rules) {
    // Video poker players read paytables: the curve follows the return.
    return 1 + 4 * (chartReturn(rules.paytable) - 0.96);
  },

  spotEdge(rules, spot) {
    return spot === 'main' ? 1 - chartReturn(rules.paytable) : 0;
  },

  guestBets(rules, unit) {
    return [{ spot: 'main', amount: clampBet(rules, unit) }];
  },
};
