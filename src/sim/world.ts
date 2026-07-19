import { eventBus } from '../EventBus';
import { ENTRANCE_TILE, GRID_COLS, GRID_ROWS, TICKS_PER_HOUR } from '../config';
import { GUEST_BALANCE, MESS_BALANCE } from '../data/balance';
import { getObjectDef } from '../data/objects';
import { canPlaceObject, placeObject, sellObject, type PlaceCheck } from './build';
import { BlackjackTable } from './entities/machines/BlackjackTable';
import { Guest } from './entities/Guest';
import type { Mess, MessKind } from './entities/Mess';
import { Staff, type StaffKind } from './entities/staff/Staff';
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
  messes: MessJSON[];
  nextMessNum: number;
  staff: StaffJSON[];
  nextStaffNum: number;
}

export class CasinoWorld {
  state: GameState;
  grid: IsoGrid;
  rng: Rng;
  machines = new Map<string, CasinoGame>();
  guests = new Map<string, Guest>();
  messes = new Map<string, Mess>();
  staff = new Map<string, Staff>();
  tickCount = 0;
  entranceTile: Cell = { ...ENTRANCE_TILE };
  autoSpawn: boolean;
  private nextGuestNum = 1;
  private nextMessNum = 1;
  private nextStaffNum = 1;
  /** machineId → staffId, so two mechanics never race to the same repair. */
  private repairClaims = new Map<string, string>();

  constructor(opts: WorldOptions = {}) {
    this.state = new GameState();
    this.grid = new IsoGrid(GRID_COLS, GRID_ROWS);
    this.rng = new Rng(opts.seed ?? Date.now() >>> 0);
    this.autoSpawn = opts.autoSpawn ?? true;
  }

  // ---------- building ----------

  canPlace(defId: string, col: number, row: number): PlaceCheck {
    return canPlaceObject(this.state, this.grid, defId, col, row);
  }

  place(defId: string, col: number, row: number): PlacedObject | null {
    const po = placeObject(this.state, this.grid, defId, col, row);
    if (po && defId === 'slot-machine') this.machines.set(po.id, new SlotMachine(po.id));
    if (po && defId === 'blackjack-table') this.machines.set(po.id, new BlackjackTable(po.id));
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
    return sellObject(this.state, this.grid, objectId);
  }

  // ---------- simulation ----------

  tick(): void {
    this.tickCount++;
    if (this.autoSpawn) this.maybeSpawn();
    this.applyMessEffects();
    for (const guest of this.guests.values()) guest.tick(this);
    for (const [id, guest] of [...this.guests]) {
      if (guest.state === 'gone') {
        this.guests.delete(id);
        eventBus.emit('guestLeft', { id });
      }
    }
    for (const member of this.staff.values()) member.tick(this);
    if (this.tickCount % TICKS_PER_HOUR === 0) this.chargeWages();
  }

  private chargeWages(): void {
    let total = 0;
    for (const member of this.staff.values()) total += member.wagePerHour;
    if (total === 0) return;
    this.state.cash -= total;
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

  private maybeSpawn(): void {
    const b = GUEST_BALANCE;
    if (this.guests.size >= b.maxGuests) return;
    const p = Math.min(
      b.spawnCapPerTick,
      b.spawnBasePerTick + this.machines.size * b.spawnPerMachinePerTick,
    );
    if (!this.rng.chance(p)) return;
    if (!this.grid.isWalkable(this.entranceTile.col, this.entranceTile.row)) return;
    this.spawnGuest();
  }

  spawnGuest(): Guest {
    const id = `g-${this.nextGuestNum++}`;
    const wallet = this.rng.int(GUEST_BALANCE.walletMin, GUEST_BALANCE.walletMax);
    const guest = new Guest(id, wallet, this.entranceTile);
    this.guests.set(id, guest);
    eventBus.emit('guestSpawned', { id });
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
    for (const mess of this.messes.values()) {
      if (mess.claimedBy) continue;
      mess.claimedBy = member.id;
      return { jobId: mess.id, cell: { col: mess.col, row: mess.row } };
    }
    return null;
  }

  isJobStillValid(member: Staff): boolean {
    if (!member.jobId) return false;
    if (member.kind === 'mechanic') {
      const machine = this.machines.get(member.jobId);
      return !!machine && machine.broken && this.repairClaims.get(member.jobId) === member.id;
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
    this.cleanMess(member.jobId);
  }

  releaseJobs(staffId: string): void {
    for (const [machineId, claimant] of this.repairClaims) {
      if (claimant === staffId) this.repairClaims.delete(machineId);
    }
    for (const mess of this.messes.values()) {
      if (mess.claimedBy === staffId) mess.claimedBy = null;
    }
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
      if (machine instanceof BlackjackTable) {
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
    eventBus.emit('moneyChanged', { cash: this.state.cash, delta: amount });
  }

  findService(defId: 'toilet' | 'food-stall'): { stand: Cell } | null {
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
    };
  }

  static fromJSON(data: CasinoWorldJSON): CasinoWorld {
    const world = new CasinoWorld();
    world.state = GameState.fromJSON(data.state);
    world.grid = IsoGrid.fromJSON(data.grid);
    world.tickCount = data.tickCount;
    for (const m of data.machines) {
      const machine =
        m.defId === 'blackjack-table'
          ? new BlackjackTable(m.id, m.costToPlay)
          : new SlotMachine(m.id, m.costToPlay);
      machine.reliability = m.reliability;
      machine.lifetimeProfit = m.lifetimeProfit;
      machine.broken = m.broken;
      world.machines.set(m.id, machine);
    }
    for (const m of data.messes) {
      world.messes.set(m.id, { ...m, claimedBy: null });
    }
    world.nextMessNum = data.nextMessNum;
    for (const s of data.staff) {
      world.staff.set(s.id, new Staff(s.id, s.kind, { col: s.col, row: s.row }));
    }
    world.nextStaffNum = data.nextStaffNum;
    return world;
  }
}
