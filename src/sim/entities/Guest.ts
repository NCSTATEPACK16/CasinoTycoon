import { eventBus } from '../../EventBus';
import type { CompKind } from '../../data/balance';
import {
  BAR_BALANCE,
  CASHIER_BALANCE,
  COMPS,
  expectedRtpFor,
  FOOD_BALANCE,
  GUEST_BALANCE,
  MESS_BALANCE,
  POKER_BALANCE,
  RAGE_BALANCE,
  STRUT_BALANCE,
} from '../../data/balance';
import { flavorName } from '../../data/names';
import { getObjectDef } from '../../data/objects';
import { THOUGHTS } from '../../data/thoughts';
import type { ThoughtContext } from '../../data/thoughts';
import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';
import { Walker } from './Walker';

export type GuestArchetype = 'regular' | 'highRoller' | 'biker' | 'tourist';

export type GuestState = 'wander' | 'seekGame' | 'play' | 'service' | 'leaving' | 'gone';

export interface GuestNeeds {
  energy: number;
  bladder: number;
  hunger: number;
  thirst: number;
  happiness: number;
}

export interface GuestThought {
  /** Stable THOUGHTS id. Kept alongside the text because the text can name its
   *  subject ("the Roulette Table is a ripoff"), so it is not a grouping key. */
  id: string;
  text: string;
  atTick: number;
}

const MAX_THOUGHTS = 6;

/** What a comped guest says about it — the whole point of targeting is that
 *  the player sees this guest react. */
const COMP_THOUGHT: Record<CompKind, string> = {
  drink: 'On the house? Very civilised.',
  meal: 'They fed me. I am not leaving.',
  matchPlay: 'Free chips! One more round.',
};

export class Guest extends Walker {
  readonly id: string;
  wallet: number;
  needs: GuestNeeds;
  state: GuestState = 'wander';

  thoughts: GuestThought[] = [];
  /** Set by the world's mess pass each tick; read by the thought predicates. */
  nearMess = false;
  readonly archetype: GuestArchetype;
  readonly name: string;
  /** Running total of payout − wager across every play this guest has made
   *  since the last time the session folded into the day's report. */
  netResult = 0;
  raging = false;
  celebrating = false;
  waitingForDrink = false;
  /** Consecutive losing plays at the current machine; reset when it changes. */
  lossStreak = 0;
  /** Consecutive winning plays at the current machine; reset when it changes. */
  winStreak = 0;
  /** Ticks spent seated at a table that couldn't deal, bounded by
   *  POKER_BALANCE.maxWaitTicks. Zero at every other game. */
  waitingForPlayersTicks = 0;
  private celebrateTicksLeft = 0;
  /** Wallet this guest arrived with. The comp cap is a fraction of it, so a
   *  high roller's comp budget scales with the session they can actually play. */
  private readonly startingWallet: number;
  /** Comp dollars issued so far this session — the figure the cap bounds. */
  compsReceived = 0;
  /** World tick at the moment of the last comp, so the comp's thought is
   *  stamped with the time it happened rather than a stale one. */
  lastCompTick = 0;
  private wagersByGame = new Map<string, number>();
  private thoughtLast = new Map<string, number>();
  private machineId: string | null = null;
  private spinsLeft = 0;
  private spinTimer = 0;
  private spinEveryTicks = 8; // from the machine's cadence at sit-down
  private serviceKind: 'toilet' | 'food-stall' | 'bar' | 'cage' | null = null;
  /** Once true, never visits a cage again this session — a one-time top-up. */
  private usedCashAdvance = false;
  private serviceTimer = 0;
  private foodStallId: string | null = null;
  private barId: string | null = null;
  private cageId: string | null = null;

  constructor(id: string, wallet: number, start: Cell, archetype: GuestArchetype = 'regular') {
    super(start);
    this.id = id;
    this.wallet = wallet;
    this.startingWallet = wallet;
    this.archetype = archetype;
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
    this.decayNeeds(world);
    this.maybeDropMess(world);
    this.updateThoughts(world.tickCount, world);
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

  private decayNeeds(world: CasinoWorld): void {
    const b = GUEST_BALANCE;
    this.needs.energy = Math.max(0, this.needs.energy - b.decayPerTick.energy);
    this.needs.bladder = Math.max(0, this.needs.bladder - b.decayPerTick.bladder);
    this.needs.hunger = Math.max(0, this.needs.hunger - b.decayPerTick.hunger);
    // A5 'heat wave' is the only modifier that touches a decay rate, and it
    // reads at the point of use so it can never drift out of sync.
    this.needs.thirst = Math.max(
      0,
      this.needs.thirst - b.decayPerTick.thirst * world.modifiers.thirstDecayMult(),
    );
    if (
      this.needs.bladder < b.criticalThreshold ||
      this.needs.hunger < b.criticalThreshold ||
      this.needs.thirst < b.criticalThreshold
    ) {
      this.adjustHappiness(-b.criticalHappinessDrainPerTick);
    }
  }

  private thoughtContext(world: CasinoWorld): ThoughtContext {
    const defId = this.machineId ? world.machineDefId(this.machineId) : null;
    const def = defId ? getObjectDef(defId) : undefined;
    return {
      wallet: this.wallet,
      nearMess: this.nearMess,
      ...this.needs,
      currentGame:
        def && this.machineId
          ? { defId: def.id, name: def.name, costToPlay: world.machineCost(this.machineId) }
          : null,
      lossStreak: this.lossStreak,
      winStreak: this.winStreak,
      hasToilet: world.hasServiceObject('toilet'),
      hasBar: world.hasServiceObject('bar'),
      hasFoodStall: world.hasServiceObject('food-stall'),
      waitingForPlayers: this.machineId
        ? world.isTableWaitingForPlayers(this.machineId)
        : false,
    };
  }

  private updateThoughts(tick: number, world: CasinoWorld): void {
    const ctx = this.thoughtContext(world);
    for (const def of THOUGHTS) {
      if (!def.when(ctx)) continue;
      // Cooldowns key on id+subject so a thought about one game can't mute the
      // same thought about another.
      const key = def.subject ? `${def.id}:${def.subject(ctx)}` : def.id;
      const last = this.thoughtLast.get(key);
      if (last !== undefined && tick - last < def.cooldownTicks) continue;
      const text = typeof def.text === 'function' ? def.text(ctx) : def.text;
      this.recordThought(tick, def.id, text, key);
    }
  }

  /** Push a thought (subject to its own cooldown) — shared by polled THOUGHTS
   * predicates and one-off event-triggered reactions like a rip-off purchase. */
  private recordThought(tick: number, id: string, text: string, cooldownKey: string = id): void {
    this.thoughtLast.set(cooldownKey, tick);
    this.thoughts.push({ id, text, atTick: tick });
    if (this.thoughts.length > MAX_THOUGHTS) this.thoughts.shift();
    eventBus.emit('guestThought', { guestId: this.id, thoughtId: id, text });
  }

  protected override onTileEntered(world: CasinoWorld): void {
    world.traffic.enter(this.pos.col, this.pos.row);
  }

  protected onRouteLost(world: CasinoWorld): void {
    if (this.state === 'leaving') {
      this.state = 'gone'; // fully walled in — despawn rather than pace forever
      return;
    }
    world.releaseMachines(this.id);
    this.machineId = null;
    this.lossStreak = 0;
    this.winStreak = 0;
    this.waitingForPlayersTicks = 0;
    this.serviceKind = null;
    this.foodStallId = null;
    this.barId = null;
    this.cageId = null;
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
    if (this.needs.thirst < b.needThreshold) {
      const svc = world.findBar();
      if (svc && this.goTo(world, svc.stand)) {
        this.state = 'service';
        this.serviceKind = 'bar';
        this.barId = svc.barId;
        this.serviceTimer = 0;
        return;
      }
    }
    if (!this.usedCashAdvance && this.wallet < CASHIER_BALANCE.walletThreshold) {
      const svc = world.findCage();
      if (svc && this.goTo(world, svc.stand)) {
        this.state = 'service';
        this.serviceKind = 'cage';
        this.cageId = svc.cageId;
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
    if (!this.waitingForDrink && this.needs.thirst < b.needThreshold) {
      this.waitingForDrink = true;
    }
    this.spinTimer++;
    if (this.spinTimer < this.spinEveryTicks) return;
    this.spinTimer = 0;
    const res = world.playMachine(this.machineId, this.id);
    if (!res) {
      // No machine to play any more (sold, or broken down under us).
      this.stopPlaying(world);
      return;
    }
    if (res.wager === 0) {
      // The table is short of players. Hold the seat — a poker room only ever
      // fills if the first guest waits for the second — but not forever.
      // spinEveryTicks is exactly the ticks elapsed since the last attempt.
      this.waitingForPlayersTicks += this.spinEveryTicks;
      if (this.waitingForPlayersTicks >= POKER_BALANCE.maxWaitTicks) this.stopPlaying(world);
      return;
    }
    this.waitingForPlayersTicks = 0;
    this.wallet += res.payout - res.wager;
    this.netResult += res.payout - res.wager;
    if (this.machineId) {
      const defId = world.machineDefId(this.machineId);
      if (defId) this.wagersByGame.set(defId, (this.wagersByGame.get(defId) ?? 0) + res.wager);
    }
    if (res.payout > 0) {
      this.winStreak++;
      this.lossStreak = 0;
      this.adjustHappiness(b.happinessOnWin);
    } else {
      this.lossStreak++;
      this.winStreak = 0;
      // Per-game sting stacks on the global loss penalty rather than replacing
      // it: a Big Six loss is happinessOnLoss (-1) plus its own -2, i.e. -3.
      const extra = this.machineId ? world.machineExtraHappinessOnLoss(this.machineId) : 0;
      this.adjustHappiness(b.happinessOnLoss + extra);
    }
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
    this.waitingForDrink = false;
    // Reset before evaluate() — it may seat this guest at the next machine in
    // the same call, and a streak must never carry across games.
    this.lossStreak = 0;
    this.winStreak = 0;
    this.waitingForPlayersTicks = 0;
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
    } else if (this.serviceKind === 'bar') {
      const purchase = this.barId ? world.buyDrink(this.barId, this.wallet) : null;
      if (purchase) {
        this.wallet -= purchase.price;
        this.needs.thirst = BAR_BALANCE.thirstRestore;
        this.adjustHappiness(BAR_BALANCE.happinessOnSelfServe);
      }
      this.barId = null;
    } else if (this.serviceKind === 'cage') {
      const result = this.cageId ? world.useCage(this.wallet, this.cageId) : null;
      if (result) {
        this.wallet += result.advance - CASHIER_BALANCE.fee;
        this.usedCashAdvance = true;
      }
      this.cageId = null;
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
      eventBus.emit('tickerMessage', { text: `${this.name} storms out in a rage!`, severity: 'warn' });
    }
    this.state = 'leaving';
    if (!this.goTo(world, world.entranceTile)) this.state = 'gone';
  }

  adjustHappiness(delta: number): void {
    this.needs.happiness = Math.min(100, Math.max(0, this.needs.happiness + delta));
  }

  /** Total wagered this session, across every game. */
  totalWagered(): number {
    let sum = 0;
    for (const wager of this.wagersByGame.values()) sum += wager;
    return sum;
  }

  /** Per-game wagers, for callers that need the breakdown (theoretical-value
   *  math weights each game by its own house edge). Copied so the internal
   *  ledger stays owned by the guest. */
  wagers(): ReadonlyMap<string, number> {
    return new Map(this.wagersByGame);
  }

  /** Theoretical win this session: Σ wagered[game] × (1 − expectedRtp(game)).
   *
   *  This is what a casino actually rates a player on — not what they lost.
   *  A guest who wagered $500 and got lucky is still worth comping; a guest
   *  who lost $50 on one bad hand is not. Games with no static payout table
   *  (poker, whose return is the rake on live population) contribute nothing,
   *  because there is no honest edge to weight them by. */
  theo(): number {
    let sum = 0;
    for (const [defId, wagered] of this.wagersByGame) {
      const rtp = expectedRtpFor(defId);
      if (rtp === null) continue;
      sum += wagered * (1 - rtp);
    }
    return sum;
  }

  /** Comp value this guest may still be issued this session.
   *
   *  Floored so the budget always admits at least one of the priciest comp:
   *  a percentage alone leaves a guest who walked in with $40 unable to accept
   *  a $25 match play, which turns the cap from a bound on propping someone up
   *  into a bar on comping them at all. */
  compHeadroom(): number {
    const budget = Math.max(
      this.startingWallet * COMPS.maxSessionExtensionPct,
      COMPS.compUnit.matchPlay,
    );
    return Math.max(0, budget - this.compsReceived);
  }

  /** Whether this guest has played enough to be worth comping. */
  get compEligible(): boolean {
    return this.theo() >= COMPS.theoFloorToComp;
  }

  /**
   * Accept a comp the player targeted at this guest.
   *
   * Returns false when the guest is not yet eligible or the session cap leaves
   * no room, so the caller can refuse the charge rather than take money for
   * nothing. Match play lands in the wallet as chips; a drink or a meal
   * restores the need it addresses. All three carry goodwill.
   */
  receiveComp(kind: CompKind): boolean {
    const cost = COMPS.compUnit[kind];
    if (!this.compEligible) return false;
    if (cost > this.compHeadroom()) return false;
    this.compsReceived += cost;
    if (kind === 'matchPlay') {
      this.wallet += cost;
    } else {
      const need = kind === 'drink' ? 'thirst' : 'hunger';
      this.needs[need] = Math.min(100, this.needs[need] + COMPS.needRestored[kind]);
    }
    this.adjustHappiness(cost * COMPS.happinessPerDollar);
    this.recordThought(this.lastCompTick, `comped-${kind}`, COMP_THOUGHT[kind]);
    return true;
  }

  /** True for a guest heading out in good spirits — reputation's positive
   *  signal, and the counterweight to rage quits. */
  get leavingContent(): boolean {
    return !this.raging && this.needs.happiness >= GUEST_BALANCE.startHappiness;
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
