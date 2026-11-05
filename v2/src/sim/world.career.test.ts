import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { getCampaign } from '../data/campaigns';
import { scenarioList } from '../worker/inspect';
import { goalLine, hudGoals, scenarioResult } from '../worker/scenario';
import { paintZoneRect } from './build';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const start = (id: string) => {
  const world = new CasinoWorld({ seed: 4, starterFloor: true, autoSpawn: false });
  world.startScenario(getCampaign(id)!);
  return world;
};

describe('B8 scenarios in the world', () => {
  it('opens Clean Slate in debt: the loan is on the books and the goal says so', () => {
    const world = start('clean-slate');
    expect(world.state.cash).toBe(8000);
    expect(world.loans.outstanding).toBe(6000);
    expect(world.scenarioFacts().debt).toBe(6000);
    const goals = hudGoals(world)!;
    expect(goals[0]).toMatchObject({ met: false, progress: '$6,000 owed' });
    expect(goalLine(world)).toBe('2 goals by day 14');
  });

  it('counts games on high-limit carpet once the Salon’s room is zoned', () => {
    const world = start('the-salon');
    world.state.cash = 50_000;
    // The marble room is floored and walled but not zoned: no game fits yet.
    expect(world.canPlace('high-limit-table', 30, 6).ok).toBe(false);
    const rect = { col0: 26, row0: 4, col1: 39, row1: 11 };
    expect(paintZoneRect(world.state, world.grid, world.floor, rect, 'highLimit').ok).toBe(true);
    world.onFloorEdited(rect);
    expect(world.place('high-limit-table', 30, 6)).not.toBeNull();
    expect(world.place('blackjack-table', 34, 6)).not.toBeNull();
    expect(world.place('blackjack-table', 14, 14)).not.toBeNull(); // the main floor: not counted
    expect(world.scenarioFacts().highLimitGames).toBe(2);
    expect(hudGoals(world)![0]!.progress).toBe('2 of 4');
  });

  it('reports a win with its medal and score for the end card', () => {
    const world = start('lucky-strike');
    expect(scenarioResult(world)).toMatchObject({ status: 'active', medal: null, score: 0 });
    // Meet both goals at a close (the rating as it stood at that close).
    world.scenario!.observeGuests(55);
    const facts = { ...world.scenarioFacts(), rating: 75 };
    world.scenario!.onDayEnded(world.ledger.closeDay(3), facts);
    const r = scenarioResult(world)!;
    expect(r).toMatchObject({ status: 'won', day: 3, medal: 'gold', dayLimit: 10 });
    expect(r.score).toBeGreaterThan(0);
    // The card reads the goals as they stand now: the record is kept.
    expect(r.goals[0]).toMatchObject({ met: true, progress: 'Most at once: 55' });
    // Once won and continued, the HUD stops chasing goals.
    world.scenario!.continue();
    expect(hudGoals(world)).toBeUndefined();
  });

  it('lists each scenario’s goals, medal days, lot and place in the career', () => {
    const list = scenarioList();
    const salon = list.find((s) => s.id === 'the-salon')!;
    expect(salon.goals).toEqual(['Put 4 games on high-limit carpet', 'Make $2,000 in one day']);
    expect(salon.lot).toEqual({ cols: 48, rows: 32 });
    expect(salon.unlockAfter).toBe('house-rules');
    const dime = list.find((s) => s.id === 'dusty-dime')!;
    expect(dime.goals).toEqual(['Average $1,000 a day over 4 days']);
    expect(dime.unlocks).toEqual(['roulette-table', 'keno-lounge', 'marquee']);
    expect(list.find((s) => s.sandbox)!.goals).toEqual([]);
  });
});
