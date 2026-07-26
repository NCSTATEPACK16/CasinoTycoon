// Client-side mirror of the SQL trigger in supabase/migrations/0001.
// The DATABASE is the real gate — this exists so the player gets a friendly
// message without a round-trip. Keep the two normalizations in agreement;
// nameFilter.test.ts pins the cases that were asserted against the live
// normalize_name(), so a drift in either direction fails a test.

export type NameError = 'too-short' | 'too-long' | 'bad-chars' | 'blocked';

export const NAME_ERROR_TEXT: Record<NameError, string> = {
  'too-short': 'Name must be at least 3 characters.',
  'too-long': 'Name must be at most 16 characters.',
  'bad-chars': 'Letters, numbers, spaces, hyphens and underscores only.',
  blocked: 'Pick a different name.',
};

// Mirrors translate(..., '43105$@', 'aeiossa') in normalize_name().
const LEET: Record<string, string> = {
  '4': 'a',
  '3': 'e',
  '1': 'i',
  '0': 'o',
  '5': 's',
  $: 's',
  '@': 'a',
};

export function normalizeName(raw: string): string {
  const folded = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining accents (unaccent equivalent)
    .replace(/[43105$@]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9]/g, ''); // drop separators so f_u_c_k collapses
  return folded.replace(/(.)\1{2,}/g, '$1');
}

export function validateDisplayName(raw: string, banned: readonly string[]): NameError | null {
  const trimmed = raw.trim();
  if (trimmed.length < 3) return 'too-short';
  if (trimmed.length > 16) return 'too-long';
  if (!/^[\p{L}\p{N} _-]+$/u.test(trimmed)) return 'bad-chars';

  const norm = normalizeName(trimmed);
  // Word-boundary match on the normalized form, NOT substring — substring
  // matching rejects Cassandra for "ass".
  for (const word of banned) {
    if (new RegExp(`\\b${word}\\b`).test(norm) || norm === word) return 'blocked';
  }
  return null;
}
