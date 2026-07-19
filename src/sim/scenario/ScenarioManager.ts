import { eventBus } from '../../EventBus';
import type { CampaignDef } from '../../data/campaigns';
import type { DailyRecord } from '../economy';

// Evaluates one campaign run against the daily rollup. The world calls
// onDayEnded after closing each day's books.

export type ScenarioStatus = 'active' | 'won' | 'failed';

export interface ScenarioJSON {
  def: CampaignDef;
  status: ScenarioStatus;
  bestDailyProfit: number | null;
}

export class ScenarioManager {
  readonly def: CampaignDef;
  status: ScenarioStatus = 'active';
  bestDailyProfit: number | null = null;

  constructor(def: CampaignDef) {
    this.def = def;
  }

  isAllowed(defId: string): boolean {
    return !this.def.allowedObjects || this.def.allowedObjects.includes(defId);
  }

  onDayEnded(record: DailyRecord): void {
    if (this.status !== 'active') return;
    this.bestDailyProfit =
      this.bestDailyProfit === null ? record.profit : Math.max(this.bestDailyProfit, record.profit);
    if (record.profit >= this.def.goalDailyProfit) {
      this.status = 'won';
      eventBus.emit('goalReached', {
        campaignId: this.def.id,
        day: record.day,
        profit: record.profit,
      });
      eventBus.emit('tickerMessage', { text: `Goal reached — ${this.def.name} is a triumph!` });
    } else if (record.day >= this.def.dayLimit) {
      this.status = 'failed';
      eventBus.emit('scenarioFailed', { campaignId: this.def.id, day: record.day });
      eventBus.emit('tickerMessage', { text: `Time's up — ${this.def.name} folds.` });
    }
  }

  toJSON(): ScenarioJSON {
    return { def: { ...this.def }, status: this.status, bestDailyProfit: this.bestDailyProfit };
  }

  static fromJSON(data: ScenarioJSON): ScenarioManager {
    const sm = new ScenarioManager(data.def);
    sm.status = data.status;
    sm.bestDailyProfit = data.bestDailyProfit;
    return sm;
  }
}
