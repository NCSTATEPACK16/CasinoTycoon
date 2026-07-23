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

  it('a dealer walks to a placed blackjack table and stations there', () => {
    const world = new CasinoWorld({ seed: 31, autoSpawn: false });
    world.place('blackjack-table', 15, 15)!;
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 500 && dealer.state !== 'stationed'; i++) world.tick();
    expect(dealer.state).toBe('stationed');
    expect(dealer.pos).not.toEqual(world.entranceTile);
  });

  it('a dealer hired before any table exists waits, then assigns once one is built', () => {
    const world = new CasinoWorld({ seed: 32, autoSpawn: false });
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 30; i++) world.tick(); // nothing to claim yet
    expect(dealer.state).toBe('idle');
    world.place('craps-table', 12, 12);
    for (let i = 0; i < 500 && dealer.state !== 'stationed'; i++) world.tick();
    expect(dealer.state).toBe('stationed');
  });

  it('two dealers claim two different tables, never the same one', () => {
    const world = new CasinoWorld({ seed: 33, autoSpawn: false });
    world.state.cash = 5000;
    world.place('blackjack-table', 8, 8);
    world.place('craps-table', 20, 20);
    const a = world.hireStaff('dealer');
    const b = world.hireStaff('dealer');
    for (let i = 0; i < 500 && (a.state !== 'stationed' || b.state !== 'stationed'); i++) {
      world.tick();
    }
    expect(a.state).toBe('stationed');
    expect(b.state).toBe('stationed');
    expect(a.assignedTableId).not.toBe(b.assignedTableId);
  });

  it('selling a dealt table frees its dealer to reassign elsewhere', () => {
    const world = new CasinoWorld({ seed: 34, autoSpawn: false });
    world.state.cash = 5000;
    const a = world.place('blackjack-table', 8, 8)!;
    const b = world.place('craps-table', 20, 20)!;
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 500 && dealer.state !== 'stationed'; i++) world.tick();
    expect(dealer.assignedTableId).toBe(a.id);
    world.sell(a.id);
    for (let i = 0; i < 500 && (dealer.assignedTableId !== b.id || dealer.state !== 'stationed'); i++) {
      world.tick();
    }
    expect(dealer.assignedTableId).toBe(b.id);
    expect(dealer.state).toBe('stationed');
  });

  it('firing a dealer frees its table for another dealer', () => {
    const world = new CasinoWorld({ seed: 35, autoSpawn: false });
    const po = world.place('blackjack-table', 8, 8)!;
    const first = world.hireStaff('dealer');
    for (let i = 0; i < 500 && first.state !== 'stationed'; i++) world.tick();
    expect(first.assignedTableId).toBe(po.id);
    world.fireStaff(first.id);
    const second = world.hireStaff('dealer');
    for (let i = 0; i < 500 && second.state !== 'stationed'; i++) world.tick();
    expect(second.assignedTableId).toBe(po.id);
  });

  it('a dealt table contributes a small capped rating bonus', () => {
    const world = new CasinoWorld({ seed: 36, autoSpawn: false });
    world.place('blackjack-table', 8, 8);
    const before = world.rating;
    const dealer = world.hireStaff('dealer');
    for (let i = 0; i < 500 && dealer.state !== 'stationed'; i++) world.tick();
    expect(world.rating).toBeGreaterThan(before);
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

  it('hires a pitBoss and a security guard at the entrance', () => {
    const world = new CasinoWorld({ seed: 40, autoSpawn: false });
    const boss = world.hireStaff('pitBoss');
    const guard = world.hireStaff('security');
    expect(world.staff.get(boss.id)).toBe(boss);
    expect(world.staff.get(guard.id)).toBe(guard);
    expect(boss.pos).toEqual(world.entranceTile);
    expect(guard.pos).toEqual(world.entranceTile);
  });

  it('idle pitBoss/security patrol the floor instead of standing frozen', () => {
    const world = new CasinoWorld({ seed: 41, autoSpawn: false });
    const guard = world.hireStaff('security');
    const start = { ...guard.pos };
    let moved = false;
    for (let i = 0; i < 600 && !moved; i++) {
      world.tick();
      if (guard.pos.col !== start.col || guard.pos.row !== start.row) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('pitBoss and security never claim mechanic or janitor jobs', () => {
    const world = new CasinoWorld({ seed: 42, autoSpawn: false });
    world.dropMess(12, 12, 'spill');
    const po = world.place('slot-machine', 10, 10)!;
    const machine = world.machines.get(po.id)!;
    machine.reliability = 0;
    machine.broken = true;
    const boss = world.hireStaff('pitBoss');
    const guard = world.hireStaff('security');
    for (let i = 0; i < 500; i++) world.tick();
    expect(boss.state).not.toBe('working');
    expect(guard.state).not.toBe('working');
    expect(boss.jobId).toBeNull();
    expect(guard.jobId).toBeNull();
    expect(world.messes.size).toBe(1); // untouched — no janitor hired
    expect(machine.broken).toBe(true); // untouched — no mechanic hired
  });

  it('charges hourly wages for pitBoss and security', () => {
    const world = new CasinoWorld({ seed: 43, autoSpawn: false });
    world.hireStaff('pitBoss');
    world.hireStaff('security');
    const before = world.state.cash;
    const hourly = STAFF_BALANCE.pitBoss.wagePerHour + STAFF_BALANCE.security.wagePerHour;
    for (let i = 0; i < TICKS_PER_HOUR; i++) world.tick();
    expect(world.state.cash).toBe(before - hourly);
  });

  it('serializes pitBoss/security kind through toJSON/fromJSON', () => {
    const world = new CasinoWorld({ seed: 44, autoSpawn: false });
    const boss = world.hireStaff('pitBoss');
    const guard = world.hireStaff('security');
    const restored = CasinoWorld.fromJSON(world.toJSON());
    expect(restored.staff.get(boss.id)!.kind).toBe('pitBoss');
    expect(restored.staff.get(guard.id)!.kind).toBe('security');
  });
});
