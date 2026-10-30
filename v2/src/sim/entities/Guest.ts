import { eventBus } from '../../EventBus';
import type { CompKind, PatronTier } from '../../data/balance';
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
import { Anim } from '../../shared/contracts';
import { AI } from '../agents/aiBalance';
import { drawProfile, guestRng, stopReason, type BankrollProfile } from '../agents/bankroll';
import { joinQueue, leaveQueue, queuePlace, queueSpot } from '../agents/queue';
import { approachPose } from '../agents/seats';
import { spreadStand, standKey } from '../agents/stands';
import {
  needUrgency,
  rankChoices,
  scoreGame,
  type Choice,
  type GuestView,
} from '../agents/utility';
import type { Cell } from '../grid/astar';
import type { Rng } from '../rng';
import { GUEST_SPEED, NavFilter } from '../nav/NavSystem';
import type { CasinoWorld } from '../world';
import { Walker } from './Walker';

export type GuestArchetype = 'regular' | 'highRoller' | 'biker' | 'tourist';

export type GuestState = 'wander' | 'seekGame' | 'queue' | 'play' | 'service' | 'leaving' | 'gone';

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
  /** A1b — the carded patron this guest is a live instance of, or null for a
   *  walk-in. Set once at spawn; the record itself lives in the registry, so
   *  nothing about a patron is duplicated onto the transient agent. */
  readonly patronId: string | null;
  /** The tier that patron currently holds. Cached at spawn rather than looked
   *  up per call because comps read it on every UI refresh, and a tier cannot
   *  change mid-visit — promotion is settled on departure. */
  readonly patronTier: PatronTier | null;
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
  /** v2 bankroll model (SPEC §7): stop-loss, win goal, unit bet, skill. */
  readonly profile: BankrollProfile;
  /** This guest's own decision stream — never world.rng (see bankroll.ts). */
  private readonly brainRng: Rng;
  /** The score of what the guest is doing now, for hysteresis. */
  private currentScore = 0;
  private rethinkTimer = 0;
  private queueFor: string | null = null;
  private browseTicks = 0;
  /** Consecutive evaluations that found nothing better than wandering. */
  private idleLooks = 0;
  /** Stand cell this guest is using or heading to for a service (stands.ts). */
  serviceStand: string | null = null;
  private queueTicks = 0;
  private queuePlaceNow = -1;
  /** Σ payout − wager over the whole visit. Unlike netResult this is never
   *  folded away at midnight — the bankroll stop rules read it. */
  sessionNet = 0;
  private bankrollLocked = false;
  /** Self-served drinks this visit; enough of them and the guest is drunk. */
  drinks = 0;
  drunk = false;
  /** Being walked out by security. */
  escorted = false;
  /** B3: under daily traffic, the tick a visit is planned to end; the guest
   *  finishes what they are doing and goes home. Null: stay as long as
   *  money, mood and energy last (the campaigns' rule). */
  leaveAtTick: number | null = null;
  /** B5: the tick this guest walked in, for the Guests list. */
  arrivedTick = 0;
  /** Standing in High-Limit right now — keeps the zone on this guest's filter
   *  until they step out, so a bust-out never strands an agent off-mesh. */
  private inHighLimit = false;

  constructor(
    id: string,
    wallet: number,
    start: Cell,
    archetype: GuestArchetype = 'regular',
    patron: { id: string; name: string; tier: PatronTier } | null = null,
  ) {
    super(start);
    this.id = id;
    this.wallet = wallet;
    this.startingWallet = wallet;
    this.archetype = archetype;
    // A returning patron keeps the name the player learned. It comes off the
    // saved record rather than being re-derived from the guest id, which is
    // freshly allocated on every visit and after every load.
    this.name = patron ? patron.name : flavorName(id);
    this.patronId = patron ? patron.id : null;
    this.patronTier = patron ? patron.tier : null;
    this.needs = {
      energy: 100,
      bladder: 100,
      hunger: 100,
      thirst: 100,
      happiness: GUEST_BALANCE.startHappiness,
    };
    this.brainRng = guestRng(id);
    this.profile = drawProfile(this.brainRng, archetype, wallet);
    // Arrivals come through a doorway, not out of one point: scatter the
    // crowd spawn a little. (Grid mode draws from pos, so this is nav-only.)
    this.x += (this.brainRng.next() - 0.5) * 0.8;
    this.z += (this.brainRng.next() - 0.5) * 0.8;
  }

  /**
   * v2's crowd only: arrive somewhere between just fed and ready for dinner
   * (GUEST_BALANCE.arrivalNeedsMin). Drawn after the constructor's draws, so a
   * guest's profile and spawn point are unchanged; grid-mode worlds (the
   * ported balance suites the campaign goals were tuned on) never call it.
   */
  varyArrivalNeeds(): void {
    const min = GUEST_BALANCE.arrivalNeedsMin;
    for (const need of ['bladder', 'hunger', 'thirst'] as const)
      this.needs[need] = min[need] + (100 - min[need]) * this.brainRng.next();
  }

  get navSpeed(): number {
    let speed = GUEST_SPEED;
    if (this.raging) speed *= RAGE_BALANCE.speedMult;
    if (this.drunk) speed *= AI.drunkSpeedMult;
    return speed;
  }

  get navFilter(): NavFilter {
    return this.wallet >= AI.highLimitBankroll || this.inHighLimit
      ? NavFilter.HighRoller
      : NavFilter.Guest;
  }

  isInWorld(world: CasinoWorld): boolean {
    return this.state !== 'gone' && world.guests.get(this.id) === this;
  }

  /** What the crowd renderer should play. */
  get anim(): Anim {
    if (this.walking) return Anim.Walk;
    if (this.state === 'play') {
      if (this.celebrating) return Anim.Cheer;
      return this.waitingForPlayersTicks > 0 ? Anim.Sit : Anim.Play;
    }
    if (
      this.state === 'service' &&
      (this.serviceKind === 'food-stall' || this.serviceKind === 'bar')
    ) {
      return Anim.Eat;
    }
    if (this.celebrating) return Anim.Cheer;
    if (
      this.wallet < GUEST_BALANCE.brokeWallet ||
      this.needs.happiness < RAGE_BALANCE.happinessThreshold
    ) {
      return Anim.Sad;
    }
    return Anim.Idle;
  }

  get moveTicksPerTile(): number {
    if (this.raging)
      return Math.max(1, Math.round(GUEST_BALANCE.moveTicksPerTile / RAGE_BALANCE.speedMult));
    return GUEST_BALANCE.moveTicksPerTile;
  }

  tick(world: CasinoWorld): void {
    if (this.state === 'gone') return;
    this.inHighLimit = world.floor.zoneAt(this.pos.col, this.pos.row) === 'highLimit';
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
    // Drunks spill whatever their mood; everyone else only litters when sour.
    if (!this.drunk && this.needs.happiness >= b.unhappyThreshold) return;
    const chance = b.dropChancePerTick * (this.drunk ? AI.drunkMessMult : 1);
    if (!world.rng.chance(chance)) return;
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
      waitingForPlayers: this.machineId ? world.isTableWaitingForPlayers(this.machineId) : false,
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
    this.dropQueue(world);
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
    // B3: when the planned visit is over, anyone not seated or being served
    // heads home now rather than at their next re-think; a player finishes
    // the run of plays they are in (tickPlay re-thinks at its end).
    if (
      this.leaveAtTick !== null &&
      world.tickCount >= this.leaveAtTick &&
      (this.state === 'wander' || this.state === 'seekGame' || this.state === 'queue')
    ) {
      this.evaluate(world);
      return;
    }
    switch (this.state) {
      case 'wander':
        // On the crowd a wanderer browses where it lands for a few seconds
        // before re-thinking; v1's instant re-target kept 400 guests in
        // permanent motion on a full floor. Grid mode keeps v1's timing.
        if (this.arrived && (!world.nav || --this.browseTicks <= 0)) {
          this.browseTicks = 20 + this.brainRng.int(0, 60);
          this.evaluate(world);
        }
        break;
      case 'seekGame':
        if (this.arrived) this.startPlaying(world);
        break;
      case 'queue':
        this.tickQueue(world);
        break;
      case 'play':
        this.tickPlay(world);
        break;
      case 'service':
        if (this.arrived) this.tickService(world);
        break;
      case 'leaving':
        // On the crowd, anyone within reach of the door is out of it: a
        // departing rush must not have to queue for the exact entrance cell.
        if (this.arrived || (world.nav && this.nearEntrance(world))) this.state = 'gone';
        break;
      case 'gone':
        break;
    }
  }

  /** v1's leave rules plus the bankroll model's stop-loss and win goal. */
  private wantsToLeave(tick: number): boolean {
    const b = GUEST_BALANCE;
    if (this.needs.energy <= b.leaveEnergy || this.wallet < b.brokeWallet) return true;
    if (this.leaveAtTick !== null && tick >= this.leaveAtTick) {
      this.recordThought(tick, 'homeTime', 'Good night. Time to head home.');
      return true;
    }
    if (this.needs.happiness <= AI.leaveUnhappy) return true;
    return stopReason(this.profile, this.sessionNet) !== null;
  }

  private view(): GuestView {
    return {
      id: this.id,
      archetype: this.archetype,
      wallet: this.wallet,
      needs: this.needs,
      pos: this.pos,
      profile: this.profile,
      usedCashAdvance: this.usedCashAdvance,
      highLimitOk: this.wallet >= AI.highLimitBankroll,
    };
  }

  /**
   * The utility brain: score every candidate activity and take the best one
   * that can actually be started (reachable, a seat or a stand free). Leaving
   * is a hard rule, not a score — a broke guest does not weigh one more spin.
   */
  private evaluate(world: CasinoWorld): void {
    this.dropQueue(world);
    this.serviceStand = null;
    if (this.wantsToLeave(world.tickCount)) {
      this.leave(world);
      return;
    }
    for (const choice of rankChoices(world, this.view())) {
      if (this.tryChoice(world, choice)) {
        this.currentScore = choice.score;
        this.rethinkTimer = 0;
        return;
      }
    }
    this.currentScore = 0;
    this.state = 'wander';
  }

  private tryChoice(world: CasinoWorld, c: Choice): boolean {
    if (c.kind === 'wander') {
      // On the crowd, a guest with nothing to do browses nearby rather than
      // marching across the floor — and after a few fruitless looks, goes
      // home: a full casino turns people away. Grid mode keeps v1's wander.
      if (world.nav) {
        if (++this.idleLooks > AI.maxIdleLooks) {
          this.leave(world);
          return true;
        }
        const target = this.nearbyTile(world);
        if (target) this.goTo(world, target);
      } else {
        const target = world.randomWalkableTile();
        if (target) this.goTo(world, target);
      }
      this.state = 'wander';
      return true;
    }
    this.idleLooks = 0;
    if (c.kind === 'game') {
      if (c.full) return this.tryQueue(world, c.machineId);
      const res = world.reserveMachine(this.id, this.wallet, c.machineId);
      if (!res) return false;
      if (this.goTo(world, res.stand, approachPose(world, res.stand, res.machineId) ?? undefined)) {
        this.state = 'seekGame';
        this.machineId = res.machineId;
        return true;
      }
      world.releaseMachines(this.id);
      return false;
    }
    let stand: Cell | null = null;
    let objectId: string | undefined;
    if (c.service === 'toilet') {
      stand = world.findService('toilet')?.stand ?? null;
    } else if (c.service === 'food-stall') {
      const svc = world.findFoodStall(this.wallet);
      if (svc) [stand, objectId, this.foodStallId] = [svc.stand, svc.standId, svc.standId];
    } else if (c.service === 'bar') {
      const svc = world.findBar();
      if (svc) [stand, objectId, this.barId] = [svc.stand, svc.barId, svc.barId];
    } else {
      const svc = world.findCage();
      if (svc) [stand, objectId, this.cageId] = [svc.stand, svc.cageId, svc.cageId];
    }
    if (stand && world.nav) {
      // On the crowd, spread out over every side of the object (and, for the
      // restroom, every restroom) instead of all taking v1's first free cell.
      const ids = objectId
        ? [objectId]
        : world.state
            .allObjects()
            .filter((o) => o.defId === 'toilet')
            .map((o) => o.id);
      const spread = spreadStand(world, this.pos, ids, this);
      if (!spread) {
        this.foodStallId = this.barId = this.cageId = null;
        return false;
      }
      [stand, objectId] = [spread.stand, spread.objectId];
    }
    if (!stand || !this.goTo(world, stand, approachPose(world, stand, objectId) ?? undefined)) {
      this.foodStallId = this.barId = this.cageId = null;
      return false;
    }
    this.serviceStand = standKey(stand);
    this.state = 'service';
    this.serviceKind = c.service;
    this.serviceTimer = 0;
    return true;
  }

  private nearEntrance(world: CasinoWorld): boolean {
    const e = world.entranceTile;
    return Math.hypot(e.col + 0.5 - this.x, e.row + 0.5 - this.z) < AI.exitReach;
  }

  /**
   * Somewhere to browse, from this guest's own stream: a walkable cell within
   * a few metres. Off the gaming floor (just through the door, or back from a
   * restroom) "nearby" is the lobby, so a guest who finds every seat taken
   * would stand by the door with every other new arrival; they head onto the
   * floor instead, to browse beside one of the games they may play.
   */
  private nearbyTile(world: CasinoWorld): Cell | null {
    const zone = world.floor.zoneAt(this.pos.col, this.pos.row);
    const onFloor = zone === 'gaming' || zone === 'highLimit';
    const around = (onFloor ? null : this.gameToBrowse(world)) ?? this.pos;
    const r = onFloor ? AI.browseRadius : AI.browseRadius >> 1;
    for (let i = 0; i < 12; i++) {
      const col = around.col + this.brainRng.int(-r, r);
      const row = around.row + this.brainRng.int(-r, r);
      if (!world.grid.isWalkable(col, row)) continue;
      if (!this.mayEnter(world, col, row)) continue;
      return { col, row };
    }
    return null;
  }

  /** A random game on the floor this guest is allowed to stand beside. */
  private gameToBrowse(world: CasinoWorld): Cell | null {
    const games: Cell[] = [];
    for (const id of world.machines.keys()) {
      const po = world.state.getObject(id);
      if (po && this.mayEnter(world, po.col, po.row)) games.push({ col: po.col, row: po.row });
    }
    return games.length ? games[this.brainRng.int(0, games.length - 1)]! : null;
  }

  /** High-Limit is closed to guests below its bankroll; back-of-house to all. */
  private mayEnter(world: CasinoWorld, col: number, row: number): boolean {
    const zone = world.floor.zoneAt(col, row);
    if (zone === 'backOfHouse') return false;
    return zone !== 'highLimit' || this.wallet >= AI.highLimitBankroll;
  }

  /** Line up behind a full table, two cells out, and wait for a seat. */
  private tryQueue(world: CasinoWorld, machineId: string): boolean {
    const place = joinQueue(world, machineId, this.id);
    const spot = queueSpot(world, machineId, place);
    if (!spot || !this.goTo(world, spot)) {
      leaveQueue(world, machineId, this.id);
      return false;
    }
    this.state = 'queue';
    this.queueFor = machineId;
    this.queueTicks = 0;
    this.queuePlaceNow = place;
    return true;
  }

  private dropQueue(world: CasinoWorld): void {
    if (this.queueFor) leaveQueue(world, this.queueFor, this.id);
    this.queueFor = null;
    this.queueTicks = 0;
  }

  private tickQueue(world: CasinoWorld): void {
    const id = this.queueFor;
    if (!id || !world.machines.has(id) || ++this.queueTicks > AI.maxQueueTicks) {
      this.evaluate(world);
      return;
    }
    const place = queuePlace(world, id, this.id);
    if (place === 0 && world.machines.get(id)!.isAvailable) {
      const res = world.reserveMachine(this.id, this.wallet, id);
      if (res && this.goTo(world, res.stand, approachPose(world, res.stand, id) ?? undefined)) {
        leaveQueue(world, id, this.id);
        this.queueFor = null;
        this.state = 'seekGame';
        this.machineId = res.machineId;
        return;
      }
      if (res) world.releaseMachines(this.id);
    }
    // Shuffle up as the line moves.
    if (place !== this.queuePlaceNow && this.arrived) {
      this.queuePlaceNow = place;
      const spot = queueSpot(world, id, Math.max(0, place));
      if (spot) this.goTo(world, spot);
    }
  }

  /** Mid-activity: does a pressing need now beat what we are doing by enough
   *  to walk away from it? Hysteresis keeps a guest from flip-flopping. */
  private needInterrupts(world: CasinoWorld): boolean {
    if (++this.rethinkTimer < AI.rethinkEveryTicks) return false;
    this.rethinkTimer = 0;
    if (this.machineId) {
      const now = scoreGame(world, this.view(), this.machineId);
      if (now) this.currentScore = now.score;
    }
    const needs: [number, boolean][] = [
      [needUrgency(this.needs.bladder, 2), world.hasServiceObject('toilet')],
      [needUrgency(this.needs.hunger, 1), world.hasServiceObject('food-stall')],
    ];
    return needs.some(([u, has]) => has && u > this.currentScore * AI.hysteresis);
  }

  /** Security walks this guest out: straight for the door, no detours. */
  escortOut(world: CasinoWorld): void {
    this.escorted = true;
    this.dropQueue(world);
    world.releaseMachines(this.id);
    this.machineId = null;
    this.serviceKind = null;
    this.state = 'leaving';
    if (!this.goTo(world, world.entranceTile)) this.state = 'gone';
  }

  private startPlaying(world: CasinoWorld): void {
    // The session bankroll is what the guest sits down with at their first
    // game, not what they walked in with — a cash advance or a comp taken on
    // the way in is part of the stake.
    if (!this.bankrollLocked) {
      this.bankrollLocked = true;
      this.profile.bankroll = this.wallet;
    }
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
      this.wallet < world.machineCost(this.machineId) ||
      !world.isTableOpen(this.machineId) ||
      this.needInterrupts(world)
    ) {
      this.stopPlaying(world);
      return;
    }
    // B2: at a dear bar a seated guest holds out longer before ordering.
    if (
      !this.waitingForDrink &&
      this.needs.thirst < b.needThreshold &&
      this.needs.thirst < b.needThreshold * Math.min(1, world.serviceAppeal('bar'))
    ) {
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
    this.sessionNet += res.payout - res.wager;
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
    // The bankroll model ends a session the moment a stop rule trips, not at
    // the end of the planned run of plays.
    if (this.spinsLeft <= 0 || stopReason(this.profile, this.sessionNet) !== null)
      this.stopPlaying(world);
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
        this.drinkMood(world, purchase.ripoff, BAR_BALANCE.happinessOnSelfServe);
        if (++this.drinks >= AI.drunkAfterDrinks && !this.drunk) {
          this.drunk = true;
          this.recordThought(world.tickCount, 'drunk', 'One more and I’ll own this place!');
        }
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
    if (
      this.wallet < GUEST_BALANCE.brokeWallet &&
      this.needs.happiness < RAGE_BALANCE.happinessThreshold
    ) {
      this.raging = true;
      world.applyRageQuitPenalty();
      this.recordThought(world.tickCount, 'raging', 'This place ripped me off!');
      eventBus.emit('tickerMessage', {
        text: `${this.name} storms out in a rage!`,
        severity: 'warn',
        guestId: this.id,
      });
    }
    this.state = 'leaving';
    if (!this.goTo(world, world.entranceTile)) this.state = 'gone';
  }

  /** How a drink went down: the usual lift, or resentment at a price past
   *  PRICE_BALANCE.ripoffIndex (the same hit as a food rip-off). */
  drinkMood(world: CasinoWorld, ripoff: boolean, happiness: number): void {
    if (!ripoff) return this.adjustHappiness(happiness);
    this.adjustHappiness(FOOD_BALANCE.happinessOnRipoff);
    this.recordThought(world.tickCount, 'ripoff', 'Who charges that for a drink?');
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
    // A1b: a carded patron's tier widens the budget. This is the tier benefit
    // the player operates rather than merely reads — a black-tier regular can
    // be looked after in a way a walk-in cannot.
    const tierBonus = 1 + (this.patronTier?.compRate ?? 0);
    const budget =
      Math.max(this.startingWallet * COMPS.maxSessionExtensionPct, COMPS.compUnit.matchPlay) *
      tierBonus;
    return Math.max(0, budget - this.compsReceived);
  }

  /** Whether this guest has played enough to be worth comping.
   *
   *  A carded patron skips the session floor outright: their lifetime record
   *  already cleared a far higher bar than one session's play ever asks for,
   *  and making the player wait to greet a known regular is exactly the
   *  bookkeeping this feature is not allowed to become. */
  get compEligible(): boolean {
    return this.patronTier !== null || this.theo() >= COMPS.theoFloorToComp;
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
