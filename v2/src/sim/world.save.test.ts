import { afterEach, describe, expect, it } from 'vitest';
import { CasinoWorld } from './world';
import { eventBus } from '../EventBus';
import { getCampaign } from '../data/campaigns';

afterEach(() => eventBus.clear());

/** Build a lived-in world: scenario, objects, staff, mess, and time on the clock. */
function populatedWorld(): CasinoWorld {
  const world = new CasinoWorld({ seed: 42 });
  world.startScenario(getCampaign('dusty-dime')!);
  world.place('slot-machine', 5, 5);
  world.place('slot-machine', 7, 5);
  world.place('toilet', 10, 8);
  const stallPo = world.place('food-stall', 12, 8)!;
  world.foodStalls.get(stallPo.id)!.setPrice('burger', 6.5);
  world.hireStaff('mechanic');
  world.hireStaff('janitor');
  world.dropMess(3, 3, 'trash');
  for (let i = 0; i < 300; i++) world.tick(); // 6 sim-hours: plays, wages, samples
  return world;
}

describe('save round-trip', () => {
  it('loadJSON restores an identical world snapshot', () => {
    const a = populatedWorld();
    const snapshot = a.toJSON();
    const b = new CasinoWorld();
    b.loadJSON(snapshot);
    expect(b.toJSON()).toEqual(snapshot);
  });

  it('loadJSON keeps state and grid object identity (gameContext aliases)', () => {
    const world = new CasinoWorld();
    const stateRef = world.state;
    const gridRef = world.grid;
    world.loadJSON(populatedWorld().toJSON());
    expect(world.state).toBe(stateRef);
    expect(world.grid).toBe(gridRef);
  });

  it('emits worldReset then worldLoaded with the scenario id, then money and clock', () => {
    // Build and snapshot the populated world before subscribing, so its own
    // tick/scenario events don't pollute the order we're asserting on load.
    const snapshot = populatedWorld().toJSON();
    const order: string[] = [];
    const offs = [
      eventBus.on('worldReset', () => order.push('reset')),
      eventBus.on('worldLoaded', ({ scenarioId }) => order.push(`loaded:${scenarioId}`)),
      eventBus.on('moneyChanged', () => order.push('money')),
      eventBus.on('hourPassed', () => order.push('hour')),
    ];
    new CasinoWorld().loadJSON(snapshot);
    offs.forEach((off) => off());
    expect(order).toEqual(['reset', 'loaded:dusty-dime', 'money', 'hour']);
  });

  it('a loaded world keeps ticking without error', () => {
    const world = new CasinoWorld();
    world.loadJSON(populatedWorld().toJSON());
    for (let i = 0; i < 200; i++) world.tick();
    expect(world.toJSON()).toBeTruthy();
  });
});
