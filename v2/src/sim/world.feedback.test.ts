// B5: the feedback views — what guests are thinking, the Guests list, and the
// mood/traffic heat maps behind the overlay.

import { afterEach, describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../config';
import { eventBus } from '../EventBus';
import { runCommand } from '../worker/commands';
import {
  THOUGHT_WINDOW_TICKS,
  type GuestRow,
  type HeatMap,
  type ThoughtSummary,
} from '../worker/feedback';
import { SnapshotBuilder } from '../worker/snapshot';
import { furnish, navWorld } from './agents/testkit';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const snap = new SnapshotBuilder();
const thoughts = (w: CasinoWorld) =>
  (runCommand(w, snap, { type: 'thoughts' }) as { data: ThoughtSummary }).data;
const guests = (w: CasinoWorld) =>
  (runCommand(w, snap, { type: 'guestList' }) as { data: GuestRow[] }).data;
const heat = (w: CasinoWorld, kind: 'mood' | 'traffic') =>
  (runCommand(w, snap, { type: 'heatMap', kind }) as { data: HeatMap }).data;

/** Plant a thought on a guest at a given tick, as Guest.recordThought would. */
function think(g: ReturnType<CasinoWorld['spawnGuest']>, id: string, text: string, atTick: number) {
  g.thoughts.push({ id, text, atTick });
}

describe('thought summary', () => {
  it('counts guests per thought in the window, with a trend, advice and who', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    world.tickCount = 10 * TICKS_PER_HOUR;
    const now = world.tickCount;
    const [a, b, c] = [world.spawnGuest(), world.spawnGuest(), world.spawnGuest()];
    const older = now - THOUGHT_WINDOW_TICKS + 10;
    const newer = now - 5;
    think(a, 'bathroom', 'I need a bathroom!', older);
    think(b, 'bathroom', 'I need a bathroom!', newer);
    think(c, 'bathroom', 'I need a bathroom!', newer);
    think(a, 'bathroom', 'I need a bathroom!', newer); // same guest twice: still one guest
    think(c, 'great', 'This place is great!', newer);
    think(b, 'filthy', 'This place is filthy!', now - THOUGHT_WINDOW_TICKS - 1); // too old

    const s = thoughts(world);
    expect(s.guests).toBe(3);
    expect(s.lines.map((l) => l.id)).toEqual(['bathroom', 'great']);
    const bath = s.lines[0]!;
    expect(bath).toMatchObject({ count: 3, sentiment: 'bad', glyph: '🚽' });
    expect(bath.trend).toBe(3 - 1); // 3 guests in the newer half, 1 in the older
    expect(bath.advice).toMatch(/restroom/i);
    expect(new Set(bath.agentIds)).toEqual(new Set([a, b, c].map((g) => Number(g.id.slice(2)))));
    expect(s.lines[1]).toMatchObject({ sentiment: 'good', advice: null });
  });
});

describe('guest list', () => {
  it('lists every guest with mood, money, need, latest thought and time on the floor', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    world.tickCount = 100;
    const g = world.spawnGuest();
    g.needs.bladder = 12;
    g.needs.thirst = 30;
    think(g, 'bathroom', 'I need a bathroom!', 120);
    world.tickCount = 100 + 2 * TICKS_PER_HOUR;
    const row = guests(world).find((r) => r.id === g.id)!;
    expect(row).toMatchObject({
      name: g.name,
      agentId: Number(g.id.slice(2)),
      need: { kind: 'bladder', value: 12 },
      thought: { id: 'bathroom', glyph: '🚽' },
      thoughtIds: ['bathroom'],
      hoursOnFloor: 2,
    });
    g.state = 'gone';
    expect(guests(world).some((r) => r.id === g.id)).toBe(false);
  });
});

describe('heat maps', () => {
  it('maps mood and footfall cell by cell, blank where nothing has been seen', async () => {
    const world = await navWorld(6);
    furnish(world, { slots: 12 });
    const { cols, rows } = world.grid;
    const empty = heat(world, 'traffic');
    expect(empty.values).toHaveLength(cols * rows);
    expect(empty.values.every((v) => v === -1)).toBe(true);
    expect(heat(world, 'mood').summary).toBeNull();

    for (let i = 0; i < 25; i++) world.spawnGuest();
    for (let t = 0; t < 400; t++) world.tick();
    const traffic = heat(world, 'traffic');
    const seen = traffic.values.filter((v) => v >= 0);
    expect(seen.length).toBeGreaterThan(10);
    expect(Math.max(...seen)).toBe(1); // the busiest tenth saturate
    // Scaled to the floor, not the door: far more than the entrance shows.
    const raw = world.traffic.busiest;
    expect(seen.filter((v) => v < 1).length).toBeGreaterThan(5);
    expect(raw).toBeGreaterThan(0);
    expect(traffic.summary).toBe(world.traffic.busiest);
    const mood = heat(world, 'mood');
    const felt = mood.values.filter((v) => v >= 0);
    expect(felt.length).toBeGreaterThan(10);
    expect(felt.every((v) => v <= 100)).toBe(true);
    expect(mood.summary).toBeGreaterThan(0);
  }, 60_000);
});
