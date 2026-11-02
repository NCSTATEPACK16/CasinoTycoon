// Bingo: 75 balls, 5×5 cards with a free centre (B 1-15, I 16-30, N 31-45,
// G 46-60, O 61-75). The caller draws until a card completes the pattern;
// every card that completes on that ball shares the prize.
//
// Par sheet (ECONOMY.md says why): the hall pays a fixed share of the game's
// card sales back as the prize (parimutuel), `payback`. Every card in the game
// costs the same and has the same chance, so each card's expected return is
// exactly `payback` × its price and the edge is 1 − payback by construction.
// No guaranteed minimum prize: the pool is always the share, so a thin game
// can never cost the house.
//
// The seated guest's cards play against `HOUSE_CARDS` cards bought by the
// hall's off-screen crowd, so the pool is real at any occupancy. Only the
// guest's own cards are booked; the crowd's cards net the same share.
//
// Spots: `card` (one card per bet; a plain `main` is a card). One action, `call`.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import {
  asRecord,
  clampBet,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

/** Cards the off-screen crowd has in every game. */
export const HOUSE_CARDS = 20;

export interface BingoRules extends BaseRules {
  /** Share of card sales paid back as the prize. */
  payback: 0.75 | 0.8 | 0.86;
  /** 'line': any row, column or diagonal; 'blackout': all 24 numbers. */
  pattern: 'line' | 'blackout';
}

const FREE = 12;
/** The 12 line masks over cells 0-24 (rows, columns, diagonals). */
const LINES: readonly number[] = (() => {
  const out: number[] = [];
  for (let r = 0; r < 5; r++) out.push(0b11111 << (r * 5));
  for (let c = 0; c < 5; c++) {
    let m = 0;
    for (let r = 0; r < 5; r++) m |= 1 << (r * 5 + c);
    out.push(m);
  }
  let d1 = 0;
  let d2 = 0;
  for (let i = 0; i < 5; i++) {
    d1 |= 1 << (i * 5 + i);
    d2 |= 1 << (i * 5 + 4 - i);
  }
  out.push(d1, d2);
  return out;
})();
const FULL = (1 << 25) - 1;

/** A card as 25 numbers, row-major, 0 in the free centre. Column c draws 5
 *  distinct numbers from 15c+1 … 15c+15. */
export function dealCard(rng: RngLike): number[] {
  const card = new Array<number>(25).fill(0);
  for (let c = 0; c < 5; c++) {
    const pool = Array.from({ length: 15 }, (_, i) => 15 * c + i + 1);
    for (let r = 0; r < 5; r++) {
      const j = r + Math.floor(rng.next() * (15 - r));
      const t = pool[r]!;
      pool[r] = pool[j]!;
      pool[j] = t;
      if (r * 5 + c !== FREE) card[r * 5 + c] = pool[r]!;
    }
  }
  return card;
}

/** Does this set of marked cells complete the pattern? */
export function complete(marks: number, pattern: BingoRules['pattern']): boolean {
  if (pattern === 'blackout') return marks === FULL;
  for (const l of LINES) if ((marks & l) === l) return true;
  return false;
}

/**
 * Call balls until a card completes. Returns the balls called and the
 * indices of the winning cards (all that complete on the last ball).
 */
export function playGame(
  cards: readonly number[][],
  pattern: BingoRules['pattern'],
  rng: RngLike,
  balls?: readonly number[],
): { called: number[]; winners: number[] } {
  // Where each number sits on each card.
  const at = Array.from({ length: 76 }, () => [] as [number, number][]);
  cards.forEach((card, k) => card.forEach((n, cell) => n > 0 && at[n]!.push([k, cell])));
  const marks = cards.map(() => 1 << FREE);
  const order = balls ? [...balls] : Array.from({ length: 75 }, (_, i) => i + 1);
  const called: number[] = [];
  for (let i = 0; i < order.length; i++) {
    if (!balls) {
      const j = i + Math.floor(rng.next() * (75 - i));
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    const ball = order[i]!;
    called.push(ball);
    const winners: number[] = [];
    for (const [k, cell] of at[ball]!) {
      marks[k]! |= 1 << cell;
      if (complete(marks[k]!, pattern)) winners.push(k);
    }
    if (winners.length) return { called, winners };
  }
  return { called, winners: [] };
}

const isCard = (spot: string) => spot === 'card' || spot === 'main';

export interface BingoView {
  cards: number[][];
  called: number[] | null;
}

class BingoRound implements Round {
  private settled: RoundResult | null = null;
  private readonly cards: number[][];

  constructor(
    private readonly rng: RngLike,
    private readonly rules: BingoRules,
    private readonly bets: readonly Bet[],
    private readonly preset?: { cards: number[][]; balls: number[] },
  ) {
    this.cards = preset
      ? preset.cards.map((c) => [...c])
      : [
          ...bets.filter((b) => isCard(b.spot)).map(() => dealCard(rng)),
          ...Array.from({ length: HOUSE_CARDS }, () => dealCard(rng)),
        ];
  }

  options(): string[] | null {
    return this.settled ? null : ['call'];
  }

  act(action: string): void {
    if (this.settled || action !== 'call') return;
    const mine = this.bets.filter((b) => isCard(b.spot));
    const wagered = this.bets.reduce((a, b) => a + b.amount, 0);
    // Every card costs the guest's price; the pool is the share of all sales.
    const price = mine.length ? mine.reduce((a, b) => a + b.amount, 0) / mine.length : 0;
    const pool = this.rules.payback * price * this.cards.length;
    const { called, winners } = playGame(
      this.cards,
      this.rules.pattern,
      this.rng,
      this.preset?.balls,
    );
    const share = winners.length ? pool / winners.length : 0;
    let returned = 0;
    for (const w of winners) if (w < mine.length) returned += share * (mine[w]!.amount / price);
    this.settled = {
      wagered,
      returned,
      summary: `bingo on ball ${called.length}${winners.some((w) => w < mine.length) ? ' — your card' : ''}${winners.length > 1 ? ` (${winners.length} share)` : ''}`,
      detail: { called, cards: this.cards.slice(0, mine.length), winners: winners.length },
    };
  }

  view(): BingoView {
    return { cards: this.cards.slice(0, this.bets.length), called: null };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A game on fixed cards (the guest's first) and a fixed ball order. */
export function bingoRoundFrom(
  rules: BingoRules,
  bets: readonly Bet[],
  cards: number[][],
  balls: number[],
): Round {
  return new BingoRound({ next: () => 0 }, rules, bets, { cards, balls });
}

export const bingoEngine: CasinoEngine<BingoRules> = {
  kind: 'bingo',

  defaultRules: () => ({ minBet: 1, maxBet: 20, payback: 0.86, pattern: 'line' }),

  validateRules(raw, base = bingoEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        payback: readChoice(src, 'payback', base.payback, [0.75, 0.8, 0.86], issues),
        pattern: readChoice(src, 'pattern', base.pattern, ['line', 'blackout'], issues),
      },
      issues,
    };
  },

  theoreticalEdge: (rules) => 1 - rules.payback,

  roundsPerHour(rules) {
    // A line game is called in about three minutes, a blackout in eight. One
    // caller for the whole hall.
    return rules.pattern === 'line' ? 20 : 8;
  },

  begin(rng, rules, bets) {
    return new BingoRound(rng, rules, bets);
  },

  strategy: (_view, options) => options[0]!,

  appeal(rules) {
    // Bingo regulars know what the hall pays out.
    return 1 + 2 * (rules.payback - 0.8);
  },

  spotEdge(rules, spot) {
    return isCard(spot) ? 1 - rules.payback : 0;
  },

  guestBets(rules, unit) {
    return [{ spot: 'card', amount: clampBet(rules, unit) }];
  },
};
