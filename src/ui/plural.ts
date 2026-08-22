// P16 — plurals for UI labels.
//
// The staff panel appended an "s", which is right for Mechanic and Janitor and
// produced "Cocktail Waitresss" and "Securitys" for the two labels that need
// anything else. Small, but it is on a panel the player opens every run, and
// the charm layer is what carries the repetition in this genre.

/** Words that are already their own plural. English has no rule for these. */
const UNCOUNTED = new Set(['security', 'staff', 'cash', 'money', 'furniture']);

/** Endings that take -es rather than a bare -s. */
const SIBILANT = /(s|x|z|ch|sh)$/i;

/**
 * The plural of `word`, or the singular when `count` is exactly 1.
 *
 * Deliberately small: this serves a fixed set of UI nouns, not arbitrary
 * English. A label that pluralises oddly belongs in UNCOUNTED rather than in a
 * new rule, because one more rule is one more way to produce "Securitys".
 */
export function pluralize(word: string, count?: number): string {
  if (count === 1) return word;
  const last = word.slice(word.lastIndexOf(' ') + 1);
  if (UNCOUNTED.has(last.toLowerCase())) return word;
  if (SIBILANT.test(word)) return `${word}es`;
  // Consonant + y becomes -ies; a vowel before it just takes an s (Lackeys).
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return `${word}s`;
}
