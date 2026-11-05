// Ultimate Texas Hold'em: Ante = Blind, optional Trips, one Play bet of
// 4x/3x preflop, 2x on the flop or 1x on the river, against a dealer who
// needs a pair to open the Ante.

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
import { categoryOf, CATEGORY_NAMES, evaluate, HandCategory } from './evaluator';

/**
 * Trips paytables, winnings per unit for trips … royal. The three are the
 * ones Shuffle Master licenses most (Wizard of Odds calls them 1, 2 and 4);
 * their edges are computed below from the exact seven-card category counts.
 */
export const TRIPS_PAYTABLES = {
  '50-40-30-9-7-4-3': {
    royal: 50,
    straightFlush: 40,
    quads: 30,
    fullHouse: 9,
    flush: 7,
    straight: 4,
    trips: 3,
  },
  '50-40-30-8-7-4-3': {
    royal: 50,
    straightFlush: 40,
    quads: 30,
    fullHouse: 8,
    flush: 7,
    straight: 4,
    trips: 3,
  },
  '50-40-30-8-6-5-3': {
    royal: 50,
    straightFlush: 40,
    quads: 30,
    fullHouse: 8,
    flush: 6,
    straight: 5,
    trips: 3,
  },
} as const;
export type TripsPaytable = keyof typeof TRIPS_PAYTABLES;

/** The Blind pays only on a player win, and only for a straight or better. */
const BLIND_PAYS: Partial<Record<HandCategory, number>> = {
  [HandCategory.Straight]: 1,
  [HandCategory.Flush]: 1.5,
  [HandCategory.FullHouse]: 3,
  [HandCategory.Quads]: 10,
  [HandCategory.StraightFlush]: 50,
};
const BLIND_ROYAL = 500;

export interface UthRules extends BaseRules {
  trips: TripsPaytable;
}

/** Exact seven-card category counts out of C(52,7) = 133,784,560, with the
 *  royal split out of the straight flushes. evaluator.test.ts re-derives the
 *  counts by full enumeration. */
const SEVEN_CARD = {
  total: 133_784_560,
  royal: 4_324,
  straightFlush: 41_584 - 4_324,
  quads: 224_848,
  fullHouse: 3_473_184,
  flush: 4_047_644,
  straight: 6_180_020,
  trips: 6_461_620,
};

/** Exact Trips edge: the bet stands on the player's seven cards alone. */
export function tripsEdge(table: TripsPaytable): number {
  const p = TRIPS_PAYTABLES[table];
  let ret = 0;
  for (const k of [
    'royal',
    'straightFlush',
    'quads',
    'fullHouse',
    'flush',
    'straight',
    'trips',
  ] as const) {
    ret += (SEVEN_CARD[k] / SEVEN_CARD.total) * (1 + p[k]);
  }
  return 1 - ret;
}

/**
 * Ante edge of the reference strategy (below). UTH has no closed form. Wizard
 * of Odds puts optimal play at 2.185% of the Ante and this decision table, his
 * "simple strategy", at 2.43%: the table gives back about a quarter point,
 * mostly on the river, where counting outs approximates the exact call.
 * uth.mc.test.ts checks the constant against 2M hands dealt by the engine.
 */
export const UTH_ANTE_EDGE = 0.0243;
/** The optimal-strategy figure, for the inspector's "best case" readout. */
export const UTH_OPTIMAL_ANTE_EDGE = 0.02185;

const isRoyal = (score: number): boolean =>
  categoryOf(score) === HandCategory.StraightFlush && (score >> 16) % 16 === 12;

function tripsWinnings(table: TripsPaytable, score: number): number {
  const p = TRIPS_PAYTABLES[table];
  switch (categoryOf(score)) {
    case HandCategory.StraightFlush:
      return isRoyal(score) ? p.royal : p.straightFlush;
    case HandCategory.Quads:
      return p.quads;
    case HandCategory.FullHouse:
      return p.fullHouse;
    case HandCategory.Flush:
      return p.flush;
    case HandCategory.Straight:
      return p.straight;
    case HandCategory.Trips:
      return p.trips;
    default:
      return -1;
  }
}

type Stage = 'preflop' | 'flop' | 'river' | 'done';

export interface UthView {
  stage: Stage;
  hole: number[];
  /** Board cards dealt face up so far: 0, 3 or 5. */
  board: number[];
  /** Shown at showdown. */
  dealer: number[] | null;
  ante: number;
  play: number;
}

const ACTIONS: Record<Exclude<Stage, 'done'>, string[]> = {
  preflop: ['check', 'bet4x', 'bet3x'],
  flop: ['check', 'bet2x'],
  river: ['fold', 'bet1x'],
};

class UthRound implements Round {
  private stage: Stage = 'preflop';
  /** 0-1 player, 2-3 dealer, 4-8 board. */
  private readonly cards = new Uint8Array(9);
  private play = 0;
  private settled: RoundResult | null = null;

  constructor(
    rng: RngLike,
    private readonly rules: UthRules,
    private readonly ante: number,
    private readonly trips: number,
    preset?: readonly number[],
  ) {
    if (preset) {
      this.cards.set(preset);
      return;
    }
    // A partial Fisher–Yates draws nine distinct cards without shuffling 52.
    const deck = Uint8Array.from({ length: 52 }, (_, i) => i);
    for (let i = 0; i < 9; i++) {
      const j = i + Math.floor(rng.next() * (52 - i));
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
      this.cards[i] = deck[i]!;
    }
  }

  options(): string[] | null {
    return this.stage === 'done' ? null : ACTIONS[this.stage];
  }

  act(action: string): void {
    if (this.stage === 'done' || !ACTIONS[this.stage].includes(action)) return;
    if (action.startsWith('bet')) {
      this.play = this.ante * Number(action[3]);
      this.showdown(false);
      return;
    }
    if (action === 'fold') {
      this.showdown(true);
      return;
    }
    this.stage = this.stage === 'preflop' ? 'flop' : 'river';
  }

  private showdown(folded: boolean): void {
    const c = this.cards;
    const player = evaluate([c[0]!, c[1]!, c[4]!, c[5]!, c[6]!, c[7]!, c[8]!], 7);
    const dealer = evaluate([c[2]!, c[3]!, c[4]!, c[5]!, c[6]!, c[7]!, c[8]!], 7);
    const ante = this.ante;
    let returned = 0;
    let note: string;
    // An unqualified dealer pushes the Ante whichever way the hand goes.
    const qualifies = categoryOf(dealer) >= HandCategory.Pair;
    if (folded) {
      note = 'fold';
    } else if (player > dealer) {
      returned += this.play * 2;
      returned += qualifies ? ante * 2 : ante;
      const blind = isRoyal(player) ? BLIND_ROYAL : (BLIND_PAYS[categoryOf(player)] ?? 0);
      returned += ante * (1 + blind);
      note = `win${qualifies ? '' : ', dealer does not qualify'}`;
    } else if (player === dealer) {
      returned += this.play + ante * 2;
      note = 'push';
    } else {
      if (!qualifies) returned += ante;
      note = qualifies ? 'lose' : 'lose, ante pushes';
    }
    // Trips is decided by the player's seven cards alone, even on a fold.
    if (this.trips > 0) {
      const w = tripsWinnings(this.rules.trips, player);
      if (w >= 0) returned += this.trips * (1 + w);
    }
    this.stage = 'done';
    this.settled = {
      wagered: ante * 2 + this.play + this.trips,
      returned,
      summary: `${CATEGORY_NAMES[categoryOf(player)]} vs ${CATEGORY_NAMES[categoryOf(dealer)]} — ${note}`,
      detail: {
        player: [c[0]!, c[1]!].map(cardLabel),
        dealer: [c[2]!, c[3]!].map(cardLabel),
        board: [...c.slice(4)].map(cardLabel),
        folded,
      },
    };
  }

  view(): UthView {
    const c = this.cards;
    const shown = this.stage === 'preflop' ? 0 : this.stage === 'flop' ? 3 : 5;
    return {
      stage: this.stage,
      hole: [c[0]!, c[1]!],
      board: this.stage === 'done' ? [...c.slice(4)] : [...c.slice(4, 4 + shown)],
      dealer: this.stage === 'done' ? [c[2]!, c[3]!] : null,
      ante: this.ante,
      play: this.play,
    };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

// ---------- the reference decision table ----------

/** Preflop 4x: any pair but deuces, any ace, K2s+/K5o+, Q6s+/Q8o+, J8s+/JTo. */
export function preflopRaise(hole: readonly number[]): boolean {
  const a = rankOf(hole[0]!);
  const b = rankOf(hole[1]!);
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const suited = suitOf(hole[0]!) === suitOf(hole[1]!);
  // Ranks: 0 = deuce … 8 = ten, 9 = J, 10 = Q, 11 = K, 12 = A.
  if (a === b) return a >= 1;
  if (hi === 12) return true;
  if (hi === 11) return suited ? true : lo >= 3;
  if (hi === 10) return suited ? lo >= 4 : lo >= 6;
  if (hi === 9) return suited ? lo >= 6 : lo >= 8;
  return false;
}

/** A pair that uses at least one hole card (pocket deuces excepted). */
function hiddenPair(hole: readonly number[], board: readonly number[]): boolean {
  const a = rankOf(hole[0]!);
  const b = rankOf(hole[1]!);
  if (a === b) return a > 0;
  return board.some((c) => rankOf(c) === a || rankOf(c) === b);
}

/** Flop 2x: two pair or better using a hole card, a hidden pair, or four to
 *  a flush that includes a hole card of ten or higher. */
export function flopRaise(hole: readonly number[], flop: readonly number[]): boolean {
  const mine = evaluate([...hole, ...flop], 5);
  if (categoryOf(mine) >= HandCategory.TwoPair) {
    // Trips on the board alone are the dealer's too.
    const boardRanks = new Set(flop.map(rankOf));
    if (!(boardRanks.size === 1 && categoryOf(mine) === HandCategory.Trips)) return true;
  }
  if (hiddenPair(hole, flop)) return true;
  for (let s = 0; s < 4; s++) {
    const n = [...hole, ...flop].filter((c) => suitOf(c) === s).length;
    if (n >= 4 && hole.some((c) => suitOf(c) === s && rankOf(c) >= 8)) return true;
  }
  return false;
}

/** River 1x: a hidden pair or better, or fewer than 21 dealer outs — the
 *  unseen cards that, as a dealer hole card, would beat the player. Ties are
 *  not outs, and neither are two-card combinations (Wizard of Odds' count). */
export function riverRaise(hole: readonly number[], board: readonly number[]): boolean {
  const player = evaluate([...hole, ...board], 7);
  if (hiddenPair(hole, board) || categoryOf(player) >= HandCategory.Straight) {
    if (player > evaluate(board, 5)) return true;
  }
  const seen = new Set([...hole, ...board]);
  const six = [...board, 0];
  let outs = 0;
  for (let c = 0; c < 52; c++) {
    if (seen.has(c)) continue;
    six[5] = c;
    if (evaluate(six, 6) > player) outs++;
  }
  return outs < 21;
}

/** A round dealt from fixed cards — player 2, dealer 2, board 5 — for tests
 *  and for replaying a hand in the inspector. */
export function uthRoundFromCards(
  rules: UthRules,
  ante: number,
  trips: number,
  cards: readonly number[],
): Round {
  return new UthRound({ next: () => 0 }, rules, ante, trips, cards);
}

export const uthEngine: CasinoEngine<UthRules> = {
  kind: 'uth',

  defaultRules: () => ({ minBet: 10, maxBet: 500, trips: '50-40-30-8-7-4-3' }),

  validateRules(raw, base = uthEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    const trips = readChoice(
      src,
      'trips',
      base.trips,
      Object.keys(TRIPS_PAYTABLES) as TripsPaytable[],
      issues,
    );
    return { rules: { ...limits, trips }, issues };
  },

  theoreticalEdge: () => UTH_ANTE_EDGE,

  roundsPerHour(_rules, seated) {
    // ~30 hands an hour at a full six-seat table, ~50 heads-up.
    return 60 / (1 + 0.15 * Math.max(1, seated));
  },

  begin(rng, rules, bets: Bet[]) {
    const ante = bets.find((b) => b.spot === 'ante')?.amount ?? rules.minBet;
    const trips = bets.find((b) => b.spot === 'trips')?.amount ?? 0;
    return new UthRound(rng, rules, ante, trips);
  },

  strategy(view, options) {
    const v = view as UthView;
    switch (v.stage) {
      case 'preflop':
        return preflopRaise(v.hole) ? 'bet4x' : 'check';
      case 'flop':
        return flopRaise(v.hole, v.board) ? 'bet2x' : 'check';
      case 'river':
        return riverRaise(v.hole, v.board) ? 'bet1x' : 'fold';
      default:
        return options[0]!;
    }
  },

  appeal(rules) {
    // Only the Trips table is a lever; the 9-for-a-full-house table is the one
    // players ask for.
    return rules.trips === '50-40-30-9-7-4-3'
      ? 1.08
      : rules.trips === '50-40-30-8-6-5-3'
        ? 0.97
        : 1;
  },

  spotEdge(rules, spot) {
    if (spot === 'ante') return UTH_ANTE_EDGE;
    if (spot === 'trips') return tripsEdge(rules.trips);
    return 0;
  },

  guestBets(rules, unit, rng) {
    const ante = clampBet(rules, unit);
    // About a third of the table puts a side bet on Trips.
    return rng.next() < 0.35
      ? [
          { spot: 'ante', amount: ante },
          { spot: 'trips', amount: clampBet(rules, ante / 2) },
        ]
      : [{ spot: 'ante', amount: ante }];
  },
};
