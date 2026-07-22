import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../../EventBus';
import { GUEST_BALANCE } from '../../data/balance';
import { CasinoWorld } from '../world';

afterEach(() => eventBus.clear());

describe('Guest', () => {
  it('needs decay per tick', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    const guest = world.spawnGuest();
    const energy = guest.needs.energy;
    const bladder = guest.needs.bladder;
    const thirst = guest.needs.thirst;
    for (let i = 0; i < 100; i++) world.tick();
    expect(guest.needs.energy).toBeCloseTo(energy - 100 * GUEST_BALANCE.decayPerTick.energy, 3);
    expect(guest.needs.bladder).toBeCloseTo(bladder - 100 * GUEST_BALANCE.decayPerTick.bladder, 3);
    expect(guest.needs.thirst).toBeCloseTo(thirst - 100 * GUEST_BALANCE.decayPerTick.thirst, 3);
  });

  it('a broke guest heads for the exit and eventually leaves', () => {
    const world = new CasinoWorld({ seed: 4, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.wallet = 0;
    const left: string[] = [];
    eventBus.on('guestLeft', ({ id }) => left.push(id));
    for (let i = 0; i < 30 && guest.state !== 'leaving' && guest.state !== 'gone'; i++) {
      world.tick();
    }
    expect(['leaving', 'gone']).toContain(guest.state);
    for (let i = 0; i < 2000 && left.length === 0; i++) world.tick();
    expect(left).toContain(guest.id);
    expect(world.guests.size).toBe(0);
  });

  it('a guest with a full bladder finds the restroom and recovers', () => {
    const world = new CasinoWorld({ seed: 6, autoSpawn: false });
    world.place('toilet', 20, 15);
    const guest = world.spawnGuest();
    guest.wallet = 500;
    guest.needs.bladder = 20;
    guest.needs.hunger = 100;
    let peak = guest.needs.bladder;
    for (let i = 0; i < 1200; i++) {
      world.tick();
      peak = Math.max(peak, guest.needs.bladder);
    }
    expect(peak).toBeGreaterThan(90); // service restored the need
  });

  it('a thirsty wandering guest self-serves at the bar and recovers', () => {
    const world = new CasinoWorld({ seed: 7, autoSpawn: false });
    const po = world.place('bar', 20, 15)!;
    world.brewDrink(po.id);
    const guest = world.spawnGuest();
    guest.wallet = 500;
    guest.needs.thirst = 20;
    guest.needs.hunger = 100;
    guest.needs.bladder = 100;
    let peak = guest.needs.thirst;
    for (let i = 0; i < 1200; i++) {
      world.tick();
      peak = Math.max(peak, guest.needs.thirst);
    }
    expect(peak).toBeGreaterThan(90);
  });

  it('emits threshold thoughts once per cooldown', () => {
    const world = new CasinoWorld({ seed: 8, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.wallet = 500;
    guest.needs.bladder = 20;
    const thoughts: string[] = [];
    eventBus.on('guestThought', ({ guestId, text }) => {
      if (guestId === guest.id) thoughts.push(text);
    });
    world.tick();
    world.tick();
    const bathroomThoughts = thoughts.filter((t) => t.includes('bathroom'));
    expect(bathroomThoughts.length).toBe(1); // cooldown suppresses the repeat
    expect(guest.thoughts.some((t) => t.text.includes('bathroom'))).toBe(true);
  });

  it('guests walk tile-by-tile along walkable cells', () => {
    const world = new CasinoWorld({ seed: 10, autoSpawn: false });
    const guest = world.spawnGuest();
    const visited = new Set<string>();
    for (let i = 0; i < 200; i++) {
      world.tick();
      visited.add(`${guest.pos.col},${guest.pos.row}`);
      expect(world.grid.inBounds(guest.pos.col, guest.pos.row)).toBe(true);
    }
    expect(visited.size).toBeGreaterThan(3); // actually moved through tiles
  });

  it('has a stable flavor name and regular archetype, and tracks netResult/favoriteGame', () => {
    const world = new CasinoWorld({ seed: 8, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const guest = world.spawnGuest();
    guest.wallet = 500;
    expect(guest.archetype).toBe('regular');
    expect(guest.name).toMatch(/^[A-Za-z ]+ [A-Z]\.$/);
    expect(guest.netResult).toBe(0);
    expect(guest.favoriteGame()).toBeNull();
    for (let i = 0; i < 400 && guest.state !== 'play'; i++) world.tick();
    for (let i = 0; i < 200; i++) world.tick(); // let it actually spin a few times
    expect(guest.favoriteGame()).toBe('slot-machine');
    expect(guest.netResult).not.toBe(0);
  });

  it('a broke AND unhappy guest rage-quits: raging flag, faster exit, ticker line', () => {
    const world = new CasinoWorld({ seed: 12, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.wallet = 0;
    guest.needs.happiness = 5;
    const lines: string[] = [];
    eventBus.on('tickerMessage', ({ text }) => lines.push(text));
    for (let i = 0; i < 30 && guest.state !== 'leaving'; i++) world.tick();
    expect(guest.state).toBe('leaving');
    expect(guest.raging).toBe(true);
    expect(lines.some((t) => t.includes(guest.name))).toBe(true);
  });

  it('a broke but content guest leaves calmly (not raging)', () => {
    const world = new CasinoWorld({ seed: 13, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.wallet = 0;
    guest.needs.happiness = 80;
    for (let i = 0; i < 30 && guest.state !== 'leaving'; i++) world.tick();
    expect(guest.state).toBe('leaving');
    expect(guest.raging).toBe(false);
  });

  it('a raging guest moves faster to the exit than a calm one', () => {
    const world = new CasinoWorld({ seed: 14, autoSpawn: false });
    const calm = world.spawnGuest();
    calm.wallet = 0;
    calm.needs.happiness = 80;
    const raging = world.spawnGuest();
    raging.wallet = 0;
    raging.needs.happiness = 5;
    raging.raging = true;
    expect(raging.moveTicksPerTile).toBeLessThan(calm.moveTicksPerTile);
  });

  it('a big win triggers a celebrating beat with a happiness bump', () => {
    const world = new CasinoWorld({ seed: 15, autoSpawn: false });
    world.place('slot-machine', 5, 5);
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    let sawCelebrate = false;
    for (let i = 0; i < 20000 && !sawCelebrate; i++) {
      world.tick();
      if (guest.celebrating) sawCelebrate = true;
    }
    expect(sawCelebrate).toBe(true);
  });
});
