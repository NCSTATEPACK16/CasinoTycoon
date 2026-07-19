// The books: revenue/expense accumulation, hourly samples for graphs, and the
// midnight daily-profit rollup. Pure data — the world decides when to close.

export interface DailyRecord {
  day: number;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface HourlySample {
  day: number;
  hour: number;
  revenue: number;
  expenses: number;
  guests: number;
}

export interface LedgerJSON {
  todayRevenue: number;
  todayExpenses: number;
  hourRevenue: number;
  hourExpenses: number;
  history: DailyRecord[];
  hourly: HourlySample[];
}

const MAX_DAILY_RECORDS = 60;
const MAX_HOURLY_SAMPLES = 7 * 24;

export class Ledger {
  todayRevenue = 0;
  todayExpenses = 0;
  history: DailyRecord[] = [];
  hourly: HourlySample[] = [];
  private hourRevenue = 0;
  private hourExpenses = 0;

  /** Negative amounts are fine — a jackpot payout is negative revenue. */
  addRevenue(amount: number): void {
    this.todayRevenue += amount;
    this.hourRevenue += amount;
  }

  addExpense(amount: number): void {
    this.todayExpenses += amount;
    this.hourExpenses += amount;
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
    const record: DailyRecord = {
      day,
      revenue: this.todayRevenue,
      expenses: this.todayExpenses,
      profit: this.todayRevenue - this.todayExpenses,
    };
    this.history.push(record);
    if (this.history.length > MAX_DAILY_RECORDS) this.history.shift();
    this.todayRevenue = 0;
    this.todayExpenses = 0;
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
    };
  }

  static fromJSON(data: LedgerJSON): Ledger {
    const ledger = new Ledger();
    ledger.todayRevenue = data.todayRevenue;
    ledger.todayExpenses = data.todayExpenses;
    ledger.hourRevenue = data.hourRevenue;
    ledger.hourExpenses = data.hourExpenses;
    ledger.history = data.history.map((r) => ({ ...r }));
    ledger.hourly = data.hourly.map((s) => ({ ...s }));
    return ledger;
  }
}
