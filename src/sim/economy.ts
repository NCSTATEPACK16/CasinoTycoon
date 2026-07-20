// The books: revenue/expense accumulation, hourly samples for graphs, and the
// midnight daily-profit rollup. Pure data — the world decides when to close.

export interface WinnerLoserEntry {
  name: string;
  net: number;
  favoriteGame: string;
}

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
  daySessions?: GuestSession[];
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
  private daySessions: GuestSession[] = [];

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

  closeDay(day: number): DailyRecord {
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
    this.daySessions = [];
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
      daySessions: [...this.daySessions],
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
    }));
    ledger.hourly = data.hourly.map((s) => ({ ...s }));
    ledger.dayPaidOut = data.dayPaidOut ?? 0;
    ledger.dayTakenIn = data.dayTakenIn ?? 0;
    ledger.dayGuestCount = data.dayGuestCount ?? 0;
    ledger.dayJackpotCount = data.dayJackpotCount ?? 0;
    ledger.dayRageQuitCount = data.dayRageQuitCount ?? 0;
    ledger.daySessions = data.daySessions ? data.daySessions.map((s) => ({ ...s })) : [];
    return ledger;
  }
}
