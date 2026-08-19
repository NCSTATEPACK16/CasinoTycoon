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
    for (const junk of [null, undefined, 42, 'nope', {}, { version: 2 }, { version: 'x', world: {} }]) {
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

describe('committed save fixtures', () => {
  it('the current fixture loads as-is', () => {
    const res = acceptEnvelope(fixtureV2);
    expect(res.status).toBe('ok');
    expect(res.world).toMatchObject({ state: { cash: 2000 } });
  });

  it('survives a replay through a full ladder above it', () => {
    // Stands in for what a returning player's file will do after several
    // releases: walk every migration in sequence, not just the newest one.
    const aged = { ...fixtureV2, version: SAVE_VERSION - 1 };
    const res = acceptEnvelope(aged, { [SAVE_VERSION]: ladder[3]! });
    expect(res.status).toBe('ok');
    expect(res.world).toMatchObject({ state: { cash: 2000 }, minBet: null });
  });

  it('a real world snapshot still round-trips into the sim after migration', async () => {
    const { CasinoWorld } = await import('../sim/world');
    const res = acceptEnvelope(fixtureV2);
    const world = new CasinoWorld({ seed: 1 });
    expect(() => world.loadJSON(res.world!)).not.toThrow();
    expect(world.state.cash).toBe(2000);
  });
});
