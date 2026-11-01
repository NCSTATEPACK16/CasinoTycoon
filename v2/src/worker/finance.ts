// B4: finance depth for the Finances tab. Chart series from the ledger's
// history, the end-of-day report card, and the bank's loan offers. Pure
// functions of the world, like inspect.ts.

import { LOANS, MODIFIERS } from '../data/balance';
import { getObjectDef } from '../data/objects';
import { weekdayName } from '../data/traffic';
import type { DailyRecord, SourceRecord } from '../sim/economy';
import {
  fromRecords,
  gamingLine,
  HOUSE_IDS,
  isGaming,
  type PeriodPnl,
} from '../sim/economy/financials';
import { installmentFor, type Loan } from '../sim/economy/loans';
import type { CasinoWorld } from '../sim/world';

// ---------- chart series ----------

export interface FinancePoint {
  day: number;
  /** Present on hourly points. */
  hour?: number;
  revenue: number;
  expenses: number;
  profit: number;
  /** Money wagered at the games, and the games' win (handle − paid out). */
  handle: number;
  win: number;
  /** win / handle, or null with no handle. */
  hold: number | null;
  /** Hourly: guests on the floor at the hour's close. Daily: visits. */
  guests: number;
  /** Cash at the close, or null where an older save did not record it. */
  cash: number | null;
  /** The day still in progress (daily series only). */
  partial?: boolean;
}

export interface FinanceHistory {
  /** Up to a week of closed hours, oldest first. */
  hours: FinancePoint[];
  /** Up to 60 closed days, oldest first, then today so far. */
  days: FinancePoint[];
}

function dayGaming(sources: readonly SourceRecord[]) {
  return gamingLine(sources.filter((r) => !HOUSE_IDS.has(r.id) && isGaming(r)));
}

export function financeHistory(world: CasinoWorld): FinanceHistory {
  const hours: FinancePoint[] = world.ledger.hourly.map((h) => {
    const handle = h.wagered ?? 0;
    const win = h.gameWin ?? 0;
    return {
      day: h.day,
      hour: h.hour,
      revenue: h.revenue,
      expenses: h.expenses,
      profit: h.revenue - h.expenses,
      handle,
      win,
      hold: handle > 0 ? win / handle : null,
      guests: h.guests,
      cash: h.cash ?? null,
    };
  });
  const days: FinancePoint[] = world.ledger.history.map((r) => {
    const g = dayGaming(r.sources);
    return {
      day: r.day,
      revenue: r.revenue,
      expenses: r.expenses,
      profit: r.profit,
      handle: g.handle,
      win: g.win,
      hold: g.hold,
      guests: r.guestCount,
      cash: r.cash ?? null,
    };
  });
  const live = dayGaming([...world.ledger.sources.values()]);
  days.push({
    day: world.time.day,
    revenue: world.ledger.todayRevenue,
    expenses: world.ledger.todayExpenses,
    profit: world.ledger.todayRevenue - world.ledger.todayExpenses,
    handle: live.handle,
    win: live.win,
    hold: live.hold,
    guests: world.guests.size,
    cash: world.state.cash,
    partial: true,
  });
  return { hours, days };
}

// ---------- the end-of-day report card ----------

export interface GameResult {
  defId: string;
  name: string;
  /** Win after the games' own upkeep. */
  net: number;
  hold: number | null;
}

export interface DayReport {
  day: number;
  weekday: string;
  pnl: PeriodPnl;
  /** The day before, for comparison; null on the first day. */
  previousProfit: number | null;
  best: GameResult | null;
  /** Null unless at least two kinds of game played. */
  worst: GameResult | null;
  /** The rating at the close and its change since the day before. */
  rating: { value: number; delta: number | null } | null;
  reputation: { value: number; delta: number };
  guests: number;
  jackpots: number;
  rageQuits: number;
  comps: number;
  interest: { overdraft: number; loans: number };
  cash: number | null;
  debt: number | null;
  conditions: string[];
  winners: { name: string; net: number }[];
  losers: { name: string; net: number }[];
  /** Fines, forced sales, loans taken and paid off: what to remember. */
  notes: string[];
}

function gameResults(r: DailyRecord): GameResult[] {
  const byDef = new Map<string, SourceRecord[]>();
  for (const s of r.sources) {
    if (HOUSE_IDS.has(s.id) || !isGaming(s)) continue;
    byDef.set(s.defId, [...(byDef.get(s.defId) ?? []), s]);
  }
  return [...byDef].map(([defId, rows]) => ({
    defId,
    name: getObjectDef(defId)?.name ?? defId,
    net: rows.reduce((a, s) => a + s.revenue - s.upkeep, 0),
    hold: gamingLine(rows).hold,
  }));
}

/** The report for a closed day: the latest, or `day` if it is still kept. */
export function dayReport(world: CasinoWorld, day?: number): DayReport | null {
  const history = world.ledger.history;
  const i = day === undefined ? history.length - 1 : history.findIndex((r) => r.day === day);
  const r = history[i];
  if (!r) return null;
  const prev = i > 0 ? history[i - 1]! : null;
  const games = gameResults(r).sort((a, b) => b.net - a.net);
  const conditionName = (id: string) =>
    MODIFIERS.catalog.find((m) => m.id === id)?.name ?? id.replace(/-/g, ' ');
  const loans = r.loanInterest ?? 0;
  return {
    day: r.day,
    weekday: weekdayName(r.day),
    pnl: fromRecords(`Day ${r.day}`, [r]),
    previousProfit: prev ? prev.profit : null,
    best: games[0] ?? null,
    worst: games.length >= 2 ? games.at(-1)! : null,
    rating:
      r.rating === undefined
        ? null
        : {
            value: r.rating,
            delta: prev?.rating === undefined ? null : r.rating - prev.rating,
          },
    reputation: { value: r.reputation, delta: r.reputationDelta },
    guests: r.guestCount,
    jackpots: r.jackpotCount,
    rageQuits: r.rageQuitCount,
    comps: r.compSpend,
    interest: { overdraft: Math.max(0, r.interestPaid - loans), loans },
    cash: r.cash ?? null,
    debt: r.debt ?? null,
    conditions: r.modifierIds.map(conditionName),
    winners: r.winners.slice(0, 3).map((w) => ({ name: w.name, net: w.net })),
    losers: r.losers.slice(0, 3).map((w) => ({ name: w.name, net: w.net })),
    notes: [...(r.notes ?? [])],
  };
}

// ---------- loans ----------

export interface LoanOffer {
  days: number;
  rate: number;
  /** The daily installment and total interest if the whole available amount
   *  were borrowed on this term. */
  installment: number;
  totalInterest: number;
}

export interface LoansView {
  limit: number;
  outstanding: number;
  /** What can still be borrowed, in LOANS.step units. */
  available: number;
  step: number;
  cash: number;
  /** The overdraft's daily rate, for comparison. */
  overdraftRate: number;
  offers: LoanOffer[];
  loans: Loan[];
  /** Due at the next midnight across every loan. */
  dueTonight: number;
}

export function loansView(world: CasinoWorld, overdraftRate: number): LoansView {
  const outstanding = world.loans.outstanding;
  const step = LOANS.step;
  const available = Math.max(0, Math.floor((world.loanLimit - outstanding) / step) * step);
  const sample = available || step;
  return {
    limit: world.loanLimit,
    outstanding,
    available,
    step,
    cash: world.state.cash,
    overdraftRate,
    offers: LOANS.terms.map((t) => {
      const installment = installmentFor(sample, t.rate, t.days);
      return {
        days: t.days,
        rate: t.rate,
        installment,
        totalInterest: installment * t.days - sample,
      };
    }),
    loans: world.loans.loans.map((l) => ({ ...l })),
    dueTonight: world.loans.loans.reduce((a, l) => a + l.installment, 0),
  };
}
