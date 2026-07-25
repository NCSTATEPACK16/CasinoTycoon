import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { POKER_BALANCE } from '../../data/balance';
import type { ThoughtContext, ThoughtDef } from '../../data/thoughts';
import { CasinoWorld } from '../world';
import type { PokerTable } from './machines/PokerTable';

afterEach(() => eventBus.clear());

const baseCtx = (over: Partial<ThoughtContext> = {}): ThoughtContext => ({
  wallet: 100,
  energy: 100,
  bladder: 100,
  hunger: 100,
  thirst: 100,
  happiness: 70,
  nearMess: false,
  currentGame: null,
  lossStreak: 0,
  winStreak: 0,
  hasToilet: true,
  hasBar: true,
  hasFoodStall: true,
  waitingForPlayers: false,
  ...over,
});

/** Tick until `done()`, up to `limit` ticks. Returns whether it happened. */
function tickUntil(world: CasinoWorld, done: () => boolean, limit = 3000): boolean {
  for (let i = 0; i < limit; i++) {
    if (done()) return true;
    world.tick();
  }
  return done();
}

describe('thought machinery', () => {
  it('supports a function-valued text that names the current game', () => {
    const def: ThoughtDef = {
      id: 'demo',
      text: (c) => `That ${c.currentGame?.name} is rigged!`,
      cooldownTicks: 10,
      when: () => true,
    };
    const ctx = baseCtx({
      currentGame: { defId: 'roulette-table', name: 'Roulette Table', costToPlay: 20 },
    });
    const text = typeof def.text === 'function' ? def.text(ctx) : def.text;
    expect(text).toBe('That Roulette Table is rigged!');
  });

  it('keys the cooldown per subject so one game cannot mute another', () => {
    const def: ThoughtDef = {
      id: 'rigged',
      text: (c) => `That ${c.currentGame?.name} is rigged!`,
      cooldownTicks: 500,
      when: (c) => c.currentGame !== null,
      subject: (c) => c.currentGame?.defId ?? '',
    };
    const roulette = baseCtx({
      currentGame: { defId: 'roulette-table', name: 'Roulette Table', costToPlay: 20 },
    });
    const bigSix = baseCtx({
      currentGame: { defId: 'big-six-wheel', name: 'Big Six Wheel', costToPlay: 10 },
    });
    expect(def.subject!(roulette)).not.toBe(def.subject!(bigSix));
  });
});

describe('world.hasServiceObject', () => {
  it('reports which service objects exist', () => {
    const world = new CasinoWorld({ seed: 41, autoSpawn: false });
    world.state.cash = 100000;
    expect(world.hasServiceObject('toilet')).toBe(false);
    expect(world.place('toilet', 3, 3)).not.toBeNull();
    expect(world.hasServiceObject('toilet')).toBe(true);
  });

  it('stops reporting a service once its last object is sold', () => {
    const world = new CasinoWorld({ seed: 42, autoSpawn: false });
    world.state.cash = 100000;
    const po = world.place('bar', 5, 5);
    expect(po).not.toBeNull();
    expect(world.hasServiceObject('bar')).toBe(true);
    world.sell(po!.id);
    expect(world.hasServiceObject('bar')).toBe(false);
  });

  it('survives a save round-trip without needing a tick', () => {
    const world = new CasinoWorld({ seed: 48, autoSpawn: false });
    world.state.cash = 100000;
    expect(world.place('food-stall', 7, 7)).not.toBeNull();
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.hasServiceObject('food-stall')).toBe(true);
  });

  it('is false for an object type that is not a tracked service', () => {
    const world = new CasinoWorld({ seed: 43, autoSpawn: false });
    expect(world.place('slot-machine', 6, 6)).not.toBeNull();
    expect(world.hasServiceObject('slot-machine')).toBe(false);
  });
});

describe('win/loss streaks', () => {
  it('counts consecutive results and never runs both sides at once', () => {
    const world = new CasinoWorld({ seed: 44, autoSpawn: false });
    expect(world.place('slot-machine', 6, 6)).not.toBeNull();
    const guest = world.spawnGuest();
    guest.wallet = 100000;
    let sawWin = false;
    let sawLoss = false;
    for (let i = 0; i < 4000; i++) {
      world.tick();
      guest.wallet = 100000; // keep it playing rather than going broke
      expect(guest.winStreak === 0 || guest.lossStreak === 0).toBe(true);
      if (guest.winStreak > 0) sawWin = true;
      if (guest.lossStreak > 0) sawLoss = true;
    }
    expect(sawWin).toBe(true);
    expect(sawLoss).toBe(true);
  });

  it('resets both streaks when the guest gives the machine up', () => {
    const world = new CasinoWorld({ seed: 49, autoSpawn: false });
    const po = world.place('slot-machine', 6, 6)!;
    const guest = world.spawnGuest();
    guest.wallet = 100000;
    expect(tickUntil(world, () => guest.winStreak + guest.lossStreak > 0)).toBe(true);
    world.sell(po.id);
    world.tick();
    expect(guest.winStreak).toBe(0);
    expect(guest.lossStreak).toBe(0);
  });
});

describe('poker sit-and-wait', () => {
  it('holds the seat while the table is short of players instead of churning', () => {
    const world = new CasinoWorld({ seed: 45, autoSpawn: false });
    world.state.cash = 100000;
    const po = world.place('poker-table', 6, 6)!;
    const table = world.machines.get(po.id) as PokerTable;
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    // seatedCount counts reservations, so wait for the guest to actually
    // arrive and start playing rather than for the seat to be claimed.
    expect(tickUntil(world, () => guest.state === 'play')).toBe(true);

    // Before this change the lone guest vacated within one play interval.
    // It must now still be in the same seat well past that.
    for (let i = 0; i < POKER_BALANCE.playIntervalTicks * 3; i++) world.tick();
    expect(table.seatedCount).toBe(1);
    expect(guest.state).toBe('play');
    expect(guest.waitingForPlayersTicks).toBeGreaterThan(POKER_BALANCE.playIntervalTicks);
  });

  it('bounds the wait at maxWaitTicks', () => {
    const world = new CasinoWorld({ seed: 45, autoSpawn: false });
    world.state.cash = 100000;
    const po = world.place('poker-table', 6, 6)!;
    const table = world.machines.get(po.id) as PokerTable;
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    expect(tickUntil(world, () => guest.state === 'play')).toBe(true);
    // Long enough for several full wait windows to expire.
    let maxSeen = 0;
    for (let i = 0; i < POKER_BALANCE.maxWaitTicks * 4; i++) {
      world.tick();
      expect(guest.waitingForPlayersTicks).toBeLessThanOrEqual(POKER_BALANCE.maxWaitTicks);
      maxSeen = Math.max(maxSeen, guest.waitingForPlayersTicks);
    }
    // The counter must actually climb — the attempt that reaches maxWaitTicks
    // gives the seat up and zeroes it in the same call, so the largest value
    // an outside observer can see is one play interval short of the cap.
    expect(maxSeen).toBe(POKER_BALANCE.maxWaitTicks - POKER_BALANCE.playIntervalTicks);
    // The table never dealt a hand, so it never wore down or earned.
    expect(table.reliability).toBe(100);
    expect(table.lifetimeProfit).toBe(0);
  });

  it('deals for both once a second guest sits down', () => {
    const world = new CasinoWorld({ seed: 46, autoSpawn: false });
    world.state.cash = 100000;
    const po = world.place('poker-table', 6, 6)!;
    const table = world.machines.get(po.id) as PokerTable;
    let plays = 0;
    eventBus.on('machinePlayed', () => plays++);

    const a = world.spawnGuest();
    a.wallet = 5000;
    expect(tickUntil(world, () => a.state === 'play')).toBe(true);
    for (let i = 0; i < POKER_BALANCE.playIntervalTicks * 2; i++) world.tick();
    expect(plays).toBe(0);

    const b = world.spawnGuest();
    b.wallet = 5000;
    expect(tickUntil(world, () => b.state === 'play')).toBe(true);
    expect(table.canDeal).toBe(true);
    for (let i = 0; i < POKER_BALANCE.playIntervalTicks * 3; i++) world.tick();
    expect(plays).toBeGreaterThan(0);
    expect(a.waitingForPlayersTicks).toBe(0);
  });

  it('does not make a guest at an ordinary game wait', () => {
    const world = new CasinoWorld({ seed: 47, autoSpawn: false });
    expect(world.place('slot-machine', 6, 6)).not.toBeNull();
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    for (let i = 0; i < POKER_BALANCE.maxWaitTicks * 2; i++) {
      world.tick();
      expect(guest.waitingForPlayersTicks).toBe(0);
    }
    expect(guest.netResult).not.toBe(0);
  });
});
