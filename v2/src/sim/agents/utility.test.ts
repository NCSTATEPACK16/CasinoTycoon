import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { CASHIER_BALANCE } from '../../data/balance';
import { SANDBOX } from '../../data/campaigns';
import type { GuestArchetype } from '../entities/Guest';
import { Rng } from '../rng';
import { CasinoWorld } from '../world';
import { AI } from './aiBalance';
import { drawProfile } from './bankroll';
import { type Choice, type GuestView, needUrgency, rankChoices, scoreGame } from './utility';

afterEach(() => eventBus.clear());

/** The ranking as it was before it went lazy: score everything, stable sort. */
function reference(world: CasinoWorld, g: GuestView): Choice[] {
  const out: Choice[] = [];
  const service = (s: 'toilet' | 'food-stall' | 'bar' | 'cage', score: number) => {
    if (score > 0) out.push({ kind: 'service', service: s, score });
  };
  if (world.hasServiceObject('toilet')) service('toilet', needUrgency(g.needs.bladder, 2));
  if (world.hasServiceObject('food-stall')) service('food-stall', needUrgency(g.needs.hunger, 1));
  if (world.hasServiceObject('bar')) service('bar', needUrgency(g.needs.thirst, 0));
  if (!g.usedCashAdvance && g.wallet < CASHIER_BALANCE.walletThreshold) service('cage', 1.3);
  for (const id of world.machines.keys()) {
    const c = scoreGame(world, g, id);
    if (c) out.push(c);
  }
  out.push({ kind: 'wander', score: AI.wanderScore });
  return out.sort((a, b) => b.score - a.score);
}

const ARCHETYPES: GuestArchetype[] = ['regular', 'highRoller', 'biker', 'tourist'];
const GAMES = ['slot-machine', 'video-poker', 'blackjack-table', 'roulette-table', 'craps-table'];

describe('rankChoices', () => {
  it('yields exactly the stable-sorted order on a big, part-occupied floor', () => {
    const world = new CasinoWorld({ seed: 5, starterFloor: true, autoSpawn: false });
    world.startScenario(SANDBOX);
    const rng = new Rng(17);
    for (let i = 0; i < 400; i++) {
      world.place(GAMES[rng.int(0, GAMES.length - 1)]!, rng.int(4, 82), rng.int(4, 58));
    }
    world.place('toilet', 5, 5);
    world.place('food-stall', 6, 58);
    world.place('bar', 6, 46);
    // Hold a third of the cabinets so availability, and with it the
    // candidate set, varies across the floor.
    let k = 0;
    for (const id of world.machines.keys()) {
      if (k++ % 3 === 0) world.reserveMachine(`holder-${k}`, 1e6, id);
    }
    expect(world.machines.size).toBeGreaterThan(200);

    for (let n = 0; n < 300; n++) {
      const archetype = ARCHETYPES[n % ARCHETYPES.length]!;
      const wallet = [20, 150, 600, 5_000][rng.int(0, 3)]!;
      const g: GuestView = {
        id: `g${n}`,
        archetype,
        wallet,
        needs: {
          energy: rng.int(0, 100),
          bladder: rng.int(0, 100),
          hunger: rng.int(0, 100),
          thirst: rng.int(0, 100),
          happiness: rng.int(0, 100),
        },
        pos: { col: rng.int(0, 95), row: rng.int(0, 63) },
        profile: drawProfile(rng, archetype, wallet),
        usedCashAdvance: rng.int(0, 1) === 1,
        highLimitOk: wallet >= AI.highLimitBankroll,
      };
      expect([...rankChoices(world, g)]).toEqual(reference(world, g));
    }
  });

  it('notices games placed and sold since the last ranking', () => {
    const world = new CasinoWorld({ seed: 2, starterFloor: true, autoSpawn: false });
    world.startScenario(SANDBOX);
    const g: GuestView = {
      id: 'g',
      archetype: 'regular',
      wallet: 500,
      needs: { energy: 100, bladder: 100, hunger: 100, thirst: 100, happiness: 100 },
      pos: { col: 40, row: 30 },
      profile: drawProfile(new Rng(1), 'regular', 500),
      usedCashAdvance: true,
      highLimitOk: true,
    };
    expect([...rankChoices(world, g)].map((c) => c.kind)).toEqual(['wander']);
    const po = world.place('slot-machine', 41, 30)!;
    expect([...rankChoices(world, g)][0]).toMatchObject({ kind: 'game', machineId: po.id });
    world.sell(po.id);
    expect([...rankChoices(world, g)].map((c) => c.kind)).toEqual(['wander']);
  });
});
