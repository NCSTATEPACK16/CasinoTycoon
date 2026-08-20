import { describe, expect, it } from 'vitest';
import { CasinoWorld } from '../sim/world';
import { CAMPAIGNS } from '../data/campaigns';
import { SAVE_VERSION } from './migrations';
import { exportFileName, exportSaveText, importSaveText } from './saveFile';

const at = new Date('2026-08-19T04:05:06.000Z');

function playedWorld(seed = 4242, scenario = false): CasinoWorld {
  const world = new CasinoWorld({ seed, autoSpawn: true });
  world.startScenario(scenario ? CAMPAIGNS[0]! : null);
  world.place('slot-machine', 6, 6);
  world.place('toilet', 6, 12);
  for (let i = 0; i < 1400; i++) world.tick();
  return world;
}

describe('exportSaveText', () => {
  it('writes the same envelope a save slot holds', () => {
    const world = playedWorld();
    const env = JSON.parse(exportSaveText(world.toJSON(), at));
    expect(env.version).toBe(SAVE_VERSION);
    expect(env.savedAt).toBe(at.toISOString());
    expect(env.world.state.cash).toBe(world.state.cash);
  });

  it('round-trips a played world back into the sim', () => {
    const world = playedWorld();
    const res = importSaveText(exportSaveText(world.toJSON(), at));
    expect(res.status).toBe('ok');
    const restored = CasinoWorld.fromJSON(res.world!);
    expect(restored.state.cash).toBe(world.state.cash);
    expect(restored.time.day).toBe(world.time.day);
    expect(restored.machines.size).toBe(world.machines.size);
    expect(restored.patrons.toJSON()).toEqual(world.patrons.toJSON());
  });

  it('is readable in a text editor', () => {
    // A save the player can open is a save they can reason about when
    // something has gone wrong, which is the only time this file gets used.
    const text = exportSaveText(playedWorld().toJSON(), at);
    expect(text.split('\n').length).toBeGreaterThan(20);
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('exportFileName', () => {
  it('names the run, not just the moment', () => {
    const world = playedWorld(9, true);
    const name = exportFileName(world.toJSON(), at);
    expect(name).toMatch(/^casino-tycoon-the-dusty-dime-day-\d+-2026-08-19\.json$/);
  });

  it('calls a scenario-less run a sandbox', () => {
    expect(exportFileName(playedWorld().toJSON(), at)).toMatch(/^casino-tycoon-sandbox-day-/);
  });

  it('never emits a character a filesystem will argue about', () => {
    const world = playedWorld();
    const json = world.toJSON();
    const named = { ...json, scenario: { def: { name: 'Neon / Nights: "88"' } } } as never;
    expect(exportFileName(named, at)).toBe('casino-tycoon-neon-nights-88-day-2-2026-08-19.json');
  });
});

describe('importSaveText', () => {
  it('migrates an older file forward, exactly as a slot does', () => {
    const world = playedWorld();
    const env = JSON.parse(exportSaveText(world.toJSON(), at));
    // A file exported before the patron registry existed. The whole point of
    // portability is that a backup outlives the build that wrote it.
    delete env.world.patrons;
    env.version = SAVE_VERSION - 1;
    const res = importSaveText(JSON.stringify(env));
    expect(res.status).toBe('ok');
    expect(res.world!.patrons).toEqual({
      patrons: [],
      dueToday: [],
      drawnForDay: 0,
      nextPatronNum: 1,
    });
  });

  it('reports a file from a newer build rather than eating it', () => {
    const env = JSON.parse(exportSaveText(playedWorld().toJSON(), at));
    env.version = SAVE_VERSION + 1;
    const res = importSaveText(JSON.stringify(env));
    expect(res.status).toBe('newer');
    expect(res.world).toBeNull();
  });

  it('refuses anything that is not a save', () => {
    for (const text of ['', 'not json', '{}', '[]', 'null', '{"version":4}']) {
      expect(importSaveText(text).status, text).toBe('unreadable');
    }
  });

  it('does not trust a file more than a slot', () => {
    // Same gate, same answer: a hand-edited file with a plausible envelope but
    // a corrupt world still has to fail somewhere it can be reported.
    const res = importSaveText('{"version":4,"savedAt":"x","world":{"state":{}}}');
    expect(res.status).toBe('ok');
    const world = new CasinoWorld({ seed: 1 });
    expect(() => world.loadJSON(res.world!)).toThrow();
    // The live session is untouched — loadJSON validates before it clears.
    expect(world.state.cash).toBeGreaterThan(0);
  });
});
