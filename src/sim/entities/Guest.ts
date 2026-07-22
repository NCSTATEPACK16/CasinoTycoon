import { eventBus } from '../../EventBus';
import { FOOD_BALANCE, GUEST_BALANCE, MESS_BALANCE, RAGE_BALANCE, STRUT_BALANCE } from '../../data/balance';
import { flavorName } from '../../data/names';
import { THOUGHTS } from '../../data/thoughts';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';
import { Walker } from './Walker';

export type GuestArchetype = 'regular';

export type GuestState = 'wander' | 'seekGame' | 'play' | 'service' | 'leaving' | 'gone';

export interface GuestNeeds {
  energy: number;
  bladder: number;
  hunger: number;
  thirst: number;
  happiness: number;
}

export interface GuestThought {
  text: string;
  atTick: number;
}

const MAX_THOUGHTS = 6;

export class Guest extends Walker {
  readonly id: string;
  wallet: number;
  needs: GuestNeeds;
  state: GuestState = 'wander';

  thoughts: GuestThought[] = [];
  /** Set by the world's mess pass each tick; read by the thought predicates. */
  nearMess = false;
  readonly archetype: GuestArchetype = 'regular';
  readonly name: string;
  /** Running total of payout − wager across every play this guest has made
   *  since the last time the session folded into the day's report. */
  netResult = 0;
  raging = false;
  celebrating = false;
  private celebrateTicksLeft = 0;
  private wagersByGame = new Map<string, number>();
  private thoughtLast = new Map<string, number>();
  private machineId: string | null = null;
  private spinsLeft = 0;
  private spinTimer = 0;
  private spinEveryTicks = 8; // from the machine's cadence at sit-down
  private serviceKind: 'toilet' | 'food-stall' | null = null;
  private serviceTimer = 0;
  private foodStallId: string | null = null;

  constructor(id: string, wallet: number, start: Cell) {
    super(start);
    this.id = id;
    this.wallet = wallet;
    this.name = flavorName(id);
    this.needs = {
      energy: 100,
      bladder: 100,
      hunger: 100,
      thirst: 100,
      happiness: GUEST_BALANCE.startHappiness,
    };
  }

  get moveTicksPerTile(): number {
    if (this.raging) return Math.max(1, Math.round(GUEST_BALANCE.moveTicksPerTile / RAGE_BALANCE.speedMult));
    return GUEST_BALANCE.moveTicksPerTile;
  }

  tick(world: CasinoWorld): void {
    if (this.state === 'gone') return;
    this.decayNeeds();
    this.maybeDropMess(world);
    this.updateThoughts(world.tickCount);
    if (this.celebrateTicksLeft > 0) {
      this.celebrateTicksLeft--;
      if (this.celebrateTicksLeft === 0) this.celebrating = false;
    }
    this.stepMovement(world);
    this.act(world);
  }

  private maybeDropMess(world: CasinoWorld): void {
    const b = MESS_BALANCE;
    if (this.needs.happiness >= b.unhappyThreshold) return;
    if (!world.rng.chance(b.dropChancePerTick)) return;
    world.dropMess(this.pos.col, this.pos.row, world.rng.chance(0.5) ? 'spill' : 'trash');
  }

  private decayNeeds(): void {
    const b = GUEST_BALANCE;
    this.needs.energy = Math.max(0, this.needs.energy - b.decayPerTick.energy);
    this.needs.bladder = Math.max(0, this.needs.bladder - b.decayPerTick.bladder);
    this.needs.hunger = Math.max(0, this.needs.hunger - b.decayPerTick.hunger);
    this.needs.thirst = Math.max(0, this.needs.thirst - b.decayPerTick.thirst);
    if (
      this.needs.bladder < b.criticalThreshold ||
      this.needs.hunger < b.criticalThreshold ||
      this.needs.thirst < b.criticalThreshold
    ) {
      this.adjustHappiness(-b.criticalHappinessDrainPerTick);
    }
  }

  private updateThoughts(tick: number): void {
    const ctx = { wallet: this.wallet, nearMess: this.nearMess, ...this.needs };
    for (const def of THOUGHTS) {
      if (!def.when(ctx)) continue;
      const last = this.thoughtLast.get(def.id);
      if (last !== undefined && tick - last < def.cooldownTicks) continue;
      this.recordThought(tick, def.id, def.text);
    }
  }

  /** Push a thought (subject to its own cooldown) — shared by polled THOUGHTS
   * predicates and one-off event-triggered reactions like a rip-off purchase. */
  private recordThought(tick: number, id: string, text: string): void {
    this.thoughtLast.set(id, tick);
    this.thoughts.push({ text, atTick: tick });
    if (this.thoughts.length > MAX_THOUGHTS) this.thoughts.shift();
    eventBus.emit('guestThought', { guestId: this.id, thoughtId: id, text });
  }

  protected onRouteLost(world: CasinoWorld): void {
    if (this.state === 'leaving') {
      this.state = 'gone'; // fully walled in — despawn rather than pace forever
      return;
    }
    world.releaseMachines(this.id);
    this.machineId = null;
    this.serviceKind = null;
    this.foodStallId = null;
    this.state = 'wander';
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
    if (this.needs.hunger < b.needThreshold) {
      const svc = world.findFoodStall(this.wallet);
      if (svc && this.goTo(world, svc.stand)) {
        this.state = 'service';
        this.serviceKind = 'food-stall';
        this.foodStallId = svc.standId;
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
    const cadence = this.machineId ? world.machineCadence(this.machineId) : null;
    if (this.machineId && cadence && world.machinePlayableBy(this.id, this.machineId)) {
      this.state = 'play';
      this.spinsLeft = world.rng.int(cadence.playsMin, cadence.playsMax);
      this.spinEveryTicks = cadence.intervalTicks;
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
    if (this.spinTimer < this.spinEveryTicks) return;
    this.spinTimer = 0;
    const res = world.playMachine(this.machineId, this.id);
    if (!res) {
      this.stopPlaying(world);
      return;
    }
    this.wallet += res.payout - res.wager;
    this.netResult += res.payout - res.wager;
    if (this.machineId) {
      const defId = world.machineDefId(this.machineId);
      if (defId) this.wagersByGame.set(defId, (this.wagersByGame.get(defId) ?? 0) + res.wager);
    }
    this.adjustHappiness(res.payout > 0 ? b.happinessOnWin : b.happinessOnLoss);
    if (res.payout >= res.wager * STRUT_BALANCE.payoutMultiplier) this.startCelebrating(world);
    this.spinsLeft--;
    if (this.spinsLeft <= 0) this.stopPlaying(world);
  }

  private startCelebrating(world: CasinoWorld): void {
    this.celebrating = true;
    this.celebrateTicksLeft = STRUT_BALANCE.durationTicks;
    this.adjustHappiness(STRUT_BALANCE.happinessBump);
    this.recordThought(world.tickCount, 'celebrate', 'Jackpot! I’m on fire!');
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
      this.adjustHappiness(b.happinessOnService);
    } else if (this.serviceKind === 'food-stall') {
      const purchase = this.foodStallId ? world.buyFoodItem(this.foodStallId, this.wallet) : null;
      if (purchase) {
        this.wallet -= purchase.price;
        this.needs.hunger = Math.min(100, this.needs.hunger + purchase.hungerSatisfaction);
        if (purchase.ripoff) {
          this.adjustHappiness(FOOD_BALANCE.happinessOnRipoff);
          this.recordThought(
            world.tickCount,
            'ripoff',
            'The prices at the food stall are a total rip-off!',
          );
        } else {
          this.adjustHappiness(b.happinessOnService);
        }
      }
      this.foodStallId = null;
    }
    this.serviceKind = null;
    this.evaluate(world);
  }

  private leave(world: CasinoWorld): void {
    world.releaseMachines(this.id);
    this.machineId = null;
    if (this.wallet < GUEST_BALANCE.brokeWallet && this.needs.happiness < RAGE_BALANCE.happinessThreshold) {
      this.raging = true;
      world.applyRageQuitPenalty();
      this.recordThought(world.tickCount, 'raging', 'This place ripped me off!');
      eventBus.emit('tickerMessage', { text: `${this.name} storms out in a rage!` });
    }
    this.state = 'leaving';
    if (!this.goTo(world, world.entranceTile)) this.state = 'gone';
  }

  adjustHappiness(delta: number): void {
    this.needs.happiness = Math.min(100, Math.max(0, this.needs.happiness + delta));
  }

  /** The defId this guest has wagered the most on, or null if it never played. */
  favoriteGame(): string | null {
    let best: string | null = null;
    let bestWager = 0;
    for (const [defId, wager] of this.wagersByGame) {
      if (wager > bestWager) {
        best = defId;
        bestWager = wager;
      }
    }
    return best;
  }
}
