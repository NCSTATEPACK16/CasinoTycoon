import { describe, expect, it } from 'vitest';
import { AGENT_STRIDE, AgentKind } from '../shared/contracts';
import { getCampaign } from '../data/campaigns';
import { footprintOf } from '../sim/build';
import { ModifierSystem } from '../sim/modifiers';
import { CasinoWorld } from '../sim/world';
import { runCommand } from './commands';
import { SnapshotBuilder, tickerEvent } from './snapshot';

describe('worker bridge', () => {
  it('places through commands and reports objects and moving guests', () => {
    const world = new CasinoWorld({ seed: 7 });
    world.startScenario(null);
    const snap = new SnapshotBuilder();
    expect(
      runCommand(world, snap, { type: 'place', defId: 'slot-machine', col: 10, row: 10, rot: 0 })
        .ok,
    ).toBe(true);
    expect(
      runCommand(world, snap, { type: 'place', defId: 'slot-machine', col: 10, row: 10, rot: 0 })
        .ok,
    ).toBe(false);
    for (let i = 0; i < 600; i++) world.tick();
    const s = snap.build(world, 0);
    expect(s.objects?.map((o) => o.defId)).toEqual(['slot-machine']);
    expect(s.agentCount).toBeGreaterThan(0);
    const kinds = new Set<number>();
    for (let i = 0; i < s.agentCount; i++) {
      const x = s.agents[i * AGENT_STRIDE]!;
      const z = s.agents[i * AGENT_STRIDE + 1]!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(z).toBeGreaterThanOrEqual(0);
      kinds.add(s.agents[i * AGENT_STRIDE + 4]!);
    }
    expect(kinds.has(AgentKind.Guest)).toBe(true);
    // Unchanged object set → no object payload on the next snapshot.
    const again = snap.build(world, 1);
    expect(again.objects === undefined || again.objectsVersion > s.objectsVersion).toBe(true);
  });

  it('picks the blackjack felt row from the table rules', () => {
    const world = new CasinoWorld({ seed: 5 });
    world.startScenario(null);
    const snap = new SnapshotBuilder();
    runCommand(world, snap, { type: 'place', defId: 'blackjack-table', col: 5, row: 5, rot: 0 });
    runCommand(world, snap, { type: 'place', defId: 'slot-machine', col: 10, row: 10, rot: 0 });
    const rowOf = (s: ReturnType<SnapshotBuilder['build']>) =>
      s.objects?.map((o) => [o.defId, o.decalRow]);
    const first = snap.build(world, 0);
    expect(rowOf(first)).toEqual([
      ['blackjack-table', 0],
      ['slot-machine', undefined],
    ]);
    const id = first.objects![0]!.id;
    runCommand(world, snap, {
      type: 'setRules',
      objectId: id,
      rules: { blackjackPays: '6:5', h17: true },
    });
    // A rules change alone must resend the objects so the felt repaints.
    const next = snap.build(world, 1);
    expect(next.objectsVersion).toBeGreaterThan(first.objectsVersion);
    expect(rowOf(next)?.[0]).toEqual(['blackjack-table', 3]);
  });

  it('keeps a won campaign going with its limits lifted', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    world.startScenario(getCampaign('high-roller')!);
    const snap = new SnapshotBuilder();
    world.scenario!.status = 'won';
    expect(world.scenario!.isAllowed('bingo-hall')).toBe(false);
    expect(runCommand(world, snap, { type: 'continueScenario' }).ok).toBe(true);
    expect(world.scenario!.status).toBe('endless');
    expect(world.scenario!.isAllowed('bingo-hall')).toBe(true);
    expect(snap.build(world, 0).hud.scenario?.status).toBe('won');
  });

  it('round-trips a save through the load command', () => {
    const world = new CasinoWorld({ seed: 3 });
    world.startScenario(null);
    const snap = new SnapshotBuilder();
    runCommand(world, snap, { type: 'place', defId: 'blackjack-table', col: 5, row: 5, rot: 0 });
    const saved = runCommand(world, snap, { type: 'save' });
    const other = new CasinoWorld({ seed: 9 });
    expect(saved.ok && runCommand(other, snap, { type: 'load', json: saved.data }).ok).toBe(true);
    expect(other.state.allObjects().map((o) => o.defId)).toEqual(['blackjack-table']);
  });

  it("carries today's modifiers on the HUD for the conditions banner", () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    world.startScenario(null);
    world.modifiers = ModifierSystem.fromJSON({ activeIds: ['heat-wave'], drawnForDay: 1 });
    const hud = new SnapshotBuilder().build(world, 0).hud;
    expect(hud.modifiers).toEqual([
      { id: 'heat-wave', name: 'Heat wave', blurb: 'Nobody can stop drinking. Stock the bar.' },
    ]);
    world.modifiers = new ModifierSystem();
    expect(new SnapshotBuilder().build(world, 0).hud.modifiers).toEqual([]);
  });

  it('places ticker lines on their object or guest for click-to-locate', () => {
    const world = new CasinoWorld({ seed: 6, autoSpawn: false });
    world.startScenario(null);
    const snap = new SnapshotBuilder();
    const placed = runCommand(world, snap, {
      type: 'place',
      defId: 'blackjack-table',
      col: 8,
      row: 6,
      rot: 1,
    });
    const id = (placed as { data: { id: string } }).data.id;
    const fp = footprintOf('blackjack-table', 1);
    expect(tickerEvent(world, { text: 'Broke', severity: 'alert', objectId: id })).toEqual({
      type: 'ticker',
      text: 'Broke',
      severity: 'alert',
      objectId: id,
      x: 8 + fp.w / 2,
      z: 6 + fp.h / 2,
    });

    const guest = world.spawnGuest('regular');
    const ev = tickerEvent(world, { text: 'Back', guestId: guest.id });
    const pose = guest.renderPose();
    expect(ev).toMatchObject({ severity: 'info', x: pose.x, z: pose.z });
    expect(ev.type === 'ticker' && ev.agentId).toBe(Number(guest.id.replace(/\D+/g, '')));

    // A subject that is gone leaves the line unplaced rather than pointing nowhere.
    expect(tickerEvent(world, { text: 'Sold', objectId: 'nope', guestId: 'g-999' })).toEqual({
      type: 'ticker',
      text: 'Sold',
      severity: 'info',
    });
  });
});
