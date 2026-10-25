// Read-only views the lead's UI panels ask the worker for: the inspector,
// staff roster, P&L and scenario list. Pure functions of the world, so the
// panels never reach into sim internals and the tests can call them directly.

import {
  BAR_BALANCE,
  COMPS,
  DEALER_BALANCE,
  FOOD_BALANCE,
  PATRONS,
  PRICE_BALANCE,
  priceAppeal,
  RAGE_BALANCE,
  RATING_BALANCE,
  SECURITY_BALANCE,
  type CompKind,
} from '../data/balance';
import { SCENARIOS } from '../data/campaigns';
import { getDefaultMenuItem } from '../data/foodMenu';
import { getObjectDef } from '../data/objects';
import type { PatronVisit } from '../sim/patrons';
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
  /** B2: a carded patron's name on the roster and tier. */
  patron: { id: string; tier: string } | null;
  /** B2: whether a comp would land, and what each costs. */
  comp: {
    eligible: boolean;
    /** Comp dollars this guest may still take this session. */
    headroom: number;
    received: number;
    costs: Record<CompKind, number>;
  };
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
      patron: g.patronId && g.patronTier ? { id: g.patronId, tier: g.patronTier.name } : null,
      comp: compView(g),
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

export function financials(
  world: CasinoWorld,
): CasinoFinancials & { wallet: number; onTable: number } {
  return {
    ...casinoFinancials(world.ledger),
    wallet: world.player.wallet,
    onTable: world.player.onTable,
  };
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

// ---------- B2: rating, patrons, prices ----------

type Guest = CasinoWorld['guests'] extends Map<string, infer G> ? G : never;

function compView(g: Guest): GuestInspect['comp'] {
  return {
    eligible: g.compEligible,
    headroom: g.compHeadroom(),
    received: g.compsReceived,
    costs: { ...COMPS.compUnit },
  };
}

export type RatingTermId =
  | 'happiness'
  | 'machines'
  | 'variety'
  | 'cleanliness'
  | 'broken'
  | 'signage'
  | 'security'
  | 'dealers'
  | 'rage';

export interface RatingReport {
  total: number;
  /** Each term with its current value and the range it can reach. */
  terms: { id: RatingTermId; value: number; best: number; worst: number }[];
  /** The counts behind the terms, so the panel can say what to do. */
  facts: {
    avgHappiness: number;
    guests: number;
    games: number;
    gameKinds: number;
    messes: number;
    brokenGames: number;
    guards: number;
    dealtTables: number;
    tablesWithoutDealer: number;
  };
  reputation: { value: number; label: string; today: number };
}

export function ratingReport(world: CasinoWorld): RatingReport {
  const b = world.ratingBreakdown();
  const r = RATING_BALANCE;
  let broken = 0;
  let tables = 0;
  for (const m of world.machines.values()) {
    if (m.broken) broken++;
    if (m.needsDealer) tables++;
  }
  const staff = [...world.staff.values()];
  const guards = staff.filter((s) => s.kind === 'security' || s.kind === 'pitBoss').length;
  const dealers = staff.filter((s) => s.kind === 'dealer').length;
  return {
    total: b.total,
    terms: [
      { id: 'happiness', value: b.happiness, best: 100 * r.happinessWeight, worst: 0 },
      { id: 'machines', value: b.machines, best: r.machineCap, worst: 0 },
      { id: 'variety', value: b.variety, best: r.varietyBonus, worst: 0 },
      { id: 'cleanliness', value: b.cleanliness, best: r.cleanlinessMax, worst: 0 },
      {
        id: 'broken',
        value: b.broken,
        best: 0,
        worst: -world.machines.size * r.perBrokenPenalty,
      },
      { id: 'signage', value: b.signage, best: r.signageBonusCap, worst: 0 },
      { id: 'security', value: b.security, best: SECURITY_BALANCE.bonusCap, worst: 0 },
      { id: 'dealers', value: b.dealers, best: DEALER_BALANCE.dealerBonusCap, worst: 0 },
      { id: 'rage', value: b.rage, best: 0, worst: -RAGE_BALANCE.maxRatingPenalty },
    ],
    facts: {
      avgHappiness: world.averageHappiness,
      guests: world.guests.size,
      games: world.machines.size,
      gameKinds: new Set([...world.machines.values()].map((m) => m.defId)).size,
      messes: world.messes.size,
      brokenGames: broken,
      guards,
      dealtTables: Math.min(tables, dealers),
      tablesWithoutDealer: Math.max(0, tables - dealers),
    },
    reputation: {
      value: world.reputation.value,
      label: world.reputation.label,
      today: world.reputation.cappedDelta,
    },
  };
}

export interface PatronView {
  id: string;
  name: string;
  archetype: string;
  tier: string;
  /** The next rung and the lifetime theo it needs; null at the top. */
  nextTier: { name: string; theo: number } | null;
  lifetimeTheo: number;
  visits: number;
  lastSeenDay: number;
  recent: PatronVisit[];
  /** Wants a comp every visit or comes back less (Black tier). */
  wantsHost: boolean;
  /** Left un-comped last time; less likely to return until comped. */
  neglected: boolean;
  /** Drawn to come in today and not here yet. */
  dueToday: boolean;
  /** On the floor right now, with what a comp could still do. */
  onFloor: { guestId: string; agentId: number; comp: GuestInspect['comp'] } | null;
}

export function patronList(world: CasinoWorld): PatronView[] {
  const live = new Map<string, Guest>();
  for (const g of world.guests.values()) {
    if (g.patronId && g.state !== 'gone') live.set(g.patronId, g);
  }
  return world.patrons.all().map((p) => {
    const tier = p.tier;
    const next = PATRONS.tiers.find((t) => t.theo > p.lifetimeTheo) ?? null;
    const g = live.get(p.id);
    return {
      id: p.id,
      name: p.name,
      archetype: p.archetype,
      tier: tier.name,
      nextTier: next ? { name: next.name, theo: next.theo } : null,
      lifetimeTheo: p.lifetimeTheo,
      visits: p.visits,
      lastSeenDay: p.lastSeenDay,
      recent: p.recent.map((v) => ({ ...v })),
      wantsHost: tier.wantsHost,
      neglected: p.neglected,
      dueToday: world.patrons.isDue(p.id),
      onFloor: g ? { guestId: g.id, agentId: idNum(g.id), comp: compView(g) } : null,
    };
  });
}

export interface PriceItem {
  id: string;
  name: string;
  price: number;
  defaultPrice: number;
  /** What one costs the house. */
  cost: number;
  min: number;
  max: number;
  /** Above this, guests feel ripped off. */
  ripoffAbove: number;
  onSale: boolean;
}

export interface PricedObject {
  objectId: string;
  defId: 'food-stall' | 'bar';
  name: string;
  items: PriceItem[];
  /** Price over the default, and how strongly that pulls custom (1 = as at default). */
  priceIndex: number;
  appeal: number;
  today: { revenue: number; cost: number };
}

export function priceList(world: CasinoWorld): PricedObject[] {
  const out: PricedObject[] = [];
  for (const po of world.state.allObjects()) {
    const src = world.ledger.sources.get(po.id);
    const today = { revenue: src?.revenue ?? 0, cost: src?.upkeep ?? 0 };
    const bar = world.bars.get(po.id);
    if (bar) {
      const p = PRICE_BALANCE;
      out.push({
        objectId: po.id,
        defId: 'bar',
        name: getObjectDef(po.defId)?.name ?? 'Bar',
        items: [
          {
            id: 'drink',
            name: 'Drink',
            price: bar.price,
            defaultPrice: BAR_BALANCE.drinkPrice,
            cost: BAR_BALANCE.drinkCost,
            min: p.barPriceFloor,
            max: p.barPriceCeil,
            ripoffAbove: BAR_BALANCE.drinkPrice * p.ripoffIndex,
            onSale: true,
          },
        ],
        priceIndex: bar.priceIndex,
        appeal: priceAppeal(bar.priceIndex),
        today,
      });
      continue;
    }
    const stall = world.foodStalls.get(po.id);
    if (!stall) continue;
    out.push({
      objectId: po.id,
      defId: 'food-stall',
      name: getObjectDef(po.defId)?.name ?? 'Food Stall',
      items: stall.items.map((m) => ({
        id: m.id,
        name: m.name,
        price: m.currentPrice,
        defaultPrice: getDefaultMenuItem(m.id)?.currentPrice ?? m.currentPrice,
        cost: m.baseCost,
        min: m.baseCost * FOOD_BALANCE.priceFloorFactor,
        max: m.baseCost * FOOD_BALANCE.priceCeilFactor,
        ripoffAbove: m.baseCost * FOOD_BALANCE.ripoffMultiplier,
        onSale: m.isUnlocked,
      })),
      priceIndex: stall.priceIndex,
      appeal: priceAppeal(stall.priceIndex),
      today,
    });
  }
  return out;
}
