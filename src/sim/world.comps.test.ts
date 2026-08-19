import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { COMPS, blackjackExpectedRtp, slotExpectedRtp } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

/** A world with one guest on the floor and no arrivals to perturb it. */
function soloWorld() {
  const world = new CasinoWorld({ seed: 7, autoSpawn: false });
  const guest = world.spawnGuest('regular');
  return { world, guest };
}

/** Push wagers through the guest's private ledger the way a real play does,
 *  without needing a table, a seat, and a pathfind to get there. */
function wager(guest: ReturnType<typeof soloWorld>['guest'], defId: string, amount: number) {
  const wagers = guest.wagers() as Map<string, number>;
  const next = new Map(wagers);
  next.set(defId, (next.get(defId) ?? 0) + amount);
  (guest as unknown as { wagersByGame: Map<string, number> }).wagersByGame = next;
}

describe('Guest.theo', () => {
  it('is zero before the guest has played', () => {
    const { guest } = soloWorld();
    expect(guest.theo()).toBe(0);
    expect(guest.compEligible).toBe(false);
  });

  it('weights each game by its own house edge, not one blended number', () => {
    const { guest } = soloWorld();
    wager(guest, 'slot-machine', 100);
    wager(guest, 'blackjack-table', 100);
    const expected = 100 * (1 - slotExpectedRtp()) + 100 * (1 - blackjackExpectedRtp());
    expect(guest.theo()).toBeCloseTo(expected, 5);
    // Slots hold more than blackjack, so equal handle is not equal theo.
    expect(1 - slotExpectedRtp()).toBeGreaterThan(1 - blackjackExpectedRtp());
  });

  it('ignores poker, which has no static edge to weight by', () => {
    const { guest } = soloWorld();
    wager(guest, 'poker-table', 1000);
    expect(guest.theo()).toBe(0);
  });
});

describe('CasinoWorld.sendComp', () => {
  it('refuses a guest who has not played enough, and charges nothing', () => {
    const { world, guest } = soloWorld();
    const cashBefore = world.state.cash;
    expect(world.sendComp(guest.id, 'drink')).toBe(false);
    expect(world.state.cash).toBe(cashBefore);
    expect(world.ledger.todayCompSpend).toBe(0);
  });

  it('refuses a guest who is not on the floor', () => {
    const { world } = soloWorld();
    expect(world.sendComp('g-nobody', 'drink')).toBe(false);
  });

  it('charges the house and books the comp once the guest is eligible', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    expect(guest.compEligible).toBe(true);
    const cashBefore = world.state.cash;

    expect(world.sendComp(guest.id, 'drink')).toBe(true);
    expect(world.state.cash).toBe(cashBefore - COMPS.compUnit.drink);
    expect(world.ledger.todayCompSpend).toBe(COMPS.compUnit.drink);
    // A comp is an expense, not negative revenue — it must show up in both.
    expect(world.ledger.todayExpenses).toBe(COMPS.compUnit.drink);
  });

  it('puts match play in the wallet as chips the guest can actually bet', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    const walletBefore = guest.wallet;
    world.sendComp(guest.id, 'matchPlay');
    expect(guest.wallet).toBe(walletBefore + COMPS.compUnit.matchPlay);
  });

  it('restores the need each comp targets, and nothing else', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    guest.needs.thirst = 10;
    guest.needs.hunger = 10;

    world.sendComp(guest.id, 'drink');
    expect(guest.needs.thirst).toBeCloseTo(10 + COMPS.needRestored.drink, 5);
    expect(guest.needs.hunger).toBe(10);

    world.sendComp(guest.id, 'meal');
    expect(guest.needs.hunger).toBeCloseTo(10 + COMPS.needRestored.meal, 5);
  });

  it('never overfills a need past full', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    guest.needs.thirst = 95;
    world.sendComp(guest.id, 'drink');
    expect(guest.needs.thirst).toBe(100);
  });

  it('buys goodwill on every kind of comp', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    const before = guest.needs.happiness;
    world.sendComp(guest.id, 'drink');
    expect(guest.needs.happiness).toBeGreaterThan(before);
  });

  it('gives the guest something to say, so the player sees the effect land', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    world.sendComp(guest.id, 'matchPlay');
    expect(guest.thoughts.some((t) => t.id === 'comped-matchPlay')).toBe(true);
  });

  it('announces the comp for the UI', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 500);
    let seen: { guestId: string; kind: string; cost: number } | null = null;
    eventBus.on('compSent', (e) => (seen = e));
    world.sendComp(guest.id, 'meal');
    expect(seen).toEqual({ guestId: guest.id, kind: 'meal', cost: COMPS.compUnit.meal });
  });

  it('caps what one guest can be given in a session, and stops charging at the cap', () => {
    const { world, guest } = soloWorld();
    wager(guest, 'slot-machine', 100000);
    const cap = guest.compHeadroom();
    expect(cap).toBeGreaterThan(0);

    let spent = 0;
    for (let i = 0; i < 500; i++) {
      if (!world.sendComp(guest.id, 'drink')) break;
      spent += COMPS.compUnit.drink;
    }
    expect(spent).toBeLessThanOrEqual(cap);
    expect(guest.compsReceived).toBe(spent);

    // Past the cap it is a hard refusal, not a silent free comp.
    const cashBefore = world.state.cash;
    expect(world.sendComp(guest.id, 'drink')).toBe(false);
    expect(world.state.cash).toBe(cashBefore);
  });

  it('scales the cap with the wallet the guest arrived with', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const whale = world.spawnGuest('highRoller');
    const ordinary = world.spawnGuest('regular');
    expect(whale.compHeadroom()).toBeGreaterThan(ordinary.compHeadroom());
  });

  it('leaves comps out of the play loop entirely — the player is the only source', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    world.place('slot-machine', 6, 6);
    const guest = world.spawnGuest('regular');
    guest.wallet = 5000;
    for (let t = 0; t < 2000; t++) world.tick();
    // Whatever the guest played, nothing comped them without a player decision.
    expect(world.ledger.todayCompSpend).toBe(0);
  });
});
