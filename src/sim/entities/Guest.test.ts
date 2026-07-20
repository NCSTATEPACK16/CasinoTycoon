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
    for (let i = 0; i < 100; i++) world.tick();
    expect(guest.needs.energy).toBeCloseTo(energy - 100 * GUEST_BALANCE.decayPerTick.energy, 3);
    expect(guest.needs.bladder).toBeCloseTo(bladder - 100 * GUEST_BALANCE.decayPerTick.bladder, 3);
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
});
