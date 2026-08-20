import { eventBus } from '../EventBus';
import { ENTRANCE_TILE, GRID_COLS, GRID_ROWS, HOURS_PER_DAY, JACKPOT_PAYOUT_MULT, STARTING_CASH } from '../config';
import {
  ARCHETYPE_BALANCE,
  BAR_BALANCE,
  CASHIER_BALANCE,
  COMPS,
  type CompKind,
  DEALER_BALANCE,
  DEBT,
  GUEST_BALANCE,
  MESS_BALANCE,
  RAGE_BALANCE,
  RATING_BALANCE,
  SECURITY_BALANCE,
} from '../data/balance';
import type { CampaignDef } from '../data/campaigns';
import { getObjectDef } from '../data/objects';
import { canPlaceObject, placeObject, sellObject, type PlaceCheck } from './build';
import { createMachine, createMachineOrThrow } from './entities/machines/factory';
import { PokerTable } from './entities/machines/PokerTable';
import { SeatedCasinoGame } from './entities/machines/SeatedCasinoGame';
import { Guest, type GuestArchetype } from './entities/Guest';
import { Bar, type BarJSON } from './entities/Bar';
import { FoodStall, type FoodStallJSON, type FoodPurchase } from './entities/FoodStall';
import type { Mess, MessKind } from './entities/Mess';
import { Staff, type StaffKind } from './entities/staff/Staff';
import { HOUSE_SOURCES, Ledger, type LedgerJSON } from './economy';
import { MoodField, type MoodFieldJSON } from './MoodField';
import { TrafficField, type TrafficFieldJSON } from './TrafficField';
import { ModifierSystem, type ModifierSystemJSON } from './modifiers';
import { type Patron, PatronRegistry, type PatronRegistryJSON } from './patrons';
import { Reputation, type ReputationJSON } from './reputation';
import { ScenarioManager, type ScenarioJSON } from './scenario/ScenarioManager';
import { interestFor } from './solvency';
import { TimeSystem, type TimeSystemJSON } from './TimeSystem';
import { type CasinoGame, type PlayCadence, type PlayResult } from './entities/machines/CasinoGame';
import { GameState, type GameStateJSON, type PlacedObject } from './GameState';
import { findPath, type Cell } from './grid/astar';
import { IsoGrid, type IsoGridJSON } from './grid/IsoGrid';
import { Rng } from './rng';

/** Ticks between overlay-field passes. Five is twice a second at
 *  SIM_TICKS_PER_SECOND — far finer than a player can perceive a heat map
 *  changing, and a fifth of the work of doing it every tick. */
const OVERLAY_SAMPLE_TICKS = 5;

// The sim's composition root and tick orchestrator. Owns state, grid, machine
// and guest registries. Presentation calls place/sell/tick and reads registries;
// everything else flows out through the EventBus.

export interface WorldOptions {
  seed?: number;
  autoSpawn?: boolean;
}

// Sim can't import src/ui/dom.ts's formatCash — that's presentation-layer.
function formatDollarAmount(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

/** Guests only come for the games; word of mouth (rating) does the rest. */
export function spawnChance(rating: number, machineCount: number): number {
  if (machineCount === 0) return 0;
  const b = GUEST_BALANCE;
  return Math.min(
    b.spawnCapPerTick,
    b.spawnBasePerTick + (rating / 100) * b.spawnRatingScalePerTick,
  );
}

interface MachineJSON {
  /** P4: the player's per-instance table minimum. Absent for fixed-denomination
   *  games, and absent in saves written before A2 — both default correctly. */
  tableMinimum?: number;
  id: string;
  defId: string;
  costToPlay: number;
  reliability: number;
  lifetimeProfit: number;
  broken: boolean;
}

interface MessJSON {
  id: string;
  kind: MessKind;
  col: number;
  row: number;
}

interface StaffJSON {
  id: string;
  kind: StaffKind;
  col: number;
  row: number;
}

/** The casino rating split into its contributing terms. Bonuses are positive,
 *  penalties negative; all nine terms sum to the pre-clamp score, and `total`
 *  is that score clamped to 0..100 and rounded. */
export interface RatingBreakdown {
  happiness: number;
  machines: number;
  variety: number;
  cleanliness: number;
  broken: number; // negative or zero
  signage: number;
  security: number;
  dealers: number;
  /** Decaying ding from guests who rage-quit. Negative or zero. */
  rage: number;
  total: number; // clamped 0..100
}

export interface CasinoWorldJSON {
  state: GameStateJSON;
  grid: IsoGridJSON;
  tickCount: number;
  machines: MachineJSON[];
  foodStalls: FoodStallJSON[];
  bars: BarJSON[];
  messes: MessJSON[];
  nextMessNum: number;
  staff: StaffJSON[];
  nextStaffNum: number;
  time: TimeSystemJSON;
  ledger: LedgerJSON;
  scenario: ScenarioJSON | null;
  modifiers: ModifierSystemJSON;
  reputation: ReputationJSON;
  /** P3 — the carded roster. Required from SAVE_VERSION 4 up; older files get
   *  an empty registry from the migration ladder rather than a missing key. */
  patrons: PatronRegistryJSON;
  /** Optional: added after SAVE_VERSION 3, and absent from both a v3 save
   *  written before it and a v2 file migrated up. `MoodField.fromJSON` starts
   *  empty in either case, which is exactly right — a returning player's mood
   *  map should reflect where guests walk now, not be invented for them. */
  mood?: MoodFieldJSON;
  /** Optional for the same reason as `mood` — absent from any save written
   *  before P2, and an empty field is the right answer there. */
  traffic?: TrafficFieldJSON;
}

export class CasinoWorld {
  state: GameState;
  grid: IsoGrid;
  rng: Rng;
  /** Separate stream for archetype selection so a guest's cosmetic archetype
   *  roll never perturbs the shared `rng` stream's call count — every other
   *  system's draws (payouts, spawn timing, ...) stay byte-identical to a
   *  build with no archetypes at all, for the same world seed. */
  private archetypeRng: Rng;
  /** Same reasoning as archetypeRng: the once-a-day modifier draw must not
   *  shift the call count of the shared stream, or every payout and spawn in
   *  the game changes the moment A5 lands. */
  private modifierRng: Rng;
  /** Same reasoning again for P3: the once-a-day return draw must not shift
   *  the shared stream, or adding patrons re-rolls the whole game for a seed. */
  private patronRng: Rng;
  machines = new Map<string, CasinoGame>();
  foodStalls = new Map<string, FoodStall>();
  bars = new Map<string, Bar>();
  guests = new Map<string, Guest>();
  messes = new Map<string, Mess>();
  staff = new Map<string, Staff>();
  time = new TimeSystem();
  ledger = new Ledger();
  /** A5 — the day's conditions. Queried at the point of use by spawn, wallet,
   *  cage, and thirst code; it owns no simulation of its own. */
  modifiers = new ModifierSystem();
  /** A12 — the persistent scalar that makes yesterday visible in today's mix. */
  reputation = new Reputation();
  /** B3-mood — where on the floor guests are happy. Sampled, not counted:
   *  every guest every tick is 130 writes at 10Hz for a map that only needs to
   *  be right on a human timescale. */
  mood = new MoodField();
  /** P2 — decayed per-tile footfall, written on guest tile-enter. */
  traffic = new TrafficField();
  /** P3/A1b — the bounded roster of carded patrons. Data records, not agents:
   *  nothing here ticks, and a record only becomes a live Guest on a visit. */
  patrons = new PatronRegistry();
  scenario: ScenarioManager | null = null;
  tickCount = 0;
  entranceTile: Cell = { ...ENTRANCE_TILE };
  autoSpawn: boolean;
  private nextGuestNum = 1;
  private nextMessNum = 1;
  private nextStaffNum = 1;
  /** machineId → staffId, so two mechanics never race to the same repair. */
  private repairClaims = new Map<string, string>();
  /** guestId → staffId, so two waitresses never race to the same delivery. */
  private drinkClaims = new Map<string, string>();
  /** tableId → staffId, so two dealers never race for the same table. */
  private dealerAssignments = new Map<string, string>();
  /** cageId → staffId, so two cashiers never race for the same cage. */
  private cashierAssignments = new Map<string, string>();
  private ragePenalty = 0;
  /** Hourly cleanliness samples for the day in progress. The A5 health
   *  inspection grades the day, not the midnight instant: with only five mess
   *  slots on the scale, a snapshot fails on a single spill the janitor was
   *  three tiles away from, which is the "unwinnable regardless of play"
   *  outcome the modifier is explicitly not allowed to have. */
  private cleanlinessSamples: number[] = [];
  /** Recomputed on every floor change and once per tick — see hasServiceObject. */
  private serviceAvailability: Record<string, boolean> = {
    toilet: false,
    bar: false,
    'food-stall': false,
  };

  constructor(opts: WorldOptions = {}) {
    this.state = new GameState();
    this.grid = new IsoGrid(GRID_COLS, GRID_ROWS);
    const seed = opts.seed ?? Date.now() >>> 0;
    this.rng = new Rng(seed);
    this.archetypeRng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    this.modifierRng = new Rng((seed ^ 0x85ebca6b) >>> 0);
    this.patronRng = new Rng((seed ^ 0xc2b2ae35) >>> 0);
    this.autoSpawn = opts.autoSpawn ?? true;
  }

  // ---------- scenarios ----------

  /** Start a campaign (or `null` for sandbox): full floor wipe + fresh clock/books. */
  startScenario(def: CampaignDef | null): void {
    this.reset(def?.startingCash ?? STARTING_CASH);
    this.scenario = def ? new ScenarioManager(def) : null;
    // Day 1 gets conditions too. Without this the first day is always the
    // quiet baseline, which teaches the player that modifiers are rare.
    this.modifiers.drawForDay(this.time.day, this.modifierRng);
    eventBus.emit('worldReset', { scenarioId: def?.id ?? null });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: 0 });
    eventBus.emit('hourPassed', { hour: this.time.hour, day: this.time.day });
  }

  /** In-place wipe — `state` and `grid` stay the same objects (gameContext aliases them). */
  private reset(startingCash: number): void {
    this.guests.clear();
    this.staff.clear();
    this.messes.clear();
    this.machines.clear();
    this.foodStalls.clear();
    this.bars.clear();
    this.repairClaims.clear();
    this.drinkClaims.clear();
    this.dealerAssignments.clear();
    this.cashierAssignments.clear();
    this.grid.clear();
    this.state.reset(startingCash);
    this.refreshServiceAvailability();
    this.time = new TimeSystem();
    this.ledger = new Ledger();
    this.cleanlinessSamples = [];
    this.modifiers = new ModifierSystem();
    this.reputation = new Reputation();
    this.mood = new MoodField();
    this.traffic = new TrafficField();
    this.patrons = new PatronRegistry();
    this.tickCount = 0;
    this.nextGuestNum = 1;
    this.nextMessNum = 1;
    this.nextStaffNum = 1;
  }

  isObjectAllowed(defId: string): boolean {
    return this.scenario ? this.scenario.isAllowed(defId) : true;
  }

  // ---------- building ----------

  canPlace(defId: string, col: number, row: number): PlaceCheck {
    if (!this.isObjectAllowed(defId)) return { ok: false, reason: 'not-allowed' };
    return canPlaceObject(this.state, this.grid, defId, col, row);
  }

  place(defId: string, col: number, row: number): PlacedObject | null {
    if (!this.isObjectAllowed(defId)) return null;
    const po = placeObject(this.state, this.grid, defId, col, row);
    if (po) {
      const machine = createMachine(defId, po.id);
      if (machine) this.machines.set(po.id, machine);
    }
    if (po && defId === 'food-stall') this.foodStalls.set(po.id, new FoodStall(po.id));
    if (po && defId === 'bar') this.bars.set(po.id, new Bar(po.id));
    if (po) this.refreshServiceAvailability();
    return po;
  }

  sell(objectId: string): number | null {
    const machine = this.machines.get(objectId);
    if (machine) {
      // Guests holding a reference re-evaluate on their next tick.
      machine.broken = true;
      machine.releaseAll();
      this.machines.delete(objectId);
      this.repairClaims.delete(objectId);
      this.dealerAssignments.delete(objectId);
    }
    this.foodStalls.delete(objectId);
    this.bars.delete(objectId);
    this.cashierAssignments.delete(objectId);
    const refund = sellObject(this.state, this.grid, objectId);
    this.refreshServiceAvailability();
    return refund;
  }

  /**
   * Whether a service object of this type exists on the floor. Backed by a
   * cache refreshed on every floor change and at the top of each tick: guests
   * query this every tick, and scanning all placed objects per guest would be
   * O(objects x guests) per tick.
   */
  hasServiceObject(defId: string): boolean {
    return this.serviceAvailability[defId] ?? false;
  }

  /** Rebuild the hasServiceObject cache from the current floor. */
  private refreshServiceAvailability(): void {
    const found: Record<string, boolean> = { toilet: false, bar: false, 'food-stall': false };
    for (const po of this.state.allObjects()) {
      if (po.defId in found) found[po.defId] = true;
    }
    this.serviceAvailability = found;
  }

  // ---------- simulation ----------

  tick(): void {
    this.tickCount++;
    // Before guests run: they read it, and staff/scenario code may have built
    // or sold since the last refresh.
    this.refreshServiceAvailability();
    const t = this.time.tick();
    if (this.autoSpawn) this.maybeSpawn();
    this.applyMessEffects();
    for (const guest of this.guests.values()) guest.tick(this);
    for (const [id, guest] of [...this.guests]) {
      if (guest.state === 'gone') {
        // Read before the fold: foldGuestSession zeroes the session.
        if (guest.leavingContent) this.reputation.onContentLeaver();
        // Before the fold for the same reason: it reads guest.theo(), which
        // the fold does not clear, but the ordering keeps the two reads of a
        // departing session next to each other.
        this.recordPatronDeparture(guest);
        this.foldGuestSession(guest);
        this.guests.delete(id);
        eventBus.emit('guestLeft', { id });
      }
    }
    for (const member of this.staff.values()) member.tick(this);
    if (this.tickCount % OVERLAY_SAMPLE_TICKS === 0) {
      this.sampleMood();
      // Traffic is written on tile-enter, so only its ageing rides this pass.
      this.traffic.decay();
    }
    if (t.hourPassed) this.onHourBoundary(t.midnight);
  }

  /** Bookkeeping at every hour boundary; midnight also rolls the day over. */
  private onHourBoundary(midnight: boolean): void {
    this.ragePenalty = Math.max(0, this.ragePenalty - RAGE_BALANCE.dingDecayPerHour);
    // The hour that just completed (time already shows the new hour/day).
    const closedHour = this.time.hour === 0 ? HOURS_PER_DAY - 1 : this.time.hour - 1;
    const closedDay = this.time.hour === 0 ? this.time.day - 1 : this.time.day;
    this.chargeWages();
    this.cleanlinessSamples.push(this.cleanlinessPct);
    if (midnight) {
      this.chargeUpkeep();
      for (const guest of this.guests.values()) this.foldGuestSession(guest);
    }
    this.ledger.closeHour(closedDay, closedHour, this.guests.size);
    eventBus.emit('hourPassed', { hour: this.time.hour, day: this.time.day });
    if (midnight) {
      // Settle the closing day's conditions before the books close, so a fine
      // lands in the day that earned it rather than the one that follows.
      const modifierIds = this.modifiers.activeModifiers.map((m) => m.id);
      const { penalty, reasons } = this.modifiers.settleDay(this.dayCleanlinessPct);
      this.cleanlinessSamples = [];
      if (penalty > 0) {
        this.state.cash -= penalty;
        this.ledger.addExpense(penalty);
        this.ledger.accrue(HOUSE_SOURCES.fines.id, HOUSE_SOURCES.fines.defId, { upkeep: penalty });
        eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -penalty });
        eventBus.emit('tickerMessage', {
          text: `${reasons.join(' and ')} failed — ${formatDollarAmount(penalty)} in fines.`,
          severity: 'alert',
        });
      }
      const repDelta = this.reputation.closeDay();
      eventBus.emit('reputationChanged', { value: this.reputation.value, delta: repDelta });
      // P16: interest on the closing balance, charged before the books close
      // so the cost of the debt lands in the day that ran it — the same
      // reasoning as the modifier fine above.
      const interest = interestFor(this.state.cash, DEBT.dailyInterestRate);
      if (interest > 0) {
        this.state.cash -= interest;
        this.ledger.addInterest(interest);
        this.ledger.accrue(HOUSE_SOURCES.interest.id, HOUSE_SOURCES.interest.defId, {
          upkeep: interest,
        });
        eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -interest });
        eventBus.emit('tickerMessage', {
          text: `Interest on the overdraft — ${formatDollarAmount(interest)}.`,
          severity: 'alert',
        });
      }
      const record = this.ledger.closeDay(closedDay, {
        reputation: this.reputation.value,
        reputationDelta: repDelta,
        modifierIds,
      });
      this.scenario?.onDayEnded(record);
      // Draw for the day that just began, after the close so the report shows
      // the conditions the closed day was played under.
      this.modifiers.drawForDay(this.time.day, this.modifierRng);
      // P3: prune the roster and draw who is expected in, for the day that
      // just began. Announced up front — Dave the Diver's flagged VIP night —
      // so the player can plan the evening instead of discovering it.
      const due = this.patrons.drawForDay(this.time.day, this.patronRng, this.livePatronIds());
      if (due.length > 0) {
        const names = due.slice(0, 3).map((p) => p.name);
        const rest = due.length - names.length;
        eventBus.emit('tickerMessage', {
          text: `Expected in today: ${names.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}.`,
        });
      }
      eventBus.emit('dayEnded', { day: record.day, profit: record.profit });
      const top = record.winners[0];
      if (top && top.net > 0) {
        eventBus.emit('tickerMessage', {
          text: `Yesterday: ${top.name} took us for ${formatDollarAmount(top.net)}!`,
        });
      }
    }
  }

  /** Record a guest's running session into today's ledger, then reset it so
   * a later fold (midnight, or eventual departure) doesn't double-count. */
  private foldGuestSession(guest: Guest): void {
    if (guest.netResult === 0) return;
    this.ledger.recordGuestSession({
      name: guest.name,
      netResult: guest.netResult,
      favoriteGame: guest.favoriteGame(),
    });
    guest.netResult = 0;
  }

  private chargeWages(): void {
    let total = 0;
    for (const member of this.staff.values()) total += member.wagePerHour;
    if (total === 0) return;
    this.state.cash -= total;
    this.ledger.addExpense(total);
    // Wages belong to no object. Booked to a house source rather than spread
    // across the floor, because attributing a janitor's pay to a slot machine
    // would be an invention, and the drill-down has to reconcile with the day.
    this.ledger.accrue(HOUSE_SOURCES.wages.id, HOUSE_SOURCES.wages.defId, { upkeep: total });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -total });
  }

  private chargeUpkeep(): void {
    let total = 0;
    for (const po of this.state.allObjects()) {
      const upkeep = getObjectDef(po.defId)?.upkeepPerDay ?? 0;
      if (upkeep === 0) continue;
      total += upkeep;
      // Upkeep is per-object and always was — this is the one expense that
      // attributes exactly, with no allocation judgement at all.
      this.ledger.accrue(po.id, po.defId, { upkeep });
    }
    if (total === 0) return;
    this.state.cash -= total;
    this.ledger.addExpense(total);
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -total });
  }

  /** Nearby messes sour guests: happiness drain + a flag the thought system reads. */
  private applyMessEffects(): void {
    const b = MESS_BALANCE;
    for (const guest of this.guests.values()) {
      let count = 0;
      for (const mess of this.messes.values()) {
        if (
          Math.abs(mess.col - guest.pos.col) <= b.radius &&
          Math.abs(mess.row - guest.pos.row) <= b.radius
        ) {
          count++;
          if (count >= b.maxDrainStacks) break;
        }
      }
      guest.nearMess = count > 0;
      if (count > 0) guest.adjustHappiness(-b.happinessDrainPerTickNearby * count);
    }
  }

  /** Mean guest happiness, or the neutral assumption when the floor is empty. */
  get averageHappiness(): number {
    const guests = [...this.guests.values()];
    return guests.length
      ? guests.reduce((sum, g) => sum + g.needs.happiness, 0) / guests.length
      : RATING_BALANCE.neutralHappiness;
  }

  /** Every contribution to the casino rating, term by term, so the UI can
   *  explain the number instead of just showing it. Terms sum to the
   *  pre-clamp score; `total` is that score clamped to 0..100 and rounded. */
  ratingBreakdown(): RatingBreakdown {
    const b = RATING_BALANCE;
    const avgHappiness = this.averageHappiness;
    const variety = new Set([...this.machines.values()].map((m) => m.defId)).size;
    let broken = 0;
    for (const m of this.machines.values()) if (m.broken) broken++;
    let signageBonus = 0;
    for (const po of this.state.allObjects()) {
      signageBonus += getObjectDef(po.defId)?.ratingBonus ?? 0;
    }
    signageBonus = Math.min(signageBonus, b.signageBonusCap);
    let securityBonus = 0;
    for (const m of this.staff.values()) {
      if (m.kind === 'pitBoss' || m.kind === 'security') {
        securityBonus += SECURITY_BALANCE.bonusPerStaff;
      }
    }
    securityBonus = Math.min(securityBonus, SECURITY_BALANCE.bonusCap);
    const dealerBonus = Math.min(
      this.dealerAssignments.size * DEALER_BALANCE.dealerBonusPerTable,
      DEALER_BALANCE.dealerBonusCap,
    );

    const terms = {
      happiness: b.happinessWeight * avgHappiness,
      machines: Math.min(this.machines.size * b.perMachine, b.machineCap),
      variety: variety >= 2 ? b.varietyBonus : 0,
      cleanliness: Math.max(0, b.cleanlinessMax - this.messes.size * b.perMessPenalty),
      // Guard the sign so an unbroken floor reports 0, not -0.
      broken: broken ? -(broken * b.perBrokenPenalty) : 0,
      signage: signageBonus,
      security: securityBonus,
      dealers: dealerBonus,
      rage: this.ragePenalty ? -this.ragePenalty : 0,
    };
    const score =
      terms.happiness +
      terms.machines +
      terms.variety +
      terms.cleanliness +
      terms.broken +
      terms.signage +
      terms.security +
      terms.dealers +
      terms.rage;
    return { ...terms, total: Math.round(Math.min(100, Math.max(0, score))) };
  }

  /** One pass over the guests, folded into the mood field. Runs on a cadence
   *  rather than every tick — see MOOD_SAMPLE_TICKS. */
  private sampleMood(): void {
    this.mood.decay();
    for (const guest of this.guests.values()) {
      if (guest.state === 'gone') continue;
      this.mood.sample(guest.pos.col, guest.pos.row, guest.needs.happiness);
    }
  }

  /** Cleanliness as a 0–100 percentage rather than a rating term, which is
   *  what the A5 health inspection is specified against. */
  get cleanlinessPct(): number {
    const b = RATING_BALANCE;
    const term = Math.max(0, b.cleanlinessMax - this.messes.size * b.perMessPenalty);
    return (term / b.cleanlinessMax) * 100;
  }

  /** Mean cleanliness across the hours of the day so far. Falls back to the
   *  live figure before the first hour boundary has been crossed. */
  get dayCleanlinessPct(): number {
    if (this.cleanlinessSamples.length === 0) return this.cleanlinessPct;
    const sum = this.cleanlinessSamples.reduce((a, b) => a + b, 0);
    return sum / this.cleanlinessSamples.length;
  }

  /** Casino rating 0–100 — drives guest arrivals; shown in UI later. */
  get rating(): number {
    return this.ratingBreakdown().total;
  }

  /** P16 — how far below zero this run may go. Campaigns name their own; the
   *  sandbox takes the module default. */
  get creditLimit(): number {
    return this.scenario?.def.creditLimit ?? DEBT.defaultCreditLimit;
  }

  private maybeSpawn(): void {
    if (this.guests.size >= GUEST_BALANCE.maxGuests) return;
    const chance = spawnChance(this.rating, this.machines.size) * this.modifiers.spawnMult();
    if (!this.rng.chance(chance)) return;
    if (!this.grid.isWalkable(this.entranceTile.col, this.entranceTile.row)) return;
    this.spawnGuest();
  }

  spawnGuest(archetypeOverride?: GuestArchetype): Guest {
    const id = `g-${this.nextGuestNum++}`;
    // A1b: a patron drawn for today takes the next arrival rather than being
    // spawned on a schedule of their own. Returning through the same door
    // keeps the guest cap, the spawn pacing, and the floor's economics exactly
    // as they were — the registry rehydrates into an ordinary Guest and then
    // has nothing further to do with them until they leave.
    const patron = archetypeOverride === undefined ? this.patrons.takeDue() : null;
    const archetype = archetypeOverride ?? patron?.archetype ?? this.rollArchetype();
    const baseWallet =
      archetype === 'highRoller'
        ? this.rng.int(ARCHETYPE_BALANCE.highRollerWalletMin, ARCHETYPE_BALANCE.highRollerWalletMax)
        : this.rng.int(GUEST_BALANCE.walletMin, GUEST_BALANCE.walletMax);
    // Floored at 1 so a stacked wallet penalty can never spawn a guest who is
    // broke on arrival and walks straight back out.
    const wallet = Math.max(1, Math.round(baseWallet * this.modifiers.walletMult()));
    const guest = new Guest(
      id,
      wallet,
      this.entranceTile,
      archetype,
      patron ? { id: patron.id, name: patron.name, tier: patron.tier } : null,
    );
    this.guests.set(id, guest);
    eventBus.emit('guestSpawned', { id, archetype: guest.archetype });
    if (patron) this.announcePatronArrival(patron);
    return guest;
  }

  /**
   * The host, doing the tracking so the player never has to.
   *
   * This is the whole player-facing surface of a return visit: a line in the
   * ticker naming someone the player already knows. A black-tier patron's
   * arrival is escalated to an alert, because that tier's benefit is only felt
   * if failing to look after them is something the player can notice and lose.
   */
  private announcePatronArrival(patron: Patron): void {
    const visit = patron.visits + 1;
    if (patron.tier.wantsHost) {
      eventBus.emit('tickerMessage', {
        text: `${patron.name} (${patron.tier.name}) is on the floor — visit ${visit}. Look after them.`,
        severity: 'alert',
      });
      return;
    }
    eventBus.emit('tickerMessage', {
      text: `${patron.name} (${patron.tier.name}) is back — visit ${visit}.`,
    });
  }

  /** Patron ids with a live guest on the floor right now. The registry cannot
   *  see the floor, and every one of its removals — prune, cap eviction, the
   *  daily return draw — is wrong for someone who is standing in the room. */
  private livePatronIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const guest of this.guests.values()) {
      if (guest.patronId) ids.add(guest.patronId);
    }
    return ids;
  }

  /** Fold a departing guest into the roster and say what it did. Called once,
   *  on the actual departure — see PatronRegistry.recordDeparture. */
  private recordPatronDeparture(guest: Guest): void {
    const out = this.patrons.recordDeparture(guest, this.time.day, this.livePatronIds());
    if (!out.patron) return;
    if (out.carded) {
      eventBus.emit('tickerMessage', {
        text: `${out.patron.name} just earned a player's card — ${out.patron.tier.name}.`,
      });
      return;
    }
    if (out.promotedTo) {
      eventBus.emit('tickerMessage', {
        text: `${out.patron.name} is now a ${out.promotedTo.name} player.`,
      });
      return;
    }
    if (out.neglected) {
      eventBus.emit('tickerMessage', {
        text: `${out.patron.name} left without so much as a drink.`,
        severity: 'warn',
      });
    }
  }

  /** Single bucketed roll on the dedicated archetypeRng (see its field
   *  comment) — every archetype is independently weighted by its slice of
   *  the [0,1) range. */
  private rollArchetype(): GuestArchetype {
    const b = ARCHETYPE_BALANCE;
    // A5 conditions and A12 reputation both bias the same roll, multiplicatively
    // — a convention during a strong reputation stacks, which is the point.
    const bias = (a: GuestArchetype) =>
      this.modifiers.archetypeBias(a) * this.reputation.archetypeMultiplier(a);
    const highRoller = b.highRollerChance * bias('highRoller');
    const biker = b.bikerChance * bias('biker');
    const tourist = b.touristChance * bias('tourist');
    // Renormalize when the biased weights would overflow the roll's range, so
    // 'regular' degrades smoothly instead of vanishing at a cliff.
    const total = highRoller + biker + tourist;
    const scale = total > 1 ? 1 / total : 1;
    const roll = this.archetypeRng.next();
    if (roll < highRoller * scale) return 'highRoller';
    if (roll < (highRoller + biker) * scale) return 'biker';
    if (roll < (highRoller + biker + tourist) * scale) return 'tourist';
    return 'regular';
  }

  // ---------- staff ----------

  hireStaff(kind: StaffKind): Staff {
    const member = new Staff(`s-${this.nextStaffNum++}`, kind, this.entranceTile);
    this.staff.set(member.id, member);
    eventBus.emit('staffHired', { id: member.id, kind });
    eventBus.emit('tickerMessage', { text: `Hired a ${kind}.` });
    return member;
  }

  fireStaff(id: string): boolean {
    const member = this.staff.get(id);
    if (!member) return false;
    this.releaseJobs(id);
    this.staff.delete(id);
    eventBus.emit('staffFired', { id, kind: member.kind });
    eventBus.emit('tickerMessage', { text: `A ${member.kind} was let go.` });
    return true;
  }

  pickUpStaff(id: string): boolean {
    const member = this.staff.get(id);
    if (!member) return false;
    member.pickUp(this);
    return true;
  }

  dropStaff(id: string, col: number, row: number): boolean {
    const member = this.staff.get(id);
    if (!member || !this.grid.isWalkable(col, row)) return false;
    member.drop({ col, row });
    return true;
  }

  /** Find and claim the next job matching this staffer's role. */
  claimJobFor(member: Staff): { jobId: string; cell: Cell } | null {
    if (member.kind === 'mechanic') {
      for (const machine of this.machines.values()) {
        if (!machine.broken || this.repairClaims.has(machine.id)) continue;
        const po = this.state.getObject(machine.id);
        if (!po) continue;
        const stand = this.standTileFor(po);
        if (!stand) continue;
        this.repairClaims.set(machine.id, member.id);
        return { jobId: machine.id, cell: stand };
      }
      return null;
    }
    if (member.kind === 'waitress') {
      for (const guest of this.guests.values()) {
        if (guest.state !== 'play' || !guest.waitingForDrink || this.drinkClaims.has(guest.id)) {
          continue;
        }
        this.drinkClaims.set(guest.id, member.id);
        return { jobId: guest.id, cell: { ...guest.pos } };
      }
      return null;
    }
    if (member.kind === 'janitor') {
      for (const mess of this.messes.values()) {
        if (mess.claimedBy) continue;
        mess.claimedBy = member.id;
        return { jobId: mess.id, cell: { col: mess.col, row: mess.row } };
      }
      return null;
    }
    // bartender never calls this (see Staff.actBartender); pitBoss/security
    // are pure ambient patrol and never claim a job either.
    return null;
  }

  isJobStillValid(member: Staff): boolean {
    if (!member.jobId) return false;
    if (member.kind === 'mechanic') {
      const machine = this.machines.get(member.jobId);
      return !!machine && machine.broken && this.repairClaims.get(member.jobId) === member.id;
    }
    if (member.kind === 'waitress') {
      const guest = this.guests.get(member.jobId);
      return (
        !!guest &&
        guest.state === 'play' &&
        guest.waitingForDrink &&
        this.drinkClaims.get(member.jobId) === member.id
      );
    }
    // Only janitor reaches here — pitBoss/security never hold a jobId, so the
    // `if (!member.jobId) return false;` guard above already excludes them.
    return this.messes.get(member.jobId)?.claimedBy === member.id;
  }

  completeJob(member: Staff): void {
    if (!member.jobId) return;
    if (member.kind === 'mechanic') {
      const machine = this.machines.get(member.jobId);
      this.repairClaims.delete(member.jobId);
      if (!machine || !machine.broken) return;
      machine.reliability = 100;
      machine.broken = false;
      eventBus.emit('machineFixed', { machineId: machine.id });
      eventBus.emit('tickerMessage', { text: 'A machine has been repaired!' });
      return;
    }
    if (member.kind === 'waitress') {
      const guestId = member.jobId;
      this.drinkClaims.delete(guestId);
      const guest = this.guests.get(guestId);
      const bar = this.findBar();
      if (!guest || !guest.waitingForDrink || !bar) return; // try again later
      const purchase = this.buyDrink(bar.barId, guest.wallet);
      if (!purchase) return;
      guest.wallet -= purchase.price;
      guest.needs.thirst = BAR_BALANCE.thirstRestore;
      guest.adjustHappiness(BAR_BALANCE.happinessOnDelivery);
      guest.waitingForDrink = false;
      return;
    }
    // Only janitor reaches here — pitBoss/security never claim a job in the
    // first place (see claimJobFor), so completeJob is unreachable for them.
    this.cleanMess(member.jobId);
  }

  releaseJobs(staffId: string): void {
    for (const [machineId, claimant] of this.repairClaims) {
      if (claimant === staffId) this.repairClaims.delete(machineId);
    }
    for (const [guestId, claimant] of this.drinkClaims) {
      if (claimant === staffId) this.drinkClaims.delete(guestId);
    }
    for (const [tableId, claimant] of this.dealerAssignments) {
      if (claimant === staffId) this.dealerAssignments.delete(tableId);
    }
    for (const [cageId, claimant] of this.cashierAssignments) {
      if (claimant === staffId) this.cashierAssignments.delete(cageId);
    }
    for (const mess of this.messes.values()) {
      if (mess.claimedBy === staffId) mess.claimedBy = null;
    }
  }

  /** Claim the nearest dealable table without a dealer already assigned.
   * "Dealable" is a capability, not a list of defIds: any SeatedCasinoGame
   * qualifies, so every communal table (blackjack, craps, roulette, poker,
   * high-limit) is covered and the standing Big Six wheel correctly is not.
   * Claims immediately (before the caller attempts to path to it), mirroring
   * claimJobFor's shape, so two dealers evaluated in the same tick never
   * claim the same table — staff tick sequentially within a tick, so the
   * second dealer's scan already sees the first's claim. */
  claimDealerTable(staffId: string): { tableId: string; stand: Cell } | null {
    for (const po of this.state.allObjects()) {
      if (!(this.machines.get(po.id) instanceof SeatedCasinoGame)) continue;
      if (this.dealerAssignments.has(po.id)) continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      this.dealerAssignments.set(po.id, staffId);
      return { tableId: po.id, stand };
    }
    return null;
  }

  /** False once the table is sold (sell() clears the entry) or reassigned —
   * tells a dealer its claim on `tableId` no longer holds. */
  isDealerAssignmentValid(staffId: string, tableId: string): boolean {
    return this.dealerAssignments.get(tableId) === staffId;
  }

  /** Put a just-claimed-but-unreachable table's claim back. */
  releaseDealerClaim(tableId: string): void {
    this.dealerAssignments.delete(tableId);
  }

  /** Claim the nearest cage without a cashier already stationed — same
   * immediate-claim shape as claimDealerTable, for the same reason. */
  claimCashierCage(staffId: string): { cageId: string; stand: Cell } | null {
    for (const po of this.state.allObjects()) {
      if (po.defId !== 'cage') continue;
      if (this.cashierAssignments.has(po.id)) continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      this.cashierAssignments.set(po.id, staffId);
      return { cageId: po.id, stand };
    }
    return null;
  }

  /** False once the cage is sold or reassigned. */
  isCashierAssignmentValid(staffId: string, cageId: string): boolean {
    return this.cashierAssignments.get(cageId) === staffId;
  }

  /** Put a just-claimed-but-unreachable cage's claim back. */
  releaseCashierClaim(cageId: string): void {
    this.cashierAssignments.delete(cageId);
  }

  /** An operational cage: has a cashier actually stationed there right now
   * (mirrors findBar's stock gate — presence instead of stock; unlike
   * dealerAssignments/repairClaims-style "claimed" checks, this specifically
   * requires the assigned staffer to have arrived, not just be en route) and
   * a walkable stand tile. */
  findCage(): { cageId: string; stand: Cell } | null {
    for (const po of this.state.allObjects()) {
      if (po.defId !== 'cage') continue;
      const staffId = this.cashierAssignments.get(po.id);
      if (!staffId || this.staff.get(staffId)?.state !== 'stationed') continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      return { cageId: po.id, stand };
    }
    return null;
  }

  /** One-time wallet top-up net of the fee; null if the wallet can't cover
   * the fee at all. */
  useCage(wallet: number, cageId?: string): { advance: number } | null {
    if (wallet < CASHIER_BALANCE.fee) return null;
    this.state.cash += CASHIER_BALANCE.fee;
    this.ledger.addRevenue(CASHIER_BALANCE.fee);
    if (cageId) this.ledger.accrue(cageId, 'cage', { revenue: CASHIER_BALANCE.fee });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: CASHIER_BALANCE.fee });
    // A5 'chip shortage' thins the advance. The fee is unchanged: the cage
    // still charges full price for less money, which is the whole bite.
    const advance = Math.round(CASHIER_BALANCE.advanceAmount * this.modifiers.cageCapacityMult());
    return { advance };
  }

  /** Public wrapper so Staff.ts (cashier) can reach a cage's stand tile,
   * mirroring barStandTile. */
  cageStandTile(cageId: string): Cell | null {
    const po = this.state.getObject(cageId);
    return po ? this.standTileFor(po) : null;
  }

  /** One-time rating ding from a rage quit; decays over subsequent hours. */
  applyRageQuitPenalty(): void {
    this.ragePenalty = Math.min(RAGE_BALANCE.maxRatingPenalty, this.ragePenalty + RAGE_BALANCE.ratingDing);
    this.ledger.recordRageQuit();
    this.reputation.onRageQuit();
  }

  // ---------- mess ----------

  dropMess(col: number, row: number, kind: MessKind): Mess | null {
    if (this.messes.size >= MESS_BALANCE.maxMesses) return null;
    const mess: Mess = { id: `m-${this.nextMessNum++}`, kind, col, row, claimedBy: null };
    this.messes.set(mess.id, mess);
    eventBus.emit('messCreated', { id: mess.id, col, row, kind });
    return mess;
  }

  cleanMess(id: string): boolean {
    if (!this.messes.delete(id)) return false;
    eventBus.emit('messCleaned', { id });
    return true;
  }

  // ---------- guest support ----------

  pathTo(from: Cell, to: Cell): Cell[] | null {
    return findPath(this.grid, from, to);
  }

  randomWalkableTile(): Cell | null {
    for (let i = 0; i < 25; i++) {
      const col = this.rng.int(1, GRID_COLS - 2);
      const row = this.rng.int(1, GRID_ROWS - 2);
      if (this.grid.isWalkable(col, row)) return { col, row };
    }
    return null;
  }

  reserveMachine(guestId: string, wallet: number): { machineId: string; stand: Cell } | null {
    for (const machine of this.machines.values()) {
      if (!machine.isAvailable || wallet < machine.costToPlay) continue;
      // Per-game wallet floor on top of the affordability test above. Defaults
      // to 0 on CasinoGame, so this can never exclude an ungated game.
      if (wallet < machine.minWallet) continue;
      const po = this.state.getObject(machine.id);
      if (!po) continue;
      if (machine instanceof SeatedCasinoGame) {
        // Seat indices align with the seat cells around the footprint.
        const cells = this.seatCellsFor(po);
        for (let seat = 0; seat < cells.length; seat++) {
          const cell = cells[seat]!;
          if (!machine.isSeatFree(seat) || !this.grid.isWalkable(cell.col, cell.row)) continue;
          // seatCellsFor enumerates the whole perimeter, which is more cells
          // than most tables have seats, so this can be handed an index the
          // table doesn't have. isSeatFree already rejects those, but don't
          // rely on that alone to keep the guest off a seat it never claimed.
          if (machine.claimSeat(guestId, seat) === null) continue;
          return { machineId: machine.id, stand: cell };
        }
        continue;
      }
      const stand = this.standTileFor(po);
      if (!stand) continue;
      machine.reservedBy = guestId;
      return { machineId: machine.id, stand };
    }
    return null;
  }

  releaseMachines(guestId: string): void {
    for (const machine of this.machines.values()) machine.release(guestId);
  }

  machinePlayableBy(guestId: string, machineId: string): boolean {
    const machine = this.machines.get(machineId);
    return !!machine && machine.isPlayableBy(guestId);
  }

  machineCost(machineId: string): number {
    return this.machines.get(machineId)?.costToPlay ?? Infinity;
  }

  /** True when this is a poker table that can't deal yet. An empty table
   * answers true as well — it genuinely is waiting for players — but the
   * caller that matters is a guest asking about the table it's sitting at. */
  isTableWaitingForPlayers(machineId: string): boolean {
    const machine = this.machines.get(machineId);
    return machine instanceof PokerTable && !machine.canDeal;
  }

  /** Per-game happiness penalty added to GUEST_BALANCE.happinessOnLoss on a loss. */
  machineExtraHappinessOnLoss(machineId: string): number {
    return this.machines.get(machineId)?.extraHappinessOnLoss ?? 0;
  }

  machineDefId(machineId: string): string | null {
    return this.machines.get(machineId)?.defId ?? null;
  }

  machineCadence(machineId: string): PlayCadence | null {
    return this.machines.get(machineId)?.cadence ?? null;
  }

  playMachine(machineId: string, guestId: string): PlayResult | null {
    const machine = this.machines.get(machineId);
    if (!machine || machine.broken) return null;
    const result = machine.play(this.rng);
    // A zero wager means the table couldn't deal (poker below minPlayers). No
    // money moved and there is nothing to record, but the caller still gets a
    // result: `null` is reserved for "there is no machine to play", which is
    // what tells a guest to give its seat up.
    if (result.wager === 0) return result;
    const delta = result.wager - result.payout;
    this.state.cash += delta;
    this.ledger.addRevenue(delta);
    this.ledger.recordPlay(result.wager, result.payout);
    this.ledger.accrue(machineId, machine.defId, {
      wagered: result.wager,
      won: result.payout,
      revenue: delta,
    });
    if (result.payout >= result.wager * JACKPOT_PAYOUT_MULT) {
      this.ledger.recordJackpot();
      // A jackpot is the loudest word-of-mouth event a casino has.
      this.reputation.onJackpotPayout();
    }
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta });
    eventBus.emit('machinePlayed', {
      machineId,
      guestId,
      wager: result.wager,
      payout: result.payout,
    });
    return result;
  }

  payCasino(amount: number, sourceId?: string, defId = 'other'): void {
    this.state.cash += amount;
    this.ledger.addRevenue(amount);
    if (sourceId) this.ledger.accrue(sourceId, defId, { revenue: amount });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: amount });
  }

  /**
   * A1a — send one comp to one guest. The player's call, not the sim's.
   *
   * Returns false without charging when the guest is gone, has not played
   * enough to be comp-eligible, or has already taken their session's fill.
   */
  sendComp(guestId: string, kind: CompKind): boolean {
    const guest = this.guests.get(guestId);
    if (!guest) return false;
    guest.lastCompTick = this.tickCount;
    if (!guest.receiveComp(kind)) return false;
    const cost = COMPS.compUnit[kind];
    this.state.cash -= cost;
    this.ledger.addComp(cost);
    this.ledger.accrue(HOUSE_SOURCES.comps.id, HOUSE_SOURCES.comps.defId, { upkeep: cost });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -cost });
    // Being looked after is the whole ask behind wantsHost, so any comp at all
    // clears the flag that would otherwise cost them their next return.
    if (guest.patronId) this.patrons.onComped(guest.patronId);
    eventBus.emit('compSent', { guestId, kind, cost });
    return true;
  }

  /** An operational food stall: has at least one unlocked item the wallet can afford. */
  findFoodStall(wallet: number): { standId: string; stand: Cell } | null {
    for (const po of this.state.allObjects()) {
      if (po.defId !== 'food-stall') continue;
      const stall = this.foodStalls.get(po.id);
      if (!stall || !stall.pickAffordableItem(wallet, this.rng)) continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      return { standId: po.id, stand };
    }
    return null;
  }

  /** Buy a random unlocked, affordable item from the stall; null if nothing qualifies anymore. */
  buyFoodItem(standId: string, wallet: number): FoodPurchase | null {
    const stall = this.foodStalls.get(standId);
    if (!stall) return null;
    const purchase = stall.buy(wallet, this.rng);
    if (!purchase) return null;
    const net = purchase.price - purchase.baseCost;
    this.state.cash += net;
    this.ledger.addRevenue(purchase.price);
    this.ledger.addExpense(purchase.baseCost);
    this.ledger.accrue(standId, 'food-stall', {
      revenue: purchase.price,
      upkeep: purchase.baseCost,
    });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: net });
    return purchase;
  }

  /** An operational bar: has stock and a walkable stand tile. */
  findBar(): { barId: string; stand: Cell } | null {
    for (const po of this.state.allObjects()) {
      if (po.defId !== 'bar') continue;
      const bar = this.bars.get(po.id);
      if (!bar || !bar.hasStock()) continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      return { barId: po.id, stand };
    }
    return null;
  }

  /** Bartender production: one drink into stock, charged as an expense. */
  brewDrink(barId: string): void {
    const bar = this.bars.get(barId);
    if (!bar) return;
    bar.brew();
    this.ledger.addExpense(BAR_BALANCE.drinkCost);
    this.ledger.accrue(barId, 'bar', { upkeep: BAR_BALANCE.drinkCost });
  }

  /** Self-serve or delivered sale: null if unaffordable or out of stock. */
  buyDrink(barId: string, wallet: number): { price: number } | null {
    const bar = this.bars.get(barId);
    if (!bar || !bar.hasStock() || wallet < BAR_BALANCE.drinkPrice) return null;
    if (!bar.takeDrink()) return null;
    this.state.cash += BAR_BALANCE.drinkPrice;
    this.ledger.addRevenue(BAR_BALANCE.drinkPrice);
    this.ledger.accrue(barId, 'bar', { revenue: BAR_BALANCE.drinkPrice });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: BAR_BALANCE.drinkPrice });
    return { price: BAR_BALANCE.drinkPrice };
  }

  /** Public wrapper so Staff.ts (bartender) can reach a bar's stand tile
   * without standTileFor (private, keyed on a PlacedObject) leaking out. */
  barStandTile(barId: string): Cell | null {
    const po = this.state.getObject(barId);
    return po ? this.standTileFor(po) : null;
  }

  findService(defId: 'toilet'): { stand: Cell } | null {
    for (const po of this.state.allObjects()) {
      if (po.defId !== defId) continue;
      const stand = this.standTileFor(po);
      if (stand) return { stand };
    }
    return null;
  }

  /**
   * Cells a guest can stand in to occupy a seat. The first four entries are
   * the historical one-per-side cells and MUST keep their order — Blackjack
   * and Craps declare 4 seats and would otherwise have guests relocate. The
   * remainder fill out the rest of the footprint perimeter so tables with
   * more than four seats (Roulette, Poker) have reachable cells for them.
   */
  private seatCellsFor(po: PlacedObject): Cell[] {
    const def = getObjectDef(po.defId);
    const { w, h } = def?.footprint ?? { w: 1, h: 1 };

    const cells: Cell[] = [
      { col: po.col - 1, row: po.row }, // west
      { col: po.col, row: po.row - 1 }, // north
      { col: po.col + w, row: po.row + h - 1 }, // east
      { col: po.col + w - 1, row: po.row + h }, // south
    ];
    const seen = new Set(cells.map((c) => `${c.col},${c.row}`));

    const push = (col: number, row: number) => {
      const key = `${col},${row}`;
      if (seen.has(key)) return;
      seen.add(key);
      cells.push({ col, row });
    };

    for (let i = 0; i < h; i++) {
      push(po.col - 1, po.row + i); // west run
      push(po.col + w, po.row + i); // east run
    }
    for (let i = 0; i < w; i++) {
      push(po.col + i, po.row - 1); // north run
      push(po.col + i, po.row + h); // south run
    }
    return cells;
  }

  /** Test-only accessor for the seat-cell enumeration. */
  seatCellsForTest(po: PlacedObject): Cell[] {
    return this.seatCellsFor(po);
  }

  /** First walkable cell on the perimeter of an object's footprint. */
  private standTileFor(po: PlacedObject): Cell | null {
    const def = getObjectDef(po.defId);
    if (!def) return null;
    const { w, h } = def.footprint;
    for (let col = po.col - 1; col <= po.col + w; col++) {
      for (let row = po.row - 1; row <= po.row + h; row++) {
        const inside = col >= po.col && col < po.col + w && row >= po.row && row < po.row + h;
        if (!inside && this.grid.isWalkable(col, row)) return { col, row };
      }
    }
    return null;
  }

  // ---------- serialization (guests are transient; machines persist) ----------

  toJSON(): CasinoWorldJSON {
    return {
      state: this.state.toJSON(),
      grid: this.grid.toJSON(),
      tickCount: this.tickCount,
      machines: [...this.machines.values()].map((m) => ({
        id: m.id,
        defId: m.defId,
        costToPlay: m.costToPlay,
        ...(m.tableMinimum !== null ? { tableMinimum: m.tableMinimum } : {}),
        reliability: m.reliability,
        lifetimeProfit: m.lifetimeProfit,
        broken: m.broken,
      })),
      foodStalls: [...this.foodStalls.values()].map((f) => f.toJSON()),
      bars: [...this.bars.values()].map((b) => b.toJSON()),
      messes: [...this.messes.values()].map((m) => ({
        id: m.id,
        kind: m.kind,
        col: m.col,
        row: m.row,
      })),
      nextMessNum: this.nextMessNum,
      staff: [...this.staff.values()].map((s) => ({
        id: s.id,
        kind: s.kind,
        col: s.pos.col,
        row: s.pos.row,
      })),
      nextStaffNum: this.nextStaffNum,
      time: this.time.toJSON(),
      ledger: this.ledger.toJSON(),
      scenario: this.scenario ? this.scenario.toJSON() : null,
      modifiers: this.modifiers.toJSON(),
      reputation: this.reputation.toJSON(),
      patrons: this.patrons.toJSON(),
      mood: this.mood.toJSON(),
      traffic: this.traffic.toJSON(),
    };
  }

  /** In-place restore from a save — `state`/`grid` keep identity (gameContext aliases them). */
  loadJSON(data: CasinoWorldJSON): void {
    // Build every machine BEFORE touching live state. An unrecognized defId
    // (corrupt or newer-than-this-build save) must throw while the player's
    // current casino is still intact — the clearing below is unrecoverable,
    // so a throw partway through it would leave a wiped, half-loaded world.
    const loadedMachines = data.machines.map((m) => {
      const machine = createMachineOrThrow(m.defId, m.id, m.costToPlay);
      // Applied after construction so the ctor's default tier does not stomp a
      // table the player deliberately raised. An unknown tier is rejected by
      // setTableMinimum and the table keeps its default rather than becoming
      // a denomination no UI can represent.
      if (m.tableMinimum !== undefined) machine.setTableMinimum(m.tableMinimum);
      machine.reliability = m.reliability;
      machine.lifetimeProfit = m.lifetimeProfit;
      machine.broken = m.broken;
      return machine;
    });
    this.guests.clear();
    this.repairClaims.clear();
    this.dealerAssignments.clear();
    this.cashierAssignments.clear();
    this.machines.clear();
    this.foodStalls.clear();
    this.bars.clear();
    this.messes.clear();
    this.staff.clear();
    this.state.load(data.state);
    this.grid.load(data.grid);
    this.tickCount = data.tickCount;
    for (const machine of loadedMachines) this.machines.set(machine.id, machine);
    for (const f of data.foodStalls) this.foodStalls.set(f.id, FoodStall.fromJSON(f));
    for (const b of data.bars) this.bars.set(b.id, Bar.fromJSON(b));
    for (const m of data.messes) this.messes.set(m.id, { ...m, claimedBy: null });
    this.nextMessNum = data.nextMessNum;
    for (const s of data.staff)
      this.staff.set(s.id, new Staff(s.id, s.kind, { col: s.col, row: s.row }));
    this.nextStaffNum = data.nextStaffNum;
    this.nextGuestNum = 1; // guests are transient — never saved
    this.time = TimeSystem.fromJSON(data.time);
    this.ledger = Ledger.fromJSON(data.ledger);
    this.scenario = data.scenario ? ScenarioManager.fromJSON(data.scenario) : null;
    this.modifiers = ModifierSystem.fromJSON(data.modifiers);
    this.reputation = Reputation.fromJSON(data.reputation);
    this.patrons = PatronRegistry.fromJSON(data.patrons);
    this.mood = MoodField.fromJSON(data.mood);
    this.traffic = TrafficField.fromJSON(data.traffic);
    this.refreshServiceAvailability();
    const scenarioId = this.scenario?.def.id ?? null;
    eventBus.emit('worldReset', { scenarioId });
    eventBus.emit('worldLoaded', { scenarioId });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: 0 });
    eventBus.emit('hourPassed', { hour: this.time.hour, day: this.time.day });
    eventBus.emit('modifiersChanged', {
      ids: this.modifiers.activeModifiers.map((m) => m.id),
    });
    eventBus.emit('reputationChanged', { value: this.reputation.value, delta: 0 });
  }

  static fromJSON(data: CasinoWorldJSON): CasinoWorld {
    const world = new CasinoWorld();
    world.loadJSON(data);
    return world;
  }
}
