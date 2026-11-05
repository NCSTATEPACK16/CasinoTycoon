// B2: the hidden sim, surfaced. Prices with real demand, the comp and price
// commands, the rating and roster views, and staff that were in the sim but
// never hired from the UI.

import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { BAR_BALANCE, COMPS, PRICE_BALANCE, priceAppeal } from '../data/balance';
import { runCommand } from '../worker/commands';
import type { GuestInspect, PatronView, PricedObject, RatingReport } from '../worker/inspect';
import { SnapshotBuilder } from '../worker/snapshot';
import { Bar } from './entities/Bar';
import { furnish, navWorld } from './agents/testkit';
import { PATRON_RECENT_VISITS, PatronRegistry } from './patrons';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

/** Push wagers through a guest's private ledger, as world.comps.test does. */
function wager(guest: ReturnType<CasinoWorld['spawnGuest']>, defId: string, amount: number) {
  const next = new Map(guest.wagers() as Map<string, number>);
  next.set(defId, (next.get(defId) ?? 0) + amount);
  (guest as unknown as { wagersByGame: Map<string, number> }).wagersByGame = next;
}

describe('price appeal', () => {
  it('is exactly 1 at the default price, falls when dearer, rises (capped) when cheaper', () => {
    expect(priceAppeal(1)).toBe(1);
    expect(priceAppeal(2)).toBeCloseTo(Math.exp(-PRICE_BALANCE.elasticity), 10);
    expect(priceAppeal(3)).toBeLessThan(priceAppeal(2));
    expect(priceAppeal(0.5)).toBeGreaterThan(1);
    expect(priceAppeal(0.01)).toBe(PRICE_BALANCE.maxAppeal);
    expect(priceAppeal(50)).toBe(PRICE_BALANCE.minAppeal);
  });

  it('leaves an untouched casino exactly as it was', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    world.place('bar', 2, 2);
    world.place('food-stall', 6, 2);
    expect(world.serviceAppeal('bar')).toBe(1);
    expect(world.serviceAppeal('food-stall')).toBe(1);
  });
});

describe('setPrice', () => {
  it('prices a bar drink and a menu item, clamped to their bands', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const snap = new SnapshotBuilder();
    const bar = world.place('bar', 2, 2)!;
    const stall = world.place('food-stall', 6, 2)!;
    const set = (objectId: string, itemId: string, price: number) =>
      runCommand(world, snap, { type: 'setPrice', objectId, itemId, price });
    expect(set(bar.id, 'drink', 18)).toEqual({ ok: true, data: 18 });
    expect(set(bar.id, 'drink', 1)).toEqual({ ok: true, data: PRICE_BALANCE.barPriceFloor });
    expect(set(bar.id, 'drink', 999)).toEqual({ ok: true, data: PRICE_BALANCE.barPriceCeil });
    expect(set(stall.id, 'burger', 7.5)).toEqual({ ok: true, data: 7.5 });
    expect(set(stall.id, 'burger', 1000)).toEqual({ ok: true, data: 12 }); // 6× its $2 cost
    expect(set(bar.id, 'burger', 5).ok).toBe(false);
    expect(set(stall.id, 'caviar', 5).ok).toBe(false);
    expect(set('obj-404', 'drink', 5).ok).toBe(false);
    expect(set(bar.id, 'drink', Number.NaN).ok).toBe(false);

    const list = runCommand(world, snap, { type: 'prices' });
    const prices = (list as { data: PricedObject[] }).data;
    expect(prices.map((p) => p.defId)).toEqual(['bar', 'food-stall']);
    expect(prices[0]!.items[0]).toMatchObject({ id: 'drink', price: PRICE_BALANCE.barPriceCeil });
    expect(prices[0]!.appeal).toBeCloseTo(priceAppeal(PRICE_BALANCE.barPriceCeil / 12), 10);
  });

  it('charges the bar price at the till and survives a save', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const po = world.place('bar', 2, 2)!;
    world.setPrice(po.id, 'drink', 20);
    const bar = world.bars.get(po.id)!;
    bar.stock = 2;
    const cash = world.state.cash;
    expect(world.buyDrink(po.id, 100)).toEqual({ price: 20, ripoff: false });
    expect(world.state.cash).toBe(cash + 20);
    expect(world.buyDrink(po.id, 19)).toBeNull(); // can't afford it
    world.setPrice(po.id, 'drink', 30);
    expect(world.buyDrink(po.id, 100)?.ripoff).toBe(true); // past 2× the $12 default
    expect(Bar.fromJSON(bar.toJSON()).price).toBe(30);
    // An older save has no price: the default applies.
    expect(Bar.fromJSON({ id: 'b', stock: 1 }).price).toBe(BAR_BALANCE.drinkPrice);
  });

  it('sends guests to the cheaper of two bars', () => {
    const world = new CasinoWorld({ seed: 3, autoSpawn: false });
    const a = world.place('bar', 2, 2)!;
    const b = world.place('bar', 10, 2)!;
    world.bars.get(a.id)!.stock = 3;
    world.bars.get(b.id)!.stock = 3;
    expect(world.findBar()?.barId).toBe(a.id); // a tie keeps placement order
    world.setPrice(a.id, 'drink', 16);
    expect(world.findBar()?.barId).toBe(b.id);
  });
});

describe('demand responds to price', () => {
  /** One day on the furnished nav floor with a fixed crowd: what the bar and
   *  the food stall took, and how many drinks and meals that was. */
  async function day(drink: number, foodScale: number) {
    const world = await navWorld(11);
    furnish(world);
    world.hireStaff('bartender');
    const bar = [...world.bars.keys()][0]!;
    const stall = [...world.foodStalls.keys()][0]!;
    world.setPrice(bar, 'drink', drink);
    for (const m of world.foodStalls.get(stall)!.items)
      world.setPrice(stall, m.id, m.currentPrice * foodScale);
    for (let i = 0; i < 60; i++) world.spawnGuest();
    for (let i = 0; i < 1200; i++) world.tick();
    const barRev = world.ledger.sources.get(bar)?.revenue ?? 0;
    const foodRev = world.ledger.sources.get(stall)?.revenue ?? 0;
    return { drinks: barRev / drink, barRev, foodRev };
  }

  it('sells fewer drinks and meals at steep prices', async () => {
    const base = await day(BAR_BALANCE.drinkPrice, 1);
    const dear = await day(BAR_BALANCE.drinkPrice * 2.5, 2.5);
    expect(base.drinks).toBeGreaterThan(0);
    expect(dear.drinks).toBeLessThan(base.drinks * 0.75);
    // Food: revenue per default-priced unit, i.e. units sold.
    expect(dear.foodRev / 2.5).toBeLessThan(base.foodRev * 0.75);
  }, 120_000);
});

describe('B2 commands', () => {
  it('sendComp refuses with a reason, then lands once the guest has played', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const snap = new SnapshotBuilder();
    const guest = world.spawnGuest('regular');
    const comp = () =>
      runCommand(world, snap, { type: 'sendComp', guestId: guest.id, kind: 'drink' });
    const refused = comp();
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.error).toMatch(/play a while/);
    wager(guest, 'slot-machine', 1000);
    const happy = guest.needs.happiness;
    const cash = world.state.cash;
    const r = comp();
    expect(r.ok).toBe(true);
    const view = (r as { data: GuestInspect }).data;
    expect(view.comp.received).toBe(COMPS.compUnit.drink);
    expect(world.state.cash).toBe(cash - COMPS.compUnit.drink);
    expect(guest.needs.happiness).toBeGreaterThan(happy);
    expect(
      runCommand(world, snap, { type: 'sendComp', guestId: 'g-404', kind: 'meal' }),
    ).toMatchObject({ ok: false, error: 'They have already left.' });
  });

  it('rating reports nine terms that add up to the rating', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    world.place('slot-machine', 10, 10);
    world.place('blackjack-table', 14, 10);
    world.hireStaff('pitBoss');
    const r = (
      runCommand(world, new SnapshotBuilder(), { type: 'rating' }) as { data: RatingReport }
    ).data;
    expect(r.terms).toHaveLength(9);
    const sum = r.terms.reduce((a, t) => a + t.value, 0);
    expect(r.total).toBe(Math.round(Math.min(100, Math.max(0, sum))));
    for (const t of r.terms) {
      expect(t.value).toBeGreaterThanOrEqual(t.worst - 1e-9);
      expect(t.value).toBeLessThanOrEqual(t.best + 1e-9);
    }
    expect(r.facts).toMatchObject({ games: 2, gameKinds: 2, guards: 1, tablesWithoutDealer: 1 });
    expect(r.terms.find((t) => t.id === 'security')!.value).toBeGreaterThan(0);
    expect(r.reputation.label).toBe('Unremarkable');
  });

  it('patrons lists the roster with tiers, recent visits and who is on the floor', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const reg = world.patrons;
    const leaver = { id: 'g-1', name: 'Ann', archetype: 'regular' as const, compsReceived: 4 };
    reg.recordDeparture({ ...leaver, patronId: null, theo: () => 100 }, 1);
    const id = reg.all()[0]!.id;
    for (let d = 2; d <= 8; d++)
      reg.recordDeparture({ ...leaver, patronId: id, theo: () => 50 }, d);
    const list = (
      runCommand(world, new SnapshotBuilder(), { type: 'patrons' }) as { data: PatronView[] }
    ).data;
    expect(list).toHaveLength(1);
    const p = list[0]!;
    expect(p).toMatchObject({ name: 'Ann', tier: 'Gold', visits: 8, lastSeenDay: 8 });
    expect(p.nextTier).toMatchObject({ name: 'Black' });
    expect(p.recent).toHaveLength(PATRON_RECENT_VISITS);
    expect(p.recent.at(-1)).toEqual({ day: 8, theo: 50, comps: 4 });
    expect(p.onFloor).toBeNull();
    // The visit history survives a save, and an old save without it loads.
    const back = PatronRegistry.fromJSON(reg.toJSON());
    expect(back.all()[0]!.recent).toEqual(reg.all()[0]!.recent);
    const old = reg.toJSON();
    delete old.patrons[0]!.recent;
    expect(PatronRegistry.fromJSON(old).all()[0]!.recent).toEqual([]);
  });

  it('puts reputation on the HUD', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    world.startScenario(null);
    expect(new SnapshotBuilder().build(world, 0).hud.reputation).toEqual({
      value: 50,
      label: 'Unremarkable',
    });
  });
});

describe('waitress and pit boss, end to end on the crowd', () => {
  it('a hired waitress carries a drink to a seated guest at the bar price', async () => {
    const world = await navWorld(21);
    furnish(world, { slots: 8 });
    world.hireStaff('bartender');
    world.hireStaff('waitress');
    const bar = [...world.bars.keys()][0]!;
    world.setPrice(bar, 'drink', 15);
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    for (let i = 0; i < 1500 && guest.state !== 'play'; i++) world.tick();
    expect(guest.state).toBe('play');
    guest.needs.thirst = 10;
    const revenue = world.ledger.sources.get(bar)?.revenue ?? 0;
    for (let i = 0; i < 3000 && guest.needs.thirst < 50; i++) world.tick();
    expect(guest.needs.thirst).toBeGreaterThan(50);
    expect(guest.waitingForDrink).toBe(false);
    expect((world.ledger.sources.get(bar)?.revenue ?? 0) - revenue).toBe(15);
  }, 60_000);

  it('a hired pit boss walks the floor and lifts the security term', async () => {
    const world = await navWorld(22);
    furnish(world, { slots: 4 });
    const before = world.ratingBreakdown().security;
    const boss = world.hireStaff('pitBoss');
    for (let i = 0; i < 400; i++) world.tick();
    expect(world.ratingBreakdown().security).toBeGreaterThan(before);
    expect(boss.pos).not.toEqual(world.entranceTile);
  }, 60_000);
});
