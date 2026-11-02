import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../../EventBus';
import { ENGINE_FOR_DEF } from '../../games';
import { Rng } from '../../rng';
import { CasinoWorld } from '../../world';
import type { CasinoGame } from './CasinoGame';
import { createMachine } from './factory';
import { SeatedCasinoGame } from './SeatedCasinoGame';

afterEach(() => eventBus.clear());

const ENGINE_DEFS = Object.keys(ENGINE_FOR_DEF);

function seated(defId: string): CasinoGame {
  const m = createMachine(defId, `m-${defId}`)!;
  if (m instanceof SeatedCasinoGame) m.claimSeat('g0');
  return m;
}

describe('engine-backed machines', () => {
  it.each(ENGINE_DEFS)(
    '%s: realised hold converges on its theoretical edge',
    (defId) => {
      const m = seated(defId);
      const rng = new Rng(97);
      let wagered = 0;
      let net = 0;
      let theo = 0;
      let sq = 0;
      const plays = 40_000;
      for (let i = 0; i < plays; i++) {
        m.reliability = 100;
        m.broken = false;
        const r = m.play(rng);
        wagered += r.wager;
        theo += r.theo ?? 0;
        net += r.wager - r.payout;
        sq += (r.wager - r.payout) ** 2;
      }
      // Theo is edge × opening bets, so theo/handle sits at or below the edge
      // (raises, doubles and odds add handle without adding theo).
      expect(theo).toBeGreaterThan(0);
      // Realised net vs theo, within 4 standard errors of the per-play net.
      const se = Math.sqrt(sq / plays - (net / plays) ** 2) * Math.sqrt(plays);
      expect(Math.abs(net - theo)).toBeLessThan(4 * se);
      expect(wagered).toBeGreaterThan(0);
    },
    // 40k plays a machine: a few seconds idle, but heavy enough to need room under load.
    180_000,
  );

  it.each(ENGINE_DEFS)('%s: rounds per play scale with dealer speed', (defId) => {
    const m = seated(defId);
    const count = (speed: number) => {
      const rng = new Rng(5);
      let rounds = 0;
      for (let i = 0; i < 2000; i++) {
        m.reliability = 100;
        rounds += m.play(rng, {
          unit: m.costToPlay,
          wallet: Infinity,
          skillError: 0,
          oddsAppetite: 1,
          dealerSpeed: speed,
        }).rounds!;
      }
      return rounds;
    };
    const fast = count(1);
    const slow = count(0.5);
    // A play of one spin, hand or cup is floored at 1 whatever the speed
    // (and none of these has a dealer to be slow without).
    if (['slots', 'videopoker', 'pachinko'].includes(m.math!.kind))
      expect(slow).toBe(fast);
    else expect(slow).toBeLessThan(fast * 0.7);
  });

  it('a guest who cannot cover the next bet stops dealing', () => {
    const m = seated('blackjack-table');
    const r = m.play(new Rng(3), {
      unit: 25,
      wallet: 30,
      skillError: 0,
      oddsAppetite: 1,
      dealerSpeed: 1,
    });
    // Winnings stay in the stack, so handle can exceed the wallet; losses cannot.
    expect(r.wager - r.payout).toBeLessThanOrEqual(30);
    expect(r.rounds).toBeGreaterThanOrEqual(1);
  });

  it('setRules validates, clamps and moves the stake with the limits', () => {
    const m = seated('blackjack-table');
    const issues = m.setRules({ minBet: 50, maxBet: 20, blackjackPays: '6:5', decks: 4 })!;
    expect(issues.map((i) => i.field).sort()).toEqual(['decks', 'maxBet']);
    expect(m.math!.rules).toMatchObject({ minBet: 50, maxBet: 50, blackjackPays: '6:5', decks: 6 });
    expect(m.costToPlay).toBe(50);
    const slot = seated('slot-machine');
    slot.setRules({ denomination: 1, credits: 5 });
    expect(slot.costToPlay).toBe(5);
  });

  it('v1 games without an engine report no rules', () => {
    expect(createMachine('bingo-hall', 'x')!.setRules({})).toBeNull();
    expect(createMachine('bingo-hall', 'x')!.math).toBeNull();
  });
});

describe('world integration', () => {
  it('rules survive save and load, and setMachineRules reports what it clamped', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.state.cash = 100_000;
    const po = world.place('roulette-table', 4, 4)!;
    const applied = world.setMachineRules(po.id, { wheel: 'single', laPartage: true, maxBet: 2 })!;
    expect(applied.issues.map((i) => i.field)).toEqual(['maxBet']);
    const copy = CasinoWorld.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    expect(copy.machines.get(po.id)!.math!.rules).toMatchObject({
      wheel: 'single',
      laPartage: true,
    });
    expect(world.setMachineRules('nope', {})).toBeNull();
  });

  it('a table without a dealer deals at the supervisor pace', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.state.cash = 100_000;
    const po = world.place('blackjack-table', 4, 4)!;
    const slot = world.place('slot-machine', 10, 10)!;
    expect(world.dealerSpeedFor(po.id)).toBeLessThan(1);
    expect(world.dealerSpeedFor(slot.id)).toBe(1);
  });

  it('a guest play books handle, win, theo and rounds against the machine', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: true });
    world.state.cash = 100_000;
    const po = world.place('craps-table', 6, 6)!;
    world.place('toilet', 12, 12);
    for (let i = 0; i < 3000; i++) world.tick();
    const rows = [
      ...world.ledger.history.flatMap((d) => d.sources),
      ...world.ledger.sources.values(),
    ];
    const row = rows.filter((r) => r.id === po.id);
    const sum = (k: 'wagered' | 'theo' | 'rounds' | 'capacityTicks') =>
      row.reduce((a, r) => a + r[k], 0);
    expect(sum('wagered')).toBeGreaterThan(0);
    expect(sum('theo')).toBeGreaterThan(0);
    expect(sum('rounds')).toBeGreaterThan(0);
    expect(sum('capacityTicks')).toBeGreaterThan(0);
  });
});
