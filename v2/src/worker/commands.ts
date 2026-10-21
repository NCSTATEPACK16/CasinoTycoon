// Command dispatch for the sim worker. Kept apart from the Worker global so
// tests can drive a world exactly the way the UI does.

import { CAMPAIGNS } from '../data/campaigns';
import type { Command } from '../shared/contracts';
import type { StaffKind } from '../sim/entities/staff/Staff';
import type { CasinoWorld, CasinoWorldJSON } from '../sim/world';
import type { SnapshotBuilder } from './snapshot';

export type CommandResult = { ok: true; data?: unknown } | { ok: false; error: string };

export function runCommand(world: CasinoWorld, snap: SnapshotBuilder, cmd: Command): CommandResult {
  switch (cmd.type) {
    case 'place': {
      const check = world.canPlace(cmd.defId, cmd.col, cmd.row);
      if (!check.ok) return { ok: false, error: check.reason };
      const placed = world.place(cmd.defId, cmd.col, cmd.row);
      return placed ? { ok: true, data: placed } : { ok: false, error: 'blocked' };
    }
    case 'canPlace':
      return { ok: true, data: world.canPlace(cmd.defId, cmd.col, cmd.row) };
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
      world.startScenario(def ?? null);
      snap.floorVersion++;
      return { ok: true };
    }
    case 'hire':
      return { ok: true, data: world.hireStaff(cmd.kind as StaffKind).id };
    case 'fire':
      return world.fireStaff(cmd.staffId) ? { ok: true } : { ok: false, error: 'no such staff' };
    case 'save':
      return { ok: true, data: world.toJSON() };
    case 'load':
      world.loadJSON(cmd.json as CasinoWorldJSON);
      snap.floorVersion++;
      return { ok: true };
    default:
      // paintFloor/paintZone/wall/door → session 3 (sim/floor); setRules/round* → session 4 (sim/games).
      return { ok: false, error: `${cmd.type} not implemented yet` };
  }
}
