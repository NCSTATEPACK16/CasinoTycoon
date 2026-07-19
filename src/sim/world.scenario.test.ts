import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { HOURS_PER_DAY, START_HOUR, STARTING_CASH, TICKS_PER_HOUR } from '../config';
import type { CampaignDef } from '../data/campaigns';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const DEF: CampaignDef = {
  id: 'test-run',
  name: 'Test Run',
  tagline: 'For the suite.',
  startingCash: 1500,
  goalDailyProfit: 300,
  dayLimit: 2,
  allowedObjects: ['slot-machine', 'toilet', 'plant'],
};

const TICKS_TO_MIDNIGHT = (HOURS_PER_DAY - START_HOUR) * TICKS_PER_HOUR;

describe('CasinoWorld — scenarios', () => {
  it('startScenario wipes the floor and applies the campaign start', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    world.spawnGuest();
    world.hireStaff('janitor');
    world.dropMess(8, 8, 'trash');
    for (let i = 0; i < TICKS_PER_HOUR * 2; i++) world.tick();

    let resets = 0;
    eventBus.on('worldReset', () => resets++);
    world.startScenario(DEF);

    expect(resets).toBe(1);
    expect(world.state.cash).toBe(1500);
    expect(world.state.allObjects()).toHaveLength(0);
    expect(world.guests.size).toBe(0);
    expect(world.staff.size).toBe(0);
    expect(world.messes.size).toBe(0);
    expect(world.machines.size).toBe(0);
    expect(world.time.day).toBe(1);
    expect(world.time.hour).toBe(START_HOUR);
    expect(world.ledger.history).toHaveLength(0);
    expect(world.grid.isWalkable(5, 5)).toBe(true); // old slot's cell freed
    expect(world.scenario?.def.id).toBe('test-run');
  });

  it('startScenario(null) returns to sandbox with default cash', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(DEF);
    world.startScenario(null);
    expect(world.scenario).toBeNull();
    expect(world.state.cash).toBe(STARTING_CASH);
    expect(world.isObjectAllowed('blackjack-table')).toBe(true);
  });

  it('disallowed objects cannot be placed', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(DEF);
    expect(world.isObjectAllowed('blackjack-table')).toBe(false);
    expect(world.canPlace('blackjack-table', 10, 10)).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
    expect(world.place('blackjack-table', 10, 10)).toBeNull();
    expect(world.place('slot-machine', 10, 10)).not.toBeNull();
  });

  it('reaching the goal by midnight wins the scenario', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(DEF);
    world.payCasino(400);
    let won = 0;
    eventBus.on('goalReached', () => won++);
    for (let i = 0; i < TICKS_TO_MIDNIGHT; i++) world.tick();
    expect(won).toBe(1);
    expect(world.scenario?.status).toBe('won');
  });

  it('running out the day limit without the goal fails the scenario', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(DEF);
    let failed = 0;
    eventBus.on('scenarioFailed', () => failed++);
    for (let i = 0; i < TICKS_TO_MIDNIGHT + DEF.dayLimit * HOURS_PER_DAY * TICKS_PER_HOUR; i++) {
      world.tick();
    }
    expect(failed).toBe(1);
    expect(world.scenario?.status).toBe('failed');
  });

  it('serializes the active scenario through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.startScenario(DEF);
    world.payCasino(400);
    for (let i = 0; i < TICKS_TO_MIDNIGHT; i++) world.tick();
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.scenario?.def.id).toBe('test-run');
    expect(restored.scenario?.status).toBe('won');
    expect(restored.scenario?.bestDailyProfit).toBe(world.scenario?.bestDailyProfit);
  });
});
