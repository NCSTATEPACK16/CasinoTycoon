import { eventBus } from '../../EventBus';
import { goalsOf, type CampaignDef } from '../../data/campaigns';
import {
  evaluateGoal,
  windowDays,
  type Goal,
  type GoalFacts,
  type GoalProgress,
} from '../../data/campaigns/goals';
import type { DailyRecord } from '../economy';
import { gamingLine, HOUSE_IDS, isGaming } from '../economy/financials';

// Evaluates one campaign run against the daily rollup. The world calls
// onDayEnded after closing each day's books.

export type ScenarioStatus = 'active' | 'won' | 'failed' | 'endless';

// P16: two ways to lose. The UI reads this to say which one happened.
export type ScenarioFailReason = 'timeUp' | 'insolvent';

export interface ScenarioJSON {
  def: CampaignDef;
  status: ScenarioStatus;
  bestDailyProfit: number | null;
  recentProfits: number[];
  /** B8 (absent in older saves): the games' handle and win per recent day,
   *  the most guests seen at once, and the day the run was won. */
  recentPlay?: { handle: number; win: number }[];
  peakGuests?: number;
  wonOnDay?: number | null;
}

/** B8: what the world knows at a close (or right now, for the HUD) that the
 *  scenario doesn't keep itself. Absent = nothing beyond the books, which is
 *  all the P16 profit rule needs. */
export type WorldFacts = Pick<GoalFacts, 'rating' | 'patrons' | 'highLimitGames' | 'debt' | 'cash'>;

const NO_FACTS: WorldFacts = {
  rating: 0,
  patrons: { silver: 0, gold: 0, black: 0 },
  highLimitGames: 0,
  debt: 0,
  cash: 0,
};

export class ScenarioManager {
  readonly def: CampaignDef;
  status: ScenarioStatus = 'active';
  bestDailyProfit: number | null = null;
  // P16: a win is something you sustain, measured as an average rather than a
  // run of qualifying days. The last goalWindowDays closes, oldest first.
  recentProfits: number[] = [];
  /** B8: the games' handle and win per closed day, on the same window. */
  recentPlay: { handle: number; win: number }[] = [];
  /** B8: the most guests on the floor at once, read at each hour. */
  peakGuests = 0;
  /** B8: the close that won the run, for the medal and the score. */
  wonOnDay: number | null = null;
  readonly goals: readonly Goal[];
  private readonly window: number;
  // P16: fail() needs a day number for its own emit, but insolvency is
  // discovered outside onDayEnded (after liquidation runs) — so it is
  // tracked here rather than threaded through as a parameter.
  private lastClosedDay = 0;

  constructor(def: CampaignDef) {
    this.def = def;
    this.goals = goalsOf(def);
    this.window = windowDays(this.goals);
    // Sandbox has nothing to win: it is the post-victory free play from the
    // first day, with the bank still watching (at a limit nobody reaches).
    // The tutorial is the same: its steps live in the UI, not in a goal.
    if (def.sandbox || def.tutorial) this.status = 'endless';
  }

  isAllowed(defId: string): boolean {
    if (this.status === 'endless') return true;
    return !this.def.allowedObjects || this.def.allowedObjects.includes(defId);
  }

  /** Moves a completed run into unrestricted, un-timed play. Only meaningful
   *  from 'won' — calling it on a run that hasn't won, or twice, is a no-op. */
  continue(): void {
    if (this.status !== 'won') return;
    this.status = 'endless';
  }

  /** Mean profit across the window so far. Null until a day has closed. */
  get windowAverage(): number | null {
    if (this.recentProfits.length === 0) return null;
    return this.recentProfits.reduce((a, b) => a + b, 0) / this.recentProfits.length;
  }

  /** B8: an hour's head count, for "N guests at once". */
  observeGuests(count: number): void {
    if (count > this.peakGuests) this.peakGuests = count;
  }

  /** Every goal against the books so far and the world's facts. */
  progress(world: WorldFacts = NO_FACTS): GoalProgress[] {
    const facts: GoalFacts = {
      ...world,
      profits: this.recentProfits,
      bestDailyProfit: this.bestDailyProfit,
      play: this.recentPlay,
      peakGuests: this.peakGuests,
    };
    return this.goals.map((g) => evaluateGoal(g, facts));
  }

  onDayEnded(record: DailyRecord, world?: WorldFacts): void {
    if (this.status === 'endless') {
      this.lastClosedDay = record.day;
      this.bestDailyProfit =
        this.bestDailyProfit === null
          ? record.profit
          : Math.max(this.bestDailyProfit, record.profit);
      return;
    }
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
    if (this.recentProfits.length > this.window) this.recentProfits.shift();
    const games = gamingLine(
      (record.sources ?? []).filter((r) => !HOUSE_IDS.has(r.id) && isGaming(r)),
    );
    this.recentPlay.push({ handle: games.handle, win: games.win });
    if (this.recentPlay.length > this.window) this.recentPlay.shift();
    // B8: every goal at once, at this close.
    if (this.progress(world ?? NO_FACTS).every((p) => p.met)) {
      this.status = 'won';
      this.wonOnDay = record.day;
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

  /** End the run as a loss. Idempotent: a scenario already decided (won and
   *  not continued, or already failed) stays decided. Endless is not decided
   *  — continuation keeps the fail state live, which is the entire point of
   *  A1: the bank still calls it, the goal just doesn't. */
  fail(reason: ScenarioFailReason): void {
    if (this.status !== 'active' && this.status !== 'endless') return;
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
      recentPlay: this.recentPlay.map((d) => ({ ...d })),
      peakGuests: this.peakGuests,
      wonOnDay: this.wonOnDay,
    };
  }

  static fromJSON(data: ScenarioJSON): ScenarioManager {
    const sm = new ScenarioManager(data.def);
    sm.status = data.status;
    sm.bestDailyProfit = data.bestDailyProfit;
    sm.recentProfits = [...(data.recentProfits ?? [])];
    sm.recentPlay = (data.recentPlay ?? []).map((d) => ({ ...d }));
    sm.peakGuests = data.peakGuests ?? 0;
    sm.wonOnDay = data.wonOnDay ?? null;
    return sm;
  }
}
