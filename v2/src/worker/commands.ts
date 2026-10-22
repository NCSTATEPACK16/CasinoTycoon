// Command dispatch for the sim worker. Kept apart from the Worker global so
// tests can drive a world exactly the way the UI does.

import { CAMPAIGNS } from '../data/campaigns';
import type { Command, SimStats } from '../shared/contracts';
import {
  buildWallLine,
  paintFloorRect,
  paintZoneRect,
  toggleDoor,
  type FloorBuildResult,
} from '../sim/build';
import type { StaffKind } from '../sim/entities/staff/Staff';
import type { CasinoWorld, CasinoWorldJSON } from '../sim/world';
import type { SnapshotBuilder } from './snapshot';

export type CommandResult = { ok: true; data?: unknown } | { ok: false; error: string };

/** Floor edits share one tail: report, and tell the world which cells moved. */
function floorEdit(
  world: CasinoWorld,
  r: FloorBuildResult,
  rect: { col0: number; row0: number; col1: number; row1: number },
): CommandResult {
  if (!r.ok) return { ok: false, error: r.error };
  if (r.changed > 0) world.onFloorEdited(rect);
  return { ok: true, data: { cost: r.cost, changed: r.changed } };
}

export function runCommand(world: CasinoWorld, snap: SnapshotBuilder, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'place': {
      const check = world.canPlace(cmd.defId, cmd.col, cmd.row, cmd.rot);
      if (!check.ok) return { ok: false, error: check.reason };
      const placed = world.place(cmd.defId, cmd.col, cmd.row, cmd.rot);
      return placed ? { ok: true, data: placed } : { ok: false, error: 'blocked' };
    }
    case 'canPlace':
      return { ok: true, data: world.canPlace(cmd.defId, cmd.col, cmd.row, cmd.rot) };
    case 'paintFloor':
      return floorEdit(
        world,
        paintFloorRect(
          world.state,
          world.grid,
          world.floor,
          cmd.rect,
          cmd.floor,
          world.creditLimit,
        ),
        cmd.rect,
      );
    case 'paintZone':
      return floorEdit(
        world,
        paintZoneRect(world.state, world.grid, world.floor, cmd.rect, cmd.zone, world.creditLimit),
        cmd.rect,
      );
    case 'wall': {
      const r = buildWallLine(
        world.state,
        world.grid,
        world.floor,
        cmd.from,
        cmd.to,
        cmd.remove,
        world.creditLimit,
      );
      const rect = {
        col0: Math.min(cmd.from.col, cmd.to.col) - 1,
        row0: Math.min(cmd.from.row, cmd.to.row) - 1,
        col1: Math.max(cmd.from.col, cmd.to.col),
        row1: Math.max(cmd.from.row, cmd.to.row),
      };
      return floorEdit(world, r, rect);
    }
    case 'door': {
      const r = toggleDoor(
        world.state,
        world.grid,
        world.floor,
        cmd.col,
        cmd.row,
        cmd.edge,
        world.creditLimit,
      );
      const rect = { col0: cmd.col - 1, row0: cmd.row - 1, col1: cmd.col, row1: cmd.row };
      return floorEdit(world, r, rect);
    }
    case 'sell': {
      const refund = world.sell(cmd.objectId);
      return refund === null ? { ok: false, error: 'not sellable' } : { ok: true, data: refund };
    }
    case 'setSpeed':
      snap.speed = cmd.speed;
      return { ok: true };
    case 'startScenario': {
      const def = cmd.scenarioId ? CAMPAIGNS.find((c) => c.id === cmd.scenarioId) : null;
      if (cmd.scenarioId && !def) return { ok: false, error: `unknown scenario ${cmd.scenarioId}` };
      // The world bumps floorRevision itself; the snapshot sends the new plan.
      world.startScenario(def ?? null);
      return { ok: true };
    }
    case 'hire':
      return { ok: true, data: world.hireStaff(cmd.kind as StaffKind).id };
    case 'fire':
      return world.fireStaff(cmd.staffId) ? { ok: true } : { ok: false, error: 'no such staff' };
    case 'debugSpawn': {
      const n = Math.max(0, Math.min(1000, Math.floor(cmd.count)));
      for (let i = 0; i < n; i++) world.spawnGuest(cmd.archetype);
      return { ok: true, data: world.guests.size };
    }
    case 'debugTicks': {
      const n = Math.max(0, Math.min(5000, Math.floor(cmd.count)));
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        world.tick();
        times.push(performance.now() - t0);
        snap.recordTick(times[i]!);
      }
      times.sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, n);
      return {
        ok: true,
        data: {
          ticks: n,
          meanMs: mean,
          p95Ms: times[Math.floor(n * 0.95)] ?? 0,
          maxMs: times[n - 1] ?? 0,
          guests: world.guests.size,
          crowdAgents: world.nav?.activeAgents ?? 0,
        },
      };
    }
    case 'stats': {
      const t = snap.tickTimes;
      const stats: SimStats = {
        guests: world.guests.size,
        staff: world.staff.size,
        crowdAgents: world.nav?.activeAgents ?? 0,
        tickMeanMs: t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0,
        tickMaxMs: t.length ? Math.max(...t) : 0,
        nav: world.nav ? { ...world.nav.stats, lastRebakeMs: world.nav.sys.lastRebakeMs } : null,
      };
      return { ok: true, data: stats };
    }
    case 'save':
      return { ok: true, data: world.toJSON() };
    case 'load':
      world.loadJSON(cmd.json as CasinoWorldJSON);
      return { ok: true };
    default:
      // setRules/round* → session 4 (sim/games).
      return { ok: false, error: `${cmd.type} not implemented yet` };
  }
}
