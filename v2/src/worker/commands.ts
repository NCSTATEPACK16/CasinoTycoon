// Command dispatch for the sim worker. Kept apart from the Worker global so
// tests can drive a world exactly the way the UI does.

import { getCampaign } from '../data/campaigns';
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
import { financials, inspectAgent, inspectObject, scenarioList, staffList } from './inspect';
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
      const def = cmd.scenarioId ? getCampaign(cmd.scenarioId) : null;
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
    // Session 4 (casino math). setRules replies { rules, issues }: the rules as
    // applied, and every field that had to be clamped or rejected.
    case 'setRules': {
      const applied = world.setMachineRules(cmd.objectId, cmd.rules);
      return applied
        ? { ok: true, data: applied }
        : { ok: false, error: 'no game rules on that object' };
    }
    // Avatar play. Both reply { options, view, wallet, onTable }, plus `result` (the
    // RoundResult with its theo) once the round has settled.
    case 'sit': {
      const reply = world.seatPlayer(cmd.objectId);
      return reply === true ? { ok: true } : { ok: false, error: reply };
    }
    case 'stand':
      world.unseatPlayer();
      return { ok: true };
    case 'roundBegin': {
      const reply = world.beginPlayerRound(cmd.objectId, cmd.bets);
      return typeof reply === 'string' ? { ok: false, error: reply } : { ok: true, data: reply };
    }
    case 'roundAct': {
      const reply = world.actPlayerRound(cmd.objectId, cmd.action);
      return typeof reply === 'string' ? { ok: false, error: reply } : { ok: true, data: reply };
    }
    case 'inspect': {
      const t = cmd.target;
      const view =
        'objectId' in t ? inspectObject(world, t.objectId) : inspectAgent(world, t.agentId);
      return view ? { ok: true, data: view } : { ok: false, error: 'nothing there' };
    }
    case 'financials':
      return { ok: true, data: financials(world) };
    case 'staffList':
      return { ok: true, data: staffList(world) };
    case 'scenarios':
      return { ok: true, data: scenarioList() };
    default:
      return { ok: false, error: `${(cmd as Command).type} not implemented` };
  }
}
