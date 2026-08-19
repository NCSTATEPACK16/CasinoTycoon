// The books: revenue/expense accumulation, hourly samples for graphs, and the
// midnight daily-profit rollup. Pure data — the world decides when to close.

export interface WinnerLoserEntry {
  name: string;
  net: number;
  favoriteGame: string;
}

/**
 * P1 — what one source earned and cost in a day.
 *
 * `revenue` is net of payouts, so a machine that got hit hard reports a
 * negative day. `wagered`/`won` sit alongside it because handle and hold are
 * different questions: a table with huge volume and thin margin and a quiet
 * table with the same net are not the same object to reason about.
 */
export interface SourceTotals {
  wagered: number;
  won: number;
  revenue: number;
  upkeep: number;
}

export interface SourceRecord extends SourceTotals {
  id: string;
  /** Catalog defId for a placed object, or a synthetic kind for the costs that
   *  belong to no object — wages, comps, fines. Those are real money, and
   *  hiding them would leave the drill-down unable to reconcile with the day. */
  defId: string;
}

/** Synthetic source ids for money that belongs to the house, not an object. */
export const HOUSE_SOURCES = {
  wages: { id: 'house:wages', defId: 'wages' },
  comps: { id: 'house:comps', defId: 'comps' },
  fines: { id: 'house:fines', defId: 'fines' },
} as const;

const emptyTotals = (): SourceTotals => ({ wagered: 0, won: 0, revenue: 0, upkeep: 0 });

export interface DailyRecord {
  day: number;
  revenue: number;
  expenses: number;
  profit: number;
  winners: WinnerLoserEntry[];
  losers: WinnerLoserEntry[];
  paidOut: number;
  takenIn: number;
  guestCount: number;
  jackpotCount: number;
  rageQuitCount: number;
  /** A1a: comp dollars issued today. Already counted inside `expenses` — this
   *  breaks out how much of the day's cost was reinvestment. */
  compSpend: number;
  /** A12: reputation after this day's roll, and the movement that produced it. */
  reputation: number;
  reputationDelta: number;
  /** A5: ids of the conditions that were in force for this day. */
  modifierIds: string[];
  /** P1: the day's takings broken out by where they came from. */
  sources: SourceRecord[];
}

export interface HourlySample {
  day: number;
  hour: number;
  revenue: number;
  expenses: number;
  guests: number;
}

interface GuestSession {
  name: string;
  netResult: number;
  favoriteGame: string | null;
}

export interface LedgerJSON {
  todayRevenue: number;
  todayExpenses: number;
  hourRevenue: number;
  hourExpenses: number;
  history: DailyRecord[];
  hourly: HourlySample[];
  dayPaidOut?: number;
  dayTakenIn?: number;
  dayGuestCount?: number;
  dayJackpotCount?: number;
  dayRageQuitCount?: number;
  dayCompSpend?: number;
  daySessions?: GuestSession[];
  daySources?: SourceRecord[];
}

/** Day-close facts the ledger records but does not own. Passed in rather than
 *  wired as dependencies so the Ledger stays a pure book. */
export interface DayCloseContext {
  reputation?: number;
  reputationDelta?: number;
  modifierIds?: string[];
}

const MAX_DAILY_RECORDS = 60;
const MAX_HOURLY_SAMPLES = 7 * 24;
const TOP_N = 5;

export class Ledger {
  todayRevenue = 0;
  todayExpenses = 0;
  history: DailyRecord[] = [];
  hourly: HourlySample[] = [];
  private hourRevenue = 0;
  private hourExpenses = 0;
  private dayPaidOut = 0;
  private dayTakenIn = 0;
  private dayGuestCount = 0;
  private dayJackpotCount = 0;
  private dayRageQuitCount = 0;
  private dayCompSpend = 0;
  private daySessions: GuestSession[] = [];
  /** Live per-source accrual for the day in progress. Written at the same
   *  moment as addRevenue/addExpense rather than through a parallel path —
   *  two ways to book the same dollar is how books stop reconciling. */
  private daySources = new Map<string, SourceRecord>();

  /**
   * Attribute money to a source. Every caller that moves cash names where it
   * came from, so the day's total is the sum of its parts by construction.
   */
  accrue(id: string, defId: string, delta: Partial<SourceTotals>): void {
    let row = this.daySources.get(id);
    if (!row) {
      row = { id, defId, ...emptyTotals() };
      this.daySources.set(id, row);
    }
    row.wagered += delta.wagered ?? 0;
    row.won += delta.won ?? 0;
    row.revenue += delta.revenue ?? 0;
    row.upkeep += delta.upkeep ?? 0;
  }

  /** Live day-to-date attribution, for the profit overlay and for a drill-down
   *  on a day still in progress. */
  get sources(): ReadonlyMap<string, SourceRecord> {
    return this.daySources;
  }

  /** Net contribution of one source so far today, or null if it has none. */
  netForSource(id: string): number | null {
    const row = this.daySources.get(id);
    return row ? row.revenue - row.upkeep : null;
  }

  /** Negative amounts are fine — a jackpot payout is negative revenue. */
  addRevenue(amount: number): void {
    this.todayRevenue += amount;
    this.hourRevenue += amount;
  }

  addExpense(amount: number): void {
    this.todayExpenses += amount;
    this.hourExpenses += amount;
  }

  /** One machine play: feeds the paid-out/taken-in daily totals. */
  recordPlay(wager: number, payout: number): void {
    this.dayTakenIn += wager;
    this.dayPaidOut += payout;
  }

  recordJackpot(): void {
    this.dayJackpotCount++;
  }

  recordRageQuit(): void {
    this.dayRageQuitCount++;
  }

  /** A comp issued to a guest: a real expense, tracked separately so the daily
   *  report can show reinvestment rather than burying it in overheads. */
  addComp(amount: number): void {
    if (amount <= 0) return;
    this.dayCompSpend += amount;
    this.addExpense(amount);
  }

  /** Comp dollars issued so far today — the live figure the dial's readout
   *  needs, since `closeDay` is the only other place it surfaces. */
  get todayCompSpend(): number {
    return this.dayCompSpend;
  }

  /** A guest's session folds in here on leave or at midnight. */
  recordGuestSession(session: GuestSession): void {
    this.daySessions.push(session);
    this.dayGuestCount++;
  }

  /** Close the hour that just completed (labeled with its own day/hour). */
  closeHour(day: number, hour: number, guests: number): void {
    this.hourly.push({
      day,
      hour,
      revenue: this.hourRevenue,
      expenses: this.hourExpenses,
      guests,
    });
    if (this.hourly.length > MAX_HOURLY_SAMPLES) this.hourly.shift();
    this.hourRevenue = 0;
    this.hourExpenses = 0;
  }

  closeDay(day: number, ctx: DayCloseContext = {}): DailyRecord {
    const sorted = [...this.daySessions].sort((a, b) => b.netResult - a.netResult);
    const toEntry = (s: GuestSession): WinnerLoserEntry => ({
      name: s.name,
      net: s.netResult,
      favoriteGame: s.favoriteGame ?? '—',
    });
    // Winners: the top-N sessions by net result, whatever the sign.
    // Losers: the worst negative sessions among what's left, ranked lowest-first.
    const winners = sorted.slice(0, TOP_N);
    const losers = sorted
      .slice(TOP_N)
      .filter((s) => s.netResult < 0)
      .reverse();
    const record: DailyRecord = {
      day,
      revenue: this.todayRevenue,
      expenses: this.todayExpenses,
      profit: this.todayRevenue - this.todayExpenses,
      winners: winners.map(toEntry),
      losers: losers.slice(0, TOP_N).map(toEntry),
      paidOut: this.dayPaidOut,
      takenIn: this.dayTakenIn,
      guestCount: this.dayGuestCount,
      jackpotCount: this.dayJackpotCount,
      rageQuitCount: this.dayRageQuitCount,
      compSpend: this.dayCompSpend,
      reputation: ctx.reputation ?? 0,
      reputationDelta: ctx.reputationDelta ?? 0,
      modifierIds: ctx.modifierIds ?? [],
      sources: [...this.daySources.values()].map((r) => ({ ...r })),
    };
    this.history.push(record);
    if (this.history.length > MAX_DAILY_RECORDS) this.history.shift();
    this.todayRevenue = 0;
    this.todayExpenses = 0;
    this.dayPaidOut = 0;
    this.dayTakenIn = 0;
    this.dayGuestCount = 0;
    this.dayJackpotCount = 0;
    this.dayRageQuitCount = 0;
    this.dayCompSpend = 0;
    this.daySessions = [];
    this.daySources.clear();
    return record;
  }

  get bestDailyProfit(): number | null {
    if (this.history.length === 0) return null;
    return Math.max(...this.history.map((r) => r.profit));
  }

  toJSON(): LedgerJSON {
    return {
      todayRevenue: this.todayRevenue,
      todayExpenses: this.todayExpenses,
      hourRevenue: this.hourRevenue,
      hourExpenses: this.hourExpenses,
      history: [...this.history],
      hourly: [...this.hourly],
      dayPaidOut: this.dayPaidOut,
      dayTakenIn: this.dayTakenIn,
      dayGuestCount: this.dayGuestCount,
      dayJackpotCount: this.dayJackpotCount,
      dayRageQuitCount: this.dayRageQuitCount,
      dayCompSpend: this.dayCompSpend,
      daySessions: [...this.daySessions],
      daySources: [...this.daySources.values()].map((r) => ({ ...r })),
    };
  }

  static fromJSON(data: LedgerJSON): Ledger {
    const ledger = new Ledger();
    ledger.todayRevenue = data.todayRevenue;
    ledger.todayExpenses = data.todayExpenses;
    ledger.hourRevenue = data.hourRevenue;
    ledger.hourExpenses = data.hourExpenses;
    ledger.history = data.history.map((r) => ({
      ...r,
      winners: r.winners ?? [],
      losers: r.losers ?? [],
      paidOut: r.paidOut ?? 0,
      takenIn: r.takenIn ?? 0,
      guestCount: r.guestCount ?? 0,
      jackpotCount: r.jackpotCount ?? 0,
      rageQuitCount: r.rageQuitCount ?? 0,
      compSpend: r.compSpend ?? 0,
      reputation: r.reputation ?? 0,
      reputationDelta: r.reputationDelta ?? 0,
      modifierIds: r.modifierIds ?? [],
      sources: r.sources ?? [],
    }));
    ledger.hourly = data.hourly.map((s) => ({ ...s }));
    ledger.dayPaidOut = data.dayPaidOut ?? 0;
    ledger.dayTakenIn = data.dayTakenIn ?? 0;
    ledger.dayGuestCount = data.dayGuestCount ?? 0;
    ledger.dayJackpotCount = data.dayJackpotCount ?? 0;
    ledger.dayRageQuitCount = data.dayRageQuitCount ?? 0;
    ledger.dayCompSpend = data.dayCompSpend ?? 0;
    ledger.daySessions = data.daySessions ? data.daySessions.map((s) => ({ ...s })) : [];
    for (const row of data.daySources ?? []) ledger.daySources.set(row.id, { ...row });
    return ledger;
  }
}
