import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { SnapshotBuilder } from '../../worker/snapshot';
import { furnish, navWorld } from './testkit';

afterEach(() => eventBus.clear());

// Node's env without pulling @types/node into a browser project.
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const TARGET = 500;
const TICKS = 10_000;

describe('crowd stress', () => {
  it(`keeps ${TARGET} agents moving for ${TICKS} ticks: no NaNs, nobody stuck, tick within budget`, async () => {
    const world = await navWorld(11);
    furnish(world, { slots: 100 });
    for (const k of ['janitor', 'janitor', 'security', 'security', 'bartender'] as const)
      world.hireStaff(k);
    for (let i = 0; i < 6; i++) world.hireStaff('dealer');
    const snap = new SnapshotBuilder();
    const times: number[] = [];
    // Per walking guest: ticks since its position last changed by > 5 cm.
    const still = new Map<string, { x: number; z: number; ticks: number }>();
    let worstStill = 0;
    let peak = 0;
    let navMs = 0;
    let walking = 0;
    for (let t = 0; t < TICKS; t++) {
      // Keep the floor full: arrivals replace departures, a few per tick at
      // most, as a busy evening would.
      for (let k = 0; k < 1 && world.guests.size < TARGET; k++) world.spawnGuest();
      const t0 = performance.now();
      world.tick();
      snap.build(world, t);
      if (t >= 500) {
        times.push(performance.now() - t0);
        navMs += world.nav!.lastStepMs;
        walking += world.nav!.activeAgents;
      }
      peak = Math.max(peak, world.guests.size + world.staff.size);
      for (const g of world.guests.values()) {
        if (!Number.isFinite(g.x) || !Number.isFinite(g.z) || !Number.isFinite(g.heading)) {
          throw new Error(`NaN pose for ${g.id} at tick ${t}`);
        }
        if (!g.walking) {
          still.delete(g.id);
          continue;
        }
        const s = still.get(g.id);
        if (!s || Math.hypot(s.x - g.x, s.z - g.z) > 0.05) {
          still.set(g.id, { x: g.x, z: g.z, ticks: 0 });
        } else {
          s.ticks++;
          worstStill = Math.max(worstStill, s.ticks);
        }
      }
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const stats = world.nav!.stats;
    console.info(
      `[stress] peak ${peak} agents; tick mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, ` +
        `max ${times[times.length - 1]!.toFixed(1)} ms; crowd step ${(navMs / times.length).toFixed(2)} ms ` +
        `for ${(walking / times.length).toFixed(0)} walking agents; repaths ${stats.repaths}, ` +
        `teleports ${stats.teleports}, rescues ${stats.rescues}; longest stall ${worstStill} ticks`,
    );
    expect(peak).toBeGreaterThanOrEqual(TARGET);
    // Stuck recovery: re-path after 3 s (30 ticks) without progress, four
    // times, then teleport — so no walking agent is ever still for more than
    // five windows plus the arrival settle.
    expect(worstStill).toBeLessThanOrEqual(5 * 30 + 30);
    // Teleports are the visible failure mode; keep them rare: well under
    // one per 10 ticks at a 500-guest churn through a single lobby.
    expect(stats.teleports).toBeLessThan(TICKS / 10);
    // Wall-clock budget: asserted when run on its own (NAV_PERF=1), and
    // only reported under the full suite's parallel load, where every
    // worker competes for the same cores.
    if (env.NAV_PERF === '1') expect(mean).toBeLessThanOrEqual(8);
  }, 600_000);
});
