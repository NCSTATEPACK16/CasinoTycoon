// CasinoFinancials: the P&L a casino CFO reads, derived from the Ledger. Pure
// and read-only — the lead's P&L panel calls casinoFinancials(world.ledger)
// and renders the result.
//
// Gaming figures follow industry usage: handle is money wagered, win is the
// house's net (handle − paid out), hold% = win / handle, theo = Σ edge × the
// opening wagers. Win above theo is player error plus luck; below it, luck.

import { HOUSE_SOURCES, type DailyRecord, type Ledger, type SourceRecord } from '../economy';

export interface GamingLine {
  handle: number;
  win: number;
  /** win / handle, or null with no handle. */
  hold: number | null;
  theo: number;
  rounds: number;
  /** Occupied seat-time / available seat-time, or null with no capacity. */
  occupancy: number | null;
}

export interface PeriodPnl {
  /** Label for the panel: 'Today', 'Yesterday', 'Last 7 days'. */
  label: string;
  days: number;
  gaming: GamingLine;
  /** Food stalls and bars, net of their own payouts. */
  foodAndBeverage: number;
  /** Cashier fees and other house income. */
  otherRevenue: number;
  wages: number;
  comps: number;
  upkeep: number;
  /** Fines and interest. */
  otherExpenses: number;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface GameBreakdown extends GamingLine {
  defId: string;
  objects: number;
  /** Net contribution after the objects' own upkeep. */
  net: number;
}

export interface CasinoFinancials {
  today: PeriodPnl;
  yesterday: PeriodPnl | null;
  last7: PeriodPnl;
  /** Today's gaming by game type, highest win first. */
  byGame: GameBreakdown[];
  /** Today's casino-wide hours so far, oldest first. */
  hours: { hour: number; revenue: number; expenses: number; handle: number; theo: number }[];
  /** The avatar's own play today: the player's side of the book. */
  player: { wagered: number; returned: number; rounds: number };
}

const FNB = new Set(['food-stall', 'bar']);
const HOUSE_IDS = new Set<string>(Object.values(HOUSE_SOURCES).map((h) => h.id));

const isGaming = (r: SourceRecord): boolean => r.wagered > 0 || r.rounds > 0 || r.capacityTicks > 0;

function gamingLine(rows: readonly SourceRecord[]): GamingLine {
  let handle = 0;
  let won = 0;
  let theo = 0;
  let rounds = 0;
  let occ = 0;
  let cap = 0;
  for (const r of rows) {
    handle += r.wagered;
    won += r.won;
    theo += r.theo;
    rounds += r.rounds;
    occ += r.occupiedTicks;
    cap += r.capacityTicks;
  }
  const win = handle - won;
  return {
    handle,
    win,
    hold: handle > 0 ? win / handle : null,
    theo,
    rounds,
    occupancy: cap > 0 ? occ / cap : null,
  };
}

function pnl(
  label: string,
  days: number,
  rows: readonly SourceRecord[],
  revenue: number,
  expenses: number,
): PeriodPnl {
  const gamingRows = rows.filter((r) => !HOUSE_IDS.has(r.id) && isGaming(r));
  const sumOf = (pred: (r: SourceRecord) => boolean, k: 'revenue' | 'upkeep') =>
    rows.filter(pred).reduce((a, r) => a + r[k], 0);
  const gaming = gamingLine(gamingRows);
  const foodAndBeverage = sumOf((r) => FNB.has(r.defId), 'revenue');
  const wages = sumOf((r) => r.id === HOUSE_SOURCES.wages.id, 'upkeep');
  const comps = sumOf((r) => r.id === HOUSE_SOURCES.comps.id, 'upkeep');
  const otherExpenses = sumOf(
    (r) => r.id === HOUSE_SOURCES.fines.id || r.id === HOUSE_SOURCES.interest.id,
    'upkeep',
  );
  const upkeep = sumOf((r) => !HOUSE_IDS.has(r.id), 'upkeep');
  return {
    label,
    days,
    gaming,
    foodAndBeverage,
    otherRevenue: revenue - gaming.win - foodAndBeverage,
    wages,
    comps,
    upkeep,
    otherExpenses,
    revenue,
    expenses,
    profit: revenue - expenses,
  };
}

function fromRecords(label: string, records: readonly DailyRecord[]): PeriodPnl {
  return pnl(
    label,
    records.length,
    records.flatMap((r) => r.sources),
    records.reduce((a, r) => a + r.revenue, 0),
    records.reduce((a, r) => a + r.expenses, 0),
  );
}

export function casinoFinancials(ledger: Ledger): CasinoFinancials {
  const live = [...ledger.sources.values()];
  const today = pnl('Today', 1, live, ledger.todayRevenue, ledger.todayExpenses);
  const last = ledger.history.at(-1);
  const week = ledger.history.slice(-6);

  const byDef = new Map<string, SourceRecord[]>();
  for (const r of live) {
    if (HOUSE_IDS.has(r.id) || !isGaming(r)) continue;
    const list = byDef.get(r.defId) ?? [];
    list.push(r);
    byDef.set(r.defId, list);
  }
  const byGame: GameBreakdown[] = [...byDef].map(([defId, rows]) => ({
    defId,
    objects: rows.length,
    ...gamingLine(rows),
    net: rows.reduce((a, r) => a + r.revenue - r.upkeep, 0),
  }));
  byGame.sort((a, b) => b.win - a.win);

  // The week is the last six closed days plus today.
  const weekRows = [...week.flatMap((r) => r.sources), ...live];
  const last7 = pnl(
    'Last 7 days',
    week.length + 1,
    weekRows,
    week.reduce((a, r) => a + r.revenue, 0) + ledger.todayRevenue,
    week.reduce((a, r) => a + r.expenses, 0) + ledger.todayExpenses,
  );

  const currentDay = last ? last.day + 1 : null;
  const hours = ledger.hourly
    .filter((h) => currentDay === null || h.day === currentDay)
    .map((h) => ({
      hour: h.hour,
      revenue: h.revenue,
      expenses: h.expenses,
      handle: h.wagered ?? 0,
      theo: h.theo ?? 0,
    }));

  return {
    today,
    yesterday: last ? fromRecords('Yesterday', [last]) : null,
    last7,
    byGame,
    hours,
    player: { ...ledger.todayPlayer },
  };
}
