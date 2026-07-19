import { eventBus } from '../EventBus';
import { ENTRANCE_TILE, GRID_COLS, GRID_ROWS } from '../config';
import { GUEST_BALANCE } from '../data/balance';
import { getObjectDef } from '../data/objects';
import { canPlaceObject, placeObject, sellObject, type PlaceCheck } from './build';
import { Guest } from './entities/Guest';
import { type PlayResult } from './entities/machines/CasinoGame';
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
  costToPlay: number;
  reliability: number;
  lifetimeProfit: number;
  broken: boolean;
}

export interface CasinoWorldJSON {
  state: GameStateJSON;
  grid: IsoGridJSON;
  tickCount: number;
  machines: MachineJSON[];
}

export class CasinoWorld {
  state: GameState;
  grid: IsoGrid;
  rng: Rng;
  machines = new Map<string, SlotMachine>();
  guests = new Map<string, Guest>();
  tickCount = 0;
  entranceTile: Cell = { ...ENTRANCE_TILE };
  autoSpawn: boolean;
  private nextGuestNum = 1;

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
    return po;
  }

  sell(objectId: string): number | null {
    const machine = this.machines.get(objectId);
    if (machine) {
      // Guests holding a reference re-evaluate on their next tick.
      machine.broken = true;
      machine.reservedBy = null;
      this.machines.delete(objectId);
    }
    return sellObject(this.state, this.grid, objectId);
  }

  // ---------- simulation ----------

  tick(): void {
    this.tickCount++;
    if (this.autoSpawn) this.maybeSpawn();
    for (const guest of this.guests.values()) guest.tick(this);
    for (const [id, guest] of [...this.guests]) {
      if (guest.state === 'gone') {
        this.guests.delete(id);
        eventBus.emit('guestLeft', { id });
      }
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
      const stand = this.standTileFor(po);
      if (!stand) continue;
      machine.reservedBy = guestId;
      return { machineId: machine.id, stand };
    }
    return null;
  }

  releaseMachines(guestId: string): void {
    for (const machine of this.machines.values()) {
      if (machine.reservedBy === guestId) machine.reservedBy = null;
    }
  }

  machinePlayableBy(guestId: string, machineId: string): boolean {
    const machine = this.machines.get(machineId);
    return !!machine && !machine.broken && machine.reservedBy === guestId;
  }

  machineCost(machineId: string): number {
    return this.machines.get(machineId)?.costToPlay ?? Infinity;
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
        costToPlay: m.costToPlay,
        reliability: m.reliability,
        lifetimeProfit: m.lifetimeProfit,
        broken: m.broken,
      })),
    };
  }

  static fromJSON(data: CasinoWorldJSON): CasinoWorld {
    const world = new CasinoWorld();
    world.state = GameState.fromJSON(data.state);
    world.grid = IsoGrid.fromJSON(data.grid);
    world.tickCount = data.tickCount;
    for (const m of data.machines) {
      const machine = new SlotMachine(m.id, m.costToPlay);
      machine.reliability = m.reliability;
      machine.lifetimeProfit = m.lifetimeProfit;
      machine.broken = m.broken;
      world.machines.set(m.id, machine);
    }
    return world;
  }
}
