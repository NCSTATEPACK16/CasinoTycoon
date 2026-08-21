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
  consecutiveDaysAtGoal: number;
}

export class ScenarioManager {
  readonly def: CampaignDef;
  status: ScenarioStatus = 'active';
  bestDailyProfit: number | null = null;
  // P16: a win is something you sustain. Days *running* at or above goal.
  consecutiveDaysAtGoal = 0;
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

  onDayEnded(record: DailyRecord): void {
    if (this.status !== 'active') return;
    this.lastClosedDay = record.day;
    this.bestDailyProfit =
      this.bestDailyProfit === null ? record.profit : Math.max(this.bestDailyProfit, record.profit);
    if (record.profit >= this.def.goalDailyProfit) {
      this.consecutiveDaysAtGoal++;
    } else {
      // Reset rather than a rolling window: it reads to the player as "two
      // days running", and it cannot be satisfied by one outlier sitting
      // inside an averaging window.
      this.consecutiveDaysAtGoal = 0;
    }
    if (this.consecutiveDaysAtGoal >= this.def.goalConsecutiveDays) {
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
      consecutiveDaysAtGoal: this.consecutiveDaysAtGoal,
    };
  }

  static fromJSON(data: ScenarioJSON): ScenarioManager {
    const sm = new ScenarioManager(data.def);
    sm.status = data.status;
    sm.bestDailyProfit = data.bestDailyProfit;
    sm.consecutiveDaysAtGoal = data.consecutiveDaysAtGoal ?? 0;
    return sm;
  }
}
