// Pachinko: not casino maths, so the par sheet is ours (ECONOMY.md says why).
// A play buys a cup of balls. Each ball has `pStart` of falling into the start
// pocket; each start spins a digital lottery that hits with `pJackpot` and
// pays `jackpotBalls`; a hit carries on into another (kakuhen, the
// "probability-up" rush) with `rush` chance, so a hit pays 1 / (1 − rush)
// jackpots on average. Payback per ball is then exact:
//
//   pStart × pJackpot × jackpotBalls / (1 − rush)
//
// and a hall sets it with the nails, which is to say with pStart. The spec
// (jackpot odds, size and rush) is the machine's swing.
//
// Spot: `main` (the cup). One action, `shoot`.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import {
  asRecord,
  clampBet,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

/** Balls in a cup: whatever the cup costs, it holds this many. */
export const BALLS_PER_CUP = 125;

/**
 * Machine specs, after the three bands Japanese halls sell: "max" (1 in 319,
 * the heaviest legal spec), "middle" (about 1 in 199) and "sweet" (amadeji,
 * about 1 in 99, small jackpots that come often).
 */
export const PACHINKO_SPECS = {
  max: { pJackpot: 1 / 319, jackpotBalls: 1500, rush: 0.65 },
  middle: { pJackpot: 1 / 199, jackpotBalls: 1000, rush: 0.6 },
  sweet: { pJackpot: 1 / 99, jackpotBalls: 500, rush: 0.5 },
} as const;
export type PachinkoSpec = keyof typeof PACHINKO_SPECS;

/** Payback per ball the hall tunes the nails to. */
export const PACHINKO_NAILS = { tight: 0.85, standard: 0.88, loose: 0.91 } as const;
export type PachinkoNails = keyof typeof PACHINKO_NAILS;

export interface PachinkoRules extends BaseRules {
  spec: PachinkoSpec;
  nails: PachinkoNails;
}

/** The start-pocket chance that gives the nails' payback on this spec. */
export function startChance(rules: Pick<PachinkoRules, 'spec' | 'nails'>): number {
  const s = PACHINKO_SPECS[rules.spec];
  return (PACHINKO_NAILS[rules.nails] * (1 - s.rush)) / (s.pJackpot * s.jackpotBalls);
}

/** Exact payback per ball from the model (equals the nails' figure). */
export function pachinkoPayback(rules: Pick<PachinkoRules, 'spec' | 'nails'>): number {
  const s = PACHINKO_SPECS[rules.spec];
  return (startChance(rules) * s.pJackpot * s.jackpotBalls) / (1 - s.rush);
}

export interface PachinkoView {
  balls: number;
}

class PachinkoRound implements Round {
  private settled: RoundResult | null = null;

  constructor(
    private readonly rng: RngLike,
    private readonly rules: PachinkoRules,
    private readonly bet: number,
    private readonly preset?: { starts: number; jackpots: number },
  ) {}

  options(): string[] | null {
    return this.settled ? null : ['shoot'];
  }

  act(action: string): void {
    if (this.settled || action !== 'shoot') return;
    const s = PACHINKO_SPECS[this.rules.spec];
    let starts = 0;
    let jackpots = 0;
    if (this.preset) ({ starts, jackpots } = this.preset);
    else {
      const pStart = startChance(this.rules);
      for (let b = 0; b < BALLS_PER_CUP; b++) {
        if (this.rng.next() >= pStart) continue;
        starts++;
        if (this.rng.next() >= s.pJackpot) continue;
        jackpots++;
        while (this.rng.next() < s.rush) jackpots++;
      }
    }
    const payout = jackpots * s.jackpotBalls;
    this.settled = {
      wagered: this.bet,
      returned: (this.bet * payout) / BALLS_PER_CUP,
      summary: jackpots
        ? `jackpot${jackpots > 1 ? ` ×${jackpots} (rush)` : ''} — ${payout} balls`
        : `${starts} starts, no jackpot`,
      detail: { balls: BALLS_PER_CUP, starts, jackpot: jackpots > 0, payout },
    };
  }

  view(): PachinkoView {
    return { balls: BALLS_PER_CUP };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A cup with a fixed number of starts and jackpots, for tests and replays. */
export function pachinkoRoundFrom(
  rules: PachinkoRules,
  bet: number,
  starts: number,
  jackpots: number,
): Round {
  return new PachinkoRound({ next: () => 0 }, rules, bet, { starts, jackpots });
}

export const pachinkoEngine: CasinoEngine<PachinkoRules> = {
  kind: 'pachinko',

  // Sweet spec by default: an arcade cabinet that pays small and often.
  defaultRules: () => ({ minBet: 1, maxBet: 50, spec: 'sweet', nails: 'standard' }),

  validateRules(raw, base = pachinkoEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    return {
      rules: {
        ...limits,
        spec: readChoice(
          src,
          'spec',
          base.spec,
          Object.keys(PACHINKO_SPECS) as PachinkoSpec[],
          issues,
        ),
        nails: readChoice(
          src,
          'nails',
          base.nails,
          Object.keys(PACHINKO_NAILS) as PachinkoNails[],
          issues,
        ),
      },
      issues,
    };
  },

  theoreticalEdge: (rules) => 1 - pachinkoPayback(rules),

  roundsPerHour() {
    // A machine fires about 100 balls a minute: 48 cups an hour.
    return 48;
  },

  begin(rng, rules, bets: Bet[]) {
    const bet = bets.find((b) => b.spot === 'main')?.amount ?? rules.minBet;
    return new PachinkoRound(rng, rules, bet);
  },

  strategy: (_view, options) => options[0]!,

  appeal(rules) {
    // Players feel the nails (they watch how many balls find the pocket) more
    // than the spec; a heavy spec draws a few jackpot hunters.
    const nails = rules.nails === 'loose' ? 1.1 : rules.nails === 'standard' ? 1.0 : 0.9;
    return nails * (rules.spec === 'max' ? 1.03 : 1.0);
  },

  spotEdge(rules, spot) {
    return spot === 'main' ? 1 - pachinkoPayback(rules) : 0;
  },

  guestBets(rules, unit) {
    return [{ spot: 'main', amount: clampBet(rules, unit) }];
  },
};
