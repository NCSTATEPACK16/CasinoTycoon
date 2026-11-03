import { eventBus } from '../EventBus';
import {
  ENTRANCE_TILE,
  entranceFor,
  GRID_COLS,
  GRID_ROWS,
  HOURS_PER_DAY,
  JACKPOT_PAYOUT_MULT,
  SELL_REFUND_RATIO,
  STARTING_CASH,
  TICKS_PER_HOUR,
} from '../config';
import {
  ARCHETYPE_BALANCE,
  BAR_BALANCE,
  CASHIER_BALANCE,
  COMPS,
  type CompKind,
  DEALER_BALANCE,
  DEBT,
  LOANS,
  ENGINE_BALANCE,
  GUEST_BALANCE,
  MESS_BALANCE,
  PRICE_BALANCE,
  priceAppeal,
  RAGE_BALANCE,
  RATING_BALANCE,
  REPUTATION,
  SECURITY_BALANCE,
  STAFF_BALANCE,
  STAFF_DEPTH,
  ADVANTAGE_BALANCE,
} from '../data/balance';
import type { CampaignDef } from '../data/campaigns';
import {
  CAMPAIGN_TRAFFIC,
  dayFactor,
  guestCap as scaledGuestCap,
  hourFactor,
  TRAFFIC_BALANCE,
  type TrafficProfile,
} from '../data/traffic';
import { getObjectDef } from '../data/objects';
import { canPlaceObject, footprintOf, placeObject, sellObject, type PlaceCheck } from './build';
import { FloorPlan, type FloorPlanJSON } from './floor/FloorPlan';
import { starterFloorPlan } from './floor/starter';
import type { WorldNav } from './nav/WorldNav';
import type { CellRect, Rotation } from '../shared/contracts';
import { createMachine, createMachineOrThrow } from './entities/machines/factory';
import { SeatedCasinoGame } from './entities/machines/SeatedCasinoGame';
import { ADVANTAGE_LABEL, Guest, type AdvantageKind, type GuestArchetype } from './entities/Guest';
import { Bar, type BarJSON } from './entities/Bar';
import { FoodStall, type FoodStallJSON, type FoodPurchase } from './entities/FoodStall';
import type { Mess, MessKind } from './entities/Mess';
import { Staff, type StaffKind, type StaffPost } from './entities/staff/Staff';
import {
  cleanRadius,
  dealerSkillSpeed,
  detectChance,
  misPayChance,
  onShiftAt,
  quitChance,
  SHIFTS,
  workHour,
  moraleTarget,
  type Shift,
} from './entities/staff/staffing';
import { HOUSE_SOURCES, Ledger, type LedgerJSON } from './economy';
import { EVENTS, getEventDef, type EventDef } from '../data/events';
import { Marketing, type Clock, type EventRun, type MarketingJSON } from './marketing';
import { MoodField, type MoodFieldJSON } from './MoodField';
import { TrafficField, type TrafficFieldJSON } from './TrafficField';
import { ModifierSystem, type ModifierSystemJSON } from './modifiers';
import { LoanBook, type Loan, type LoanBookJSON } from './economy/loans';
import { type Patron, PatronRegistry, type PatronRegistryJSON } from './patrons';
import { Reputation, type ReputationJSON } from './reputation';
import { ScenarioManager, type ScenarioJSON, type WorldFacts } from './scenario/ScenarioManager';
import { interestFor, pickLiquidation, type LiquidationCandidate } from './solvency';
import { TimeSystem, type TimeSystemJSON } from './TimeSystem';
import {
  type CasinoGame,
  type PlayCadence,
  type PlayContext,
  type PlayResult,
} from './entities/machines/CasinoGame';
import { PlayerPlay, type PlayerPlayJSON, type PlayerRoundReply } from './economy/PlayerPlay';
import type { RulesIssue } from './games/types';
import type { Bet, RoundResult } from '../shared/games';
import { GameState, type GameStateJSON, type PlacedObject } from './GameState';
import { findPath, type Cell } from './grid/astar';
import { IsoGrid, type IsoGridJSON } from './grid/IsoGrid';
import { Rng } from './rng';

/** Ticks between overlay-field passes. Five is twice a second at
 *  SIM_TICKS_PER_SECOND — far finer than a player can perceive a heat map
 *  changing, and a fifth of the work of doing it every tick. */
const OVERLAY_SAMPLE_TICKS = 5;

/** Objects guests depend on. The last one of these is never liquidated. */
const SERVICE_DEFIDS = new Set(['toilet', 'food-stall']);

// The sim's composition root and tick orchestrator. Owns state, grid, machine
// and guest registries. Presentation calls place/sell/tick and reads registries;
// everything else flows out through the EventBus.

export interface WorldOptions {
  seed?: number;
  autoSpawn?: boolean;
  /** v2: scenarios start on a walled, zoned starter floor instead of v1's
   *  open lot. Off by default so the ported suite keeps its open 40×30 lot. */
  starterFloor?: boolean;
  /** v2: a dealt table is closed until a dealer is stationed at it. */
  requireDealers?: boolean;
}

// Sim can't import src/ui/dom.ts's formatCash — that's presentation-layer.
function formatDollarAmount(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`;
}

/**
 * Guests only come for the games; word of mouth does the rest.
 *
 * P16 — word of mouth is half today's floor and half the casino's standing.
 * Keying arrivals on the instantaneous rating alone made each day nearly
 * independent of the one before it: lag-1 autocorrelation across the tournament
 * was +0.20 and the daily standard deviation ran two to three times the mean,
 * which is a coin-flip rather than a difficulty curve. Reputation was already
 * the persistent scalar this wants — capped per day and drifting to the mean,
 * so it moves over several days and cannot become absorbing — but it only ever
 * reached the archetype mix, never the arrival rate.
 *
 * The two terms are a redistribution, not a bonus: at REPUTATION.start the
 * result is exactly what the rating-only formula returned, so no downstream
 * tuning number moves for an averagely-regarded casino.
 */
export function spawnChance(rating: number, machineCount: number, reputation: number): number {
  if (machineCount === 0) return 0;
  const b = GUEST_BALANCE;
  const w = b.spawnReputationWeight;
  // Reputation is expressed relative to neutral so that a middling name is
  // worth exactly the rating it replaces.
  const standing = rating + (reputation - REPUTATION.start) * (100 / REPUTATION.max);
  const wordOfMouth = (rating * (1 - w) + standing * w) / 100;
  return Math.min(
    b.spawnCapPerTick,
    b.spawnBasePerTick + Math.max(0, wordOfMouth) * b.spawnRatingScalePerTick,
  );
}

/** B3: services that count toward the floor's room for guests. */
const CAP_SERVICES = new Set(['toilet', 'food-stall', 'bar', 'cage']);
/** B3: how often a scaled guest cap is recomputed. */
const CAP_REFRESH_TICKS = 10;

interface MachineJSON {
  /** P4: the player's per-instance table minimum. Absent for fixed-denomination
   *  games, and absent in saves written before A2 — both default correctly. */
  tableMinimum?: number;
  id: string;
  defId: string;
  costToPlay: number;
  /** v2: the machine's game rules (engine games only). */
  rules?: unknown;
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
  // B11 (optional: older saves load with the defaults).
  skill?: number;
  morale?: number;
  fatigue?: number;
  shift?: Shift;
  awayHours?: number;
  awayFor?: 'training' | 'break' | null;
  off?: boolean;
  misPays?: number;
  misPaid?: number;
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
  /** B11: per-role wage levers, $/hour (absent = the market wage). */
  wages?: Partial<Record<StaffKind, number>>;
  /** B10: events booked and run, and recent arrivals by hour. */
  marketing?: MarketingJSON;
  time: TimeSystemJSON;
  ledger: LedgerJSON;
  scenario: ScenarioJSON | null;
  modifiers: ModifierSystemJSON;
  reputation: ReputationJSON;
  /** P3 — the carded roster. Required from SAVE_VERSION 4 up; older files get
   *  an empty registry from the migration ladder rather than a missing key. */
  patrons: PatronRegistryJSON;
  /** B4: absent in older saves. */
  loans?: LoanBookJSON;
  /** Optional: added after SAVE_VERSION 3, and absent from both a v3 save
   *  written before it and a v2 file migrated up. `MoodField.fromJSON` starts
   *  empty in either case, which is exactly right — a returning player's mood
   *  map should reflect where guests walk now, not be invented for them. */
  mood?: MoodFieldJSON;
  /** Optional for the same reason as `mood` — absent from any save written
   *  before P2, and an empty field is the right answer there. */
  traffic?: TrafficFieldJSON;
  /** v2 floor plan. Absent from v1-shaped saves, which load onto an open lot. */
  floor?: FloorPlanJSON;
  /** v2: the avatar's wallet. */
  player?: PlayerPlayJSON;
}

/** The seat holder id the avatar uses at tables and machines. */
export const PLAYER_SEAT = 'player';

/** B11: how often (ticks) the pit looks around. */
const PIT_WATCH_TICKS = 10;

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
  /** B11: same reasoning again. Hire skill, mis-pays, advantage players,
   *  detection and quits draw here, so a campaign without them keeps every
   *  other draw where it was. */
  private staffRng: Rng;
  /** B11: per-role wage levers, $/hour. Absent = the market wage. */
  wageLevels = new Map<StaffKind, number>();
  /** B11: what advantage players have taken off the house this run, on top
   *  of fair play (not saved; for tests and telemetry). */
  advantageTaken = 0;
  /** B10: events booked and run, and arrivals by hour to measure them. */
  marketing = new Marketing();
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
  /** v2 (Session 4): the avatar's wallet and open rounds. */
  player = new PlayerPlay();
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
  loans = new LoanBook();
  scenario: ScenarioManager | null = null;
  tickCount = 0;
  entranceTile: Cell = { ...ENTRANCE_TILE };
  autoSpawn: boolean;
  /** v2 — the lot. The grid aliases it for walkability (see IsoGrid.floor). */
  floor: FloorPlan;
  /** Bumped whenever the floor plan is replaced or edited — the snapshot
   *  sends a fresh FloorPlanView when it changes. */
  floorRevision = 0;
  /** Bumped whenever a game joins or leaves `machines`, so indexes over the
   *  games on the floor (the guest brain's, see utility.ts) know to rebuild. */
  machinesRevision = 0;
  /** v2 — the Recast navmesh and crowd. Null in grid mode (every bare world,
   *  including the ported suite); the worker attaches one after WASM init. */
  nav: WorldNav | null = null;
  readonly requireDealers: boolean;
  private readonly starterFloor: boolean;
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
    this.staffRng = new Rng((seed ^ 0x27d4eb2f) >>> 0);
    this.patronRng = new Rng((seed ^ 0xc2b2ae35) >>> 0);
    this.autoSpawn = opts.autoSpawn ?? true;
    this.starterFloor = opts.starterFloor ?? false;
    this.requireDealers = opts.requireDealers ?? false;
    this.floor = FloorPlan.open(GRID_COLS, GRID_ROWS, ENTRANCE_TILE);
    this.grid.floor = this.floor;
  }

  // ---------- floor plan & navigation hooks (v2, session 3) ----------

  /** Hook: replace the floor plan (scenario start, load). */
  installFloor(plan: FloorPlan): void {
    this.floor = plan;
    this.grid.floor = plan;
    this.entranceTile = { ...plan.entrance };
    this.floorRevision++;
    this.nav?.rebuild(this);
  }

  /** Hook: something changed the walkable layout inside `rect` (paint, wall,
   *  door, an object placed or sold). Queues a navmesh rebake of those tiles. */
  onFloorEdited(rect: CellRect): void {
    this.floorRevision++;
    this.nav?.markDirty(rect);
  }

  /** Hook: attach a baked navmesh; from here on walkers move on the crowd. */
  attachNav(nav: WorldNav): void {
    this.nav = nav;
    nav.rebuild(this);
  }

  /** Hook: whether a game is staffed to play. With requireDealers, a dealt
   *  table needs its dealer actually stationed, not merely en route. Broken is
   *  a separate fact (ObjectView.broken) and deliberately not folded in here. */
  isTableOpen(machineId: string): boolean {
    const machine = this.machines.get(machineId);
    if (!machine) return false;
    if (!this.requireDealers || !machine.needsDealer) return true;
    const staffId = this.dealerAssignments.get(machineId);
    return !!staffId && this.staff.get(staffId)?.state === 'stationed';
  }

  // ---------- scenarios ----------

  /** Start a campaign (or `null` for sandbox): full floor wipe + fresh clock/books. */
  startScenario(def: CampaignDef | null): void {
    const { cols, rows } = def?.lot ?? { cols: GRID_COLS, rows: GRID_ROWS };
    this.reset(def?.startingCash ?? STARTING_CASH, cols, rows);
    this.installFloor(
      this.starterFloor
        ? starterFloorPlan(def?.id ?? null, cols, rows)
        : FloorPlan.open(cols, rows, entranceFor(cols, rows)),
    );
    this.scenario = def ? new ScenarioManager(def) : null;
    // B8: a run that opens in debt. The loan's cash is already counted in
    // startingCash, so it is booked straight onto the loan book.
    if (def?.startingLoan) {
      this.loans.take(def.startingLoan.amount, def.startingLoan.days, this.time.day, Infinity);
    }
    // Day 1 gets conditions too. Without this the first day is always the
    // quiet baseline, which teaches the player that modifiers are rare.
    this.modifiers.drawForDay(this.time.day, this.modifierRng);
    eventBus.emit('worldReset', { scenarioId: def?.id ?? null });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: 0 });
    eventBus.emit('hourPassed', { hour: this.time.hour, day: this.time.day });
  }

  /** In-place wipe — `state` and `grid` stay the same objects (gameContext aliases them). */
  /** Wipe everything and size the grid and per-tile fields to the lot. */
  private reset(startingCash: number, cols: number, rows: number): void {
    this.guests.clear();
    this.staff.clear();
    this.messes.clear();
    this.machines.clear();
    this.machinesRevision++;
    this.foodStalls.clear();
    this.bars.clear();
    this.repairClaims.clear();
    this.drinkClaims.clear();
    this.dealerAssignments.clear();
    this.cashierAssignments.clear();
    this.wageLevels.clear();
    this.marketing = new Marketing();
    this.grid.clear(cols, rows);
    this.state.reset(startingCash);
    this.refreshServiceAvailability();
    this.time = new TimeSystem();
    this.ledger = new Ledger();
    this.cleanlinessSamples = [];
    this.modifiers = new ModifierSystem();
    this.reputation = new Reputation();
    this.mood = new MoodField(cols, rows);
    this.traffic = new TrafficField(cols, rows);
    this.patrons = new PatronRegistry();
    this.loans = new LoanBook();
    this.tickCount = 0;
    this.nextGuestNum = 1;
    this.nextMessNum = 1;
    this.nextStaffNum = 1;
  }

  isObjectAllowed(defId: string): boolean {
    return this.scenario ? this.scenario.isAllowed(defId) : true;
  }

  // ---------- building ----------

  canPlace(defId: string, col: number, row: number, rot: Rotation = 0): PlaceCheck {
    if (!this.isObjectAllowed(defId)) return { ok: false, reason: 'not-allowed' };
    // P16: the house may expand on credit, down to the same line the bank
    // liquidates against. Buying is the only way a player can reach that line
    // deliberately — upkeep drift alone never got near it.
    return canPlaceObject(this.state, this.grid, defId, col, row, this.creditLimit, rot);
  }

  place(defId: string, col: number, row: number, rot: Rotation = 0): PlacedObject | null {
    if (!this.isObjectAllowed(defId)) return null;
    const po = placeObject(this.state, this.grid, defId, col, row, this.creditLimit, rot);
    if (po) this.onFloorEdited(this.footprintRect(po));
    if (po) {
      const machine = createMachine(defId, po.id);
      if (machine) this.machines.set(po.id, machine);
      if (machine) this.machinesRevision++;
    }
    if (po && defId === 'food-stall') this.foodStalls.set(po.id, new FoodStall(po.id));
    if (po && defId === 'bar') this.bars.set(po.id, new Bar(po.id));
    if (po) this.refreshServiceAvailability();
    return po;
  }

  /** Cells an object covers, with rotation. */
  private footprintRect(po: PlacedObject): CellRect {
    const fp = footprintOf(po.defId, po.rot);
    return { col0: po.col, row0: po.row, col1: po.col + fp.w - 1, row1: po.row + fp.h - 1 };
  }

  sell(objectId: string): number | null {
    const sold = this.state.getObject(objectId);
    if (sold) this.onFloorEdited(this.footprintRect(sold));
    const machine = this.machines.get(objectId);
    if (machine) {
      // Guests holding a reference re-evaluate on their next tick.
      machine.broken = true;
      machine.releaseAll();
      this.machines.delete(objectId);
      this.machinesRevision++;
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
    if (this.marketing.runs.length > 0) this.marketingTick();
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
    if (this.tickCount % PIT_WATCH_TICKS === 0) this.detectAdvantagePlayers();
    this.nav?.step(this);
    this.sampleOccupancy();
    if (this.tickCount % OVERLAY_SAMPLE_TICKS === 0) {
      this.sampleMood();
      // Traffic is written on tile-enter, so only its ageing rides this pass.
      this.traffic.decay();
    }
    if (t.hourPassed) this.onHourBoundary(t.midnight);
    // P16 — the bank watches continuously. While this lived only in the
    // day-close block, a breach at 3pm that recovered by midnight cost nothing,
    // so the ceiling bound the closing balance rather than the run. Now that
    // the house can expand on credit, that gap is what separates a limit from a
    // suggestion. Cheap when solvent: one comparison, and the loop never turns.
    //
    // Only the *selling* is continuous. The terminal verdict stays at the close,
    // after onDayEnded — a day that reaches the goal still wins it, even from
    // under the limit, which is the ordering world.solvency.test.ts pins down.
    this.liquidateToLimit();
  }

  /** Bookkeeping at every hour boundary; midnight also rolls the day over. */
  private onHourBoundary(midnight: boolean): void {
    this.ragePenalty = Math.max(0, this.ragePenalty - RAGE_BALANCE.dingDecayPerHour);
    // The hour that just completed (time already shows the new hour/day).
    const closedHour = this.time.hour === 0 ? HOURS_PER_DAY - 1 : this.time.hour - 1;
    const closedDay = this.time.hour === 0 ? this.time.day - 1 : this.time.day;
    this.staffHour(midnight);
    this.cleanlinessSamples.push(this.cleanlinessPct);
    if (midnight) {
      this.chargeUpkeep();
      for (const guest of this.guests.values()) this.foldGuestSession(guest);
    }
    this.ledger.closeHour(closedDay, closedHour, this.guests.size, this.state.cash);
    this.scenario?.observeGuests(this.guests.size);
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
        const text = `${reasons.join(' and ')} failed — ${formatDollarAmount(penalty)} in fines.`;
        this.ledger.note(text);
        eventBus.emit('tickerMessage', { text, severity: 'alert' });
      }
      const repDelta = this.reputation.closeDay();
      eventBus.emit('reputationChanged', { value: this.reputation.value, delta: repDelta });
      // B4: loan installments, before the overdraft interest, so a payment
      // that tips the house into the red is charged for it like any other.
      this.settleLoans();
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
        const text = `Interest on the overdraft — ${formatDollarAmount(interest)}.`;
        this.ledger.note(text);
        eventBus.emit('tickerMessage', { text, severity: 'alert' });
      }
      const record = this.ledger.closeDay(closedDay, {
        reputation: this.reputation.value,
        reputationDelta: repDelta,
        modifierIds,
        rating: this.rating,
        cash: this.state.cash,
        debt: this.loans.outstanding,
      });
      this.scenario?.onDayEnded(record, this.scenarioFacts());
      // P16: the bank takes what it is owed. After onDayEnded, so a day that
      // reached the goal is a win even if it also closed under the limit.
      // The tick-level check above will already have sold against any breach
      // during the day; this catches the one the close itself just opened,
      // since upkeep, wages, interest and fines all land immediately above.
      this.liquidateToLimit(record.notes);
      if (
        (this.scenario?.status === 'active' || this.scenario?.status === 'endless') &&
        this.state.cash < -this.creditLimit
      ) {
        // Liquidation ran and could not free enough. Sandbox has no scenario
        // and so never reaches here: free play applies the pressure without
        // the fail state. Endless keeps this gate live deliberately — see
        // ScenarioManager.fail()'s doc comment.
        this.scenario.fail('insolvent');
      }
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
    // B11: only who worked the hour is paid (off shift, training and breaks
    // draw nothing), at the role's wage lever.
    for (const member of this.staff.values())
      if (member.state !== 'off') total += this.wageFor(member.kind);
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
      if ((m.kind === 'pitBoss' || m.kind === 'security') && m.state !== 'off') {
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

  /** True for anything that can appear as a P1 revenue source — a game, or a
   *  service catalogued as one (food stall, bar, cage — see ObjectDef.isRevenueSource).
   *  A toilet is a service guests need but never a source, so it is protected
   *  by SERVICE_DEFIDS rather than counted here. */
  private isRevenueObject(defId: string): boolean {
    const def = getObjectDef(defId);
    if (!def) return false;
    return def.category === 'game' || def.isRevenueSource === true;
  }

  /** Attributed net for one object over the last three closed days. Three
   *  rather than one because a single quiet day is noise, and rather than
   *  lifetime because a table bought yesterday would otherwise always look
   *  like the weakest asset on the floor. */
  private trailingNetFor(objectId: string): number {
    let net = 0;
    for (const record of this.ledger.history.slice(-3)) {
      for (const source of record.sources) {
        if (source.id === objectId) net += source.revenue - source.upkeep;
      }
    }
    return net;
  }

  // ---------- B8: scenario goals ----------

  /** What the scenario's goals read from the world, right now. */
  scenarioFacts(): WorldFacts {
    let gold = 0;
    let black = 0;
    for (const p of this.patrons.all()) {
      if (p.tier.id === 'black') black++;
      if (p.tier.id === 'gold' || p.tier.id === 'black') gold++;
    }
    let highLimitGames = 0;
    for (const o of this.state.allObjects()) {
      if (getObjectDef(o.defId)?.category !== 'game') continue;
      if (this.floor.zoneAt(o.col, o.row) === 'highLimit') highLimitGames++;
    }
    return {
      rating: this.rating,
      patrons: { silver: this.patrons.all().length, gold, black },
      highLimitGames,
      debt: this.loans.outstanding,
      cash: this.state.cash,
    };
  }

  // ---------- B4: loans ----------

  /** The most the bank will have out on loan at once, for this scenario. */
  get loanLimit(): number {
    return this.scenario?.def.loanLimit ?? LOANS.defaultLimit;
  }

  /** Borrow `amount` (rounded to LOANS.step) over a term on offer. The cash
   *  is financing, not revenue: it moves the balance, never the day's P&L. */
  takeLoan(amount: number, days: number): Loan | null {
    const step = LOANS.step;
    const rounded = Math.floor(amount / step) * step;
    const loan = this.loans.take(rounded, days, this.time.day, this.loanLimit);
    if (!loan) return null;
    this.state.cash += loan.principal;
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: loan.principal });
    const text = `Borrowed ${formatDollarAmount(loan.principal)} over ${days} days.`;
    this.ledger.note(text);
    eventBus.emit('tickerMessage', { text });
    return loan;
  }

  /** Pay a loan down early from cash on hand. Returns what was paid. */
  repayLoan(loanId: string, amount: number): number {
    const paid = this.loans.repay(loanId, Math.min(amount, Math.max(0, this.state.cash)));
    if (paid <= 0) return 0;
    this.state.cash -= paid;
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -paid });
    if (!this.loans.loans.some((l) => l.id === loanId)) {
      const text = 'A loan was paid off early.';
      this.ledger.note(text);
      eventBus.emit('tickerMessage', { text });
    }
    return paid;
  }

  /** Midnight: every loan's installment comes out of cash, interest booked
   *  as the cost of debt and principal as plain repayment. */
  private settleLoans(): void {
    const s = this.loans.settleDay();
    const interest = Math.round(s.interest * 100) / 100;
    const paid = s.interest + s.principal;
    if (paid <= 0) return;
    this.state.cash -= paid;
    this.ledger.addLoanInterest(interest);
    this.ledger.accrue(HOUSE_SOURCES.interest.id, HOUSE_SOURCES.interest.defId, {
      upkeep: interest,
    });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -paid });
    for (const _ of s.paidOff) {
      const text = 'A loan is paid off.';
      this.ledger.note(text);
      eventBus.emit('tickerMessage', { text });
    }
  }

  /**
   * P16 — sell assets until the house is back above its credit limit.
   *
   * Returns the defIds sold, in order. An empty return while still below the
   * limit is the insolvency condition; Task 5's caller reads it that way.
   */
  /** `notes`: a closed day's report notes, when the sale belongs to a day
   *  whose books just closed (the midnight call), not to the one beginning. */
  private liquidateToLimit(notes?: string[]): string[] {
    const sold: string[] = [];
    // Bounded by the floor: every pass removes one object, so this cannot spin.
    while (this.state.cash < -this.creditLimit) {
      const objects = this.state.allObjects();
      const revenueIds = new Set(
        objects.filter((o) => this.isRevenueObject(o.defId)).map((o) => o.id),
      );
      const serviceCounts = new Map<string, number>();
      for (const o of objects) {
        serviceCounts.set(o.defId, (serviceCounts.get(o.defId) ?? 0) + 1);
      }
      const candidates: LiquidationCandidate[] = objects.map((o) => ({
        id: o.id,
        defId: o.defId,
        isDecor: getObjectDef(o.defId)?.category === 'decor',
        isLastOfService: SERVICE_DEFIDS.has(o.defId) && (serviceCounts.get(o.defId) ?? 0) <= 1,
        isLastRevenueObject: revenueIds.has(o.id) && revenueIds.size <= 1,
        trailingNet: this.trailingNetFor(o.id),
        refund: Math.round((getObjectDef(o.defId)?.cost ?? 0) * SELL_REFUND_RATIO),
      }));
      const pick = pickLiquidation(candidates);
      if (!pick) break;
      const refund = this.sell(pick.id);
      sold.push(pick.defId);
      const text = `The bank forced a sale — ${pick.defId.replace(/-/g, ' ')} gone for ${formatDollarAmount(refund ?? 0)}.`;
      if (notes) notes.push(text);
      else this.ledger.note(text);
      eventBus.emit('tickerMessage', { text, severity: 'alert' });
    }
    return sold;
  }

  private maybeSpawn(): void {
    if (this.guests.size >= this.guestCap()) return;
    if (!this.rng.chance(this.arrivalChance())) return;
    if (!this.grid.isWalkable(this.entranceTile.col, this.entranceTile.row)) return;
    this.spawnGuest();
  }

  /** B3: how guests arrive here: the scenario's own profile, else the flat
   *  rate and fixed cap the campaigns were tuned on. */
  get trafficProfile(): TrafficProfile {
    return this.scenario?.def.traffic ?? CAMPAIGN_TRAFFIC;
  }

  /** B3: the floor's room, in seats: every seat at a game, plus
   *  TRAFFIC_BALANCE.serviceSeats per restroom, food stall, bar or cage. */
  floorCapacity(): number {
    let room = 0;
    for (const m of this.machines.values()) room += m instanceof SeatedCasinoGame ? m.seatCount : 1;
    for (const po of this.state.allObjects())
      if (CAP_SERVICES.has(po.defId)) room += TRAFFIC_BALANCE.serviceSeats;
    return room;
  }

  private capCache = { tick: -Infinity, value: 0 };

  /** B3: how many guests may be on the floor at once. A scaled cap follows
   *  the floor and the rating, refreshed every few ticks (it walks every
   *  object, and neither moves faster than that matters). */
  guestCap(): number {
    const cap = this.trafficProfile.cap;
    if (cap !== 'scaled') return cap;
    if (this.tickCount - this.capCache.tick >= CAP_REFRESH_TICKS) {
      this.capCache = {
        tick: this.tickCount,
        value: scaledGuestCap(this.floorCapacity(), this.rating),
      };
    }
    return this.capCache.value;
  }

  /** B3: the chance a guest walks in this tick. Flat traffic is the campaign
   *  formula unchanged; daily traffic shapes it by hour and weekday, and a
   *  scaled cap multiplies it by cap / minCap, so a floor that holds ten
   *  times the people draws ten times the arrivals. */
  arrivalChance(): number {
    const chance = this.unliftedArrivalChance(this.clockNow());
    // B10: an ad or a tournament lifts its archetypes' arrivals; the mix of
    // who comes follows in rollArchetype. Skipped outright when nothing runs.
    if (!this.marketing.liftsArrivals(this.tickCount)) return chance;
    return Math.min(1, chance * this.marketingLift());
  }

  private unliftedArrivalChance(at: { day: number; hour: number; fraction: number }): number {
    const base =
      spawnChance(this.rating, this.machines.size, this.reputation.value) *
      this.modifiers.spawnMult();
    const p = this.trafficProfile;
    if (p.curve === 'flat') return base;
    const t = TRAFFIC_BALANCE;
    const scale = p.cap === 'scaled' ? (this.guestCap() / t.minCap) * t.fill : 1;
    const clock = hourFactor(at.hour, at.fraction) * dayFactor(at.day);
    return Math.min(1, base * scale * clock);
  }

  spawnGuest(archetypeOverride?: GuestArchetype, walletMult = 1): Guest {
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
    const wallet = Math.max(1, Math.round(baseWallet * this.modifiers.walletMult() * walletMult));
    const guest = new Guest(
      id,
      wallet,
      this.entranceTile,
      archetype,
      patron ? { id: patron.id, name: patron.name, tier: patron.tier } : null,
    );
    if (this.nav) guest.varyArrivalNeeds();
    guest.arrivedTick = this.tickCount;
    guest.advantage = this.rollAdvantage();
    // B3: open play's guests come for an evening, not for good.
    if (this.trafficProfile.curve === 'daily') {
      const h = TRAFFIC_BALANCE.stayHours;
      guest.leaveAtTick =
        this.tickCount + this.rng.int(h.min * TICKS_PER_HOUR, h.max * TICKS_PER_HOUR);
    }
    if (this.marketing.runs.length > 0) this.marketingArrival(guest);
    this.guests.set(id, guest);
    eventBus.emit('guestSpawned', { id, archetype: guest.archetype });
    if (patron) this.announcePatronArrival(patron, id);
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
  private announcePatronArrival(patron: Patron, guestId: string): void {
    const visit = patron.visits + 1;
    if (patron.tier.wantsHost) {
      eventBus.emit('tickerMessage', {
        text: `${patron.name} (${patron.tier.name}) is on the floor — visit ${visit}. Look after them.`,
        severity: 'alert',
        guestId,
      });
      return;
    }
    eventBus.emit('tickerMessage', {
      text: `${patron.name} (${patron.tier.name}) is back — visit ${visit}.`,
      guestId,
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
        guestId: guest.id,
      });
      return;
    }
    if (out.promotedTo) {
      eventBus.emit('tickerMessage', {
        text: `${out.patron.name} is now a ${out.promotedTo.name} player.`,
        guestId: guest.id,
      });
      return;
    }
    if (out.neglected) {
      eventBus.emit('tickerMessage', {
        text: `${out.patron.name} left without so much as a drink.`,
        severity: 'warn',
        guestId: guest.id,
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
    if (this.marketing.liftsArrivals(this.tickCount))
      return this.rollLiftedArchetype(highRoller * scale, biker * scale, tourist * scale);
    const roll = this.archetypeRng.next();
    if (roll < highRoller * scale) return 'highRoller';
    if (roll < (highRoller + biker) * scale) return 'biker';
    if (roll < (highRoller + biker + tourist) * scale) return 'tourist';
    return 'regular';
  }

  /** B10: the same roll with each archetype's share times its marketing
   *  lift, renormalised, so an ad brings more of its own people and nobody
   *  else's. The one draw on archetypeRng is unchanged. */
  private rollLiftedArchetype(highRoller: number, biker: number, tourist: number): GuestArchetype {
    const shares = this.liftedShares(highRoller, biker, tourist);
    let roll = this.archetypeRng.next();
    for (const [archetype, share] of shares) {
      if (roll < share) return archetype;
      roll -= share;
    }
    return 'regular';
  }

  /** B10: who arrives, as shares of 1, with any marketing lift applied. */
  private liftedShares(
    highRoller: number,
    biker: number,
    tourist: number,
  ): [GuestArchetype, number][] {
    const raw: [GuestArchetype, number][] = [
      ['highRoller', highRoller],
      ['biker', biker],
      ['tourist', tourist],
      ['regular', Math.max(0, 1 - highRoller - biker - tourist)],
    ];
    const lifted = raw.map(([a, w]): [GuestArchetype, number] => [
      a,
      w * this.marketing.lift(a, this.tickCount),
    ]);
    const total = lifted.reduce((sum, [, w]) => sum + w, 0);
    return lifted.map(([a, w]) => [a, w / total]);
  }

  /** B10: arrival shares by archetype right now, before marketing. */
  archetypeShares(): Record<GuestArchetype, number> {
    const b = ARCHETYPE_BALANCE;
    const bias = (a: GuestArchetype) =>
      this.modifiers.archetypeBias(a) * this.reputation.archetypeMultiplier(a);
    const hr = b.highRollerChance * bias('highRoller');
    const bk = b.bikerChance * bias('biker');
    const tr = b.touristChance * bias('tourist');
    const scale = hr + bk + tr > 1 ? 1 / (hr + bk + tr) : 1;
    return {
      highRoller: hr * scale,
      biker: bk * scale,
      tourist: tr * scale,
      regular: Math.max(0, 1 - (hr + bk + tr) * scale),
    };
  }

  /** B10: how much marketing multiplies arrivals in all: each archetype's
   *  lift weighted by its share of who comes. */
  private marketingLift(): number {
    let lift = 0;
    for (const [a, share] of Object.entries(this.archetypeShares()) as [GuestArchetype, number][])
      lift += share * this.marketing.lift(a, this.tickCount);
    return lift;
  }

  // ---------- marketing (B10) ----------

  private clock(): Clock {
    return {
      tick: this.tickCount,
      day: this.time.day,
      hour: this.time.hour,
      tickInHour: this.time.tickInHour,
    };
  }

  /** Hook: the event ids this scenario offers (none outside a scenario). */
  get marketingOffered(): readonly string[] {
    return this.scenario?.def.marketing ?? [];
  }

  /** Hook: why this event can't be booked now, or null if it can. */
  eventBlocked(def: EventDef): string | null {
    if (!this.marketingOffered.includes(def.id)) return 'Not offered here';
    if (def.requiresObject && !this.state.allObjects().some((o) => o.defId === def.requiresObject))
      return `Needs a ${def.requiresObject.replace(/-/g, ' ')}`;
    if (def.requires) {
      const ids = new Set(def.requires.defIds);
      let n = 0;
      for (const o of this.state.allObjects()) if (ids.has(o.defId)) n++;
      if (n < def.requires.count) return def.requires.label;
    }
    if (this.marketing.current(def.id, this.tickCount)) return 'Already booked';
    const ready = this.marketing.readyAt(def);
    if (ready > this.tickCount) {
      const days = Math.ceil((ready - this.tickCount) / (HOURS_PER_DAY * TICKS_PER_HOUR));
      return `Ready in ${days} day${days === 1 ? '' : 's'}`;
    }
    if (this.state.cash < def.cost) return 'Not enough cash';
    return null;
  }

  /** Hook: book an event. Pays its price now; returns the run, or throws
   *  with the reason it can't run. */
  runEvent(id: string): EventRun {
    const def = getEventDef(id);
    if (!def) throw new Error(`Unknown event ${id}`);
    const blocked = this.eventBlocked(def);
    if (blocked) throw new Error(blocked);
    const run = this.marketing.book(def, this.clock());
    this.state.cash -= def.cost;
    this.ledger.addExpense(def.cost);
    this.ledger.accrue(HOUSE_SOURCES.marketing.id, HOUSE_SOURCES.marketing.defId, {
      upkeep: def.cost,
    });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -def.cost });
    const text = `${def.name} booked for ${formatDollarAmount(def.cost)}.`;
    this.ledger.note(text);
    eventBus.emit('tickerMessage', { text });
    return run;
  }

  /** Hook: guests this event should bring, from the curve and the floor as
   *  they stand now (ignoring the cap; the panel says so). */
  expectedExtra(def: EventDef): number {
    const e = def.effect;
    if (e.type === 'group') return e.count;
    const { start, end } = this.marketing.window(def, this.clock());
    const shares = this.archetypeShares();
    const share = e.archetypes.reduce((sum, a) => sum + shares[a], 0);
    let extra = 0;
    // Hour by hour across the window, from the clock it will be then.
    const startOffset = this.time.tickInHour + (start - this.tickCount);
    for (let t = 0; t < end - start; t += TICKS_PER_HOUR) {
      const hoursAhead = Math.floor((startOffset + t) / TICKS_PER_HOUR);
      const abs = (this.time.day - 1) * HOURS_PER_DAY + this.time.hour + hoursAhead;
      const ticks = Math.min(TICKS_PER_HOUR, end - start - t);
      const at = {
        day: Math.floor(abs / HOURS_PER_DAY) + 1,
        hour: abs % HOURS_PER_DAY,
        fraction: 0.5,
      };
      extra += this.unliftedArrivalChance(at) * ticks * share * (e.mult - 1);
    }
    return Math.round(extra);
  }

  /** B10, every tick while any event is on the books: bring in a junket
   *  that is due, and close out the runs that just ended. */
  private marketingTick(): void {
    for (const run of this.marketing.dueGroups(this.tickCount)) {
      run.groupDone = true;
      const e = getEventDef(run.id)?.effect;
      if (e?.type !== 'group') continue;
      for (let i = 0; i < e.count; i++) {
        const guest = this.spawnGuest(e.archetype, e.walletMult);
        guest.leaveAtTick = this.tickCount + e.stayHours * TICKS_PER_HOUR;
      }
      const text = `The ${run.name.toLowerCase()} is here: ${e.count} guests through the door.`;
      eventBus.emit('tickerMessage', { text });
    }
    const active = this.marketing.active(this.tickCount);
    if (active.length > 0) {
      const full = this.guests.size >= this.guestCap();
      const chance = full ? 0 : this.unliftedArrivalChance(this.clockNow());
      const shares = full ? null : this.archetypeShares();
      for (const run of active) {
        run.ticks++;
        if (full) run.fullTicks++;
        const e = getEventDef(run.id)?.effect;
        if (!shares || e?.type !== 'arrivals') continue;
        const share = e.archetypes.reduce((sum, a) => sum + shares[a], 0);
        run.lifted += Math.min(1, chance * (1 + share * (e.mult - 1))) - chance;
      }
    }
    for (const run of this.marketing.runs) {
      if (run.result !== undefined || this.tickCount < run.endTick) continue;
      this.closeEventRun(run);
    }
  }

  private clockNow(): { day: number; hour: number; fraction: number } {
    return {
      day: this.time.day,
      hour: this.time.hour,
      fraction: this.time.tickInHour / TICKS_PER_HOUR,
    };
  }

  private closeEventRun(run: EventRun): void {
    const def = getEventDef(run.id);
    const parts: string[] = [];
    if (def?.effect.type === 'group') {
      run.extra = def.effect.count;
      parts.push(`${def.effect.count} guests flew in`);
    } else {
      run.extra = Math.round(run.lifted);
      const full = run.ticks > 0 ? Math.round((100 * run.fullTicks) / run.ticks) : 0;
      parts.push(
        `${run.arrivals} arrivals while it ran, about ${run.extra} more than the same hours without it` +
          (full > 0 ? ` (the floor was full ${full}% of the time)` : ''),
      );
    }
    if (def?.kind === 'tournament')
      parts.push(`${run.entrants} entrants paid ${formatDollarAmount(run.fees)}`);
    run.result = parts.join('; ');
    // The day report lists it from the run (worker/finance.ts dayReport).
    const text = `${run.name} ended: ${run.result}.`;
    eventBus.emit('tickerMessage', { text });
  }

  /** B10: a guest through the door while events are on the books: count
   *  them against what's running, and sign them up for a tournament. */
  private marketingArrival(guest: Guest): void {
    this.marketing.countArrival(this.tickCount);
    const t = this.marketing.tournament(this.tickCount);
    if (!t || t.def.effect.type !== 'arrivals') return;
    if (!t.def.effect.archetypes.includes(guest.archetype)) return;
    const fee = t.def.entryFee ?? 0;
    if (guest.wallet <= fee * 2) return;
    guest.tournament = true;
    guest.wallet -= fee;
    t.run.entrants++;
    t.run.fees += fee;
    if (fee === 0) return;
    this.state.cash += fee;
    this.ledger.addRevenue(fee);
    this.ledger.accrue(HOUSE_SOURCES.marketing.id, HOUSE_SOURCES.marketing.defId, {
      revenue: fee,
    });
  }

  /** Hook: what's booked or running now, for the HUD and the panel. */
  eventsNow(): { id: string; name: string; status: string }[] {
    const out: { id: string; name: string; status: string }[] = [];
    for (const run of this.marketing.runs) {
      if (this.tickCount >= run.endTick) continue;
      const running = this.tickCount >= run.startTick;
      const at = (tick: number) => {
        const abs =
          (this.time.day - 1) * HOURS_PER_DAY +
          this.time.hour +
          Math.floor((this.time.tickInHour + tick - this.tickCount) / TICKS_PER_HOUR);
        const day = Math.floor(abs / HOURS_PER_DAY) + 1;
        const hour = String(abs % HOURS_PER_DAY).padStart(2, '0');
        return day === this.time.day ? `${hour}:00` : `day ${day} ${hour}:00`;
      };
      out.push({
        id: run.id,
        name: run.name,
        status: running ? `until ${at(run.endTick)}` : `from ${at(run.startTick)}`,
      });
    }
    return out;
  }

  /** Every event this world knows, for the panel. */
  get eventDefs(): readonly EventDef[] {
    return EVENTS;
  }

  // ---------- staff ----------

  hireStaff(kind: StaffKind): Staff {
    const member = new Staff(`s-${this.nextStaffNum++}`, kind, this.entranceTile);
    member.skill = this.staffRng.int(STAFF_DEPTH.hireSkill.min, STAFF_DEPTH.hireSkill.max);
    member.shift = this.shiftForHire(kind);
    this.staff.set(member.id, member);
    if (this.staffDepth && !onShiftAt(member.shift, this.time.hour))
      member.clockOut(this, this.entranceTile);
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

  // ---------- B11: staff with depth ----------

  /** Hook: does this run play the full staffing game (shifts, fatigue,
   *  advantage players)? Sandbox and the career do; the P16 campaigns and the
   *  tutorial keep staff on every hour, as they were tuned. */
  get staffDepth(): boolean {
    return !!this.scenario?.def.staffDepth;
  }

  /** Hook: a role's hourly wage (the lever, else the market wage). */
  wageFor(kind: StaffKind): number {
    return this.wageLevels.get(kind) ?? STAFF_BALANCE[kind].wagePerHour;
  }

  /** Hook: set a role's wage, clamped to half to double the market wage.
   *  Returns the wage applied. */
  setWage(kind: StaffKind, wagePerHour: number): number | null {
    const market = STAFF_BALANCE[kind]?.wagePerHour;
    if (market === undefined || !Number.isFinite(wagePerHour)) return null;
    const [lo, hi] = STAFF_DEPTH.wageRange;
    const wage = Math.round(Math.min(hi * market, Math.max(lo * market, wagePerHour)) * 100) / 100;
    if (wage === market) this.wageLevels.delete(kind);
    else this.wageLevels.set(kind, wage);
    return wage;
  }

  /** The shift a new hire of this role takes: the one with the fewest of
   *  the role on it, the busiest of those first. A role's posts (tables,
   *  bars, a cage) need someone every hour, so the shifts fill evenly. */
  private shiftForHire(kind: StaffKind): Shift {
    const weight = (sh: Shift) => {
      const [from, to] = STAFF_DEPTH.shifts[sh];
      let w = 0;
      for (let h = from; h < to; h++) w += hourFactor(h);
      return w;
    };
    const count = (sh: Shift) =>
      [...this.staff.values()].filter((m) => m.kind === kind && m.shift === sh).length;
    return [...SHIFTS].sort((a, b) => count(a) - count(b) || weight(b) - weight(a))[0]!;
  }

  /** Is a role short-handed on the floor right now? */
  understaffed(kind: StaffKind): boolean {
    const on = [...this.staff.values()].filter((m) => m.kind === kind && m.state !== 'off').length;
    if (kind === 'dealer') {
      let dealt = 0;
      for (const m of this.machines.values()) if (m.needsDealer) dealt++;
      return on < dealt;
    }
    if (kind === 'mechanic') {
      let broken = 0;
      for (const m of this.machines.values()) if (m.broken) broken++;
      return on * STAFF_DEPTH.brokenPerMechanic < broken;
    }
    if (kind === 'janitor') return on * STAFF_DEPTH.messesPerJanitor < this.messes.size;
    return false;
  }

  /** Hook: staff rest at any service with `restsStaff: true` (none on the
   *  catalogue yet; B6's lounge seating is meant to be the first). */
  staffRestAvailable(): boolean {
    for (const po of this.state.allObjects()) if (getObjectDef(po.defId)?.restsStaff) return true;
    return false;
  }

  /** The hour boundary for staff: pay who worked the hour, tire them and move
   *  their morale, run the rota for the new hour, let the pit look around, and
   *  at midnight let the unhappy quit. */
  private staffHour(midnight: boolean): void {
    this.chargeWages();
    const depth = this.staffDepth;
    const short = new Map<StaffKind, boolean>();
    const isShort = (k: StaffKind) => {
      if (!short.has(k)) short.set(k, this.understaffed(k));
      return short.get(k)!;
    };
    for (const m of this.staff.values()) {
      if (m.state === 'off' || m.state === 'carried') continue;
      const ratio = this.wageFor(m.kind) / STAFF_BALANCE[m.kind].wagePerHour;
      if (depth) workHour(m, ratio, isShort(m.kind));
      else m.morale += STAFF_DEPTH.moraleDrift * (moraleTarget(ratio, 0, false) - m.morale);
    }
    const rest = depth && this.staffRestAvailable();
    // Who goes and who comes this hour. The leavers' posts go to the arrivals
    // of the same role (a handover in place), so a dealt table keeps dealing
    // through the change instead of waiting on a walk from the door.
    const posts = new Map<StaffKind, StaffPost[]>();
    const arriving: Staff[] = [];
    for (const m of this.staff.values()) {
      if (m.state === 'carried') continue;
      if (m.awayHours > 0) {
        if (--m.awayHours > 0) continue;
        m.awayFor = null;
      }
      const due = !depth || onShiftAt(m.shift, this.time.hour);
      if (due && m.state === 'off') arriving.push(m);
      else if (!due && m.state !== 'off') {
        const list = posts.get(m.kind) ?? [];
        list.push(m.post());
        posts.set(m.kind, list);
        m.clockOut(this, this.entranceTile);
        m.fatigue = 0;
      } else if (due && rest && m.fatigue >= STAFF_DEPTH.breakAtFatigue) {
        m.clockOut(this, this.entranceTile);
        m.fatigue = 0;
        m.awayFor = 'break';
        m.awayHours = 1;
      }
    }
    for (const m of arriving) {
      const post = posts.get(m.kind)?.shift();
      if (!post) {
        m.clockIn(this.entranceTile);
        continue;
      }
      // A post whose table, bar or cage has gone since is just a place to start.
      if (
        post.tableId &&
        (!this.machines.has(post.tableId) || this.dealerAssignments.has(post.tableId))
      )
        post.tableId = null;
      if (post.cageId && this.cashierAssignments.has(post.cageId)) post.cageId = null;
      if (post.barId && !this.bars.has(post.barId)) post.barId = null;
      if (post.state && !post.tableId && !post.barId && !post.cageId) post.state = null;
      m.relieve(post);
      if (post.tableId) this.dealerAssignments.set(post.tableId, m.id);
      if (post.cageId) this.cashierAssignments.set(post.cageId, m.id);
    }
    if (!midnight) return;
    for (const m of [...this.staff.values()]) {
      if (!this.staffRng.chance(quitChance(m.morale))) continue;
      this.fireStaff(m.id);
      const text = `A ${m.kind} quit (morale ${Math.round(m.morale)}).`;
      this.ledger.note(text);
      eventBus.emit('tickerMessage', { text, severity: 'alert' });
    }
  }

  /** Hook: send a member to training: costs money, adds skill, and takes them
   *  off the floor for a few game hours. */
  trainStaff(id: string): boolean {
    const m = this.staff.get(id);
    const t = STAFF_DEPTH.train;
    if (!m || m.skill >= 100 || m.awayFor || m.state === 'carried') return false;
    if (this.state.cash - t.cost < -this.creditLimit) return false;
    this.state.cash -= t.cost;
    this.ledger.addExpense(t.cost);
    this.ledger.accrue(HOUSE_SOURCES.wages.id, HOUSE_SOURCES.wages.defId, { upkeep: t.cost });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -t.cost });
    m.skill = Math.min(100, m.skill + t.skill);
    if (m.state !== 'off') m.clockOut(this, this.entranceTile);
    m.awayFor = 'training';
    m.awayHours = t.hours;
    return true;
  }

  /** Hook: move a member to another shift; they clock in or out at once. */
  setStaffShift(id: string, shift: Shift): boolean {
    const m = this.staff.get(id);
    if (!m || !SHIFTS.includes(shift)) return false;
    m.shift = shift;
    if (!this.staffDepth || m.awayFor || m.state === 'carried') return true;
    const due = onShiftAt(shift, this.time.hour);
    if (due && m.state === 'off') m.clockIn(this.entranceTile);
    else if (!due && m.state !== 'off') {
      m.clockOut(this, this.entranceTile);
      m.fatigue = 0;
    }
    return true;
  }

  /** An arrival's advantage, if the scenario has them. Draws nothing
   *  otherwise. */
  private rollAdvantage(): AdvantageKind | null {
    if (!this.staffDepth || !this.staffRng.chance(ADVANTAGE_BALANCE.share)) return null;
    let r = this.staffRng.next();
    for (const [kind, p] of Object.entries(ADVANTAGE_BALANCE.kinds) as [AdvantageKind, number][]) {
      if (r < p) return kind;
      r -= p;
    }
    return 'counter';
  }

  /** Hook: what the staff and the guest's advantage do to a play's money
   *  before it is booked. Theo is untouched: the house books what it expects,
   *  so a mis-pay or an undetected advantage shows as hold under theo. */
  private staffPlayEffects(machineId: string, guestId: string, result: PlayResult): void {
    const machine = this.machines.get(machineId);
    const guest = this.guests.get(guestId);
    if (!machine) return;
    const rounds = Math.max(1, result.rounds ?? 1);
    const stake = result.wager / rounds;
    const dealer = machine.needsDealer
      ? this.staff.get(this.dealerAssignments.get(machineId) ?? '')
      : undefined;
    if (dealer) {
      const p = misPayChance(dealer.skill);
      for (let i = 0; i < rounds; i++) {
        if (!this.staffRng.chance(p)) continue;
        result.payout += stake;
        dealer.misPays++;
        dealer.misPaid += stake;
      }
    }
    // Once the pit has flagged them, the dealer shuffles up on a counter and
    // the pit watches the layout and the reels: the advantage is gone, even
    // before security reaches them.
    if (!guest?.advantage || guest.suspicious) return;
    const kind = machine.math?.kind;
    const a = ADVANTAGE_BALANCE;
    let extra = 0;
    if (guest.advantage === 'counter' && kind === 'blackjack')
      extra = (result.theo ?? 0) + a.counterEdge * result.wager;
    else if (
      guest.advantage === 'pastPoster' &&
      (kind === 'roulette' || kind === 'craps' || kind === 'sicbo')
    ) {
      for (let i = 0; i < rounds; i++)
        if (this.staffRng.chance(a.pastPost.chance)) extra += a.pastPost.stakes * stake;
    } else if (guest.advantage === 'slotCheat' && kind === 'slots')
      extra = a.slotDrain * result.wager;
    else return;
    result.payout += extra;
    this.advantageTaken += extra;
    guest.advRounds += rounds;
    guest.advNet += extra;
    guest.advGame = machine.defId;
  }

  /** Each pit boss on the floor watches the advantage players in range: the
   *  hourly chance, spread over the hour's checks. */
  private detectAdvantagePlayers(): void {
    const a = ADVANTAGE_BALANCE;
    for (const boss of this.staff.values()) {
      if (boss.kind !== 'pitBoss' || boss.state === 'off' || boss.state === 'carried') continue;
      const hourly = Math.min(1, detectChance(boss.skill) * boss.speed);
      const p = 1 - (1 - hourly) ** (PIT_WATCH_TICKS / TICKS_PER_HOUR);
      for (const g of this.guests.values()) {
        if (!g.advantage || g.suspicious || g.advRounds === 0 || g.state === 'gone') continue;
        if (Math.hypot(g.pos.col - boss.pos.col, g.pos.row - boss.pos.row) > a.pitRadius) continue;
        if (!this.staffRng.chance(p)) continue;
        g.suspicious = true;
        const name = getObjectDef(g.advGame ?? '')?.name ?? 'the tables';
        const text = `The pit flagged ${g.name} at ${name}: ${ADVANTAGE_LABEL[g.advantage]}.`;
        this.ledger.note(text);
        eventBus.emit('tickerMessage', { text, severity: 'alert' });
      }
    }
  }

  /** Hook: walk a guest the pit has flagged out of the casino. */
  removeGuest(id: string): boolean {
    const g = this.guests.get(id);
    if (!g || !g.suspicious || g.escorted || g.state === 'gone') return false;
    g.escortOut(this);
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
      eventBus.emit('tickerMessage', {
        text: 'A machine has been repaired!',
        objectId: machine.id,
      });
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
      guest.drinkMood(this, purchase.ripoff, BAR_BALANCE.happinessOnDelivery);
      guest.waitingForDrink = false;
      return;
    }
    // Only janitor reaches here — pitBoss/security never claim a job in the
    // first place (see claimJobFor), so completeJob is unreachable for them.
    const at = this.messes.get(member.jobId);
    this.cleanMess(member.jobId);
    // B11: a skilled janitor sweeps what's around the job too.
    const r = cleanRadius(member.skill);
    if (!at || r === 0) return;
    for (const mess of [...this.messes.values()])
      if (
        Math.max(Math.abs(mess.col - at.col), Math.abs(mess.row - at.row)) <= r &&
        (!mess.claimedBy || mess.claimedBy === member.id)
      )
        this.cleanMess(mess.id);
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
      if (this.machines.get(po.id)?.needsDealer !== true) continue;
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
    this.ragePenalty = Math.min(
      RAGE_BALANCE.maxRatingPenalty,
      this.ragePenalty + RAGE_BALANCE.ratingDing,
    );
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

  /** Hook (B11): where a pit boss strolls next — a walkable cell within a
   *  few tiles of a table game, so the pit is watched. Only with staff depth
   *  (the P16 campaigns keep their ambient patrol); null with no tables. */
  pitPatrolTile(): Cell | null {
    if (!this.staffDepth) return null;
    const tables = [...this.machines.values()].filter((m) => m.needsDealer);
    if (tables.length === 0) return null;
    const po = this.state.getObject(tables[this.staffRng.int(0, tables.length - 1)]!.id);
    if (!po) return null;
    for (let i = 0; i < 25; i++) {
      const col = po.col + this.staffRng.int(-4, 4);
      const row = po.row + this.staffRng.int(-4, 4);
      if (this.grid.inBounds(col, row) && this.grid.isWalkable(col, row)) return { col, row };
    }
    return null;
  }

  randomWalkableTile(): Cell | null {
    for (let i = 0; i < 25; i++) {
      const col = this.rng.int(1, this.grid.cols - 2);
      const row = this.rng.int(1, this.grid.rows - 2);
      if (this.grid.isWalkable(col, row)) return { col, row };
    }
    return null;
  }

  /** `onlyMachineId` (v2 hook): the guest brain has already chosen which game;
   *  reserve a seat there or nowhere. */
  reserveMachine(
    guestId: string,
    wallet: number,
    onlyMachineId?: string,
  ): { machineId: string; stand: Cell } | null {
    for (const machine of this.machines.values()) {
      if (onlyMachineId !== undefined && machine.id !== onlyMachineId) continue;
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
    // v2: the poker table deals house-banked Ultimate Texas Hold'em, so no
    // table waits for a second player any more. Kept for the guest AI's call.
    void machineId;
    return false;
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
    const result = machine.play(this.rng, this.playContextFor(machineId, guestId));
    // A zero wager means the table couldn't deal (poker below minPlayers). No
    // money moved and there is nothing to record, but the caller still gets a
    // result: `null` is reserved for "there is no machine to play", which is
    // what tells a guest to give its seat up.
    if (result.wager === 0) return result;
    this.staffPlayEffects(machineId, guestId, result);
    const delta = result.wager - result.payout;
    this.state.cash += delta;
    this.ledger.addRevenue(delta);
    this.ledger.recordPlay(result.wager, result.payout);
    this.ledger.accrue(machineId, machine.defId, {
      wagered: result.wager,
      won: result.payout,
      revenue: delta,
      theo: result.theo ?? 0,
      rounds: result.rounds ?? 0,
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

  // ---------- v2 casino-math hooks (Session 4) ----------

  /** Hook: what a machine needs to know to play a guest's turn — their stake,
   *  their wallet, their skill, and how fast the table is being dealt. */
  playContextFor(machineId: string, guestId: string): PlayContext {
    const machine = this.machines.get(machineId);
    const guest = this.guests.get(guestId);
    return {
      unit: machine?.costToPlay ?? 0,
      wallet: guest?.wallet ?? Infinity,
      skillError:
        guest?.advantage === 'counter'
          ? 0
          : (ENGINE_BALANCE.skillErrorByArchetype[guest?.archetype ?? 'regular'] ?? 0.02),
      oddsAppetite: ENGINE_BALANCE.oddsAppetiteByArchetype[guest?.archetype ?? 'regular'] ?? 0.3,
      dealerSpeed: this.dealerSpeedFor(machineId),
    };
  }

  /** Hook: rounds-per-hour multiplier from the table's dealer. A dealt table
   *  without one limps along at ENGINE_BALANCE.noDealerSpeed. */
  dealerSpeedFor(machineId: string): number {
    const machine = this.machines.get(machineId);
    if (!machine?.needsDealer) return 1;
    const dealer = this.staff.get(this.dealerAssignments.get(machineId) ?? '');
    // B11: a dealer's skill sets the pace (0.8× at 0 to 1.15× at 100), and
    // low morale slows it.
    return dealer ? dealerSkillSpeed(dealer.skill) * dealer.speed : ENGINE_BALANCE.noDealerSpeed;
  }

  /** Hook: seat occupancy for the books — occupied and available seat-ticks. */
  private sampleOccupancy(): void {
    for (const machine of this.machines.values()) {
      const seats = machine instanceof SeatedCasinoGame ? machine.seatCount : 1;
      const occupied =
        machine instanceof SeatedCasinoGame ? machine.seatedCount : machine.reservedBy ? 1 : 0;
      this.ledger.accrue(machine.id, machine.defId, {
        occupiedTicks: occupied,
        capacityTicks: seats,
      });
    }
  }

  /** Hook: the `setRules` command. Validates, clamps and applies; replies with
   *  what had to change. Null when the object has no game engine. */
  setMachineRules(objectId: string, raw: unknown): { rules: unknown; issues: RulesIssue[] } | null {
    const machine = this.machines.get(objectId);
    const issues = machine?.setRules(raw);
    if (!machine || !issues) return null;
    return { rules: machine.math!.rules, issues };
  }

  /** Hook: the `sit` command — the avatar takes a seat the way a guest does,
   *  so a full table turns it away and guests can't sit on top of it. */
  seatPlayer(objectId: string): true | string {
    const machine = this.machines.get(objectId);
    if (!machine) return 'nothing there';
    if (machine.isPlayableBy(PLAYER_SEAT)) return true;
    if (machine.broken) return 'out of order';
    this.unseatPlayer();
    if (machine instanceof SeatedCasinoGame)
      return machine.claimSeat(PLAYER_SEAT) === null ? 'every seat is taken' : true;
    if (machine.reservedBy !== null) return 'someone is already playing';
    machine.reservedBy = PLAYER_SEAT;
    return true;
  }

  /** Hook: the `stand` command — give the avatar's seat back. */
  unseatPlayer(): void {
    this.releaseMachines(PLAYER_SEAT);
  }

  /** Hook: the `roundBegin` command — the avatar bets from its seat, taking one
   *  first if it has none (a save reload, or a table that was cleared). */
  beginPlayerRound(objectId: string, bets: Bet[]): PlayerRoundReply | string {
    const machine = this.machines.get(objectId);
    if (!machine?.math) return 'not a game the avatar can play';
    if (machine.broken) return 'out of order';
    const seated = this.seatPlayer(objectId);
    if (seated !== true) return seated;
    return this.player.begin(objectId, machine.math, bets, this.rng, this.houseBook);
  }

  /** Hook: the `roundAct` command — the avatar's next decision. */
  actPlayerRound(objectId: string, action: string): PlayerRoundReply | string {
    return this.player.act(objectId, action, this.houseBook);
  }

  /** The house side of the avatar's round: the player's loss is our win. */
  private readonly houseBook = {
    settle: (machineId: string, result: RoundResult & { theo: number }): void => {
      const machine = this.machines.get(machineId);
      const defId = machine?.defId ?? 'other';
      const delta = result.wagered - result.returned;
      this.state.cash += delta;
      this.ledger.addRevenue(delta);
      this.ledger.recordPlay(result.wagered, result.returned);
      this.ledger.recordPlayerRound(result.wagered, result.returned);
      this.ledger.accrue(machineId, defId, {
        wagered: result.wagered,
        won: result.returned,
        revenue: delta,
        theo: result.theo,
        rounds: 1,
      });
      if (machine) machine.lifetimeProfit += delta;
      eventBus.emit('moneyChanged', { cash: this.state.cash, delta });
    },
  };

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

  /** An operational food stall: has at least one unlocked item the wallet can
   *  afford. The cheapest such stall wins (B2); ties keep placement order, so a
   *  casino whose stalls share a price list picks exactly as before. */
  findFoodStall(wallet: number): { standId: string; stand: Cell } | null {
    let best: { standId: string; stand: Cell } | null = null;
    let bestIndex = Infinity;
    for (const po of this.state.allObjects()) {
      if (po.defId !== 'food-stall') continue;
      const stall = this.foodStalls.get(po.id);
      if (!stall || stall.priceIndex >= bestIndex) continue;
      if (!stall.pickAffordableItem(wallet, this.rng)) continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      best = { standId: po.id, stand };
      bestIndex = stall.priceIndex;
    }
    return best;
  }

  /**
   * B2 — how much the prices of a kind of service draw custom: priceAppeal of
   * the cheapest one on the floor, since that is the one a guest would pick.
   * Exactly 1 at default prices.
   */
  serviceAppeal(kind: 'food-stall' | 'bar'): number {
    let index = Infinity;
    const all = kind === 'bar' ? this.bars.values() : this.foodStalls.values();
    for (const s of all) index = Math.min(index, s.priceIndex);
    return index === Infinity ? 1 : priceAppeal(index);
  }

  /**
   * B2 — the player prices a menu item ('burger', ...) at a food stall, or the
   * drink ('drink') at a bar. Clamped to the object's band; returns the price
   * as applied, or null when there is no such object or item.
   */
  setPrice(objectId: string, itemId: string, price: number): number | null {
    if (!Number.isFinite(price)) return null;
    const bar = this.bars.get(objectId);
    if (bar) {
      if (itemId !== 'drink') return null;
      bar.setPrice(price);
      return bar.price;
    }
    const stall = this.foodStalls.get(objectId);
    const item = stall?.items.find((m) => m.id === itemId);
    if (!stall || !item) return null;
    stall.setPrice(itemId, price);
    return item.currentPrice;
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

  /** An operational bar: has stock and a walkable stand tile. The cheapest
   *  wins (B2); ties keep placement order, as findFoodStall. */
  findBar(): { barId: string; stand: Cell } | null {
    let best: { barId: string; stand: Cell } | null = null;
    let bestIndex = Infinity;
    for (const po of this.state.allObjects()) {
      if (po.defId !== 'bar') continue;
      const bar = this.bars.get(po.id);
      if (!bar || !bar.hasStock() || bar.priceIndex >= bestIndex) continue;
      const stand = this.standTileFor(po);
      if (!stand) continue;
      best = { barId: po.id, stand };
      bestIndex = bar.priceIndex;
    }
    return best;
  }

  /** Bartender production: one drink into stock, charged as an expense. A
   *  full bar pours nothing and costs nothing (B2: it used to book $4 every
   *  brew regardless, ~$300 a day against a few drinks sold). */
  brewDrink(barId: string): void {
    const bar = this.bars.get(barId);
    if (!bar || !bar.brew()) return;
    this.ledger.addExpense(BAR_BALANCE.drinkCost);
    this.ledger.accrue(barId, 'bar', { upkeep: BAR_BALANCE.drinkCost });
  }

  /** Self-serve or delivered sale at the bar's own price: null if
   *  unaffordable or out of stock. `ripoff` past PRICE_BALANCE.ripoffIndex. */
  buyDrink(barId: string, wallet: number): { price: number; ripoff: boolean } | null {
    const bar = this.bars.get(barId);
    if (!bar || !bar.hasStock() || wallet < bar.price) return null;
    if (!bar.takeDrink()) return null;
    const price = bar.price;
    this.state.cash += price;
    this.ledger.addRevenue(price);
    this.ledger.accrue(barId, 'bar', { revenue: price });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: price });
    return { price, ripoff: bar.priceIndex > PRICE_BALANCE.ripoffIndex };
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
    const { w, h } = footprintOf(po.defId, po.rot);

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
    if (!getObjectDef(po.defId)) return null;
    const { w, h } = footprintOf(po.defId, po.rot);
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
        ...(m.math ? { rules: m.math.toJSON() } : {}),
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
      wages: Object.fromEntries(this.wageLevels),
      marketing: this.marketing.toJSON(),
      staff: [...this.staff.values()].map((s) => ({
        skill: s.skill,
        morale: s.morale,
        fatigue: s.fatigue,
        shift: s.shift,
        awayHours: s.awayHours,
        awayFor: s.awayFor,
        off: s.state === 'off',
        misPays: s.misPays,
        misPaid: s.misPaid,
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
      loans: this.loans.toJSON(),
      mood: this.mood.toJSON(),
      traffic: this.traffic.toJSON(),
      floor: this.floor.toJSON(),
      player: this.player.toJSON(),
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
      // Rules first, then the saved stake: syncing the stake to the rules
      // would otherwise clamp a deliberately raised one back down.
      if (m.rules !== undefined) machine.setRules(m.rules);
      machine.costToPlay = m.costToPlay;
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
    this.installFloor(
      data.floor
        ? FloorPlan.fromJSON(data.floor)
        : FloorPlan.open(
            this.grid.cols,
            this.grid.rows,
            entranceFor(this.grid.cols, this.grid.rows),
          ),
    );
    this.tickCount = data.tickCount;
    for (const machine of loadedMachines) this.machines.set(machine.id, machine);
    this.machinesRevision++;
    for (const f of data.foodStalls) this.foodStalls.set(f.id, FoodStall.fromJSON(f));
    for (const b of data.bars) this.bars.set(b.id, Bar.fromJSON(b));
    for (const m of data.messes) this.messes.set(m.id, { ...m, claimedBy: null });
    this.nextMessNum = data.nextMessNum;
    for (const s of data.staff) {
      const member = new Staff(s.id, s.kind, { col: s.col, row: s.row });
      member.skill = s.skill ?? member.skill;
      member.morale = s.morale ?? member.morale;
      member.fatigue = s.fatigue ?? 0;
      member.shift = s.shift ?? member.shift;
      member.awayHours = s.awayHours ?? 0;
      member.awayFor = s.awayFor ?? null;
      member.misPays = s.misPays ?? 0;
      member.misPaid = s.misPaid ?? 0;
      if (s.off) member.state = 'off';
      this.staff.set(s.id, member);
    }
    this.wageLevels = new Map(Object.entries(data.wages ?? {}) as [StaffKind, number][]);
    this.marketing = Marketing.fromJSON(data.marketing);
    this.nextStaffNum = data.nextStaffNum;
    this.nextGuestNum = 1; // guests are transient — never saved
    this.time = TimeSystem.fromJSON(data.time);
    this.ledger = Ledger.fromJSON(data.ledger);
    this.scenario = data.scenario ? ScenarioManager.fromJSON(data.scenario) : null;
    this.modifiers = ModifierSystem.fromJSON(data.modifiers);
    this.reputation = Reputation.fromJSON(data.reputation);
    this.patrons = PatronRegistry.fromJSON(data.patrons);
    this.loans = LoanBook.fromJSON(data.loans);
    this.mood = MoodField.fromJSON(data.mood);
    this.traffic = TrafficField.fromJSON(data.traffic);
    this.player = PlayerPlay.fromJSON(data.player);
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
