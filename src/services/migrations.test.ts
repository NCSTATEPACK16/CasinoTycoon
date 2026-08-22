import { describe, expect, it } from 'vitest';
import {
  acceptEnvelope,
  migrateWorld,
  MIGRATIONS,
  SAVE_VERSION,
  type Migration,
  type SaveWorld,
} from './migrations';

// A synthetic ladder. The real MIGRATIONS registry is empty at v2 — these prove
// the machinery works before the first real schema change depends on it.
const ladder: Record<number, Migration> = {
  3: (w) => ({ ...w, steps: [...((w.steps as string[]) ?? []), 'v3'], minBet: null }),
  4: (w) => ({ ...w, steps: [...((w.steps as string[]) ?? []), 'v4'], patrons: [] }),
  5: (w) => ({ ...w, steps: [...((w.steps as string[]) ?? []), 'v5'] }),
};

const v2World = (): SaveWorld => ({ cash: 2000 });

describe('migrateWorld', () => {
  it('replays every step in order, not just the last one', () => {
    const out = migrateWorld(v2World(), 2, 5, ladder);
    // The chain is the thing that breaks in practice: a returning player's file
    // walks all of them, so testing each step in isolation proves nothing.
    expect(out.steps).toEqual(['v3', 'v4', 'v5']);
    expect(out).toMatchObject({ cash: 2000, minBet: null, patrons: [] });
  });

  it('is a no-op when the file is already current', () => {
    const world = v2World();
    expect(migrateWorld(world, 5, 5, ladder)).toEqual(world);
  });

  it('throws on a gap in the ladder rather than silently skipping it', () => {
    expect(() => migrateWorld(v2World(), 2, 4, { 4: ladder[4]! })).toThrow(/version 3/);
  });

  it('has a step for every version above the initial one', () => {
    // Guards the bug this whole module exists to prevent: bumping SAVE_VERSION
    // without writing the migration that goes with it.
    for (let v = 3; v <= SAVE_VERSION; v++) {
      expect(MIGRATIONS[v], `missing migration to save version ${v}`).toBeDefined();
    }
  });
});

describe('acceptEnvelope', () => {
  const env = (version: number, world: unknown = v2World()) => ({
    version,
    savedAt: '2026-08-18T00:00:00.000Z',
    world,
  });

  it('passes a current-version file straight through', () => {
    const result = acceptEnvelope(env(SAVE_VERSION), ladder);
    expect(result.status).toBe('ok');
    expect(result.world).toEqual(v2World());
  });

  it('migrates an older file forward', () => {
    // v2 is current, so "older" here is a hypothetical v1 with a step up to v2.
    const result = acceptEnvelope(env(SAVE_VERSION - 1), { [SAVE_VERSION]: ladder[3]! });
    expect(result.status).toBe('ok');
    expect(result.world).toMatchObject({ cash: 2000, minBet: null });
  });

  it('reports a newer file as newer instead of discarding it', () => {
    const result = acceptEnvelope(env(SAVE_VERSION + 1), ladder);
    expect(result.status).toBe('newer');
    expect(result.savedAt).toBe('2026-08-18T00:00:00.000Z');
    expect(result.world).toBeNull();
  });

  it('treats a throwing migration as unreadable rather than crashing the load', () => {
    const boom: Record<number, Migration> = {
      [SAVE_VERSION]: () => {
        throw new Error('bad shape');
      },
    };
    expect(acceptEnvelope(env(SAVE_VERSION - 1), boom).status).toBe('unreadable');
  });

  it('rejects junk without throwing', () => {
    for (const junk of [
      null,
      undefined,
      42,
      'nope',
      {},
      { version: 2 },
      { version: 'x', world: {} },
    ]) {
      expect(acceptEnvelope(junk, ladder).status).toBe('unreadable');
    }
  });

  it('tolerates a missing savedAt', () => {
    const result = acceptEnvelope({ version: SAVE_VERSION, world: v2World() }, ladder);
    expect(result.status).toBe('ok');
    expect(result.savedAt).toBeNull();
  });
});

// Real serialized saves, committed per version. When SAVE_VERSION is bumped,
// the outgoing version's file is added here and never edited again — these are
// the shapes actually sitting in players' browsers.
import fixtureV2 from './__fixtures__/save-v2.json';
import fixtureV3 from './__fixtures__/save-v3.json';
import fixtureV4 from './__fixtures__/save-v4.json';
import fixtureV5 from './__fixtures__/save-v5.json';
import { ScenarioManager, type ScenarioJSON } from '../sim/scenario/ScenarioManager';

describe('committed save fixtures', () => {
  it('every committed fixture migrates up to the current version', () => {
    for (const [label, fixture] of [
      ['v2', fixtureV2],
      ['v3', fixtureV3],
      ['v4', fixtureV4],
      ['v5', fixtureV5],
    ] as const) {
      const res = acceptEnvelope(fixture);
      expect(res.status, label).toBe('ok');
      expect(res.world, label).not.toBeNull();
    }
  });

  it('a v2 file walks the whole ladder, not just the newest step', () => {
    // This is what a returning player's file actually does after several
    // releases. Testing each step in isolation would not catch a migration
    // that only works against a shape one version old.
    const res = acceptEnvelope(fixtureV2);
    expect(res.status).toBe('ok');
    // Every step's defaults are present at once: v3's Track 2 systems and v4's
    // patron registry, on a file that predates both.
    expect(res.world).toMatchObject({
      state: { cash: 2000 },
      modifiers: { activeIds: [] },
      reputation: { value: 50 },
      patrons: { patrons: [] },
    });
  });

  it('migrates a v4 file forward with an empty goal window', () => {
    const res = acceptEnvelope(fixtureV4);
    expect(res.status).toBe('ok');
    const scenario = (res.world as unknown as { scenario: Record<string, unknown> }).scenario;
    // A v4 file predates the window entirely, and the v5 streak it gains on the
    // way through does not convert — a streak says how many days cleared the
    // goal, never by how much. An empty window is the truthful default: it is
    // re-earned over the next few days and can never lose a run, since an
    // unfilled window simply does not win.
    expect(scenario.recentProfits).toEqual([]);
    expect(scenario.consecutiveDaysAtGoal).toBeUndefined();
    // The embedded def predates the P16 fields. Absent is not harmless:
    // `length >= undefined` is always false, so the run could never be won.
    expect(scenario).toMatchObject({
      status: 'active',
      def: { id: 'dusty-dime', goalDailyProfit: 350, goalWindowDays: 1 },
    });
    expect(
      (scenario as unknown as { def: { creditLimit: number } }).def.creditLimit,
    ).toBeGreaterThan(0);
  });

  it('leaves a migrated v4 campaign winnable under its old peak-day rule', () => {
    const res = acceptEnvelope(fixtureV4);
    const sm = ScenarioManager.fromJSON(
      (res.world as unknown as { scenario: ScenarioJSON }).scenario,
    );
    sm.onDayEnded({ day: 4, profit: 400 } as unknown as Parameters<
      ScenarioManager['onDayEnded']
    >[0]);
    expect(sm.status).toBe('won');
  });

  it('converts a v5 streak into an empty window rather than inventing profits', () => {
    // The v5 file is mid-run with a streak of 1. A streak records that a day
    // cleared the goal but never by how much, so there is no honest set of
    // profits to seed the window with — and inventing some would hand the
    // player progress they did not earn, or take some away.
    const res = acceptEnvelope(fixtureV5);
    expect(res.status).toBe('ok');
    const scenario = (res.world as unknown as { scenario: Record<string, unknown> }).scenario;
    expect(scenario.recentProfits).toEqual([]);
    expect(scenario.consecutiveDaysAtGoal).toBeUndefined();
    // The window length inherits the streak it replaces, so the file keeps
    // roughly the commitment it was played under.
    expect(scenario).toMatchObject({ def: { goalWindowDays: 2 } });
    // Untouched state still survives the step.
    expect(scenario.bestDailyProfit).toBe(420);
  });

  it('tolerates a sandbox v4 file, which has no scenario at all', () => {
    const res = acceptEnvelope({ version: 4, savedAt: null, world: { scenario: null } });
    expect(res.status).toBe('ok');
    // A sandbox save must pass through rather than growing a scenario.
    expect((res.world as unknown as { scenario: unknown }).scenario).toBeNull();
  });

  it('a v3 file gains an empty patron roster rather than a missing key', () => {
    const res = acceptEnvelope(fixtureV3);
    // The v3 snapshot has real modifier and reputation state, and it must
    // survive untouched — a migration that resets what it does not own would
    // quietly wipe a player's standing.
    expect(res.world).toMatchObject({
      reputation: (fixtureV3 as { world: { reputation: unknown } }).world.reputation,
      patrons: { patrons: [], dueToday: [], drawnForDay: 0, nextPatronNum: 1 },
    });
  });

  it('a real world snapshot still round-trips into the sim after migration', async () => {
    const { CasinoWorld } = await import('../sim/world');
    for (const fixture of [fixtureV2, fixtureV3, fixtureV4]) {
      const res = acceptEnvelope(fixture);
      const world = new CasinoWorld({ seed: 1 });
      expect(() => world.loadJSON(res.world!)).not.toThrow();
      expect(world.patrons.size).toBe(0);
    }
  });
});
