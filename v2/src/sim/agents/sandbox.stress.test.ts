import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { SANDBOX } from '../../data/campaigns';
import type { StaffKind } from '../entities/staff/Staff';
import { furnishSandbox, navWorld } from './testkit';

afterEach(() => eventBus.clear());

// Node's env without pulling @types/node into a browser project.
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const GUESTS = 500;
const TICKS = Number(env.TICKS ?? 1_500);
const STAFF: Partial<Record<StaffKind, number>> = {
  dealer: 50,
  janitor: 12,
  security: 8,
  mechanic: 8,
  bartender: 2,
  waitress: 6,
  cashier: 2,
  pitBoss: 2,
};

describe('Sandbox stress (SPEC §9.7)', () => {
  it(`runs ${GUESTS} guests on 2,000 objects within the 8 ms tick budget`, async () => {
    // The worker's own setup: dealers must be stationed for tables to open.
    const world = await navWorld(7, { scenario: SANDBOX, requireDealers: true });
    const placed = furnishSandbox(world);
    expect(placed).toBeGreaterThanOrEqual(2_000);
    for (const [kind, n] of Object.entries(STAFF))
      for (let i = 0; i < n!; i++) world.hireStaff(kind as StaffKind);

    const times: number[] = [];
    let navMs = 0;
    for (let t = 0; t < TICKS; t++) {
      // Keep the floor full: departures are replaced, one arrival a tick.
      if (world.guests.size < GUESTS) world.spawnGuest();
      const t0 = performance.now();
      world.tick();
      // The first 500 ticks are the arrival rush; measure the floor once it is full.
      if (t >= 500) {
        times.push(performance.now() - t0);
        navMs += world.nav!.lastStepMs;
      }
    }
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)]!;
    const stats = world.nav!.stats;
    console.info(
      `[sandbox] ${placed} objects, ${world.guests.size} guests, ${world.staff.size} staff; ` +
        `tick mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms; ` +
        `crowd step ${(navMs / times.length).toFixed(2)} ms; ` +
        `repaths ${stats.repaths}, teleports ${stats.teleports}, rescues ${stats.rescues}`,
    );
    expect(world.guests.size).toBeGreaterThanOrEqual(GUESTS - 5);
    // Wall-clock budget: asserted when run on its own (NAV_PERF=1), and
    // only reported under the full suite's parallel load.
    if (env.NAV_PERF === '1') expect(mean).toBeLessThanOrEqual(8);
  }, 600_000);
});
