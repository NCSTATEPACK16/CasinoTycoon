import { describe, expect, it } from 'vitest';
import { AGENT_STRIDE, AgentKind } from '../shared/contracts';
import { CasinoWorld } from '../sim/world';
import { runCommand } from './commands';
import { SnapshotBuilder } from './snapshot';

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
});
