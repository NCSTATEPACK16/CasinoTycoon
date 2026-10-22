// Craps: the shooter's come-out/point state machine with every bet a real
// layout carries — Pass/Don't Pass (bar 12), Come/Don't Come, free odds at
// true payouts, place bets, the field, hardways and the one-roll props.
//
// A "round" is one guest's stay in the action: it starts on a come-out roll
// and keeps rolling until every bet that guest laid down has been decided.
// Edges are therefore per resolved bet, which is how every published craps
// table quotes them.

import type { BaseRules, Bet, Round, RoundResult, RngLike } from '../../../shared/games';
import {
  asRecord,
  clampBet,
  readChoice,
  readLimits,
  type CasinoEngine,
  type RulesIssue,
} from '../types';

export const ODDS_OPTIONS = ['1x', '2x', '3-4-5x', '5x', '10x', '20x'] as const;
export type OddsOption = (typeof ODDS_OPTIONS)[number];

export interface CrapsRules extends BaseRules {
  /** Free-odds limit, as a multiple of the line bet. */
  odds: OddsOption;
  /** The field pays 2:1 on 2 always; 12 pays 2:1 or (the generous house) 3:1. */
  field12Pays: 2 | 3;
}

/** Ways to roll each total with two dice, out of 36. */
export const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] as const;
export const POINTS = [4, 5, 6, 8, 9, 10] as const;

/** Maximum odds multiple behind a point. */
export function maxOddsMultiple(odds: OddsOption, point: number): number {
  if (odds === '3-4-5x')
    return point === 4 || point === 10 ? 3 : point === 5 || point === 9 ? 4 : 5;
  return Number(odds.slice(0, -1));
}

/** True-odds winnings per unit: what the "free" odds bet pays. */
function trueOdds(point: number, right: boolean): number {
  const ratio = 6 / WAYS[point]!; // 7s to point: 2 for 4/10, 1.5 for 5/9, 1.2 for 6/8
  return right ? ratio : 1 / ratio;
}

/** Place-bet winnings per unit: 9:5 on 4/10, 7:5 on 5/9, 7:6 on 6/8. */
const PLACE_PAYS: Record<number, number> = {
  4: 9 / 5,
  10: 9 / 5,
  5: 7 / 5,
  9: 7 / 5,
  6: 7 / 6,
  8: 7 / 6,
};

// ---------- exact edges ----------

/** P(point repeats before a 7) — the whole of craps' arithmetic rests on this. */
function pointBefore7(point: number): number {
  return WAYS[point]! / (WAYS[point]! + 6);
}

interface Outcome {
  win: number;
  lose: number;
  /** Winnings per unit on a win (stake returned on top). */
  pays: (total: number) => number;
}

/**
 * Exact expected return per unit of a spot, enumerating the dice. Multi-roll
 * bets are absorbing Markov chains; for a bet that only cares about some
 * totals, the rolls that don't decide it drop out, so P(win) is a ratio of
 * per-roll ways.
 */
export function crapsSpotReturn(rules: CrapsRules, spot: string): number {
  const [kind, arg] = spot.split(':');
  const n = Number(arg);
  switch (kind) {
    case 'pass':
    case 'come': {
      let ev = (WAYS[7]! + WAYS[11]!) / 36; // naturals win even money
      for (const p of POINTS) ev += (WAYS[p]! / 36) * pointBefore7(p);
      return 2 * ev; // stake back plus 1:1 on every win
    }
    case 'dontPass':
    case 'dontCome': {
      // 2 and 3 win, 12 is barred (a push), 7 and 11 lose.
      let ev = 2 * ((WAYS[2]! + WAYS[3]!) / 36) + 1 * (WAYS[12]! / 36);
      for (const p of POINTS) ev += 2 * (WAYS[p]! / 36) * (1 - pointBefore7(p));
      return ev;
    }
    case 'odds':
    case 'layOdds': {
      // Paid at true odds, so the expectation is exactly the stake.
      if (!POINTS.includes(n as (typeof POINTS)[number])) return 0;
      const right = kind === 'odds';
      const pWin = right ? pointBefore7(n) : 1 - pointBefore7(n);
      return pWin * (1 + trueOdds(n, right));
    }
    case 'place': {
      if (!(n in PLACE_PAYS)) return 0;
      return pointBefore7(n) * (1 + PLACE_PAYS[n]!);
    }
    case 'hard': {
      if (n !== 4 && n !== 6 && n !== 8 && n !== 10) return 0;
      // Wins on the one hard combination; loses on 7 or any easy way of n.
      const win = 1;
      const lose = 6 + (WAYS[n]! - 1);
      const pays = n === 4 || n === 10 ? 7 : 9;
      return (win / (win + lose)) * (1 + pays);
    }
    default: {
      const one = ONE_ROLL[spot];
      if (!one) return 0;
      let ev = 0;
      for (let t = 2; t <= 12; t++) {
        const pays = one.pays(rules, t);
        if (pays !== null) ev += (WAYS[t]! / 36) * (1 + pays);
      }
      return ev;
    }
  }
}

/** One-roll bets: winnings per unit for a total, or null on a loss. */
const ONE_ROLL: Record<string, { pays: (rules: CrapsRules, total: number) => number | null }> = {
  field: {
    pays: (rules, t) =>
      t === 2 ? 2 : t === 12 ? rules.field12Pays : [3, 4, 9, 10, 11].includes(t) ? 1 : null,
  },
  any7: { pays: (_r, t) => (t === 7 ? 4 : null) },
  anyCraps: { pays: (_r, t) => (t === 2 || t === 3 || t === 12 ? 7 : null) },
  yo: { pays: (_r, t) => (t === 11 ? 15 : null) },
};

export function crapsSpotEdge(rules: CrapsRules, spot: string): number {
  if (!isLegalSpot(spot)) return 0;
  return 1 - crapsSpotReturn(rules, spot);
}

const OPENING_SPOTS = new Set([
  'pass',
  'dontPass',
  'come',
  'dontCome',
  'field',
  'any7',
  'anyCraps',
  'yo',
  'place:4',
  'place:5',
  'place:6',
  'place:8',
  'place:9',
  'place:10',
  'hard:4',
  'hard:6',
  'hard:8',
  'hard:10',
]);

function isLegalSpot(spot: string): boolean {
  if (OPENING_SPOTS.has(spot)) return true;
  const [kind, arg] = spot.split(':');
  return (
    (kind === 'odds' || kind === 'layOdds') &&
    POINTS.includes(Number(arg) as (typeof POINTS)[number])
  );
}

// ---------- the round ----------

type BetState =
  | { kind: 'line'; right: boolean; amount: number; point: number | null; odds: number }
  // A come bet waits for the next roll after a point is up before it is in action.
  | {
      kind: 'come';
      right: boolean;
      amount: number;
      point: number | null;
      odds: number;
      live: boolean;
    }
  | { kind: 'place'; number: number; amount: number }
  | { kind: 'hard'; number: number; amount: number }
  | { kind: 'oneRoll'; spot: string; amount: number };

interface Tracked {
  spot: string;
  state: BetState;
  done: boolean;
}

export interface CrapsView {
  /** The table's point (null on a come-out roll). */
  point: number | null;
  rolls: [number, number][];
  /** Bets still working, with their own points and odds. */
  working: { spot: string; amount: number; point: number | null; odds: number }[];
  /** Line/come bets with a point and room for more odds: the spots 'odds:<spot>' may target. */
  oddsOpen: { spot: string; max: number }[];
  log: string[];
}

class CrapsRound implements Round {
  private tablePoint: number | null = null;
  private readonly bets: Tracked[] = [];
  private readonly rolls: [number, number][] = [];
  private readonly log: string[] = [];
  private wagered = 0;
  private returned = 0;
  private settled: RoundResult | null = null;

  constructor(
    private readonly rng: RngLike,
    private readonly rules: CrapsRules,
    opening: Bet[],
  ) {
    for (const b of opening) {
      if (!OPENING_SPOTS.has(b.spot) || b.amount <= 0) continue;
      const [kind, arg] = b.spot.split(':');
      const n = Number(arg);
      let state: BetState;
      if (kind === 'pass' || kind === 'dontPass') {
        state = { kind: 'line', right: kind === 'pass', amount: b.amount, point: null, odds: 0 };
      } else if (kind === 'come' || kind === 'dontCome') {
        state = {
          kind: 'come',
          right: kind === 'come',
          amount: b.amount,
          point: null,
          odds: 0,
          live: false,
        };
      } else if (kind === 'place') state = { kind: 'place', number: n, amount: b.amount };
      else if (kind === 'hard') state = { kind: 'hard', number: n, amount: b.amount };
      else state = { kind: 'oneRoll', spot: b.spot, amount: b.amount };
      // A come bet is not in action until it is moved to the line — counted then.
      if (state.kind !== 'come') this.wagered += b.amount;
      this.bets.push({ spot: b.spot, state, done: false });
    }
    if (this.bets.length === 0) this.finish();
  }

  /** Bets with a point that may still take more odds. */
  private oddsOpen(): { bet: Tracked; max: number }[] {
    const open: { bet: Tracked; max: number }[] = [];
    for (const t of this.bets) {
      const s = t.state;
      if (t.done || (s.kind !== 'line' && s.kind !== 'come') || s.point === null) continue;
      // The limit is on what the odds can win, so a don't bettor lays more than
      // the multiple to win it: 3x on a 4 means laying 6 units to win 3.
      const mult = maxOddsMultiple(this.rules.odds, s.point);
      const max = s.amount * (s.right ? mult : mult / trueOdds(s.point, false));
      if (s.odds < max) open.push({ bet: t, max: max - s.odds });
    }
    return open;
  }

  options(): string[] | null {
    if (this.settled) return null;
    const opts = ['roll'];
    for (const { bet } of this.oddsOpen()) opts.push(`odds:${bet.spot}`);
    return opts;
  }

  act(action: string): void {
    if (this.settled) return;
    if (action.startsWith('odds:')) {
      const spot = action.slice(5);
      const open = this.oddsOpen().find((o) => o.bet.spot === spot);
      if (!open) return;
      const s = open.bet.state as Extract<BetState, { kind: 'line' | 'come' }>;
      s.odds += open.max;
      this.wagered += open.max;
      this.log.push(`${s.right ? 'odds' : 'lay'} $${open.max} behind ${spot} on ${s.point}`);
      return;
    }
    if (action !== 'roll') return;
    this.roll();
  }

  private pay(t: Tracked, amount: number, note: string): void {
    this.returned += amount;
    t.done = true;
    this.log.push(note);
  }

  private roll(): void {
    const d1 = 1 + Math.floor(this.rng.next() * 6);
    const d2 = 1 + Math.floor(this.rng.next() * 6);
    const total = d1 + d2;
    const hard = d1 === d2;
    this.rolls.push([d1, d2]);
    const comeOut = this.tablePoint === null;

    for (const t of this.bets) {
      if (t.done) continue;
      const s = t.state;
      switch (s.kind) {
        case 'line':
        case 'come':
          this.resolveContract(t, s, total, comeOut);
          break;
        case 'place':
          // Off on the come-out by house convention: only a point roll can decide it.
          if (comeOut) break;
          if (total === s.number)
            this.pay(t, s.amount * (1 + PLACE_PAYS[s.number]!), `place ${s.number} wins`);
          else if (total === 7) this.pay(t, 0, `place ${s.number} loses`);
          break;
        case 'hard':
          if (comeOut) break;
          if (total === s.number && hard) {
            const pays = s.number === 4 || s.number === 10 ? 7 : 9;
            this.pay(t, s.amount * (1 + pays), `hard ${s.number} wins`);
          } else if (total === 7 || total === s.number) this.pay(t, 0, `hard ${s.number} loses`);
          break;
        case 'oneRoll': {
          const pays = ONE_ROLL[s.spot]!.pays(this.rules, total);
          this.pay(
            t,
            pays === null ? 0 : s.amount * (1 + pays),
            `${s.spot} ${pays === null ? 'loses' : 'wins'}`,
          );
          break;
        }
      }
    }

    // The table's own point moves with the shooter, whoever is still betting.
    if (comeOut) {
      if (POINTS.includes(total as (typeof POINTS)[number])) this.tablePoint = total;
    } else if (total === this.tablePoint || total === 7) {
      this.tablePoint = null;
    }

    // Come bets go live on the first roll they could act on: one made while a
    // point is up. A come bet laid at the come-out simply waits for the point.
    if (this.tablePoint !== null) {
      for (const t of this.bets) {
        const s = t.state;
        if (s.kind === 'come' && !s.live && !t.done) {
          s.live = true;
          this.wagered += s.amount;
        }
      }
    }

    // A come bet that never went live (the line resolved first) is handed back
    // untouched — it was never in action, so it is not in the handle either.
    const unresolved = this.bets.filter((t) => !t.done);
    if (unresolved.every((t) => t.state.kind === 'come' && !t.state.live)) {
      for (const t of unresolved) t.done = true;
      this.finish();
    }
  }

  private resolveContract(
    t: Tracked,
    s: Extract<BetState, { kind: 'line' | 'come' }>,
    total: number,
    tableComeOut: boolean,
  ): void {
    // A come bet that was only just made sees this roll as its own come-out.
    if (s.kind === 'come' && !s.live) return;
    const name = t.spot;
    if (s.point === null) {
      // This bet's come-out roll.
      if (s.right) {
        if (total === 7 || total === 11) this.pay(t, s.amount * 2, `${name} wins on ${total}`);
        else if (total === 2 || total === 3 || total === 12) this.pay(t, 0, `${name} craps out`);
        else s.point = total;
      } else {
        if (total === 2 || total === 3) this.pay(t, s.amount * 2, `${name} wins on ${total}`);
        else if (total === 12) this.pay(t, s.amount, `${name} pushes — bar 12`);
        else if (total === 7 || total === 11) this.pay(t, 0, `${name} loses on ${total}`);
        else s.point = total;
      }
      return;
    }
    // A line bet's point is the table's point; it cannot be decided on a fresh
    // come-out, so this only fires while that point is up.
    if (s.kind === 'line' && tableComeOut) return;
    const point = s.point;
    if (total !== point && total !== 7) return;
    const rightWins = total === point;
    const won = s.right === rightWins;
    // Come-bet odds are off on the come-out roll by convention: a 7 then
    // loses the flat bet but hands the odds back.
    const oddsOff = s.kind === 'come' && tableComeOut;
    let ret = won ? s.amount * 2 : 0;
    if (s.odds > 0) {
      if (oddsOff) ret += s.odds;
      else if (won) ret += s.odds * (1 + trueOdds(point, s.right));
    }
    this.pay(t, ret, `${name} ${won ? 'wins' : 'loses'} (${point}, rolled ${total})`);
  }

  private finish(): void {
    const last = this.rolls.at(-1);
    this.settled = {
      wagered: this.wagered,
      returned: this.returned,
      summary:
        this.rolls.length === 0
          ? 'no bets'
          : `${this.rolls.length} roll${this.rolls.length === 1 ? '' : 's'}, last ${last![0] + last![1]}`,
      detail: { rolls: this.rolls, log: this.log },
    };
  }

  view(): CrapsView {
    return {
      point: this.tablePoint,
      rolls: this.rolls,
      working: this.bets
        .filter((t) => !t.done)
        .map((t) => {
          const s = t.state;
          const point = s.kind === 'line' || s.kind === 'come' ? s.point : null;
          const odds = s.kind === 'line' || s.kind === 'come' ? s.odds : 0;
          return { spot: t.spot, amount: s.amount, point, odds };
        }),
      oddsOpen: this.oddsOpen().map((o) => ({ spot: o.bet.spot, max: o.max })),
      log: this.log,
    };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

export const crapsEngine: CasinoEngine<CrapsRules> = {
  kind: 'craps',

  defaultRules(): CrapsRules {
    return { minBet: 15, maxBet: 1000, odds: '3-4-5x', field12Pays: 2 };
  },

  validateRules(raw, base = crapsEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const limits = readLimits(src, base, issues);
    const odds = readChoice(src, 'odds', base.odds, ODDS_OPTIONS, issues);
    const field12Pays = readChoice(src, 'field12Pays', base.field12Pays, [2, 3] as const, issues);
    return { rules: { ...limits, odds, field12Pays }, issues };
  },

  theoreticalEdge(rules) {
    // The reference wager is the pass line: 7/495.
    return crapsSpotEdge(rules, 'pass');
  },

  roundsPerHour(_rules, seated) {
    // ~100 rolls an hour at a lively table, a little slower as the rail fills
    // and payouts take longer. A pass-line decision takes 557/165 ≈ 3.38 rolls.
    const rolls = 110 / (1 + 0.03 * Math.max(1, seated));
    return rolls / (557 / 165);
  },

  begin(rng, rules, bets) {
    return new CrapsRound(rng, rules, bets);
  },

  strategy(_view, options) {
    // The sharp line bettor takes every dollar of odds the table allows: it is
    // the only zero-edge bet in the building.
    return options.find((o) => o.startsWith('odds:')) ?? 'roll';
  },

  appeal(rules) {
    // Odds are what craps regulars shop for. 1x is a clip joint, 10x+ a draw.
    const byOdds: Record<OddsOption, number> = {
      '1x': 0.8,
      '2x': 0.9,
      '3-4-5x': 1.0,
      '5x': 1.05,
      '10x': 1.15,
      '20x': 1.2,
    };
    return byOdds[rules.odds] + (rules.field12Pays === 3 ? 0.05 : 0);
  },

  spotEdge: crapsSpotEdge,

  guestBets(rules, unit, rng) {
    const stake = clampBet(rules, unit);
    const r = rng.next();
    // Most of the rail plays the line; a few lay against it; the rest add a
    // prop or place bet beside their line bet — which is where craps earns.
    if (r < 0.55) return [{ spot: 'pass', amount: stake }];
    if (r < 0.65) return [{ spot: 'dontPass', amount: stake }];
    if (r < 0.8)
      return [
        { spot: 'pass', amount: stake },
        { spot: 'place:6', amount: stake },
      ];
    if (r < 0.9)
      return [
        { spot: 'pass', amount: stake },
        { spot: 'field', amount: stake },
      ];
    return [
      { spot: 'pass', amount: stake },
      { spot: 'hard:8', amount: clampBet(rules, stake / 3) },
    ];
  },
};
