import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import type { CampaignDef } from '../../data/campaigns';
import { ScenarioManager } from './ScenarioManager';

afterEach(() => eventBus.clear());

const DEF: CampaignDef = {
  id: 'test-run',
  name: 'Test Run',
  tagline: 'For the suite.',
  startingCash: 1000,
  goalDailyProfit: 500,
  dayLimit: 3,
  goalWindowDays: 1,
  creditLimit: 5000,
};

const record = (day: number, profit: number) => ({
  day,
  profit,
  revenue: profit,
  expenses: 0,
  winners: [],
  losers: [],
  paidOut: 0,
  takenIn: 0,
  guestCount: 0,
  jackpotCount: 0,
  rageQuitCount: 0,
  compSpend: 0,
  interestPaid: 0,
  reputation: 50,
  reputationDelta: 0,
  modifierIds: [],
  sources: [],
});

describe('ScenarioManager', () => {
  it('wins the moment a day closes at or above the goal', () => {
    const sm = new ScenarioManager(DEF);
    let won: { campaignId: string; day: number; profit: number } | null = null;
    eventBus.on('goalReached', (e) => (won = e));
    sm.onDayEnded(record(1, 120));
    expect(sm.status).toBe('active');
    sm.onDayEnded(record(2, 500));
    expect(sm.status).toBe('won');
    expect(won).toEqual({ campaignId: 'test-run', day: 2, profit: 500 });
  });

  it('fails when the last allowed day closes under the goal', () => {
    const sm = new ScenarioManager(DEF);
    let failed: { campaignId: string; day: number; reason: string } | null = null;
    eventBus.on('scenarioFailed', (e) => (failed = e));
    sm.onDayEnded(record(1, 0));
    sm.onDayEnded(record(2, 100));
    expect(sm.status).toBe('active');
    sm.onDayEnded(record(3, 499));
    expect(sm.status).toBe('failed');
    expect(failed).toEqual({ campaignId: 'test-run', day: 3, reason: 'timeUp' });
  });

  it('tracks the best daily profit and goes quiet after a terminal state', () => {
    const sm = new ScenarioManager(DEF);
    let events = 0;
    eventBus.on('goalReached', () => events++);
    sm.onDayEnded(record(1, 700));
    sm.onDayEnded(record(2, 900)); // already won — no second event
    expect(events).toBe(1);
    expect(sm.bestDailyProfit).toBe(700);
  });

  it('enforces the allowed-objects list when present', () => {
    const sm = new ScenarioManager({ ...DEF, allowedObjects: ['blackjack-table', 'plant'] });
    expect(sm.isAllowed('blackjack-table')).toBe(true);
    expect(sm.isAllowed('slot-machine')).toBe(false);
    const open = new ScenarioManager(DEF);
    expect(open.isAllowed('slot-machine')).toBe(true);
  });
});

describe('continuation', () => {
  it('continue() only moves a won scenario to endless', () => {
    const sm = new ScenarioManager(DEF);
    sm.continue(); // not won yet — no-op
    expect(sm.status).toBe('active');
    sm.onDayEnded(record(1, 500));
    expect(sm.status).toBe('won');
    sm.continue();
    expect(sm.status).toBe('endless');
    sm.continue(); // idempotent
    expect(sm.status).toBe('endless');
  });

  it('isAllowed ignores allowedObjects once endless', () => {
    const sm = new ScenarioManager({ ...DEF, allowedObjects: ['blackjack-table'] });
    expect(sm.isAllowed('slot-machine')).toBe(false);
    sm.onDayEnded(record(1, 500));
    sm.continue();
    expect(sm.isAllowed('slot-machine')).toBe(true);
  });

  it('keeps tracking best day and closed-day bookkeeping while endless, but evaluates no goal', () => {
    const sm = new ScenarioManager(DEF);
    sm.onDayEnded(record(1, 500));
    sm.continue();
    let goalEvents = 0;
    eventBus.on('goalReached', () => goalEvents++);
    sm.onDayEnded(record(2, 900)); // far past dayLimit=3, and far past the goal too
    expect(sm.status).toBe('endless'); // no re-win, no timeUp fail
    expect(sm.bestDailyProfit).toBe(900);
    expect(goalEvents).toBe(0);
  });

  it('fail() still works from endless, not just active', () => {
    const sm = new ScenarioManager(DEF);
    sm.onDayEnded(record(1, 500));
    sm.continue();
    let failed: { reason: string } | null = null;
    eventBus.on('scenarioFailed', (e) => (failed = e));
    sm.fail('insolvent');
    expect(sm.status).toBe('failed');
    expect(failed).toEqual({ campaignId: 'test-run', day: 1, reason: 'insolvent' });
  });

  it('fail() is still a no-op once already failed or won-not-continued', () => {
    const sm = new ScenarioManager(DEF);
    sm.onDayEnded(record(1, 500)); // won
    sm.fail('insolvent'); // won, not endless — must not override a win
    expect(sm.status).toBe('won');
  });
});

// P16 — the goal is a rolling average, not a run of qualifying days.
//
// "N days running at goal" sounds like a test of consistency and behaves like
// one of luck: with a high-variance daily profit it is waiting for N heads in a
// row, and the run is decided by the coin rather than by the casino. Averaging
// over a window is the standard answer to variance, and it is the change that
// makes a steady operation beat a lucky one.
describe('a rolling-average goal', () => {
  const SUSTAINED: CampaignDef = {
    id: 'test',
    name: 'Test',
    tagline: '',
    startingCash: 1000,
    goalDailyProfit: 100,
    dayLimit: 10,
    goalWindowDays: 3,
    creditLimit: 5000,
  };
  const day = (n: number, profit: number) =>
    ({ day: n, profit }) as unknown as Parameters<ScenarioManager['onDayEnded']>[0];

  it('does not win before the window is even full', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 100_000));
    sm.onDayEnded(day(2, 100_000));
    expect(sm.status).toBe('active');
  });

  it('wins on the average, even though no single day clears the goal', () => {
    // The whole point: 90/100/110 is a casino running at goal. Under a streak
    // rule the 90 resets everything and this run never wins at all.
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 90));
    sm.onDayEnded(day(2, 100));
    sm.onDayEnded(day(3, 110));
    expect(sm.status).toBe('won');
  });

  it('lets one exceptional day carry the window, but only at three times goal', () => {
    // The cost of averaging, taken deliberately: a $300 day against a $100 goal
    // is not an outlier to be filtered out, it is a good day.
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 0));
    sm.onDayEnded(day(2, 0));
    sm.onDayEnded(day(3, 299));
    expect(sm.status).toBe('active');
    const sm2 = new ScenarioManager(SUSTAINED);
    sm2.onDayEnded(day(1, 0));
    sm2.onDayEnded(day(2, 0));
    sm2.onDayEnded(day(3, 300));
    expect(sm2.status).toBe('won');
  });

  it('rolls: a bad day stops counting once it leaves the window', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 0));
    sm.onDayEnded(day(2, 120));
    sm.onDayEnded(day(3, 120));
    expect(sm.status).toBe('active'); // mean 80
    sm.onDayEnded(day(4, 120)); // window is now 120/120/120
    expect(sm.status).toBe('won');
  });

  it('reports the running average so the panel can show progress', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 60));
    sm.onDayEnded(day(2, 90));
    expect(sm.windowAverage).toBe(75);
  });

  it('carries the window through a save round-trip', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 120));
    sm.onDayEnded(day(2, 120));
    const back = ScenarioManager.fromJSON(sm.toJSON());
    expect(back.windowAverage).toBe(120);
    back.onDayEnded(day(3, 120));
    expect(back.status).toBe('won');
  });
});
