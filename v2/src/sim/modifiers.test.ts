import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { MODIFIERS } from '../data/balance';
import { ModifierSystem } from './modifiers';
import { Rng } from './rng';

afterEach(() => eventBus.clear());

/** A stream that always draws — removes the `drawChance` coin flip from tests
 *  that are about what happens *after* a draw. */
const alwaysDraws = () => {
  const rng = new Rng(1);
  rng.next = () => 0;
  return rng;
};

describe('ModifierSystem', () => {
  it('starts with nothing in force', () => {
    const sys = new ModifierSystem();
    expect(sys.activeModifiers).toEqual([]);
    expect(sys.spawnMult()).toBe(1);
    expect(sys.walletMult()).toBe(1);
    expect(sys.thirstDecayMult()).toBe(1);
    expect(sys.cageCapacityMult()).toBe(1);
  });

  it('never draws more than maxActivePerDay', () => {
    for (let seed = 0; seed < 200; seed++) {
      const sys = new ModifierSystem();
      sys.drawForDay(1, new Rng(seed));
      expect(sys.activeModifiers.length).toBeLessThanOrEqual(MODIFIERS.maxActivePerDay);
    }
  });

  it('draws without replacement, so a modifier never stacks with itself', () => {
    for (let seed = 0; seed < 200; seed++) {
      const sys = new ModifierSystem();
      sys.drawForDay(1, new Rng(seed));
      const ids = sys.activeModifiers.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('is idempotent within a day, so reloading does not reroll', () => {
    const sys = new ModifierSystem();
    sys.drawForDay(3, alwaysDraws());
    const first = sys.activeModifiers.map((m) => m.id);
    // A second call for the same day must not touch the stream or the set.
    sys.drawForDay(3, alwaysDraws());
    expect(sys.activeModifiers.map((m) => m.id)).toEqual(first);
  });

  it('replaces the previous day set rather than accumulating', () => {
    const sys = new ModifierSystem();
    sys.drawForDay(1, alwaysDraws());
    sys.drawForDay(2, alwaysDraws());
    expect(sys.activeModifiers.length).toBeLessThanOrEqual(MODIFIERS.maxActivePerDay);
  });

  it('multiplies stacked effects rather than taking the last one', () => {
    const sys = new ModifierSystem();
    // convention (1.45) and bus-junket (1.8) both raise spawn.
    const restored = ModifierSystem.fromJSON({
      activeIds: ['convention', 'bus-junket'],
      drawnForDay: 1,
    });
    // Read from the catalog rather than repeating its numbers: this test is
    // about multiplying stacked effects, not about what any one of them is
    // worth, and P16 retuned both of these.
    const spawnOf = (id: string) =>
      MODIFIERS.catalog.find((m) => m.id === id)?.spawnMult ?? 1;
    expect(restored.spawnMult()).toBeCloseTo(spawnOf('convention') * spawnOf('bus-junket'), 5);
    expect(sys.spawnMult()).toBe(1);
  });

  it('fines a failed cleanliness requirement and spares a met one', () => {
    const sys = ModifierSystem.fromJSON({ activeIds: ['health-inspection'], drawnForDay: 1 });
    const failed = sys.settleDay(50);
    expect(failed.penalty).toBe(400);
    expect(failed.reasons).toEqual(['Health inspection']);
    expect(sys.settleDay(80).penalty).toBe(0);
    expect(sys.settleDay(95).penalty).toBe(0);
  });

  it('charges nothing when no condition carries a requirement', () => {
    const sys = ModifierSystem.fromJSON({ activeIds: ['heat-wave'], drawnForDay: 1 });
    expect(sys.settleDay(0)).toEqual({ penalty: 0, reasons: [] });
  });

  it('round-trips through JSON by id', () => {
    const sys = new ModifierSystem();
    sys.drawForDay(4, alwaysDraws());
    const restored = ModifierSystem.fromJSON(sys.toJSON());
    expect(restored.activeModifiers.map((m) => m.id)).toEqual(
      sys.activeModifiers.map((m) => m.id),
    );
    // Still idempotent for its own day after a reload — the whole reason
    // drawnForDay is serialized.
    restored.drawForDay(4, alwaysDraws());
    expect(restored.activeModifiers.map((m) => m.id)).toEqual(
      sys.activeModifiers.map((m) => m.id),
    );
  });

  it('drops an id no longer in the catalog instead of failing the load', () => {
    const restored = ModifierSystem.fromJSON({
      activeIds: ['retired-modifier', 'heat-wave'],
      drawnForDay: 2,
    });
    expect(restored.activeModifiers.map((m) => m.id)).toEqual(['heat-wave']);
  });

  it('tolerates a null or half-built payload', () => {
    expect(ModifierSystem.fromJSON(null).activeModifiers).toEqual([]);
    expect(
      ModifierSystem.fromJSON({} as unknown as { activeIds: string[]; drawnForDay: number })
        .activeModifiers,
    ).toEqual([]);
  });
});
