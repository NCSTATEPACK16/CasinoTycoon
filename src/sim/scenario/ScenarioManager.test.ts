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
  goalConsecutiveDays: 1,
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

describe('a sustained goal', () => {
  const SUSTAINED: CampaignDef = {
    id: 'test',
    name: 'Test',
    tagline: '',
    startingCash: 1000,
    goalDailyProfit: 100,
    dayLimit: 10,
    goalConsecutiveDays: 2,
    creditLimit: 5000,
  };
  const day = (n: number, profit: number) =>
    ({ day: n, profit }) as unknown as Parameters<ScenarioManager['onDayEnded']>[0];

  it('does not win on a single peak day, however large', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 100_000));
    expect(sm.status).toBe('active');
  });

  it('wins on the second day running at goal', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 150));
    sm.onDayEnded(day(2, 150));
    expect(sm.status).toBe('won');
  });

  it('resets the streak on a miss — two days running means running', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 150));
    sm.onDayEnded(day(2, 40));
    expect(sm.consecutiveDaysAtGoal).toBe(0);
    sm.onDayEnded(day(3, 150));
    expect(sm.status).toBe('active');
  });

  it('carries the streak through a save round-trip', () => {
    const sm = new ScenarioManager(SUSTAINED);
    sm.onDayEnded(day(1, 150));
    const back = ScenarioManager.fromJSON(sm.toJSON());
    expect(back.consecutiveDaysAtGoal).toBe(1);
    back.onDayEnded(day(2, 150));
    expect(back.status).toBe('won');
  });
});
