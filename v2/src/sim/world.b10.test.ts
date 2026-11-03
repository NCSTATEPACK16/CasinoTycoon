// B10: marketing and events, wired into the world. An ad lifts its own
// archetype's arrivals for its days only and costs what it says; a full floor
// gets nothing for it; a junket flies its group in; a tournament signs up
// slot players; scenarios that offer nothing are untouched.

import { afterEach, describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../config';
import { eventBus } from '../EventBus';
import { CAREER, getCampaign, SANDBOX, TUTORIAL, type CampaignDef } from '../data/campaigns';
import { getEventDef } from '../data/events';
import { CAREER_PLANS, careerWorld, runCareer } from './__testkit__/career';
import { runCampaign } from './__testkit__/strategies';
import { HOUSE_SOURCES } from './economy';
import type { GuestArchetype } from './entities/Guest';
import { TICKS_PER_DAY } from './marketing';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const marketingSpend = (world: CasinoWorld) =>
  world.ledger.sources.get(HOUSE_SOURCES.marketing.id)?.upkeep ?? 0;

function sandbox(seed = 4, autoSpawn = false, def: CampaignDef = SANDBOX): CasinoWorld {
  const world = new CasinoWorld({ seed, autoSpawn });
  world.startScenario(def);
  return world;
}

/** A row of slots by the door (95, 32), staffed enough to run. */
function slotFloor(world: CasinoWorld, n: number): void {
  for (let i = 0; i < n; i++)
    world.place('slot-machine', 70 + 2 * (i % 12), 24 + 3 * Math.floor(i / 12));
  world.hireStaff('mechanic');
  world.hireStaff('janitor');
}

describe('booking', () => {
  it('costs what it says, once, booked to marketing', () => {
    const world = sandbox();
    const cash = world.state.cash;
    world.runEvent('radio');
    expect(cash - world.state.cash).toBe(getEventDef('radio')!.cost);
    expect(marketingSpend(world)).toBe(getEventDef('radio')!.cost);
    expect(() => world.runEvent('radio')).toThrow('Already booked');
  });

  it('only what the scenario offers, and the concert needs a stage', () => {
    const tutorial = sandbox(4, false, TUTORIAL);
    expect(tutorial.marketingOffered).toEqual([]);
    expect(() => tutorial.runEvent('radio')).toThrow('Not offered here');
    const world = sandbox();
    expect(world.eventBlocked(getEventDef('concert')!)).toBe('Needs a stage');
    expect(world.eventBlocked(getEventDef('slot-tournament')!)).toBe('Needs 6 slots');
    slotFloor(world, 6);
    expect(world.eventBlocked(getEventDef('slot-tournament')!)).toBeNull();
  });

  it('cools down after it ends', () => {
    const world = sandbox();
    const run = world.runEvent('mailers');
    while (world.tickCount < run.endTick) world.tick();
    expect(world.eventBlocked(getEventDef('mailers')!)).toBe('Ready in 4 days');
    while (world.tickCount < run.endTick + 4 * TICKS_PER_DAY) world.tick();
    expect(world.eventBlocked(getEventDef('mailers')!)).toBeNull();
  });

  it('the early career and the P16 campaigns offer none', () => {
    const offering = CAREER.filter((c) => (c.marketing ?? []).length > 0).map((c) => c.id);
    expect(offering).toEqual(['the-salon', 'clean-slate', 'the-strip']);
  });
});

describe('arrivals', () => {
  it('an ad lifts its archetype’s arrival chance for its days only', () => {
    const world = sandbox();
    const twin = sandbox();
    slotFloor(world, 12);
    slotFloor(twin, 12);
    const run = world.runEvent('radio');
    // The regulars' share moves with the day's conditions; the lift follows it.
    const ratios: { r: number; want: number }[] = [];
    for (let t = 0; t < 5 * TICKS_PER_DAY; t++) {
      world.tick();
      twin.tick();
      if (t % TICKS_PER_HOUR === 0)
        ratios.push({
          r: world.arrivalChance() / twin.arrivalChance(),
          want: 1 + 0.2 * world.archetypeShares().regular,
        });
    }
    const during = ratios.slice(0, 3 * 24 - 1);
    const after = ratios.slice(3 * 24 + 1);
    for (const { r, want } of during) expect(r).toBeCloseTo(want, 6);
    for (const { r } of after) expect(r).toBe(1);
    expect(world.tickCount).toBeGreaterThan(run.endTick);
  });

  it('brings more of its own archetype and no more of anyone else', () => {
    const count = (book: boolean) => {
      const world = sandbox(9);
      if (book) world.runEvent('billboards');
      const n: Record<GuestArchetype, number> = { regular: 0, tourist: 0, biker: 0, highRoller: 0 };
      const roll = (world as unknown as { rollArchetype(): GuestArchetype }).rollArchetype.bind(
        world,
      );
      for (let i = 0; i < 40_000; i++) n[roll()]++;
      return n;
    };
    const plain = count(false);
    const ad = count(true);
    // Per arrival: tourists 2.5× as likely relative to everyone else.
    const odds = (n: Record<GuestArchetype, number>) => n.tourist / (40_000 - n.tourist);
    expect(odds(ad) / odds(plain)).toBeGreaterThan(2.2);
    expect(odds(ad) / odds(plain)).toBeLessThan(2.8);
    expect(ad.highRoller / ad.regular).toBeCloseTo(plain.highRoller / plain.regular, 1);
  });

  it('on the floor: more guests in its days, and the run measures them', () => {
    const arrivals = (book: boolean) => {
      const world = sandbox(5, true);
      slotFloor(world, 36);
      for (let i = 0; i < 4; i++) world.place('toilet', 60 + 3 * i, 36);
      let n = 0;
      const off = eventBus.on('guestSpawned', () => n++);
      for (let t = 0; t < TICKS_PER_DAY; t++) world.tick();
      const before = n;
      const run = book ? world.runEvent('radio') : null;
      for (let t = 0; t < 3 * TICKS_PER_DAY; t++) world.tick();
      off();
      eventBus.clear();
      return { during: n - before, run, cap: world.guestCap() };
    };
    const plain = arrivals(false);
    const ad = arrivals(true);
    const why = JSON.stringify({ plain: plain.during, ad: ad.during, cap: ad.cap, run: ad.run });
    expect(ad.during, why).toBeGreaterThan(plain.during * 1.08);
    expect(ad.run!.result, why).toMatch(/about \d+ more than the same hours without it/);
    // What it says it added is about what it did add, against the twin.
    expect(ad.run!.extra!, why).toBeGreaterThan(0.4 * (ad.during - plain.during));
    expect(ad.run!.extra!, why).toBeLessThan(2.5 * (ad.during - plain.during));
  });
});

describe('a full floor', () => {
  /** Flat traffic and the fixed 30-guest cap: the floor sits full. */
  const FULL: CampaignDef = {
    ...SANDBOX,
    id: 'full-floor',
    sandbox: false,
    traffic: { curve: 'flat', cap: 30 },
    staffDepth: false,
    marketing: ['radio'],
  };

  it('an ad doesn’t pay for itself when the cap already binds', () => {
    const run = (seed: number, book: boolean) => {
      const world = sandbox(seed, true, FULL);
      slotFloor(world, 12);
      for (let t = 0; t < 12 * TICKS_PER_HOUR; t++) world.tick();
      let n = 0;
      const off = eventBus.on('guestSpawned', () => n++);
      const cash = world.state.cash;
      const booked = book ? world.runEvent('radio') : null;
      for (let t = 0; t < 3 * TICKS_PER_DAY; t++) world.tick();
      off();
      eventBus.clear();
      return {
        arrivals: n,
        gain: world.state.cash - cash,
        added: booked?.extra ?? 0,
        fullShare: booked ? booked.fullTicks / booked.ticks : 0,
      };
    };
    let lift = 0;
    let gain = 0;
    const seen: unknown[] = [];
    for (const seed of [3, 7, 11]) {
      const plain = run(seed, false);
      const ad = run(seed, true);
      seen.push({ plain, ad });
      lift += ad.arrivals / plain.arrivals - 1;
      gain += ad.gain - plain.gain;
    }
    const why = JSON.stringify(seen);
    expect(lift / 3, why).toBeLessThan(0.05);
    // And the run says so: full most of the time, and only the few guests
    // who took a freed place sooner (5–9 of ~50 when measured).
    for (const { ad } of seen as { ad: { added: number; fullShare: number; arrivals: number } }[]) {
      expect(ad.fullShare, why).toBeGreaterThan(0.7);
      expect(ad.added, why).toBeLessThan(0.2 * ad.arrivals);
    }
    expect(gain / 3, why).toBeLessThan(0);
  });
});

describe('junkets and tournaments', () => {
  it('a junket flies its group in at its hour, with bigger wallets, for its night', () => {
    const world = sandbox();
    slotFloor(world, 6);
    const run = world.runEvent('junket');
    const spawned: string[] = [];
    eventBus.on('guestSpawned', ({ id }) => spawned.push(id));
    while (world.tickCount < run.startTick) world.tick();
    expect(world.time.hour).toBe(20);
    expect(spawned).toHaveLength(8);
    for (const id of spawned) {
      const g = world.guests.get(id)!;
      expect(g.archetype).toBe('highRoller');
      expect(g.leaveAtTick).toBe(world.tickCount + 8 * TICKS_PER_HOUR);
    }
    const wallets = spawned.map((id) => world.guests.get(id)!.wallet);
    expect(Math.min(...wallets)).toBeGreaterThanOrEqual(750);
  });

  it('a tournament signs up its arrivals, takes their fees and sends them to the slots', () => {
    const world = sandbox(6, true);
    slotFloor(world, 12);
    const run = world.runEvent('slot-tournament');
    while (world.tickCount < run.endTick) world.tick();
    world.tick();
    expect(run.entrants).toBeGreaterThan(5);
    expect(run.fees).toBe(run.entrants * 10);
    expect(world.ledger.sources.get(HOUSE_SOURCES.marketing.id)?.revenue ?? 0).toBe(run.fees);
    expect(run.result).toMatch(/entrants paid/);
  });
});

describe('a casino that books nothing', () => {
  it('never touches the marketing path', () => {
    const world = sandbox(2, true);
    slotFloor(world, 8);
    for (let t = 0; t < TICKS_PER_DAY; t++) world.tick();
    expect(world.marketing.runs).toEqual([]);
    expect(world.marketing.liftsArrivals(world.tickCount)).toBe(false);
  });
});

describe('scenarios that offer no marketing', () => {
  /** Recorded at 31a8a7c, the commit before B10's sim changes, with the same
   *  code below. If a later change moves the economy on purpose, re-record. */
  const BEFORE_B10 = {
    days: [
      [1, -549.79, 374, 42],
      [2, 136.4, 562, 63],
      [3, 326.74, 574, 52],
      [4, 1800.71, 585, 58],
      [5, 483.1, 676, 86],
      [6, 823.66, 587, 81],
      [7, 2461.9, 654, 94],
      [8, 636.41, 685, 90],
      [9, 962.2, 741, 98],
    ],
    p16: ['failed', null, 747.83],
  };

  it('play exactly as before B10 (one seed, day by day)', async () => {
    const def = getCampaign('lucky-strike')!;
    expect(def.marketing ?? []).toEqual([]);
    const world = await careerWorld(def, 1234, false);
    runCareer(def, world, 'active', CAREER_PLANS['lucky-strike']!);
    const cents = (v: number) => Math.round(v * 100) / 100;
    const days = world.ledger.history.map((d) => [
      d.day,
      cents(d.revenue),
      cents(d.expenses),
      d.guestCount,
    ]);
    const p16 = runCampaign(getCampaign('neon-nights')!, 1234, 'managed');
    expect({ days, p16: [p16.outcome, p16.wonOnDay, cents(p16.best)] }).toEqual(BEFORE_B10);
  }, 120_000);
});
