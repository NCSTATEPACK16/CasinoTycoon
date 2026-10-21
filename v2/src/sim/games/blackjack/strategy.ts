// Basic strategy, generated rather than transcribed. A combinatorial
// calculator works out the dealer's final-total distribution for each upcard
// and the expected value of every player action against it; basic strategy is
// then just "take the action with the highest EV". Computing it means every
// rule set the player can configure gets a correct chart for free.
//
// The calculation is infinite-deck and total-dependent: card probabilities do
// not shift as cards come out. That is the standard "basic strategy" the
// published charts print, and on 6–8 decks it is indistinguishable from the
// composition-dependent optimum; on 1–2 decks it differs on a few marginal
// hands worth hundredths of a percent.

import type { BlackjackRules } from './rules';

/** Card values 1 (ace) … 10. */
const P = [0, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 4 / 13];

export type BjAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

const bestTotal = (sum: number, ace: boolean): number => (ace && sum + 10 <= 21 ? sum + 10 : sum);

/**
 * Dealer final totals against upcard `up`: index 0..4 = 17..21, 5 = bust.
 * Conditioned on the dealer not holding blackjack when the up card is an ace
 * or ten, because the dealer peeks: by the time the player acts, that case
 * has already been settled.
 */
export function dealerDistribution(up: number, h17: boolean): number[] {
  const memo = new Map<number, number[]>();
  const play = (sum: number, ace: boolean): number[] => {
    const key = sum * 2 + (ace ? 1 : 0);
    const hit = memo.get(key);
    if (hit) return hit;
    const out = [0, 0, 0, 0, 0, 0];
    const best = bestTotal(sum, ace);
    const soft = ace && sum + 10 <= 21;
    if (sum > 21) out[5] = 1;
    else if (best > 17 || (best === 17 && !(soft && h17))) out[best - 17] = 1;
    else {
      for (let c = 1; c <= 10; c++) {
        const next = play(sum + c, ace || c === 1);
        for (let i = 0; i < 6; i++) out[i]! += P[c]! * next[i]!;
      }
    }
    memo.set(key, out);
    return out;
  };
  // First hole card, renormalised to exclude the blackjack-making card.
  const out = [0, 0, 0, 0, 0, 0];
  let norm = 0;
  for (let c = 1; c <= 10; c++) {
    if ((up === 1 && c === 10) || (up === 10 && c === 1)) continue;
    norm += P[c]!;
  }
  for (let c = 1; c <= 10; c++) {
    if ((up === 1 && c === 10) || (up === 10 && c === 1)) continue;
    const next = play(up + c, up === 1 || c === 1);
    for (let i = 0; i < 6; i++) out[i]! += (P[c]! / norm) * next[i]!;
  }
  return out;
}

/** EVs for one dealer upcard, memoised on (hard sum, holds an ace). */
class UpcardTable {
  private readonly dealer: number[];
  private readonly standMemo = new Map<number, number>();
  private readonly hitMemo = new Map<number, number>();

  constructor(
    up: number,
    h17: boolean,
    private readonly das: boolean,
  ) {
    this.dealer = dealerDistribution(up, h17);
  }

  /** EV of standing on a best total. */
  stand(total: number): number {
    if (total > 21) return -1;
    const cached = this.standMemo.get(total);
    if (cached !== undefined) return cached;
    const d = this.dealer;
    let ev = d[5]!; // dealer busts
    for (let t = 17; t <= 21; t++) {
      if (t < total) ev += d[t - 17]!;
      else if (t > total) ev -= d[t - 17]!;
    }
    this.standMemo.set(total, ev);
    return ev;
  }

  /** EV of the best play from here when doubling is no longer allowed. */
  bestNoDouble(sum: number, ace: boolean): number {
    if (sum > 21) return -1;
    return Math.max(this.stand(bestTotal(sum, ace)), this.hit(sum, ace));
  }

  hit(sum: number, ace: boolean): number {
    if (sum > 21) return -1;
    const key = sum * 2 + (ace ? 1 : 0);
    const cached = this.hitMemo.get(key);
    if (cached !== undefined) return cached;
    let ev = 0;
    for (let c = 1; c <= 10; c++) ev += P[c]! * this.bestNoDouble(sum + c, ace || c === 1);
    this.hitMemo.set(key, ev);
    return ev;
  }

  double(sum: number, ace: boolean): number {
    let ev = 0;
    for (let c = 1; c <= 10; c++) {
      const s = sum + c;
      ev += P[c]! * (s > 21 ? -1 : this.stand(bestTotal(s, ace || c === 1)));
    }
    return 2 * ev;
  }

  /** EV of splitting a pair of `v`s: two hands, each started from one card. */
  split(v: number): number {
    let hand = 0;
    for (let c = 1; c <= 10; c++) {
      const sum = v + c;
      const ace = v === 1 || c === 1;
      if (v === 1) {
        // Split aces take one card each and stand.
        hand += P[c]! * this.stand(bestTotal(sum, ace));
      } else {
        const play = this.bestNoDouble(sum, ace);
        hand += P[c]! * (this.das ? Math.max(play, this.double(sum, ace)) : play);
      }
    }
    return 2 * hand;
  }
}

export interface HandFacts {
  /** Hard sum, aces counted as 1. */
  sum: number;
  ace: boolean;
  /** Card value when the hand is a splittable pair, else null. */
  pair: number | null;
}

export class BasicStrategy {
  private readonly tables: UpcardTable[] = [];

  constructor(rules: Pick<BlackjackRules, 'h17' | 'das'>) {
    for (let up = 1; up <= 10; up++) this.tables[up] = new UpcardTable(up, rules.h17, rules.das);
  }

  /** EV of one action, per unit of the hand's original bet. */
  ev(action: BjAction, hand: HandFacts, up: number): number {
    const t = this.tables[up]!;
    switch (action) {
      case 'stand':
        return t.stand(bestTotal(hand.sum, hand.ace));
      case 'hit':
        return t.hit(hand.sum, hand.ace);
      case 'double':
        return t.double(hand.sum, hand.ace);
      case 'split':
        return hand.pair === null ? -Infinity : t.split(hand.pair);
      case 'surrender':
        return -0.5;
    }
  }

  /** The highest-EV action among those the table currently allows. */
  choose(hand: HandFacts, up: number, allowed: readonly BjAction[]): BjAction {
    let best = allowed[0]!;
    let bestEv = -Infinity;
    for (const a of allowed) {
      const ev = this.ev(a, hand, up);
      // Ties go to the earlier option; `allowed` lists the conservative plays first.
      if (ev > bestEv + 1e-12) {
        best = a;
        bestEv = ev;
      }
    }
    return best;
  }
}

const cache = new Map<string, BasicStrategy>();

/** Strategies are pure functions of the rules that change a decision, so share them. */
export function basicStrategyFor(rules: Pick<BlackjackRules, 'h17' | 'das'>): BasicStrategy {
  const key = `${rules.h17 ? 'H' : 'S'}${rules.das ? 'D' : 'N'}`;
  let s = cache.get(key);
  if (!s) {
    s = new BasicStrategy(rules);
    cache.set(key, s);
  }
  return s;
}

const UP_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
const CODE: Record<BjAction, string> = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

/**
 * The printable chart — rows of hard 5–17, soft 13–20 and pairs against 2–A —
 * for the avatar's table UI and the rules editor. 'D' means double if allowed
 * (else hit), 'R' surrender if allowed (else hit), as the printed cards say.
 */
export function strategyChart(rules: BlackjackRules): {
  ups: string[];
  rows: { label: string; cells: string[] }[];
} {
  const s = basicStrategyFor(rules);
  const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
  const opening: BjAction[] = ['hit', 'stand', 'double'];
  if (rules.surrender === 'late') opening.push('surrender');
  const row = (label: string, hand: HandFacts, allowed: BjAction[]) => ({
    label,
    cells: ups.map((u) => CODE[s.choose(hand, u, allowed)]),
  });
  const rows = [];
  for (let t = 5; t <= 17; t++) rows.push(row(`${t}`, { sum: t, ace: false, pair: null }, opening));
  for (let o = 2; o <= 9; o++) rows.push(row(`A,${o}`, { sum: 1 + o, ace: true, pair: null }, opening));
  for (let v = 2; v <= 11; v++) {
    const card = v === 11 ? 1 : v;
    const label = v === 11 ? 'A,A' : `${v},${v}`;
    rows.push(row(label, { sum: card * 2, ace: card === 1, pair: card }, [...opening, 'split']));
  }
  return { ups: ups.map((u) => UP_LABELS[u]!), rows };
}
