import { afterEach, describe, expect, it } from 'vitest';
import { eventBus } from '../EventBus';
import { ARCHETYPE_BALANCE, GUEST_BALANCE } from '../data/balance';
import type { GuestArchetype } from './entities/Guest';
import { CasinoWorld } from './world';

afterEach(() => eventBus.clear());

describe('CasinoWorld — guest archetypes', () => {
  it('spawnGuest honors an explicit archetype override, and highRoller gets a much wider wallet range', () => {
    const world = new CasinoWorld({ seed: 1, autoSpawn: false });
    for (let i = 0; i < 30; i++) {
      const vip = world.spawnGuest('highRoller');
      expect(vip.archetype).toBe('highRoller');
      expect(vip.wallet).toBeGreaterThanOrEqual(ARCHETYPE_BALANCE.highRollerWalletMin);
      expect(vip.wallet).toBeLessThanOrEqual(ARCHETYPE_BALANCE.highRollerWalletMax);
    }
    // Sanity: the high-roller range is materially above the regular range.
    expect(ARCHETYPE_BALANCE.highRollerWalletMin).toBeGreaterThan(GUEST_BALANCE.walletMax);
  });

  it('biker and tourist overrides keep the standard wallet range', () => {
    const world = new CasinoWorld({ seed: 2, autoSpawn: false });
    for (let i = 0; i < 20; i++) {
      const biker = world.spawnGuest('biker');
      expect(biker.wallet).toBeGreaterThanOrEqual(GUEST_BALANCE.walletMin);
      expect(biker.wallet).toBeLessThanOrEqual(GUEST_BALANCE.walletMax);
      const tourist = world.spawnGuest('tourist');
      expect(tourist.wallet).toBeGreaterThanOrEqual(GUEST_BALANCE.walletMin);
      expect(tourist.wallet).toBeLessThanOrEqual(GUEST_BALANCE.walletMax);
    }
  });

  it('unweighted spawnGuest() distribution: regular dominates, but all 4 archetypes appear over many spawns', () => {
    const world = new CasinoWorld({ seed: 42, autoSpawn: false });
    const counts: Record<GuestArchetype, number> = { regular: 0, highRoller: 0, biker: 0, tourist: 0 };
    for (let i = 0; i < 4000; i++) {
      counts[world.spawnGuest().archetype]++;
    }
    expect(counts.regular).toBeGreaterThan(counts.highRoller);
    expect(counts.regular).toBeGreaterThan(counts.biker);
    expect(counts.regular).toBeGreaterThan(counts.tourist);
    expect(counts.regular).toBeGreaterThan(2000); // clearly dominant, not exactly specified
    expect(counts.highRoller).toBeGreaterThan(0);
    expect(counts.biker).toBeGreaterThan(0);
    expect(counts.tourist).toBeGreaterThan(0);
  });
});
