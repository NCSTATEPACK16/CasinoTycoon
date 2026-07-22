import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { TICKS_PER_HOUR } from '../config';
import { STAFF_BALANCE } from '../data/balance';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — staff', () => {
  it('hires staff at the entrance and emits staffHired', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    let hired: { id: string; kind: string } | null = null;
    eventBus.on('staffHired', (e) => (hired = e));
    const mech = world.hireStaff('mechanic');
    expect(world.staff.get(mech.id)).toBe(mech);
    expect(mech.pos).toEqual(world.entranceTile);
    expect(hired).toEqual({ id: mech.id, kind: 'mechanic' });
  });

  it('fires staff and emits staffFired', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const jan = world.hireStaff('janitor');
    let fired: { id: string; kind: string } | null = null;
    eventBus.on('staffFired', (e) => (fired = e));
    expect(world.fireStaff(jan.id)).toBe(true);
    expect(world.staff.size).toBe(0);
    expect(fired).toEqual({ id: jan.id, kind: 'janitor' });
    expect(world.fireStaff(jan.id)).toBe(false);
  });

  it('charges hourly wages for the payroll', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    world.hireStaff('mechanic');
    world.hireStaff('janitor');
    const before = world.state.cash;
    const hourly = STAFF_BALANCE.mechanic.wagePerHour + STAFF_BALANCE.janitor.wagePerHour;
    for (let i = 0; i < TICKS_PER_HOUR; i++) world.tick();
    expect(world.state.cash).toBe(before - hourly);
    for (let i = 0; i < TICKS_PER_HOUR; i++) world.tick();
    expect(world.state.cash).toBe(before - 2 * hourly);
  });

  it('charges no wages with no staff', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const before = world.state.cash;
    for (let i = 0; i < TICKS_PER_HOUR * 2; i++) world.tick();
    expect(world.state.cash).toBe(before);
  });

  it('a mechanic walks to a broken machine, repairs it, and it works again', () => {
    const world = new CasinoWorld({ seed: 21, autoSpawn: false });
    const po = world.place('slot-machine', 10, 10)!;
    const machine = world.machines.get(po.id)!;
    machine.reliability = 0;
    machine.broken = true;
    world.hireStaff('mechanic');

    let fixedId: string | null = null;
    eventBus.on('machineFixed', ({ machineId }) => (fixedId = machineId));
    for (let i = 0; i < 3000 && !fixedId; i++) world.tick();

    expect(fixedId).toBe(po.id);
    expect(machine.broken).toBe(false);
    expect(machine.reliability).toBe(100);
  });

  it('two mechanics fix two broken machines', () => {
    const world = new CasinoWorld({ seed: 22, autoSpawn: false });
    const a = world.place('slot-machine', 8, 8)!;
    const b = world.place('slot-machine', 20, 20)!;
    for (const id of [a.id, b.id]) {
      const m = world.machines.get(id)!;
      m.reliability = 0;
      m.broken = true;
    }
    world.hireStaff('mechanic');
    world.hireStaff('mechanic');
    const fixed = new Set<string>();
    eventBus.on('machineFixed', ({ machineId }) => fixed.add(machineId));
    for (let i = 0; i < 6000 && fixed.size < 2; i++) world.tick();
    expect(fixed).toEqual(new Set([a.id, b.id]));
  });

  it('a janitor walks to a mess and cleans it up', () => {
    const world = new CasinoWorld({ seed: 23, autoSpawn: false });
    world.dropMess(12, 12, 'spill');
    world.hireStaff('janitor');
    let cleaned = 0;
    eventBus.on('messCleaned', () => cleaned++);
    for (let i = 0; i < 3000 && cleaned === 0; i++) world.tick();
    expect(cleaned).toBe(1);
    expect(world.messes.size).toBe(0);
  });

  it('a bartender walks to the bar and brews drinks on a timer', () => {
    const world = new CasinoWorld({ seed: 27, autoSpawn: false });
    const po = world.place('bar', 15, 15)!;
    world.hireStaff('bartender');
    for (let i = 0; i < 500 && world.bars.get(po.id)!.stock === 0; i++) world.tick();
    expect(world.bars.get(po.id)!.stock).toBeGreaterThan(0);
  });

  it('a bartender hired before any bar exists waits, then assigns once one is built', () => {
    const world = new CasinoWorld({ seed: 28, autoSpawn: false });
    world.hireStaff('bartender');
    for (let i = 0; i < 30; i++) world.tick(); // idles/patrols, no bar yet
    const po = world.place('bar', 12, 12)!;
    for (let i = 0; i < 500 && world.bars.get(po.id)!.stock === 0; i++) world.tick();
    expect(world.bars.get(po.id)!.stock).toBeGreaterThan(0);
  });

  it('a waitress delivers a drink to a seated, thirsty guest', () => {
    const world = new CasinoWorld({ seed: 29, autoSpawn: false });
    world.place('bar', 2, 2);
    world.place('slot-machine', 20, 20);
    world.hireStaff('bartender');
    world.hireStaff('waitress');
    const guest = world.spawnGuest();
    guest.wallet = 5000;
    for (let i = 0; i < 400 && guest.state !== 'play'; i++) world.tick();
    expect(guest.state).toBe('play');
    guest.needs.thirst = 10;
    for (let i = 0; i < 4000 && guest.needs.thirst < 50; i++) world.tick();
    expect(guest.needs.thirst).toBeGreaterThan(50);
    expect(guest.waitingForDrink).toBe(false);
  });

  it('idle staff patrol the floor instead of standing frozen', () => {
    const world = new CasinoWorld({ seed: 24, autoSpawn: false });
    const jan = world.hireStaff('janitor');
    const start = { ...jan.pos };
    let moved = false;
    for (let i = 0; i < 600 && !moved; i++) {
      world.tick();
      if (jan.pos.col !== start.col || jan.pos.row !== start.row) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('picked-up staff freeze; dropping on a walkable tile teleports them there', () => {
    const world = new CasinoWorld({ seed: 25, autoSpawn: false });
    const mech = world.hireStaff('mechanic');
    expect(world.pickUpStaff(mech.id)).toBe(true);
    expect(mech.state).toBe('carried');
    const held = { ...mech.pos };
    for (let i = 0; i < 100; i++) world.tick();
    expect(mech.pos).toEqual(held);
    expect(world.dropStaff(mech.id, 15, 15)).toBe(true);
    expect(mech.pos).toEqual({ col: 15, row: 15 });
    expect(mech.state).not.toBe('carried');
  });

  it('refuses drops on blocked or out-of-bounds tiles', () => {
    const world = new CasinoWorld({ seed: 26, autoSpawn: false });
    world.place('plant', 3, 3);
    const mech = world.hireStaff('mechanic');
    world.pickUpStaff(mech.id);
    expect(world.dropStaff(mech.id, 3, 3)).toBe(false);
    expect(world.dropStaff(mech.id, -1, -1)).toBe(false);
    expect(mech.state).toBe('carried');
  });

  it('serializes staff through toJSON/fromJSON without id collisions', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    const mech = world.hireStaff('mechanic');
    const jan = world.hireStaff('janitor');
    const tender = world.hireStaff('bartender');
    world.pickUpStaff(jan.id);
    world.dropStaff(jan.id, 9, 9);
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.staff.size).toBe(3);
    expect(restored.staff.get(mech.id)!.kind).toBe('mechanic');
    expect(restored.staff.get(tender.id)!.kind).toBe('bartender');
    expect(restored.staff.get(jan.id)!.pos).toEqual({ col: 9, row: 9 });
    const extra = restored.hireStaff('janitor');
    expect([mech.id, jan.id, tender.id]).not.toContain(extra.id);
  });
});
