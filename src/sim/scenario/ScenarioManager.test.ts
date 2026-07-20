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
    let failed: { campaignId: string; day: number } | null = null;
    eventBus.on('scenarioFailed', (e) => (failed = e));
    sm.onDayEnded(record(1, 0));
    sm.onDayEnded(record(2, 100));
    expect(sm.status).toBe('active');
    sm.onDayEnded(record(3, 499));
    expect(sm.status).toBe('failed');
    expect(failed).toEqual({ campaignId: 'test-run', day: 3 });
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
