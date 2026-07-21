import { describe, expect, it } from 'vitest';
import { flavorName } from './names';

describe('flavorName', () => {
  it('is deterministic for the same id', () => {
    expect(flavorName('g-47')).toBe(flavorName('g-47'));
  });

  it('varies across ids', () => {
    const names = new Set(Array.from({ length: 20 }, (_, i) => flavorName(`g-${i}`)));
    expect(names.size).toBeGreaterThan(10);
  });

  it('looks like "First L." — a first name plus a last initial', () => {
    expect(flavorName('g-1')).toMatch(/^[A-Za-z ]+ [A-Z]\.$/);
  });
});
