// Roulette: a single-zero (European) or double-zero (American) wheel, every
// standard inside and outside bet, and La Partage on single zero. Edges are
// computed by enumerating the wheel's pockets rather than quoted, so a new bet
// type or rule cannot drift from its own math.

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

export interface RouletteRules extends BaseRules {
  wheel: 'single' | 'double';
  /** Even-money bets lose only half when the ball lands on 0 (single zero only). */
  laPartage: boolean;
}

/** Pocket 37 is 00. */
export const DOUBLE_ZERO = 37;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export function isRed(n: number): boolean {
  return RED.has(n);
}

export function pocketLabel(n: number): string {
  return n === DOUBLE_ZERO ? '00' : String(n);
}

function pocketsOf(rules: RouletteRules): number[] {
  const n = rules.wheel === 'double' ? 38 : 37;
  return Array.from({ length: n }, (_, i) => i);
}

export interface SpotDef {
  /** Numbers this bet covers. */
  covers: number[];
  /** Winnings per unit staked (stake returned on top). */
  pays: number;
  /** Red/black, odd/even, low/high: the bets La Partage applies to. */
  evenMoney: boolean;
}

const OUTSIDE: Record<string, (n: number) => boolean> = {
  red: (n) => RED.has(n),
  black: (n) => n >= 1 && n <= 36 && !RED.has(n),
  odd: (n) => n >= 1 && n <= 36 && n % 2 === 1,
  even: (n) => n >= 1 && n <= 36 && n % 2 === 0,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19 && n <= 36,
};

const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Parse a spot id into what it covers and pays, or null if the wheel has no
 * such bet. Inside bets follow the layout (three numbers per row, 1-3 on the
 * first row), so "split:1-5" is rejected: those numbers do not touch.
 */
export function parseSpot(spot: string, wheel: RouletteRules['wheel']): SpotDef | null {
  const [kind, arg = ''] = spot.split(':');
  const inside = (covers: number[]): SpotDef => ({
    covers,
    pays: 36 / covers.length - 1,
    evenMoney: false,
  });
  switch (kind) {
    case 'straight': {
      const n = arg === '00' ? DOUBLE_ZERO : Number(arg);
      if (!Number.isInteger(n) || n < 0 || n > 37) return null;
      if (n === DOUBLE_ZERO && wheel !== 'double') return null;
      return inside([n]);
    }
    case 'split': {
      const [a, b] = arg.split('-').map(Number);
      if (a === undefined || b === undefined || !(a >= 1 && b <= 36 && a < b)) return null;
      const sameRow = b - a === 1 && a % 3 !== 0;
      if (!sameRow && b - a !== 3) return null;
      return inside([a, b]);
    }
    case 'street': {
      const a = Number(arg);
      if (!Number.isInteger(a) || a < 1 || a > 34 || a % 3 !== 1) return null;
      return inside(range(a, a + 2));
    }
    case 'corner': {
      const a = Number(arg);
      if (!Number.isInteger(a) || a < 1 || a > 32 || a % 3 === 0) return null;
      return inside([a, a + 1, a + 3, a + 4]);
    }
    case 'sixline': {
      const a = Number(arg);
      if (!Number.isInteger(a) || a < 1 || a > 31 || a % 3 !== 1) return null;
      return inside(range(a, a + 5));
    }
    case 'basket':
      // The double-zero "five number" bet (0-00-1-2-3) pays 6:1, not the 36/5 - 1
      // = 6.2:1 a fair inside bet would, which is why it is the worst bet on the
      // layout. On a single-zero wheel the same corner is the 8:1 "first four".
      return wheel === 'double'
        ? { covers: [0, DOUBLE_ZERO, 1, 2, 3], pays: 6, evenMoney: false }
        : inside([0, 1, 2, 3]);
    case 'column': {
      const c = Number(arg);
      if (c !== 1 && c !== 2 && c !== 3) return null;
      return { covers: range(1, 36).filter((n) => (n - c) % 3 === 0), pays: 2, evenMoney: false };
    }
    case 'dozen': {
      const d = Number(arg);
      if (d !== 1 && d !== 2 && d !== 3) return null;
      return { covers: range(12 * d - 11, 12 * d), pays: 2, evenMoney: false };
    }
    default: {
      const test = OUTSIDE[spot];
      if (!test) return null;
      return { covers: range(1, 36).filter(test), pays: 1, evenMoney: true };
    }
  }
}

/** Amount returned (stake included) on `amount` staked at `def` when `pocket` hits. */
function returnFor(def: SpotDef, amount: number, pocket: number, rules: RouletteRules): number {
  if (def.covers.includes(pocket)) return amount * (1 + def.pays);
  if (pocket === 0 && def.evenMoney && rules.laPartage && rules.wheel === 'single') {
    return amount / 2;
  }
  return 0;
}

/** Exact edge of a spot: 1 − (mean return per unit over every pocket). */
export function rouletteSpotEdge(rules: RouletteRules, spot: string): number {
  const def = parseSpot(spot, rules.wheel);
  if (!def) return 0;
  const pockets = pocketsOf(rules);
  let ret = 0;
  for (const p of pockets) ret += returnFor(def, 1, p, rules);
  return 1 - ret / pockets.length;
}

export interface RouletteView {
  wheel: RouletteRules['wheel'];
  bets: Bet[];
  /** Null until the ball has dropped. */
  pocket: number | null;
}

class RouletteRound implements Round {
  private pocket: number | null = null;
  private settled: RoundResult | null = null;

  constructor(
    private readonly rng: RngLike,
    private readonly rules: RouletteRules,
    private readonly bets: Bet[],
  ) {}

  options(): string[] | null {
    return this.settled ? null : ['spin'];
  }

  act(action: string): void {
    if (this.settled || action !== 'spin') return;
    const pockets = this.rules.wheel === 'double' ? 38 : 37;
    const pocket = Math.floor(this.rng.next() * pockets);
    this.pocket = pocket;
    let wagered = 0;
    let returned = 0;
    for (const b of this.bets) {
      const def = parseSpot(b.spot, this.rules.wheel);
      if (!def) continue;
      wagered += b.amount;
      returned += returnFor(def, b.amount, pocket, this.rules);
    }
    const colour = pocket === 0 || pocket === DOUBLE_ZERO ? 'green' : isRed(pocket) ? 'red' : 'black';
    this.settled = {
      wagered,
      returned,
      summary: `${pocketLabel(pocket)} ${colour}`,
      detail: { pocket },
    };
  }

  view(): RouletteView {
    return { wheel: this.rules.wheel, bets: this.bets, pocket: this.pocket };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

// Guests spread across the layout the way a real roulette crowd does: mostly
// outside bets, a minority chasing straight-ups. The mix only matters for
// variance — every bet but the five-number carries the same edge.
const GUEST_SPOTS = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'dozen:1',
  'dozen:2',
  'dozen:3',
  'column:1',
  'column:2',
  'column:3',
  'corner:17',
  'street:31',
  'split:8-11',
  'straight:17',
  'straight:7',
  'straight:32',
] as const;

export const rouletteEngine: CasinoEngine<RouletteRules> = {
  kind: 'roulette',

  defaultRules(): RouletteRules {
    // Double zero is the default because the tycoon starts on the Strip, not in
    // Monte Carlo: the single-zero wheel is the lever, and its price is appeal.
    return { minBet: 20, maxBet: 1000, wheel: 'double', laPartage: false };
  },

  validateRules(raw, base = rouletteEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    const wheel = readChoice(src, 'wheel', base.wheel, ['single', 'double'] as const, issues);
    let laPartage = readChoice(src, 'laPartage', base.laPartage, [true, false] as const, issues);
    if (laPartage && wheel === 'double') {
      issues.push({ field: 'laPartage', message: 'only offered on a single-zero wheel' });
      laPartage = false;
    }
    return { rules: { ...limits, wheel, laPartage }, issues };
  },

  theoreticalEdge(rules) {
    // Quoted on the standard bets. La Partage halves the edge on even-money
    // bets only, so the inside edge is the conservative figure for a table.
    return rouletteSpotEdge(rules, 'straight:17');
  },

  roundsPerHour(_rules, seated) {
    // About 100 spins an hour heads-up, falling to the ~38 a full table manages
    // while the croupier clears and pays chips (Wizard of Odds' rule of thumb).
    return 112 / (1 + 0.33 * Math.max(1, seated));
  },

  begin(rng, rules, bets) {
    const legal = bets
      .filter((b) => parseSpot(b.spot, rules.wheel) !== null && b.amount > 0)
      .map((b) => ({ spot: b.spot, amount: b.amount }));
    return new RouletteRound(rng, rules, legal);
  },

  strategy(_view, options) {
    return options[0]!;
  },

  appeal(rules) {
    // Regulars know what the second zero costs them; La Partage is a draw.
    let a = rules.wheel === 'single' ? 1.15 : 0.95;
    if (rules.laPartage) a += 0.1;
    return a;
  },

  spotEdge: rouletteSpotEdge,

  guestBets(rules, unit, rng) {
    return [{ spot: pickFrom(rng, GUEST_SPOTS), amount: clampBet(rules, unit) }];
  },
};
