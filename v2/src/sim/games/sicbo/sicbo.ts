// Sic bo: three dice, a layout of bets, one roll. Every bet's edge is
// enumerated over the 216 ordered outcomes, so nothing here is a quoted figure.
//
// Spots: `small`, `big`, `single:N`, `double:N`, `triple:N`, `anyTriple`,
// `total:T` (4-17) and `pair:a-b` (two different faces, a < b). A plain
// `main` bet backs small.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import {
  asRecord,
  clampBet,
  pickFrom,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

export interface SicBoRules extends BaseRules {
  /** What one specific triple pays, to 1. Casinos run 150 or 180. */
  triple: 150 | 180;
  /** What any triple pays, to 1: 24 or 30. */
  anyTriple: 24 | 30;
  /** What a single number pays when all three dice show it: 2 or 3 to 1. */
  singleTriple: 2 | 3;
}

/** Winnings per unit staked on a `total:T` bet (4 … 17). Triples count. */
export const TOTAL_PAYS: Readonly<Record<number, number>> = {
  4: 60,
  5: 30,
  6: 17,
  7: 12,
  8: 8,
  9: 6,
  10: 6,
  11: 6,
  12: 6,
  13: 8,
  14: 12,
  15: 17,
  16: 30,
  17: 60,
};

/** Winnings per unit on a spot, given a roll; -1 loses the stake. */
export function spotWinnings(rules: SicBoRules, spot: string, dice: readonly number[]): number {
  const [a, b, c] = dice as [number, number, number];
  const total = a + b + c;
  const triple = a === b && b === c;
  const [kind, arg] = spot.split(':') as [string, string | undefined];
  switch (kind) {
    // `main` is a plain bet with no layout spot (the avatar's generic play
    // view): it backs small.
    case 'main':
    case 'small':
      return !triple && total >= 4 && total <= 10 ? 1 : -1;
    case 'big':
      return !triple && total >= 11 && total <= 17 ? 1 : -1;
    case 'single': {
      const n = Number(arg);
      const hits = (a === n ? 1 : 0) + (b === n ? 1 : 0) + (c === n ? 1 : 0);
      if (hits === 0) return -1;
      return hits === 3 ? rules.singleTriple : hits;
    }
    case 'double': {
      const n = Number(arg);
      const hits = (a === n ? 1 : 0) + (b === n ? 1 : 0) + (c === n ? 1 : 0);
      return hits >= 2 ? 10 : -1;
    }
    case 'triple':
      return triple && a === Number(arg) ? rules.triple : -1;
    case 'anyTriple':
      return triple ? rules.anyTriple : -1;
    case 'total':
      return total === Number(arg) ? (TOTAL_PAYS[total] ?? -1) : -1;
    case 'pair': {
      const [x, y] = (arg ?? '').split('-').map(Number) as [number, number];
      return dice.includes(x) && dice.includes(y) ? 5 : -1;
    }
    default:
      return -1;
  }
}

/** Every ordered roll, for exact edges. */
const ROLLS: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) out.push([a, b, c]);
  return out;
})();

/** Exact house edge of a spot: 1 − E[return] over the 216 rolls. */
export function sicBoSpotEdge(rules: SicBoRules, spot: string): number {
  let ret = 0;
  for (const roll of ROLLS) ret += 1 + spotWinnings(rules, spot, roll);
  return 1 - ret / ROLLS.length;
}

export interface SicBoView {
  dice: number[];
  total: number;
  triple: boolean;
}

class SicBoRound implements Round {
  private settled: RoundResult | null = null;
  private readonly dice: number[];

  constructor(
    rng: RngLike,
    private readonly rules: SicBoRules,
    private readonly bets: readonly Bet[],
    preset?: readonly number[],
  ) {
    this.dice = preset ? [...preset] : [0, 1, 2].map(() => 1 + Math.floor(rng.next() * 6));
  }

  options(): string[] | null {
    return this.settled ? null : ['roll'];
  }

  act(action: string): void {
    if (this.settled || action !== 'roll') return;
    let wagered = 0;
    let returned = 0;
    for (const bet of this.bets) {
      wagered += bet.amount;
      const w = spotWinnings(this.rules, bet.spot, this.dice);
      if (w >= 0) returned += bet.amount * (1 + w);
    }
    const total = this.dice.reduce((x, y) => x + y, 0);
    const triple = this.dice[0] === this.dice[1] && this.dice[1] === this.dice[2];
    this.settled = {
      wagered,
      returned,
      summary: `${this.dice.join('-')} = ${total}${triple ? ' (triple)' : ''}`,
      detail: { dice: [...this.dice], total, triple },
    };
  }

  view(): SicBoView {
    const total = this.dice.reduce((x, y) => x + y, 0);
    return {
      dice: [...this.dice],
      total,
      triple: this.dice[0] === this.dice[1] && this.dice[1] === this.dice[2],
    };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A round on fixed dice — for tests and for replaying a roll. */
export function sicBoRoundFromDice(
  rules: SicBoRules,
  bets: readonly Bet[],
  dice: readonly number[],
): Round {
  return new SicBoRound({ next: () => 0 }, rules, bets, dice);
}

/** How a guest spreads their stake: mostly the even-money bets, some single
 *  numbers, a few long shots — a real sic bo layout is loaded with all three.
 *  Each family is a list of spots picked uniformly, so the blended edge is exact. */
const FACES = [1, 2, 3, 4, 5, 6];
const GUEST_MIX: readonly { weight: number; spots: readonly string[] }[] = [
  { weight: 0.4, spots: ['small', 'big'] },
  { weight: 0.3, spots: FACES.map((n) => `single:${n}`) },
  { weight: 0.1, spots: [8, 9, 10, 11, 12, 13].map((t) => `total:${t}`) },
  { weight: 0.1, spots: FACES.map((n) => `double:${n}`) },
  { weight: 0.04, spots: ['anyTriple'] },
  { weight: 0.02, spots: FACES.map((n) => `triple:${n}`) },
  {
    weight: 0.04,
    spots: FACES.flatMap((a) => FACES.filter((b) => b > a).map((b) => `pair:${a}-${b}`)),
  },
];

export const sicBoEngine: CasinoEngine<SicBoRules> = {
  kind: 'sicbo',

  defaultRules: () => ({ minBet: 2, maxBet: 500, triple: 180, anyTriple: 30, singleTriple: 3 }),

  validateRules(raw, base = sicBoEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        triple: readChoice(src, 'triple', base.triple, [150, 180], issues),
        anyTriple: readChoice(src, 'anyTriple', base.anyTriple, [24, 30], issues),
        singleTriple: readChoice(src, 'singleTriple', base.singleTriple, [2, 3], issues),
      },
      issues,
    };
  },

  /** The guest mix's blended edge, weighted by stake. A sic bo layout's quoted
   *  figure is its even-money bets (2.78%); the money actually wagered sits on
   *  heavier bets, which is why this is the mix. */
  theoreticalEdge(rules) {
    let edge = 0;
    for (const m of GUEST_MIX) {
      const mean = m.spots.reduce((a, s) => a + sicBoSpotEdge(rules, s), 0) / m.spots.length;
      edge += m.weight * mean;
    }
    return edge;
  },

  roundsPerHour(_rules, seated) {
    // A live dealer clears about 70 rolls an hour; payouts across a crowded
    // layout slow it.
    return 80 / (1 + 0.12 * Math.max(1, seated));
  },

  begin(rng, rules, bets) {
    return new SicBoRound(rng, rules, bets);
  },

  strategy: (_view, options) => options[0]!,

  appeal(rules) {
    // The 180:1 triple and a 3:1 triple on singles are what the layout is
    // advertised on; the 150 / 24 / 2 rules read as a tightened table.
    return (
      1 +
      (rules.triple === 180 ? 0.04 : -0.04) +
      (rules.anyTriple === 30 ? 0.03 : -0.03) +
      (rules.singleTriple === 3 ? 0.02 : -0.02)
    );
  },

  spotEdge: sicBoSpotEdge,

  guestBets(rules, unit, rng) {
    const amount = clampBet(rules, unit);
    let r = rng.next();
    for (const m of GUEST_MIX) {
      if (r < m.weight) return [{ spot: pickFrom(rng, m.spots), amount }];
      r -= m.weight;
    }
    return [{ spot: 'small', amount }];
  },
};
