// Command dispatch for the sim worker. Kept apart from the Worker global so
// tests can drive a world exactly the way the UI does.

import { getCampaign } from '../data/campaigns';
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
      const def = cmd.scenarioId ? getCampaign(cmd.scenarioId) : null;
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
    // Session 4 (casino math). setRules replies { rules, issues }: the rules as
    // applied, and every field that had to be clamped or rejected.
    case 'setRules': {
      const applied = world.setMachineRules(cmd.objectId, cmd.rules);
      return applied
        ? { ok: true, data: applied }
        : { ok: false, error: 'no game rules on that object' };
    }
    // Avatar play. Both reply { options, view, wallet }, plus `result` (the
    // RoundResult with its theo) once the round has settled.
    case 'roundBegin': {
      const reply = world.beginPlayerRound(cmd.objectId, cmd.bets);
      return typeof reply === 'string' ? { ok: false, error: reply } : { ok: true, data: reply };
    }
    case 'roundAct': {
      const reply = world.actPlayerRound(cmd.objectId, cmd.action);
      return typeof reply === 'string' ? { ok: false, error: reply } : { ok: true, data: reply };
    }
    default:
      // paintFloor/paintZone/wall/door → session 3 (sim/floor).
      return { ok: false, error: `${cmd.type} not implemented yet` };
  }
}
