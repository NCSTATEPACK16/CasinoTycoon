import { eventBus } from '../../EventBus';
import { GUEST_BALANCE, SLOT_BALANCE } from '../../data/balance';
import { THOUGHTS } from '../../data/thoughts';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';

export type GuestState = 'wander' | 'seekGame' | 'play' | 'service' | 'leaving' | 'gone';

export interface GuestNeeds {
  energy: number;
  bladder: number;
  hunger: number;
  happiness: number;
}

export interface GuestThought {
  text: string;
  atTick: number;
}

const MAX_THOUGHTS = 6;

export class Guest {
  readonly id: string;
  wallet: number;
  needs: GuestNeeds;
  state: GuestState = 'wander';

  // Movement: pos is the logical tile; while stepping, moveFrom→moveTo with
  // moveTick/moveTicksPerTile progress. Render interpolates from these.
  pos: Cell;
  moveFrom: Cell;
  moveTo: Cell | null = null;
  moveTick = 0;

  thoughts: GuestThought[] = [];
  private thoughtLast = new Map<string, number>();
  private path: Cell[] = [];
  private machineId: string | null = null;
  private spinsLeft = 0;
  private spinTimer = 0;
  private serviceKind: 'toilet' | 'food-stall' | null = null;
  private serviceTimer = 0;

  constructor(id: string, wallet: number, start: Cell) {
    this.id = id;
    this.wallet = wallet;
    this.needs = {
      energy: 100,
      bladder: 100,
      hunger: 100,
      happiness: GUEST_BALANCE.startHappiness,
    };
    this.pos = { ...start };
    this.moveFrom = { ...start };
  }

  tick(world: CasinoWorld): void {
    if (this.state === 'gone') return;
    this.decayNeeds();
    this.updateThoughts(world.tickCount);
    this.stepMovement(world);
    this.act(world);
  }

  private decayNeeds(): void {
    const b = GUEST_BALANCE;
    this.needs.energy = Math.max(0, this.needs.energy - b.decayPerTick.energy);
    this.needs.bladder = Math.max(0, this.needs.bladder - b.decayPerTick.bladder);
    this.needs.hunger = Math.max(0, this.needs.hunger - b.decayPerTick.hunger);
    if (this.needs.bladder < b.criticalThreshold || this.needs.hunger < b.criticalThreshold) {
      this.adjustHappiness(-b.criticalHappinessDrainPerTick);
    }
  }

  private updateThoughts(tick: number): void {
    const ctx = { wallet: this.wallet, ...this.needs };
    for (const def of THOUGHTS) {
      if (!def.when(ctx)) continue;
      const last = this.thoughtLast.get(def.id);
      if (last !== undefined && tick - last < def.cooldownTicks) continue;
      this.thoughtLast.set(def.id, tick);
      this.thoughts.push({ text: def.text, atTick: tick });
      if (this.thoughts.length > MAX_THOUGHTS) this.thoughts.shift();
      eventBus.emit('guestThought', { guestId: this.id, text: def.text });
    }
  }

  private stepMovement(world: CasinoWorld): void {
    if (!this.moveTo) {
      if (this.path.length > 0) this.beginStep(world);
      return;
    }
    this.moveTick++;
    if (this.moveTick >= GUEST_BALANCE.moveTicksPerTile) {
      this.pos = { ...this.moveTo };
      this.moveFrom = { ...this.moveTo };
      this.moveTo = null;
      this.moveTick = 0;
      if (this.path.length > 0) this.beginStep(world);
    }
  }

  private beginStep(world: CasinoWorld): void {
    const next = this.path[0];
    if (!next) return;
    if (!world.grid.isWalkable(next.col, next.row)) {
      // Something was built across the route — re-path to the same destination.
      const dest = this.path[this.path.length - 1];
      const fresh = dest ? world.pathTo(this.pos, dest) : null;
      this.path = fresh ? fresh.slice(1) : [];
      if (this.path.length === 0) this.onRouteLost(world);
      return;
    }
    this.path.shift();
    this.moveTo = next;
    this.moveTick = 0;
  }

  private onRouteLost(world: CasinoWorld): void {
    if (this.state === 'leaving') {
      this.state = 'gone'; // fully walled in — despawn rather than pace forever
      return;
    }
    world.releaseMachines(this.id);
    this.machineId = null;
    this.serviceKind = null;
    this.state = 'wander';
  }

  private get arrived(): boolean {
    return this.moveTo === null && this.path.length === 0;
  }

  private act(world: CasinoWorld): void {
    switch (this.state) {
      case 'wander':
        if (this.arrived) this.evaluate(world);
        break;
      case 'seekGame':
        if (this.arrived) this.startPlaying(world);
        break;
      case 'play':
        this.tickPlay(world);
        break;
      case 'service':
        if (this.arrived) this.tickService(world);
        break;
      case 'leaving':
        if (this.arrived) this.state = 'gone';
        break;
      case 'gone':
        break;
    }
  }

  private evaluate(world: CasinoWorld): void {
    const b = GUEST_BALANCE;
    if (this.needs.energy <= b.leaveEnergy || this.wallet < b.brokeWallet) {
      this.leave(world);
      return;
    }
    if (this.needs.bladder < b.needThreshold) {
      const svc = world.findService('toilet');
      if (svc && this.goTo(world, svc.stand)) {
        this.state = 'service';
        this.serviceKind = 'toilet';
        this.serviceTimer = 0;
        return;
      }
    }
    if (this.needs.hunger < b.needThreshold && this.wallet >= b.foodPrice) {
      const svc = world.findService('food-stall');
      if (svc && this.goTo(world, svc.stand)) {
        this.state = 'service';
        this.serviceKind = 'food-stall';
        this.serviceTimer = 0;
        return;
      }
    }
    const res = world.reserveMachine(this.id, this.wallet);
    if (res) {
      if (this.goTo(world, res.stand)) {
        this.state = 'seekGame';
        this.machineId = res.machineId;
        return;
      }
      world.releaseMachines(this.id);
    }
    const target = world.randomWalkableTile();
    if (target) this.goTo(world, target);
    this.state = 'wander';
  }

  private startPlaying(world: CasinoWorld): void {
    if (this.machineId && world.machinePlayableBy(this.id, this.machineId)) {
      this.state = 'play';
      this.spinsLeft = world.rng.int(SLOT_BALANCE.spinsMin, SLOT_BALANCE.spinsMax);
      this.spinTimer = 0;
      return;
    }
    this.stopPlaying(world);
  }

  private tickPlay(world: CasinoWorld): void {
    const b = GUEST_BALANCE;
    if (
      !this.machineId ||
      !world.machinePlayableBy(this.id, this.machineId) ||
      this.wallet < world.machineCost(this.machineId)
    ) {
      this.stopPlaying(world);
      return;
    }
    this.spinTimer++;
    if (this.spinTimer < SLOT_BALANCE.spinIntervalTicks) return;
    this.spinTimer = 0;
    const res = world.playMachine(this.machineId, this.id);
    if (!res) {
      this.stopPlaying(world);
      return;
    }
    this.wallet += res.payout - res.wager;
    this.adjustHappiness(res.payout > 0 ? b.happinessOnWin : b.happinessOnLoss);
    this.spinsLeft--;
    if (this.spinsLeft <= 0) this.stopPlaying(world);
  }

  private stopPlaying(world: CasinoWorld): void {
    world.releaseMachines(this.id);
    this.machineId = null;
    this.evaluate(world);
  }

  private tickService(world: CasinoWorld): void {
    const b = GUEST_BALANCE;
    this.serviceTimer++;
    if (this.serviceTimer < b.serviceTicks) return;
    if (this.serviceKind === 'toilet') {
      this.needs.bladder = 100;
    } else if (this.serviceKind === 'food-stall') {
      if (this.wallet >= b.foodPrice) {
        this.wallet -= b.foodPrice;
        world.payCasino(b.foodPrice);
      }
      this.needs.hunger = 100;
    }
    this.adjustHappiness(b.happinessOnService);
    this.serviceKind = null;
    this.evaluate(world);
  }

  private leave(world: CasinoWorld): void {
    world.releaseMachines(this.id);
    this.machineId = null;
    this.state = 'leaving';
    if (!this.goTo(world, world.entranceTile)) this.state = 'gone';
  }

  private goTo(world: CasinoWorld, dest: Cell): boolean {
    const path = world.pathTo(this.pos, dest);
    if (!path) return false;
    this.path = path.slice(1);
    this.moveTo = null;
    this.moveTick = 0;
    return true;
  }

  private adjustHappiness(delta: number): void {
    this.needs.happiness = Math.min(100, Math.max(0, this.needs.happiness + delta));
  }
}
