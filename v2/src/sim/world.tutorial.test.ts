import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { getCampaign, CAREER, SCENARIOS } from '../data/campaigns';
import { scenarioList } from '../worker/inspect';
import { goalLine, hudGoals, scenarioResult } from '../worker/scenario';
import { paintZoneRect } from './build';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const start = () => {
  const world = new CasinoWorld({ seed: 4, starterFloor: true, autoSpawn: false });
  world.startScenario(getCampaign('opening-night')!);
  return world;
};

describe('B12 Opening Night in the world', () => {
  it('is a lesson, not a contest: no goal, no clock, and outside the career', () => {
    const world = start();
    expect(world.scenario!.status).toBe('endless');
    expect(hudGoals(world)).toBeUndefined();
    expect(scenarioResult(world)).toBeNull();
    expect(goalLine(world)).toBe('Learn the ropes');
    expect(CAREER.map((d) => d.id)).not.toContain('opening-night');
    expect(SCENARIOS[0]!.id).toBe('opening-night');
    const info = scenarioList().find((s) => s.id === 'opening-night')!;
    expect(info).toMatchObject({ tutorial: true, sandbox: false, goals: [] });
  });

  it('starts with the east half of the hall unzoned, so the first lesson is zoning it', () => {
    const world = start();
    expect(world.floor.zoneAt(10, 14)).toBe('gaming');
    expect(world.floor.zoneAt(25, 14)).toBe('none');
    expect(world.canPlace('slot-machine', 25, 14).ok).toBe(false);
    const rect = { col0: 20, row0: 4, col1: 33, row1: 25 };
    expect(paintZoneRect(world.state, world.grid, world.floor, rect, 'gaming').ok).toBe(true);
    world.onFloorEdited(rect);
    expect(world.canPlace('slot-machine', 25, 14).ok).toBe(true);
  });

  it('can be lost to the bank like any run, but never wins on its own', () => {
    const world = start();
    world.scenario!.onDayEnded(world.ledger.closeDay(1), world.scenarioFacts());
    expect(world.scenario!.status).toBe('endless');
    expect(world.scenario!.wonOnDay).toBeNull();
  });
});
