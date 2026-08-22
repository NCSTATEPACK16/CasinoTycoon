import { describe, expect, it } from 'vitest';
import { pluralize } from './plural';

/**
 * P16 — the staff panel built plurals by appending an "s".
 *
 * That is fine for Mechanic and Janitor and wrong for the two labels that
 * happen to need anything else, which is how "Cocktail Waitresss" and
 * "Securitys" ended up on a panel the player opens every run. A sibilant
 * takes -es, and some words are already plural.
 */
describe('pluralize', () => {
  it('adds a plain s to an ordinary word', () => {
    expect(pluralize('Mechanic')).toBe('Mechanics');
    expect(pluralize('Janitor')).toBe('Janitors');
    expect(pluralize('Dealer')).toBe('Dealers');
  });

  it('adds -es after a sibilant rather than a third s', () => {
    expect(pluralize('Cocktail Waitress')).toBe('Cocktail Waitresses');
    expect(pluralize('Boss')).toBe('Bosses');
    expect(pluralize('Box')).toBe('Boxes');
  });

  it('leaves a mass noun alone', () => {
    // "Securitys" was the other one on the panel. Security is already the
    // plural of itself, and no rule about endings will work that out.
    expect(pluralize('Security')).toBe('Security');
    expect(pluralize('Staff')).toBe('Staff');
  });

  it('turns a consonant + y into -ies', () => {
    expect(pluralize('Croupier')).toBe('Croupiers');
    expect(pluralize('Lackey')).toBe('Lackeys');
    expect(pluralize('Company')).toBe('Companies');
  });

  it('counts: one of a thing keeps the singular', () => {
    expect(pluralize('Mechanic', 1)).toBe('Mechanic');
    expect(pluralize('Cocktail Waitress', 1)).toBe('Cocktail Waitress');
    expect(pluralize('Mechanic', 0)).toBe('Mechanics');
    expect(pluralize('Mechanic', 2)).toBe('Mechanics');
  });
});
