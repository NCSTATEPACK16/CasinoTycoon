// Read-only views the lead's UI panels ask the worker for: the inspector,
// staff roster, P&L and scenario list. Pure functions of the world, so the
// panels never reach into sim internals and the tests can call them directly.

import { SCENARIOS } from '../data/campaigns';
import { getObjectDef } from '../data/objects';
import { SeatedCasinoGame } from '../sim/entities/machines/SeatedCasinoGame';
import { casinoFinancials, type CasinoFinancials } from '../sim/economy/financials';
import type { CasinoWorld } from '../sim/world';

export interface MachineInspect {
  kind: 'object';
  id: string;
  defId: string;
  name: string;
  category: string;
  broken: boolean;
  open: boolean;
  reliability: number;
  lifetimeProfit: number;
  seats: { used: number; total: number } | null;
  /** Present for objects that run one of the real game engines. */
  game: {
    kind: string;
    rules: unknown;
    edge: number;
    appeal: number;
    roundsPerHour: number;
  } | null;
  /** Today's books for this object, from the ledger. */
  today: { handle: number; win: number; hold: number | null; theo: number; rounds: number } | null;
}

export interface GuestInspect {
  kind: 'guest';
  id: string;
  name: string;
  archetype: string;
  state: string;
  wallet: number;
  needs: Record<string, number>;
  bankroll: { bankroll: number; stopLoss: number; winGoal: number; bjError: number } | null;
  thought: string | null;
}

export interface StaffInspect {
  kind: 'staff';
  id: string;
  role: string;
  state: string;
  wagePerHour: number;
  assignedTo: string | null;
}

export type InspectResult = MachineInspect | GuestInspect | StaffInspect;

const idNum = (id: string) => Number(id.replace(/\D+/g, '')) || 0;

export function inspectObject(world: CasinoWorld, objectId: string): MachineInspect | null {
  const po = world.state.getObject(objectId);
  if (!po) return null;
  const def = getObjectDef(po.defId);
  const m = world.machines.get(objectId);
  const math = m?.math ?? null;
  const seated = m instanceof SeatedCasinoGame ? m.seatedCount : m?.reservedBy ? 1 : 0;
  const src = world.ledger.sources.get(objectId);
  return {
    kind: 'object',
    id: objectId,
    defId: po.defId,
    name: def?.name ?? po.defId,
    category: def?.category ?? 'decor',
    broken: m?.broken ?? false,
    open: m ? world.isTableOpen(objectId) : true,
    reliability: m?.reliability ?? 100,
    lifetimeProfit: m?.lifetimeProfit ?? 0,
    seats: m instanceof SeatedCasinoGame ? { used: m.seatedCount, total: m.seatCount } : null,
    game: math
      ? {
          kind: math.kind,
          rules: math.rules,
          edge: math.edge,
          appeal: math.appeal,
          roundsPerHour: math.roundsPerHour(Math.max(1, seated)),
        }
      : null,
    today: src
      ? {
          handle: src.wagered,
          win: src.wagered - src.won,
          hold: src.wagered > 0 ? (src.wagered - src.won) / src.wagered : null,
          theo: src.theo,
          rounds: src.rounds,
        }
      : null,
  };
}

/** Agents are picked by the numeric part of their id; guests win a tie. */
export function inspectAgent(
  world: CasinoWorld,
  agentId: number,
): GuestInspect | StaffInspect | null {
  for (const g of world.guests.values()) {
    if (idNum(g.id) !== agentId) continue;
    const p = g.profile;
    return {
      kind: 'guest',
      id: g.id,
      name: g.name,
      archetype: g.archetype,
      state: g.state,
      wallet: g.wallet,
      needs: { ...g.needs },
      bankroll: p
        ? { bankroll: p.bankroll, stopLoss: p.stopLoss, winGoal: p.winGoal, bjError: p.bjError }
        : null,
      thought: g.thoughts[g.thoughts.length - 1]?.text ?? null,
    };
  }
  for (const s of world.staff.values()) {
    if (idNum(s.id) !== agentId) continue;
    return staffView(s);
  }
  return null;
}

function staffView(s: CasinoWorld['staff'] extends Map<string, infer S> ? S : never): StaffInspect {
  return {
    kind: 'staff',
    id: s.id,
    role: s.kind,
    state: s.state,
    wagePerHour: s.wagePerHour,
    assignedTo: s.assignedTableId ?? s.assignedBarId ?? s.assignedCageId ?? s.jobId,
  };
}

export function staffList(world: CasinoWorld): StaffInspect[] {
  return [...world.staff.values()].map(staffView);
}

export function financials(world: CasinoWorld): CasinoFinancials & { wallet: number } {
  return { ...casinoFinancials(world.ledger), wallet: world.player.wallet };
}

export interface ScenarioInfo {
  id: string;
  name: string;
  tagline: string;
  startingCash: number;
  goalDailyProfit: number;
  dayLimit: number;
  goalWindowDays: number;
}

export function scenarioList(): ScenarioInfo[] {
  return SCENARIOS.map((c) => ({
    id: c.id,
    name: c.name,
    tagline: c.tagline,
    startingCash: c.startingCash,
    goalDailyProfit: c.goalDailyProfit,
    dayLimit: c.dayLimit,
    goalWindowDays: c.goalWindowDays,
  }));
}
