import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { HOURS_PER_DAY, START_HOUR, TICKS_PER_HOUR } from '../config';
import { STAFF_BALANCE } from '../data/balance';
import { getObjectDef } from '../data/objects';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

const TICKS_TO_MIDNIGHT = (HOURS_PER_DAY - START_HOUR) * TICKS_PER_HOUR;

describe('CasinoWorld — time & daily rollup', () => {
  it('emits hourPassed with the new clock time', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const hours: { hour: number; day: number }[] = [];
    eventBus.on('hourPassed', (e) => hours.push(e));
    for (let i = 0; i < TICKS_PER_HOUR * 2; i++) world.tick();
    expect(hours).toEqual([
      { hour: START_HOUR + 1, day: 1 },
      { hour: START_HOUR + 2, day: 1 },
    ]);
  });

  it('emits dayEnded at midnight with the completed day and its profit', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.payCasino(500); // deterministic revenue
    const ended: { day: number; profit: number }[] = [];
    eventBus.on('dayEnded', (e) => ended.push(e));
    for (let i = 0; i < TICKS_TO_MIDNIGHT; i++) world.tick();
    expect(ended).toEqual([{ day: 1, profit: 500 }]);
  });

  it('daily profit = revenue − upkeep − wages', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.place('slot-machine', 5, 5); // $20/day upkeep
    world.hireStaff('janitor'); // $4/hr — charged at every hour boundary
    world.payCasino(500);
    let ended: { day: number; profit: number } | null = null;
    eventBus.on('dayEnded', (e) => (ended = e));
    for (let i = 0; i < TICKS_TO_MIDNIGHT; i++) world.tick();
    const hoursCharged = HOURS_PER_DAY - START_HOUR; // 13:00 … 23:00 and 00:00
    const wages = STAFF_BALANCE.janitor.wagePerHour * hoursCharged;
    const upkeep = getObjectDef('slot-machine')!.upkeepPerDay;
    expect(ended).toEqual({ day: 1, profit: 500 - upkeep - wages });
    expect(world.ledger.history).toHaveLength(1);
    expect(world.ledger.history[0]).toMatchObject({
      day: 1,
      revenue: 500,
      expenses: upkeep + wages,
    });
  });

  it('charges upkeep from cash at midnight', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const afterBuild = world.state.cash;
    for (let i = 0; i < TICKS_TO_MIDNIGHT; i++) world.tick();
    expect(world.state.cash).toBe(afterBuild - getObjectDef('slot-machine')!.upkeepPerDay);
  });

  it('records an hourly sample per hour with the live guest count', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.spawnGuest();
    for (let i = 0; i < TICKS_PER_HOUR * 3; i++) world.tick();
    expect(world.ledger.hourly.length).toBe(3);
    expect(world.ledger.hourly[0]).toMatchObject({ day: 1, hour: START_HOUR, guests: 1 });
  });

  it('losing plays (payout > wager) book negative revenue', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.payCasino(-120); // stand-in for a jackpot payout
    world.payCasino(200);
    for (let i = 0; i < TICKS_TO_MIDNIGHT; i++) world.tick();
    expect(world.ledger.history[0]!.revenue).toBe(80);
  });

  it('serializes time and ledger through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.payCasino(300);
    for (let i = 0; i < TICKS_TO_MIDNIGHT + TICKS_PER_HOUR * 2; i++) world.tick();
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.time.day).toBe(2);
    expect(restored.time.hour).toBe(2);
    expect(restored.ledger.history).toEqual(world.ledger.history);
    expect(restored.ledger.hourly).toEqual(world.ledger.hourly);
  });
});
