// Pai gow poker: seven cards each from a 53-card deck (one joker). Player and
// banker each set a five-card high hand that must outrank a two-card low hand.
// The player wins both hands to win (even money less commission), wins one
// to push, and loses both or any copy (an identical hand goes to the banker).
//
// Guests and dealer set by the same house way (`setHand`), so a round has no
// decisions: one `deal` action. Spot: `main`.
//
// The joker is semi-wild: it completes a straight, flush or straight flush,
// otherwise it is an ace. A-2-3-4-5 ranks as the lowest straight (some rooms
// rank it second-highest; this one does not).

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

/** Card 52 is the joker; 0-51 are the usual rank << 2 | suit. */
export const JOKER = 52;
export const JOKER_LABEL = 'Jk';

export const paiGowLabel = (card: number): string =>
  card === JOKER ? JOKER_LABEL : cardLabel(card);

export interface PaiGowRules extends BaseRules {
  /** Commission on a winning hand: 5% standard, 4% at a few rooms. */
  commission: 0.05 | 0.04;
  /** 'semi-wild': the 53-card game; 'none': 52 cards, no joker. */
  jokerRule: 'semi-wild' | 'none';
}

export enum Cat {
  HighCard,
  Pair,
  TwoPair,
  Trips,
  Straight,
  Flush,
  FullHouse,
  Quads,
  StraightFlush,
  FiveAces,
}

export const CAT_NAMES = [
  'high card',
  'pair',
  'two pair',
  'three of a kind',
  'straight',
  'flush',
  'full house',
  'four of a kind',
  'straight flush',
  'five aces',
];

const B = 13;
const B5 = B ** 5;

/** Score five natural cards given as ranks and suits (suit -1 = wild). */
function scoreNatural(ranks: number[], suits: number[]): number {
  const counts = new Array<number>(13).fill(0);
  for (const r of ranks) counts[r]!++;
  const flushSuit = suits.find((s) => s >= 0) ?? 0;
  const flush = suits.every((s) => s < 0 || s === flushSuit);
  const distinct = counts.filter((c) => c > 0).length;
  let straightTop = -1;
  if (distinct === 5) {
    const hi = Math.max(...ranks);
    const lo = Math.min(...ranks);
    if (hi - lo === 4) straightTop = hi;
    else if (hi === 12 && counts[0] && counts[1] && counts[2] && counts[3]) straightTop = 3;
  }
  if (straightTop >= 0 && flush) return Cat.StraightFlush * B5 + straightTop;
  // Groups by count, then rank, both descending.
  const groups: [number, number][] = [];
  for (let r = 12; r >= 0; r--) if (counts[r]) groups.push([counts[r]!, r]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let tie = 0;
  for (const [, r] of groups) tie = tie * B + r;
  const top = groups[0]![0];
  if (top === 5) return Cat.FiveAces * B5;
  if (top === 4) return Cat.Quads * B5 + tie;
  if (top === 3 && groups[1]![0] === 2) return Cat.FullHouse * B5 + tie;
  if (flush) {
    let s = 0;
    for (const r of [...ranks].sort((a, b) => b - a)) s = s * B + r;
    return Cat.Flush * B5 + s;
  }
  if (straightTop >= 0) return Cat.Straight * B5 + straightTop;
  if (top === 3) return Cat.Trips * B5 + tie;
  if (top === 2 && groups[1]![0] === 2) return Cat.TwoPair * B5 + tie;
  if (top === 2) return Cat.Pair * B5 + tie;
  return Cat.HighCard * B5 + tie;
}

/** Score a five-card hand; the joker takes its best legal value. */
export function scoreHigh(cards: readonly number[]): number {
  const natural = cards.filter((c) => c !== JOKER);
  const ranks = natural.map(rankOf);
  const suits = natural.map(suitOf);
  if (natural.length === 5) return scoreNatural(ranks, suits);
  // As an ace it may still complete a flush (its suit is free).
  let best = scoreNatural([...ranks, 12], [...suits, -1]);
  for (let r = 0; r < 12; r++) {
    const s = scoreNatural([...ranks, r], [...suits, -1]);
    const cat = Math.floor(s / B5);
    if (s > best && (cat === Cat.Straight || cat === Cat.Flush || cat === Cat.StraightFlush))
      best = s;
  }
  return best;
}

export const catOf = (score: number): Cat => Math.floor(score / B5);

/** The two-card hand: a pair, or two ranks. The joker is an ace here. */
export function scoreLow(cards: readonly number[]): number {
  const [a, b] = cards.map((c) => (c === JOKER ? 12 : rankOf(c))) as [number, number];
  if (a === b) return B * B + a;
  return Math.max(a, b) * B + Math.min(a, b);
}

/** The high hand outranks the low one: the setting rule. */
export function legalSetting(high: readonly number[], low: readonly number[]): boolean {
  const h = scoreHigh(high);
  const l = scoreLow(low);
  const lowPair = l >= B * B;
  const hc = catOf(h);
  if (lowPair) {
    if (hc >= Cat.TwoPair) return true;
    if (hc === Cat.HighCard) return false;
    // The same pair high and low is legal: the high hand's kickers lift it.
    return Math.floor((h % B5) / B ** 3) >= l - B * B; // pair rank sits at B^3
  }
  if (hc > Cat.HighCard) return true;
  // High card both: compare the top two ranks.
  const t = h % B5;
  const h1 = Math.floor(t / B ** 4);
  const h2 = Math.floor(t / B ** 3) % B;
  const l1 = Math.floor(l / B);
  const l2 = l % B;
  return h1 > l1 || (h1 === l1 && h2 > l2);
}

/** Rank for grouping: the joker counts as an ace. */
const groupRank = (c: number): number => (c === JOKER ? 12 : rankOf(c));

function straightOrFlushPossible(cards: readonly number[]): boolean {
  const joker = cards.includes(JOKER) ? 1 : 0;
  const suitCount = [0, 0, 0, 0];
  const has = new Array<boolean>(13).fill(false);
  for (const c of cards) {
    if (c === JOKER) continue;
    suitCount[suitOf(c)]!++;
    has[rankOf(c)] = true;
  }
  if (Math.max(...suitCount) + joker >= 5) return true;
  for (let top = 3; top <= 12; top++) {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const r = top - i;
      if (r < 0 ? has[12] : has[r]) n++;
    }
    if (n + joker >= 5) return true;
  }
  return false;
}

/** The straight/flush setting that leaves the best low hand, or null. */
function bestStraightFlush(cards: readonly number[]): { high: number[]; low: number[] } | null {
  if (!straightOrFlushPossible(cards)) return null;
  let best: { high: number[]; low: number[]; lo: number; hi: number } | null = null;
  for (let i = 0; i < 7; i++)
    for (let j = i + 1; j < 7; j++) {
      const low = [cards[i]!, cards[j]!];
      const high = cards.filter((_, k) => k !== i && k !== j);
      const hi = scoreHigh(high);
      const cat = catOf(hi);
      if (cat !== Cat.Straight && cat !== Cat.Flush && cat !== Cat.StraightFlush) continue;
      const lo = scoreLow(low);
      if (!best || lo > best.lo || (lo === best.lo && hi > best.hi)) best = { high, low, lo, hi };
    }
  return best && { high: best.high, low: best.low };
}

/**
 * The house way. A simple, posted-style way, close to the ones Wizard of Odds
 * lists under "Pai Gow Poker: house way" (it is not any one casino's in full):
 *
 * - No pair: the highest card in the high hand, the next two in the low.
 * - One pair: the pair high, the two highest singles low.
 * - Two pair: split (higher pair high, lower pair low), unless the higher
 *   pair is jacks or lower and there is an ace to play low with the next
 *   single; then both pairs stay high.
 * - Three pair: the highest pair low.
 * - Trips: high, with the two highest singles low; three aces split, a pair
 *   of aces high and an ace low.
 * - Two trips: split the higher, a pair of it low.
 * - Full house: the pair low (the higher pair, with two).
 * - Quads 2-6 stay together; 7-10 stay together with an ace to play low,
 *   else split; jacks or better split; any spare pair goes low first.
 * - Straight, flush or straight flush, with no more than one pair: play it
 *   high with the best two cards left (a pair low if one can be kept). Two
 *   pairs play the two-pair way.
 */
export function setHand(cards: readonly number[]): { high: number[]; low: number[] } {
  const byRank = new Map<number, number[]>();
  for (const c of cards) {
    const r = groupRank(c);
    const g = byRank.get(r);
    if (g) g.push(c);
    else byRank.set(r, [c]);
  }
  const ranks = [...byRank.keys()].sort((a, b) => b - a);
  const of = (n: number) => ranks.filter((r) => byRank.get(r)!.length === n);
  const fives = of(5);
  const quads = of(4);
  const trips = of(3);
  const pairs = of(2);
  const singles = ranks.filter((r) => byRank.get(r)!.length === 1).map((r) => byRank.get(r)![0]!);
  const rest = (low: number[]) => ({ high: cards.filter((c) => !low.includes(c)), low });
  const cardsOf = (r: number) => byRank.get(r)!;

  // Five aces: two of them low unless a pair can go there.
  if (fives.length) return rest(pairs.length ? cardsOf(pairs[0]!) : cardsOf(12).slice(0, 2));

  if (quads.length) {
    const q = quads[0]!;
    if (pairs.length) return rest(cardsOf(pairs[0]!));
    if (trips.length) return rest(cardsOf(trips[0]!).slice(0, 2));
    const keep = q <= 4 || (q <= 8 && singles.some((c) => groupRank(c) === 12));
    return rest(keep ? singles.slice(0, 2) : cardsOf(q).slice(0, 2));
  }

  if (trips.length >= 2) return rest(cardsOf(trips[0]!).slice(0, 2));
  if (trips.length && pairs.length) return rest(cardsOf(pairs[0]!));
  if (pairs.length === 3) return rest(cardsOf(pairs[0]!));

  if (pairs.length <= 1) {
    const sf = bestStraightFlush(cards);
    if (sf) return sf;
  }

  if (trips.length) {
    const t = trips[0]!;
    if (t === 12) return rest([cardsOf(12)[0]!, singles[0]!]);
    return rest(singles.slice(0, 2));
  }

  if (pairs.length === 2) {
    const [hi, lo] = pairs as [number, number];
    const ace = singles.find((c) => groupRank(c) === 12);
    if (ace !== undefined && hi <= 9) {
      const next = singles.find((c) => c !== ace)!;
      return rest([ace, next]);
    }
    return rest(cardsOf(lo));
  }

  if (pairs.length === 1) return rest(singles.slice(0, 2));
  return rest(singles.slice(1, 3));
}

export type PaiGowOutcome = 'win' | 'push' | 'lose';

/** Settle a player's setting against the banker's: copies go to the banker. */
export function settle(
  player: { high: readonly number[]; low: readonly number[] },
  banker: { high: readonly number[]; low: readonly number[] },
): PaiGowOutcome {
  const high = scoreHigh(player.high) > scoreHigh(banker.high);
  const low = scoreLow(player.low) > scoreLow(banker.low);
  return high && low ? 'win' : high || low ? 'push' : 'lose';
}

/**
 * Outcome rates for the house way against a house-way banker, measured by a
 * 10M-hand Monte Carlo of this engine per deck (pai gow has no closed form a test can
 * enumerate in budget; paigow.test.ts re-measures 2M). Wizard of Odds puts the
 * player's edge playing the house way against the banker at about 2.7% with a
 * 5% commission, with about 41% pushes.
 */
export const PAI_GOW_RATES: Readonly<
  Record<PaiGowRules['jokerRule'], { win: number; lose: number }>
> = {
  'semi-wild': { win: 0.28882, lose: 0.30127 }, // 2.69% at 5%; 40.99% push
  none: { win: 0.29664, lose: 0.30935 }, // 2.76% at 5%; 39.40% push
};

/** Edge per hand: P(lose) − P(win)(1 − commission). */
export function paiGowEdge(rules: PaiGowRules): number {
  const r = PAI_GOW_RATES[rules.jokerRule];
  return r.lose - r.win * (1 - rules.commission);
}

export interface PaiGowView {
  player: number[];
  dealer: number[] | null;
}

class PaiGowRound implements Round {
  private settled: RoundResult | null = null;
  /** 0-6 the player, 7-13 the banker. */
  private readonly cards: number[];

  constructor(
    rng: RngLike,
    private readonly rules: PaiGowRules,
    private readonly bet: number,
    preset?: readonly number[],
  ) {
    if (preset) {
      this.cards = [...preset];
      return;
    }
    const size = rules.jokerRule === 'none' ? 52 : 53;
    const deck = Array.from({ length: size }, (_, i) => i);
    for (let i = 0; i < 14; i++) {
      const j = i + Math.floor(rng.next() * (size - i));
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
    }
    this.cards = deck.slice(0, 14);
  }

  options(): string[] | null {
    return this.settled ? null : ['deal'];
  }

  act(action: string): void {
    if (this.settled || action !== 'deal') return;
    const player = setHand(this.cards.slice(0, 7));
    const banker = setHand(this.cards.slice(7, 14));
    const outcome = settle(player, banker);
    const returned =
      outcome === 'win'
        ? this.bet * (2 - this.rules.commission)
        : outcome === 'push'
          ? this.bet
          : 0;
    const hi = catOf(scoreHigh(player.high));
    this.settled = {
      wagered: this.bet,
      returned,
      summary: `${CAT_NAMES[hi]} vs ${CAT_NAMES[catOf(scoreHigh(banker.high))]} — ${outcome}`,
      detail: {
        player: { high: player.high.map(paiGowLabel), low: player.low.map(paiGowLabel) },
        dealer: { high: banker.high.map(paiGowLabel), low: banker.low.map(paiGowLabel) },
        outcome,
      },
    };
  }

  view(): PaiGowView {
    return {
      player: this.cards.slice(0, 7),
      dealer: this.settled ? this.cards.slice(7, 14) : null,
    };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A round on fixed cards (player 7, banker 7), for tests and replays. */
export function paiGowRoundFromCards(
  rules: PaiGowRules,
  bet: number,
  cards: readonly number[],
): Round {
  return new PaiGowRound({ next: () => 0 }, rules, bet, cards);
}

export const paiGowEngine: CasinoEngine<PaiGowRules> = {
  kind: 'paigow',

  defaultRules: () => ({ minBet: 5, maxBet: 1000, commission: 0.05, jokerRule: 'semi-wild' }),

  validateRules(raw, base = paiGowEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        commission: readChoice(src, 'commission', base.commission, [0.05, 0.04], issues),
        jokerRule: readChoice(src, 'jokerRule', base.jokerRule, ['semi-wild', 'none'], issues),
      },
      issues,
    };
  },

  theoreticalEdge: paiGowEdge,

  roundsPerHour(_rules, seated) {
    // About 30 hands an hour: every hand is set twice and compared twice.
    return 36 / (1 + 0.08 * Math.max(1, seated));
  },

  begin(rng, rules, bets: Bet[]) {
    const bet = bets.find((b) => b.spot === 'main')?.amount ?? rules.minBet;
    return new PaiGowRound(rng, rules, bet);
  },

  strategy: (_view, options) => options[0]!,

  appeal(rules) {
    return (
      (rules.commission === 0.04 ? 1.05 : 1.0) * (rules.jokerRule === 'semi-wild' ? 1.0 : 0.97)
    );
  },

  spotEdge(rules, spot) {
    return spot === 'main' ? paiGowEdge(rules) : 0;
  },

  guestBets(rules, unit) {
    return [{ spot: 'main', amount: clampBet(rules, unit) }];
  },
};
