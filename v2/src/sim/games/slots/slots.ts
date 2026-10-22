// The slot engine: one spin of a par sheet at a denomination and credit count.

import type { BaseRules, Round, RoundResult, RngLike } from '../../../shared/games';
import { asRecord, readChoice, readNumber, type CasinoEngine, type RulesIssue } from '../types';
import { spinSheet, type SpinOutcome } from './parSheet';
import { DEFAULT_SHEET, PAR_SHEETS } from './sheets';

export const DENOMINATIONS = [0.01, 0.25, 1, 5] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export interface SlotRules extends BaseRules {
  /** Par sheet id from PAR_SHEETS. */
  sheet: string;
  denomination: Denomination;
  /** Credits played per spin: total bet = denomination × credits. */
  credits: number;
}

/** A slot's bet is fixed by its denomination and credits, so min = max = that bet. */
export function slotBet(rules: Pick<SlotRules, 'denomination' | 'credits'>): number {
  return Math.round(rules.denomination * rules.credits * 100) / 100;
}

export interface SlotView {
  sheet: string;
  bet: number;
  outcome: SpinOutcome | null;
}

class SlotRound implements Round {
  private outcome: SpinOutcome | null = null;
  private settled: RoundResult | null = null;

  constructor(
    private readonly rng: RngLike,
    private readonly rules: SlotRules,
    private readonly bet: number,
  ) {}

  options(): string[] | null {
    return this.settled ? null : ['spin'];
  }

  act(action: string): void {
    if (this.settled || action !== 'spin') return;
    const sheet = PAR_SHEETS[this.rules.sheet]!;
    const o = spinSheet(sheet, () => this.rng.next());
    this.outcome = o;
    const returned = Math.round(this.bet * o.multiplier * 100) / 100;
    this.settled = {
      wagered: this.bet,
      returned,
      summary:
        returned > 0
          ? `pays ${o.multiplier.toFixed(2)}× (${o.lineWins.length} line${o.lineWins.length === 1 ? '' : 's'}${o.scatterCount >= 3 ? `, ${o.scatterCount} scatters` : ''})`
          : 'no win',
      detail: o,
    };
  }

  view(): SlotView {
    return { sheet: this.rules.sheet, bet: this.bet, outcome: this.outcome };
  }

  result(): RoundResult | null {
    return this.settled;
  }
}

function makeRules(sheet: string, denomination: Denomination, credits: number): SlotRules {
  const bet = slotBet({ denomination, credits });
  return { sheet, denomination, credits, minBet: bet, maxBet: bet };
}

export const slotsEngine: CasinoEngine<SlotRules> = {
  kind: 'slots',

  defaultRules: () => makeRules(DEFAULT_SHEET, 0.25, 40),

  validateRules(raw, base = slotsEngine.defaultRules()) {
    const src = asRecord(raw);
    const issues: RulesIssue[] = [];
    const sheet = readChoice(src, 'sheet', base.sheet, Object.keys(PAR_SHEETS), issues);
    const denomination = readChoice(src, 'denomination', base.denomination, DENOMINATIONS, issues);
    const credits = Math.round(readNumber(src, 'credits', base.credits, 1, 500, issues));
    return { rules: makeRules(sheet, denomination, credits), issues };
  },

  theoreticalEdge(rules) {
    // The filed RTP, which parSheet.test.ts proves equal to the enumerated one.
    // Enumerating here would stall the worker for seconds on a 5-reel sheet.
    return 1 - PAR_SHEETS[rules.sheet]!.rtp;
  },

  roundsPerHour(rules) {
    return PAR_SHEETS[rules.sheet]!.spinsPerHour;
  },

  begin(rng, rules, bets) {
    // The machine sets the bet; a requested stake only matters if it matches.
    void bets;
    return new SlotRound(rng, rules, slotBet(rules));
  },

  strategy(_view, options) {
    return options[0]!;
  },

  appeal(rules) {
    // Locals talk about which machines are loose. Each RTP point is worth
    // about 4% of appeal: 88% reads as tight (0.84), 97% as loose (1.2).
    const rtp = PAR_SHEETS[rules.sheet]!.rtp;
    return Math.min(1.5, Math.max(0.5, 1 + (rtp - 0.92) * 4));
  },

  spotEdge(rules, spot) {
    return spot === 'spin' ? slotsEngine.theoreticalEdge(rules) : 0;
  },

  guestBets(rules) {
    return [{ spot: 'spin', amount: slotBet(rules) }];
  },
};
