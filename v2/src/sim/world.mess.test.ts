import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { MESS_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — mess', () => {
  it('dropMess registers a mess and emits messCreated', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    let created: { id: string; col: number; row: number; kind: string } | null = null;
    eventBus.on('messCreated', (e) => (created = e));
    const mess = world.dropMess(8, 9, 'trash');
    expect(mess).not.toBeNull();
    expect(world.messes.get(mess!.id)).toBe(mess);
    expect(created).toEqual({ id: mess!.id, col: 8, row: 9, kind: 'trash' });
  });

  it('unhappy guests drop messes as they wander', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.needs.happiness = MESS_BALANCE.unhappyThreshold - 10;
    let drops = 0;
    eventBus.on('messCreated', () => drops++);
    for (let i = 0; i < 2000; i++) world.tick();
    expect(drops).toBeGreaterThan(0);
  });

  it('happy guests never drop messes', () => {
    const world = new CasinoWorld({ seed: 5, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.needs.happiness = 90;
    guest.needs.bladder = 100;
    guest.needs.hunger = 100;
    let drops = 0;
    eventBus.on('messCreated', () => drops++);
    for (let i = 0; i < 500; i++) world.tick();
    expect(drops).toBe(0);
  });

  it('a nearby mess drains guest happiness; a distant one does not', () => {
    const world = new CasinoWorld({ seed: 9, autoSpawn: false });
    const near = world.spawnGuest();
    const far = world.spawnGuest();
    near.needs.happiness = 70;
    far.needs.happiness = 70;
    // Park both guests: no path targets, needs topped up so nothing else drains.
    for (const g of [near, far]) {
      g.needs.energy = 100;
      g.needs.bladder = 100;
      g.needs.hunger = 100;
    }
    far.pos = { col: 2, row: 2 };
    far.moveFrom = { col: 2, row: 2 };
    world.dropMess(near.pos.col, near.pos.row, 'spill');
    const nearBefore = near.needs.happiness;
    const farBefore = far.needs.happiness;
    for (let i = 0; i < 50; i++) world.tick();
    expect(near.needs.happiness).toBeLessThan(nearBefore);
    // Distant guest may drift for other reasons, but not from the mess drain:
    expect(farBefore - far.needs.happiness).toBeLessThan((nearBefore - near.needs.happiness) * 0.5);
  });

  it('guests standing in filth eventually think about it', () => {
    const world = new CasinoWorld({ seed: 13, autoSpawn: false });
    const guest = world.spawnGuest();
    guest.needs.bladder = 100;
    guest.needs.hunger = 100;
    world.dropMess(guest.pos.col, guest.pos.row, 'spill');
    const texts: string[] = [];
    eventBus.on('guestThought', ({ text }) => texts.push(text));
    for (let i = 0; i < 100; i++) world.tick();
    expect(texts).toContain('This place is filthy!');
  });

  it('cleanMess removes the mess and emits messCleaned', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const mess = world.dropMess(4, 4, 'trash')!;
    let cleaned: string | null = null;
    eventBus.on('messCleaned', ({ id }) => (cleaned = id));
    expect(world.cleanMess(mess.id)).toBe(true);
    expect(world.messes.size).toBe(0);
    expect(cleaned).toBe(mess.id);
    expect(world.cleanMess(mess.id)).toBe(false);
  });

  it('mess count is capped', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    for (let i = 0; i < MESS_BALANCE.maxMesses + 10; i++) world.dropMess(3, 3, 'trash');
    expect(world.messes.size).toBe(MESS_BALANCE.maxMesses);
  });

  it('serializes messes through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const m1 = world.dropMess(4, 4, 'trash')!;
    const m2 = world.dropMess(6, 6, 'spill')!;
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.messes.size).toBe(2);
    expect(restored.messes.get(m1.id)).toMatchObject({ col: 4, row: 4, kind: 'trash' });
    expect(restored.messes.get(m2.id)).toMatchObject({ col: 6, row: 6, kind: 'spill' });
    // New messes after a load must not collide with restored ids.
    const m3 = restored.dropMess(7, 7, 'trash')!;
    expect(restored.messes.size).toBe(3);
    expect([m1.id, m2.id]).not.toContain(m3.id);
  });
});
