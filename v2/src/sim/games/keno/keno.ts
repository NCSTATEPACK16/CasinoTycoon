// Keno: 80 numbers, 20 drawn. A ticket marks n spots (the lounge sells 1, 4,
// 6, 8 and 10) and pays by how many of them the draw catches. The chance of k
// catches is hypergeometric, C(n,k)·C(80−n,20−k)/C(80,20), so every ticket's
// edge is exact; nothing here is a quoted figure.
//
// Spots: `spot:N` for an N-spot ticket; a plain `main` bet (the avatar's
// generic play view) is a 4-spot. One action, `draw`.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import {
  asRecord,
  clampBet,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

export const KENO_SPOTS = [1, 4, 6, 8, 10] as const;
export type KenoSpot = (typeof KENO_SPOTS)[number];

/**
 * Pays "for 1" (stake included) by catches, per ticket. Shaped like the live
 * and lounge tickets Wizard of Odds surveys ("Keno": Las Vegas live keno
 * returned 65–80% in 2001; video keno runs 84–95%), with the tops capped at
 * lounge sizes rather than the $100,000 aggregate limit of a live game. The
 * exact returns (kenoReturn) are, by table:
 *   generous  1:80.0%  4:76.6%  6:78.8%  8:83.3%  10:83.9%
 *   standard  1:75.0%  4:72.3%  6:74.5%  8:75.2%  10:74.9%
 *   tight     1:70.0%  4:64.9%  6:64.6%  8:65.5%  10:65.0%
 */
export const KENO_PAYTABLES: Readonly<
  Record<KenoPaytable, Readonly<Record<KenoSpot, Readonly<Record<number, number>>>>>
> = {
  generous: {
    1: { 1: 3.2 },
    4: { 2: 1, 3: 5, 4: 110 },
    6: { 3: 1, 4: 5, 5: 100, 6: 1600 },
    8: { 4: 1, 5: 14, 6: 110, 7: 1300, 8: 6000 },
    10: { 0: 1, 5: 3, 6: 22, 7: 140, 8: 1000, 9: 4000, 10: 10000 },
  },
  standard: {
    1: { 1: 3 },
    4: { 2: 1, 3: 4, 4: 110 },
    6: { 3: 1, 4: 5, 5: 90, 6: 1500 },
    8: { 4: 1, 5: 12, 6: 100, 7: 1200, 8: 5000 },
    10: { 0: 1, 5: 2, 6: 20, 7: 130, 8: 1000, 9: 4000, 10: 10000 },
  },
  tight: {
    1: { 1: 2.8 },
    4: { 2: 1, 3: 3, 4: 100 },
    6: { 3: 1, 4: 4, 5: 80, 6: 1200 },
    8: { 4: 1, 5: 10, 6: 90, 7: 1000, 8: 4000 },
    10: { 5: 2, 6: 18, 7: 120, 8: 900, 9: 4000, 10: 10000 },
  },
};
export type KenoPaytable = 'generous' | 'standard' | 'tight';

export interface KenoRules extends BaseRules {
  paytable: KenoPaytable;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** P(k of an n-spot ticket's numbers are among the 20 drawn). */
export function catchProbability(n: number, k: number): number {
  return (choose(n, k) * choose(80 - n, 20 - k)) / choose(80, 20);
}

/** Exact return per unit of an n-spot ticket. */
export function kenoReturn(table: KenoPaytable, n: KenoSpot): number {
  const pays = KENO_PAYTABLES[table][n];
  let ret = 0;
  for (let k = 0; k <= n; k++) ret += catchProbability(n, k) * (pays[k] ?? 0);
  return ret;
}

/** How the lounge's guests split their tickets: mostly the cheap thrills
 *  (1- and 4-spot), fewer chasing the 8- and 10-spot tops. */
export const KENO_GUEST_MIX: Readonly<Record<KenoSpot, number>> = {
  1: 0.3,
  4: 0.4,
  6: 0.2,
  8: 0.07,
  10: 0.03,
};

function spotCount(spot: string): KenoSpot | null {
  if (spot === 'main') return 4;
  const m = /^spot:(\d+)$/.exec(spot);
  const n = m ? Number(m[1]) : NaN;
  return (KENO_SPOTS as readonly number[]).includes(n) ? (n as KenoSpot) : null;
}

export function kenoSpotEdge(rules: KenoRules, spot: string): number {
  const n = spotCount(spot);
  return n === null ? 0 : 1 - kenoReturn(rules.paytable, n);
}

/** `count` distinct numbers 1-80 by a partial Fisher–Yates. */
function drawNumbers(rng: RngLike, count: number): number[] {
  const pool = Array.from({ length: 80 }, (_, i) => i + 1);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng.next() * (80 - i));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, count);
}

export interface KenoView {
  picks: number[][];
  drawn: number[] | null;
}

class KenoRound implements Round {
  private settled: RoundResult | null = null;
  /** One list of marked numbers per bet, in bet order. */
  private readonly picks: number[][];
  private readonly drawn: number[];

  constructor(
    rng: RngLike,
    private readonly rules: KenoRules,
    private readonly bets: readonly Bet[],
    preset?: { picks: number[][]; drawn: number[] },
  ) {
    if (preset) {
      this.picks = preset.picks.map((p) => [...p]);
      this.drawn = [...preset.drawn];
      return;
    }
    this.picks = bets.map((b) => drawNumbers(rng, spotCount(b.spot) ?? 0).sort((x, y) => x - y));
    this.drawn = drawNumbers(rng, 20);
  }

  options(): string[] | null {
    return this.settled ? null : ['draw'];
  }

  act(action: string): void {
    if (this.settled || action !== 'draw') return;
    const hit = new Set(this.drawn);
    let wagered = 0;
    let returned = 0;
    let hits = 0;
    this.bets.forEach((bet, i) => {
      wagered += bet.amount;
      const n = spotCount(bet.spot);
      if (n === null) return;
      const k = (this.picks[i] ?? []).filter((x) => hit.has(x)).length;
      if (i === 0) hits = k;
      returned += bet.amount * (KENO_PAYTABLES[this.rules.paytable][n][k] ?? 0);
    });
    const n = this.picks[0]?.length ?? 0;
    this.settled = {
      wagered,
      returned,
      summary: `caught ${hits} of ${n}${returned > 0 ? ` — pays ${returned / wagered}×` : ''}`,
      detail: { picks: [...(this.picks[0] ?? [])], drawn: [...this.drawn], hits },
    };
  }

  view(): KenoView {
    return { picks: this.picks.map((p) => [...p]), drawn: this.settled ? [...this.drawn] : null };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

/** A round on fixed picks and draw — for tests and replays. */
export function kenoRoundFromDraw(
  rules: KenoRules,
  bets: readonly Bet[],
  picks: number[][],
  drawn: number[],
): Round {
  return new KenoRound({ next: () => 0 }, rules, bets, { picks, drawn });
}

export const kenoEngine: CasinoEngine<KenoRules> = {
  kind: 'keno',

  defaultRules: () => ({ minBet: 1, maxBet: 100, paytable: 'standard' }),

  validateRules(raw, base = kenoEngine.defaultRules()) {
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
          Object.keys(KENO_PAYTABLES) as KenoPaytable[],
          issues,
        ),
      },
      issues,
    };
  },

  /** The guest mix's edge: every ticket costs the same stake, so it is the
   *  mix-weighted mean of the tickets' exact edges (26% on the standard table). */
  theoreticalEdge(rules) {
    let edge = 0;
    for (const n of KENO_SPOTS) edge += KENO_GUEST_MIX[n] * (1 - kenoReturn(rules.paytable, n));
    return edge;
  },

  roundsPerHour() {
    // A lounge game every four minutes: live keno calls one about every five,
    // the lounge's screens run a little quicker. Everyone plays the same draw,
    // so the pace does not depend on how many are seated.
    return 15;
  },

  begin(rng, rules, bets) {
    return new KenoRound(rng, rules, bets);
  },

  strategy: (_view, options) => options[0]!,

  appeal(rules) {
    // Keno players are loyal and not price-sensitive; a tight table still
    // reads a little mean on the board.
    return rules.paytable === 'generous' ? 1.08 : rules.paytable === 'standard' ? 1.0 : 0.93;
  },

  spotEdge: kenoSpotEdge,

  guestBets(rules, unit, rng) {
    const amount = clampBet(rules, unit);
    let r = rng.next();
    for (const n of KENO_SPOTS) {
      if (r < KENO_GUEST_MIX[n]) return [{ spot: `spot:${n}`, amount }];
      r -= KENO_GUEST_MIX[n];
    }
    return [{ spot: 'spot:4', amount }];
  },
};
