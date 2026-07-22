import { eventBus } from '../EventBus';
import { ENTRANCE_TILE, GRID_COLS, GRID_ROWS, HOURS_PER_DAY, JACKPOT_PAYOUT_MULT, STARTING_CASH } from '../config';
import { BAR_BALANCE, GUEST_BALANCE, MESS_BALANCE, RAGE_BALANCE, RATING_BALANCE } from '../data/balance';
import type { CampaignDef } from '../data/campaigns';
import { getObjectDef } from '../data/objects';
import { canPlaceObject, placeObject, sellObject, type PlaceCheck } from './build';
import { BlackjackTable } from './entities/machines/BlackjackTable';
import { CrapsTable } from './entities/machines/CrapsTable';
import { SeatedCasinoGame } from './entities/machines/SeatedCasinoGame';
import { Guest } from './entities/Guest';
import { Bar, type BarJSON } from './entities/Bar';
import { FoodStall, type FoodStallJSON, type FoodPurchase } from './entities/FoodStall';
import type { Mess, MessKind } from './entities/Mess';
import { Staff, type StaffKind } from './entities/staff/Staff';
import { Ledger, type LedgerJSON } from './economy';
import { ScenarioManager, type ScenarioJSON } from './scenario/ScenarioManager';
import { TimeSystem, type TimeSystemJSON } from './TimeSystem';
import { type CasinoGame, type PlayCadence, type PlayResult } from './entities/machines/CasinoGame';
import { SlotMachine } from './entities/machines/SlotMachine';
import { GameState, type GameStateJSON, type PlacedObject } from './GameState';
import { findPath, type Cell } from './grid/astar';
import { IsoGrid, type IsoGridJSON } from './grid/IsoGrid';
import { Rng } from './rng';

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
}

export class CasinoWorld {
  state: GameState;
  grid: IsoGrid;
  rng: Rng;
  machines = new Map<string, CasinoGame>();
  foodStalls = new Map<string, FoodStall>();
  bars = new Map<string, Bar>();
  guests = new Map<string, Guest>();
  messes = new Map<string, Mess>();
  staff = new Map<string, Staff>();
  time = new TimeSystem();
  ledger = new Ledger();
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
  private ragePenalty = 0;

  constructor(opts: WorldOptions = {}) {
    this.state = new GameState();
    this.grid = new IsoGrid(GRID_COLS, GRID_ROWS);
    this.rng = new Rng(opts.seed ?? Date.now() >>> 0);
    this.autoSpawn = opts.autoSpawn ?? true;
  }

  // ---------- scenarios ----------

  /** Start a campaign (or `null` for sandbox): full floor wipe + fresh clock/books. */
  startScenario(def: CampaignDef | null): void {
    this.reset(def?.startingCash ?? STARTING_CASH);
    this.scenario = def ? new ScenarioManager(def) : null;
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
    this.grid.clear();
    this.state.reset(startingCash);
    this.time = new TimeSystem();
    this.ledger = new Ledger();
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
    if (po && defId === 'slot-machine') this.machines.set(po.id, new SlotMachine(po.id));
    if (po && defId === 'blackjack-table') this.machines.set(po.id, new BlackjackTable(po.id));
    if (po && defId === 'craps-table') this.machines.set(po.id, new CrapsTable(po.id));
    if (po && defId === 'food-stall') this.foodStalls.set(po.id, new FoodStall(po.id));
    if (po && defId === 'bar') this.bars.set(po.id, new Bar(po.id));
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
    }
    this.foodStalls.delete(objectId);
    this.bars.delete(objectId);
    return sellObject(this.state, this.grid, objectId);
  }

  // ---------- simulation ----------

  tick(): void {
    this.tickCount++;
    const t = this.time.tick();
    if (this.autoSpawn) this.maybeSpawn();
    this.applyMessEffects();
    for (const guest of this.guests.values()) guest.tick(this);
    for (const [id, guest] of [...this.guests]) {
      if (guest.state === 'gone') {
        this.foldGuestSession(guest);
        this.guests.delete(id);
        eventBus.emit('guestLeft', { id });
      }
    }
    for (const member of this.staff.values()) member.tick(this);
    if (t.hourPassed) this.onHourBoundary(t.midnight);
  }

  /** Bookkeeping at every hour boundary; midnight also rolls the day over. */
  private onHourBoundary(midnight: boolean): void {
    this.ragePenalty = Math.max(0, this.ragePenalty - RAGE_BALANCE.dingDecayPerHour);
    // The hour that just completed (time already shows the new hour/day).
    const closedHour = this.time.hour === 0 ? HOURS_PER_DAY - 1 : this.time.hour - 1;
    const closedDay = this.time.hour === 0 ? this.time.day - 1 : this.time.day;
    this.chargeWages();
    if (midnight) {
      this.chargeUpkeep();
      for (const guest of this.guests.values()) this.foldGuestSession(guest);
    }
    this.ledger.closeHour(closedDay, closedHour, this.guests.size);
    eventBus.emit('hourPassed', { hour: this.time.hour, day: this.time.day });
    if (midnight) {
      const record = this.ledger.closeDay(closedDay);
      this.scenario?.onDayEnded(record);
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
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: -total });
  }

  private chargeUpkeep(): void {
    let total = 0;
    for (const po of this.state.allObjects()) {
      total += getObjectDef(po.defId)?.upkeepPerDay ?? 0;
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

  /** Casino rating 0–100 — drives guest arrivals; shown in UI later. */
  get rating(): number {
    const b = RATING_BALANCE;
    const guests = [...this.guests.values()];
    const avgHappiness = guests.length
      ? guests.reduce((sum, g) => sum + g.needs.happiness, 0) / guests.length
      : b.neutralHappiness;
    const variety = new Set([...this.machines.values()].map((m) => m.defId)).size;
    let broken = 0;
    for (const m of this.machines.values()) if (m.broken) broken++;
    let signageBonus = 0;
    for (const po of this.state.allObjects()) {
      signageBonus += getObjectDef(po.defId)?.ratingBonus ?? 0;
    }
    signageBonus = Math.min(signageBonus, b.signageBonusCap);
    const score =
      b.happinessWeight * avgHappiness +
      Math.min(this.machines.size * b.perMachine, b.machineCap) +
      (variety >= 2 ? b.varietyBonus : 0) +
      Math.max(0, b.cleanlinessMax - this.messes.size * b.perMessPenalty) -
      broken * b.perBrokenPenalty +
      signageBonus -
      this.ragePenalty;
    return Math.round(Math.min(100, Math.max(0, score)));
  }

  private maybeSpawn(): void {
    if (this.guests.size >= GUEST_BALANCE.maxGuests) return;
    if (!this.rng.chance(spawnChance(this.rating, this.machines.size))) return;
    if (!this.grid.isWalkable(this.entranceTile.col, this.entranceTile.row)) return;
    this.spawnGuest();
  }

  spawnGuest(): Guest {
    const id = `g-${this.nextGuestNum++}`;
    const wallet = this.rng.int(GUEST_BALANCE.walletMin, GUEST_BALANCE.walletMax);
    const guest = new Guest(id, wallet, this.entranceTile);
    this.guests.set(id, guest);
    eventBus.emit('guestSpawned', { id, archetype: guest.archetype });
    return guest;
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
    return null; // bartender never calls claimJobFor — see Staff.actBartender
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
    this.cleanMess(member.jobId);
  }

  releaseJobs(staffId: string): void {
    for (const [machineId, claimant] of this.repairClaims) {
      if (claimant === staffId) this.repairClaims.delete(machineId);
    }
    for (const [guestId, claimant] of this.drinkClaims) {
      if (claimant === staffId) this.drinkClaims.delete(guestId);
    }
    for (const mess of this.messes.values()) {
      if (mess.claimedBy === staffId) mess.claimedBy = null;
    }
  }

  /** One-time rating ding from a rage quit; decays over subsequent hours. */
  applyRageQuitPenalty(): void {
    this.ragePenalty = Math.min(RAGE_BALANCE.maxRatingPenalty, this.ragePenalty + RAGE_BALANCE.ratingDing);
    this.ledger.recordRageQuit();
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
      const po = this.state.getObject(machine.id);
      if (!po) continue;
      if (machine instanceof SeatedCasinoGame) {
        // Seat indices align with the seat cells around the footprint.
        const cells = this.seatCellsFor(po);
        for (let seat = 0; seat < cells.length; seat++) {
          const cell = cells[seat]!;
          if (!machine.isSeatFree(seat) || !this.grid.isWalkable(cell.col, cell.row)) continue;
          machine.claimSeat(guestId, seat);
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
    if (result.wager === 0) return null;
    const delta = result.wager - result.payout;
    this.state.cash += delta;
    this.ledger.addRevenue(delta);
    this.ledger.recordPlay(result.wager, result.payout);
    if (result.payout >= result.wager * JACKPOT_PAYOUT_MULT) this.ledger.recordJackpot();
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta });
    eventBus.emit('machinePlayed', {
      machineId,
      guestId,
      wager: result.wager,
      payout: result.payout,
    });
    return result;
  }

  payCasino(amount: number): void {
    this.state.cash += amount;
    this.ledger.addRevenue(amount);
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: amount });
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
  }

  /** Self-serve or delivered sale: null if unaffordable or out of stock. */
  buyDrink(barId: string, wallet: number): { price: number } | null {
    const bar = this.bars.get(barId);
    if (!bar || !bar.hasStock() || wallet < BAR_BALANCE.drinkPrice) return null;
    if (!bar.takeDrink()) return null;
    this.state.cash += BAR_BALANCE.drinkPrice;
    this.ledger.addRevenue(BAR_BALANCE.drinkPrice);
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

  /** One seat cell per table seat: the midpoints of the four footprint sides. */
  private seatCellsFor(po: PlacedObject): Cell[] {
    const def = getObjectDef(po.defId);
    const { w, h } = def?.footprint ?? { w: 1, h: 1 };
    return [
      { col: po.col - 1, row: po.row }, // west
      { col: po.col, row: po.row - 1 }, // north
      { col: po.col + w, row: po.row + h - 1 }, // east
      { col: po.col + w - 1, row: po.row + h }, // south
    ];
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
    };
  }

  /** In-place restore from a save — `state`/`grid` keep identity (gameContext aliases them). */
  loadJSON(data: CasinoWorldJSON): void {
    this.guests.clear();
    this.repairClaims.clear();
    this.machines.clear();
    this.foodStalls.clear();
    this.bars.clear();
    this.messes.clear();
    this.staff.clear();
    this.state.load(data.state);
    this.grid.load(data.grid);
    this.tickCount = data.tickCount;
    for (const m of data.machines) {
      const machine =
        m.defId === 'blackjack-table'
          ? new BlackjackTable(m.id, m.costToPlay)
          : m.defId === 'craps-table'
            ? new CrapsTable(m.id, m.costToPlay)
            : new SlotMachine(m.id, m.costToPlay);
      machine.reliability = m.reliability;
      machine.lifetimeProfit = m.lifetimeProfit;
      machine.broken = m.broken;
      this.machines.set(m.id, machine);
    }
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
    const scenarioId = this.scenario?.def.id ?? null;
    eventBus.emit('worldReset', { scenarioId });
    eventBus.emit('worldLoaded', { scenarioId });
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: 0 });
    eventBus.emit('hourPassed', { hour: this.time.hour, day: this.time.day });
  }

  static fromJSON(data: CasinoWorldJSON): CasinoWorld {
    const world = new CasinoWorld();
    world.loadJSON(data);
    return world;
  }
}
