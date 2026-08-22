import { eventBus } from '../../EventBus';
import type { CampaignDef } from '../../data/campaigns';
import type { DailyRecord } from '../economy';

// Evaluates one campaign run against the daily rollup. The world calls
// onDayEnded after closing each day's books.

export type ScenarioStatus = 'active' | 'won' | 'failed';

// P16: two ways to lose. The UI reads this to say which one happened.
export type ScenarioFailReason = 'timeUp' | 'insolvent';

export interface ScenarioJSON {
  def: CampaignDef;
  status: ScenarioStatus;
  bestDailyProfit: number | null;
  recentProfits: number[];
}

export class ScenarioManager {
  readonly def: CampaignDef;
  status: ScenarioStatus = 'active';
  bestDailyProfit: number | null = null;
  // P16: a win is something you sustain, measured as an average rather than a
  // run of qualifying days. The last goalWindowDays closes, oldest first.
  recentProfits: number[] = [];
  // P16: fail() needs a day number for its own emit, but insolvency is
  // discovered outside onDayEnded (after liquidation runs) — so it is
  // tracked here rather than threaded through as a parameter.
  private lastClosedDay = 0;

  constructor(def: CampaignDef) {
    this.def = def;
  }

  isAllowed(defId: string): boolean {
    return !this.def.allowedObjects || this.def.allowedObjects.includes(defId);
  }

  /** Mean profit across the window so far. Null until a day has closed. */
  get windowAverage(): number | null {
    if (this.recentProfits.length === 0) return null;
    return this.recentProfits.reduce((a, b) => a + b, 0) / this.recentProfits.length;
  }

  /** True once the window is both full and averaging at or above the goal. */
  private get windowClearsGoal(): boolean {
    if (this.recentProfits.length < this.def.goalWindowDays) return false;
    return (this.windowAverage ?? 0) >= this.def.goalDailyProfit;
  }

  onDayEnded(record: DailyRecord): void {
    if (this.status !== 'active') return;
    this.lastClosedDay = record.day;
    this.bestDailyProfit =
      this.bestDailyProfit === null ? record.profit : Math.max(this.bestDailyProfit, record.profit);
    // A run of qualifying days was a test of luck as much as of management: with
    // a high-variance daily profit, "N days running" is waiting for N heads in a
    // row. Averaging over the window is what lets a steady casino beat a lucky
    // one — and it accepts, deliberately, that one day at N times the goal
    // carries the window. That is a good day, not an outlier to be filtered.
    this.recentProfits.push(record.profit);
    if (this.recentProfits.length > this.def.goalWindowDays) this.recentProfits.shift();
    if (this.windowClearsGoal) {
      this.status = 'won';
      eventBus.emit('goalReached', {
        campaignId: this.def.id,
        day: record.day,
        profit: record.profit,
      });
      eventBus.emit('tickerMessage', { text: `Goal reached — ${this.def.name} is a triumph!` });
    } else if (record.day >= this.def.dayLimit) {
      this.fail('timeUp');
    }
  }

  /** End the run as a loss. Idempotent: a scenario already decided stays decided. */
  fail(reason: ScenarioFailReason): void {
    if (this.status !== 'active') return;
    this.status = 'failed';
    eventBus.emit('scenarioFailed', { campaignId: this.def.id, day: this.lastClosedDay, reason });
    eventBus.emit('tickerMessage', {
      text:
        reason === 'insolvent'
          ? `The bank has called it — ${this.def.name} is insolvent.`
          : `Time's up — ${this.def.name} folds.`,
      severity: 'alert',
    });
  }

  toJSON(): ScenarioJSON {
    return {
      def: { ...this.def },
      status: this.status,
      bestDailyProfit: this.bestDailyProfit,
      recentProfits: [...this.recentProfits],
    };
  }

  static fromJSON(data: ScenarioJSON): ScenarioManager {
    const sm = new ScenarioManager(data.def);
    sm.status = data.status;
    sm.bestDailyProfit = data.bestDailyProfit;
    sm.recentProfits = [...(data.recentProfits ?? [])];
    return sm;
  }
}
