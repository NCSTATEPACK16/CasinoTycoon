// B7a: guests are at the games, not walking between them. Pins the share of
// guests seated and playing on the crowd, so the slower clock and the longer
// runs at one machine can't quietly regress.
//
// Measured when B7a landed (share of guests at a game, sampled every 10 ticks):
//   40×30 lot, furnish(24 slots), 1 day:   before 35–36%  →  after 58–66%
//   ~210-seat Sandbox floor, day 2–3:      before 0.5–0.7% → after 17–19%
// Floors below sit well under the measured values, above anything the old
// behaviour could reach.

import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { SANDBOX } from '../../data/campaigns';
import { furnish, furnishSandboxFloor, measurePlayShare, navWorld } from './testkit';

afterEach(() => eventBus.clear());

describe('guests at the games (B7a)', () => {
  it('a campaign-size floor has about half its guests playing', async () => {
    const world = await navWorld(3);
    furnish(world, { slots: 24 });
    world.hireStaff('dealer');
    world.hireStaff('dealer');
    world.hireStaff('janitor');
    world.autoSpawn = true;
    const m = measurePlayShare(world, 1200, 200);
    expect(m.guests).toBeGreaterThan(20);
    expect(m.share).toBeGreaterThan(0.5);
  }, 120_000);

  it('a big Sandbox floor has guests at its games, not all walking', async () => {
    const world = await navWorld(5, { scenario: SANDBOX });
    furnishSandboxFloor(world);
    for (const k of ['janitor', 'janitor', 'janitor', 'janitor', 'mechanic'] as const)
      world.hireStaff(k);
    world.autoSpawn = true;
    const m = measurePlayShare(world, 1200, 1200);
    expect(m.guests).toBeGreaterThan(100);
    expect(m.share).toBeGreaterThan(0.12);
  }, 300_000);
});
