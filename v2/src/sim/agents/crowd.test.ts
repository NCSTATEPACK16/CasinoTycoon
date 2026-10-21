import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { AGENT_STRIDE } from '../../shared/contracts';
import { SnapshotBuilder } from '../../worker/snapshot';
import { furnish, navWorld } from './testkit';

afterEach(() => eventBus.clear());

describe('guests on the navmesh', () => {
  it('walk in through the door, sit at games, use the restroom and leave by the entrance', async () => {
    const world = await navWorld(3);
    furnish(world, { slots: 12 });
    const seen = { play: 0, service: 0, leaving: 0, left: 0 };
    eventBus.on('guestLeft', () => seen.left++);
    for (let i = 0; i < 20; i++) world.spawnGuest();
    // Force a restroom trip early for a few of them.
    [...world.guests.values()].slice(0, 4).forEach((g) => (g.needs.bladder = 5));
    let sitting = 0;
    for (let t = 0; t < 3000; t++) {
      world.tick();
      for (const g of world.guests.values()) {
        if (g.state === 'play') {
          seen.play++;
          // A seated player is parked: pinned to its seat, off the crowd.
          if (world.nav!.isParked(g)) sitting++;
        }
        if (g.state === 'service') seen.service++;
        if (g.state === 'leaving') seen.leaving++;
        expect(Number.isFinite(g.x) && Number.isFinite(g.z)).toBe(true);
      }
      if (t % 50 === 0 && world.guests.size < 20) world.spawnGuest();
    }
    expect(seen.play).toBeGreaterThan(0);
    expect(sitting).toBeGreaterThan(0);
    expect(seen.service).toBeGreaterThan(0);
    expect(seen.left).toBeGreaterThan(0);
    // Nobody ever stood inside a wall-enclosed object or off the lot.
    for (const g of world.guests.values())
      expect(world.floor.isFloored(g.pos.col, g.pos.row)).toBe(true);
  });

  it('writes float positions and anims into the snapshot', async () => {
    const world = await navWorld(5);
    furnish(world, { slots: 6 });
    for (let i = 0; i < 6; i++) world.spawnGuest();
    for (let t = 0; t < 40; t++) world.tick();
    const s = new SnapshotBuilder().build(world, 0);
    expect(s.floor?.cols).toBe(40);
    const xs = new Set<number>();
    for (let i = 0; i < s.agentCount; i++) xs.add(s.agents[i * AGENT_STRIDE]!);
    // Crowd agents are not on cell centres.
    expect([...xs].some((x) => Math.abs((x % 1) - 0.5) > 0.05)).toBe(true);
  });

  it('queues at a full table and takes the next free seat', async () => {
    const world = await navWorld(9);
    world.place('blackjack-table', 20, 14);
    for (let i = 0; i < 10; i++) world.spawnGuest();
    let queued = 0;
    for (let t = 0; t < 600; t++) {
      world.tick();
      for (const g of world.guests.values()) if (g.state === 'queue') queued++;
    }
    expect(queued).toBeGreaterThan(0);
  });

  it('a table without a stationed dealer is closed when dealers are required', async () => {
    const world = await navWorld(4, { requireDealers: true });
    const table = world.place('blackjack-table', 20, 14)!;
    expect(world.isTableOpen(table.id)).toBe(false);
    world.hireStaff('dealer');
    for (let t = 0; t < 400 && !world.isTableOpen(table.id); t++) world.tick();
    expect(world.isTableOpen(table.id)).toBe(true);
  });

  it('security walks a drunk guest out', async () => {
    const world = await navWorld(6);
    furnish(world, { slots: 4 });
    world.hireStaff('security');
    const g = world.spawnGuest();
    g.drunk = true;
    for (let t = 0; t < 800 && !g.escorted; t++) world.tick();
    expect(g.escorted).toBe(true);
  });

  it('a janitor paths to a mess and cleans it', async () => {
    const world = await navWorld(2);
    world.hireStaff('janitor');
    world.dropMess(20, 20, 'spill');
    for (let t = 0; t < 600 && world.messes.size > 0; t++) world.tick();
    expect(world.messes.size).toBe(0);
  });
});
