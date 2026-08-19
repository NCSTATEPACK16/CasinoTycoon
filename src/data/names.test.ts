import { describe, expect, it } from 'vitest';
import { flavorName, NAME_POOL_SIZE, uniqueFlavorName } from './names';

describe('flavorName', () => {
  it('is deterministic for the same id', () => {
    expect(flavorName('g-47')).toBe(flavorName('g-47'));
  });

  it('varies across ids', () => {
    const names = new Set(Array.from({ length: 20 }, (_, i) => flavorName(`g-${i}`)));
    expect(names.size).toBeGreaterThan(10);
  });

  it('looks like "First Last"', () => {
    expect(flavorName('g-1')).toMatch(/^[A-Za-z]+ [A-Za-z]+$/);
  });
});

describe('the name pool', () => {
  // A1b's one non-negotiable number: the documented immersion break for
  // persistent named entities is name repetition, and the registry caps at 150.
  it('offers the 4,000+ combinations a persistent roster needs', () => {
    expect(NAME_POOL_SIZE).toBeGreaterThanOrEqual(4000);
  });

  it('reaches every combination in the pool as ids vary', () => {
    const seen = new Set<string>();
    for (let i = 0; i < NAME_POOL_SIZE; i++) seen.add(uniqueFlavorName('g-0', new Set(seen)));
    expect(seen.size).toBe(NAME_POOL_SIZE);
  });
});

describe('uniqueFlavorName', () => {
  it('returns the plain name when it is free', () => {
    expect(uniqueFlavorName('g-9', new Set())).toBe(flavorName('g-9'));
  });

  it('walks past a name already on the roster', () => {
    const taken = new Set([flavorName('g-9')]);
    const name = uniqueFlavorName('g-9', taken);
    expect(taken.has(name)).toBe(false);
  });

  it('still answers when every combination is spoken for', () => {
    const all = new Set<string>();
    for (let i = 0; i < NAME_POOL_SIZE; i++) all.add(uniqueFlavorName('g-0', new Set(all)));
    expect(all.has(uniqueFlavorName('g-0', all))).toBe(true);
  });
});
