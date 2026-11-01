// Three Card Poker: Ante, an optional Pair Plus, three cards each. After
// seeing her hand the player plays (a Play bet equal to the Ante) or folds;
// the dealer needs queen-high to open.
//
// Spots: `ante` and `pairPlus`. The Play bet is an action, as in UTH.

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

export enum TcpCategory {
  HighCard,
  Pair,
  Flush,
  Straight,
  Trips,
  StraightFlush,
}

export const TCP_CATEGORY_NAMES = [
  'high card',
  'pair',
  'flush',
  'straight',
  'three of a kind',
  'straight flush',
];

/** Rank, then ranks, packed into one comparable integer. A straight flush
 *  outranks trips, which outrank a straight, which outranks a flush: the
 *  order that is peculiar to three cards. */
export function scoreHand(cards: readonly number[]): number {
  const r = cards.map(rankOf).sort((a, b) => b - a) as [number, number, number];
  const flush = suitOf(cards[0]!) === suitOf(cards[1]!) && suitOf(cards[1]!) === suitOf(cards[2]!);
  const wheel = r[0] === 12 && r[1] === 1 && r[2] === 0;
  const straight = wheel || (r[0] - r[1] === 1 && r[1] - r[2] === 1);
  // A-2-3 is the lowest straight, ranked by its three.
  const top = wheel ? 1 : r[0];
  let cat: TcpCategory;
  let a: number;
  let b = 0;
  let c = 0;
  if (straight && flush) [cat, a] = [TcpCategory.StraightFlush, top];
  else if (r[0] === r[1] && r[1] === r[2]) [cat, a] = [TcpCategory.Trips, r[0]];
  else if (straight) [cat, a] = [TcpCategory.Straight, top];
  else if (flush) [cat, a, b, c] = [TcpCategory.Flush, r[0], r[1], r[2]];
  else if (r[0] === r[1] || r[1] === r[2]) {
    cat = TcpCategory.Pair;
    a = r[1];
    b = r[0] === r[1] ? r[2] : r[0];
  } else [cat, a, b, c] = [TcpCategory.HighCard, r[0], r[1], r[2]];
  return cat * 2744 + a * 196 + b * 14 + c;
}

export const categoryOf = (score: number): TcpCategory => Math.floor(score / 2744);

/** The dealer opens with queen-high or better. */
export function dealerQualifies(score: number): boolean {
  return categoryOf(score) > TcpCategory.HighCard || Math.floor((score % 2744) / 196) >= 10;
}

/** The reference play: Q-6-4 or better (Wizard of Odds' optimal strategy). */
export function shouldPlay(cards: readonly number[]): boolean {
  const s = scoreHand(cards);
  if (categoryOf(s) > TcpCategory.HighCard) return true;
  return s >= Q64_SCORE;
}
// Q (10) 6 (4) 4 (2): rank indices, deuce = 0.
const Q64_SCORE = 0 * 2744 + 10 * 196 + 4 * 14 + 2;

export const PAIR_PLUS_TABLES = {
  '40-30-6-4-1': { straightFlush: 40, trips: 30, straight: 6, flush: 4, pair: 1 },
  '40-30-6-3-1': { straightFlush: 40, trips: 30, straight: 6, flush: 3, pair: 1 },
  '50-40-6-3-1': { straightFlush: 50, trips: 40, straight: 6, flush: 3, pair: 1 },
} as const;
export type PairPlusTable = keyof typeof PAIR_PLUS_TABLES;

export const ANTE_BONUS_TABLES = {
  '5-4-1': { straightFlush: 5, trips: 4, straight: 1 },
  '3-2-1': { straightFlush: 3, trips: 2, straight: 1 },
} as const;
export type AnteBonusTable = keyof typeof ANTE_BONUS_TABLES;

export interface TcpRules extends BaseRules {
  pairPlus: PairPlusTable;
  anteBonus: AnteBonusTable;
}

/** Hands out of C(52,3) = 22,100 for each category. */
export const THREE_CARD_COUNTS = {
  total: 22_100,
  straightFlush: 48,
  trips: 52,
  straight: 720,
  flush: 1_096,
  pair: 3_744,
  highCard: 16_440,
};

/** Exact Pair Plus edge: 1 − E[return] over the 22,100 hands. */
export function pairPlusEdge(table: PairPlusTable): number {
  const p = PAIR_PLUS_TABLES[table];
  const n = THREE_CARD_COUNTS;
  const net =
    n.straightFlush * p.straightFlush +
    n.trips * p.trips +
    n.straight * p.straight +
    n.flush * p.flush +
    n.pair * p.pair -
    n.highCard;
  return -net / n.total;
}

/**
 * Player net per Ante under the reference strategy, excluding the Ante bonus,
 * summed over every (player, dealer) pair of disjoint three-card hands:
 * `TCP_BASE_NET / TCP_PAIRS`. Re-derived by full enumeration in tcp.test.ts.
 * Ante and Play each win or lose one unit; a dealer who does not open pays
 * the Ante only; a fold loses the Ante.
 */
export const TCP_PAIRS = 22_100 * 18_424;
export const TCP_BASE_NET = -35_253_012;

/** Ante bonus per Ante, from the player's hand alone (every straight or better plays). */
function anteBonusReturn(table: AnteBonusTable): number {
  const p = ANTE_BONUS_TABLES[table];
  const n = THREE_CARD_COUNTS;
  return (
    (n.straightFlush * p.straightFlush + n.trips * p.trips + n.straight * p.straight) / n.total
  );
}

/** Exact Ante edge for the reference strategy: Wizard of Odds' 3.37% of the Ante at 5-4-1. */
export function tcpAnteEdge(table: AnteBonusTable): number {
  return -(TCP_BASE_NET / TCP_PAIRS + anteBonusReturn(table));
}

export interface TcpView {
  stage: 'decide' | 'done';
  hand: number[];
  /** Shown once the player has acted. */
  dealer: number[] | null;
  ante: number;
  pairPlus: number;
  play: number;
}

class TcpRound implements Round {
  private stage: 'decide' | 'done' = 'decide';
  private play = 0;
  private settled: RoundResult | null = null;
  /** 0-2 player, 3-5 dealer. */
  private readonly cards = new Uint8Array(6);

  constructor(
    rng: RngLike,
    private readonly rules: TcpRules,
    private readonly ante: number,
    private readonly pairPlus: number,
    preset?: readonly number[],
  ) {
    if (preset) {
      this.cards.set(preset);
      return;
    }
    const deck = Uint8Array.from({ length: 52 }, (_, i) => i);
    for (let i = 0; i < 6; i++) {
      const j = i + Math.floor(rng.next() * (52 - i));
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
      this.cards[i] = deck[i]!;
    }
  }

  options(): string[] | null {
    return this.stage === 'done' ? null : ['play', 'fold'];
  }

  act(action: string): void {
    if (this.stage === 'done' || (action !== 'play' && action !== 'fold')) return;
    const folded = action === 'fold';
    if (!folded) this.play = this.ante;
    const c = this.cards;
    const player = scoreHand([c[0]!, c[1]!, c[2]!]);
    const dealer = scoreHand([c[3]!, c[4]!, c[5]!]);
    const cat = categoryOf(player);
    const ante = this.ante;
    let returned = 0;
    let note: string;
    if (folded) {
      note = 'fold';
    } else {
      const bonus = ANTE_BONUS_TABLES[this.rules.anteBonus];
      returned +=
        ante *
        (cat === TcpCategory.StraightFlush
          ? bonus.straightFlush
          : cat === TcpCategory.Trips
            ? bonus.trips
            : cat === TcpCategory.Straight
              ? bonus.straight
              : 0);
      if (!dealerQualifies(dealer)) {
        returned += ante * 2 + this.play; // Ante wins 1:1, Play pushes
        note = 'win, dealer does not open';
      } else if (player > dealer) {
        returned += (ante + this.play) * 2;
        note = 'win';
      } else if (player === dealer) {
        returned += ante + this.play;
        note = 'push';
      } else {
        note = 'lose';
      }
    }
    // Pair Plus pays on the player's hand alone, even after a fold.
    if (this.pairPlus > 0) {
      const t = PAIR_PLUS_TABLES[this.rules.pairPlus];
      const w =
        cat === TcpCategory.StraightFlush
          ? t.straightFlush
          : cat === TcpCategory.Trips
            ? t.trips
            : cat === TcpCategory.Straight
              ? t.straight
              : cat === TcpCategory.Flush
                ? t.flush
                : cat === TcpCategory.Pair
                  ? t.pair
                  : -1;
      if (w >= 0) returned += this.pairPlus * (1 + w);
    }
    this.stage = 'done';
    this.settled = {
      wagered: ante + this.play + this.pairPlus,
      returned,
      summary: `${TCP_CATEGORY_NAMES[cat]} vs ${TCP_CATEGORY_NAMES[categoryOf(dealer)]} — ${note}`,
      detail: {
        player: [c[0]!, c[1]!, c[2]!].map(cardLabel),
        dealer: [c[3]!, c[4]!, c[5]!].map(cardLabel),
        folded,
      },
    };
  }

  view(): TcpView {
    const c = this.cards;
    return {
      stage: this.stage,
      hand: [c[0]!, c[1]!, c[2]!],
      dealer: this.stage === 'done' ? [c[3]!, c[4]!, c[5]!] : null,
      ante: this.ante,
      pairPlus: this.pairPlus,
      play: this.play,
    };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A round dealt from fixed cards (player 3, dealer 3), for tests and replays. */
export function tcpRoundFromCards(
  rules: TcpRules,
  ante: number,
  pairPlus: number,
  cards: readonly number[],
): Round {
  return new TcpRound({ next: () => 0 }, rules, ante, pairPlus, cards);
}

export const tcpEngine: CasinoEngine<TcpRules> = {
  kind: 'tcp',

  defaultRules: () => ({ minBet: 5, maxBet: 500, pairPlus: '40-30-6-4-1', anteBonus: '5-4-1' }),

  validateRules(raw, base = tcpEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        pairPlus: readChoice(
          src,
          'pairPlus',
          base.pairPlus,
          Object.keys(PAIR_PLUS_TABLES) as PairPlusTable[],
          issues,
        ),
        anteBonus: readChoice(
          src,
          'anteBonus',
          base.anteBonus,
          Object.keys(ANTE_BONUS_TABLES) as AnteBonusTable[],
          issues,
        ),
      },
      issues,
    };
  },

  /** Edge of the Ante with the reference strategy. */
  theoreticalEdge: (rules) => tcpAnteEdge(rules.anteBonus),

  roundsPerHour(_rules, seated) {
    // About 70 hands an hour heads-up, 45 with a full table.
    return 75 / (1 + 0.1 * Math.max(1, seated));
  },

  begin(rng, rules, bets: Bet[]) {
    const ante = bets.find((b) => b.spot === 'ante')?.amount ?? rules.minBet;
    const pairPlus = bets.find((b) => b.spot === 'pairPlus')?.amount ?? 0;
    return new TcpRound(rng, rules, ante, pairPlus);
  },

  strategy(view) {
    return shouldPlay((view as TcpView).hand) ? 'play' : 'fold';
  },

  appeal(rules) {
    return (
      (rules.pairPlus === '40-30-6-4-1' ? 1.06 : rules.pairPlus === '50-40-6-3-1' ? 1.0 : 0.94) *
      (rules.anteBonus === '5-4-1' ? 1.02 : 0.94)
    );
  },

  spotEdge(rules, spot) {
    if (spot === 'ante') return tcpAnteEdge(rules.anteBonus);
    if (spot === 'pairPlus') return pairPlusEdge(rules.pairPlus);
    return 0;
  },

  guestBets(rules, unit, rng) {
    const ante = clampBet(rules, unit);
    // Four in ten also back a Pair Plus.
    return rng.next() < 0.4
      ? [
          { spot: 'ante', amount: ante },
          { spot: 'pairPlus', amount: clampBet(rules, ante) },
        ]
      : [{ spot: 'ante', amount: ante }];
  },
};
