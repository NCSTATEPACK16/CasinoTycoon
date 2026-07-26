import { describe, expect, it } from 'vitest';
import { normalizeName, validateDisplayName } from './nameFilter';

const BANNED = ['fuck', 'shit', 'cono'] as const;

describe('normalizeName', () => {
  it('lowercases, strips accents, folds leet, and collapses repeats', () => {
    expect(normalizeName('FUCK')).toBe('fuck');
    expect(normalizeName('coño')).toBe('cono');
    expect(normalizeName('sh1t')).toBe('shit');
    expect(normalizeName('f4ck')).toBe('fack');
    expect(normalizeName('fuuuuck')).toBe('fuck');
    expect(normalizeName('f_u_c_k')).toBe('fuck');
  });

  // These are the exact inputs asserted against normalize_name() in the live
  // database (see the Task 2 commit). If this test and that function ever
  // disagree, a name blocked here will pass the real gate, or vice versa.
  it('agrees with the SQL normalize_name on every evasion spelling', () => {
    const cases: [string, string][] = [
      ['FUCK', 'fuck'],
      ['f_u_c_k', 'fuck'],
      ['sh1t', 'shit'],
      ['F.U.C.K', 'fuck'],
      ['fuuuuck', 'fuck'],
      ['$hit', 'shit'],
      ['coño', 'cono'],
      ['cabrón', 'cabron'],
      ['p@nocha', 'panocha'],
      ['Cassandra', 'cassandra'],
      ['Calculo', 'calculo'],
      ['Sussex', 'sussex'],
      ['High Roller', 'highroller'],
      ['Rita', 'rita'],
    ];
    for (const [raw, expected] of cases) {
      expect(normalizeName(raw), raw).toBe(expected);
    }
  });
});

describe('validateDisplayName', () => {
  it('accepts ordinary names', () => {
    expect(validateDisplayName('Rita', BANNED)).toBeNull();
    expect(validateDisplayName('High Roller', BANNED)).toBeNull();
  });

  it('does not false-positive on innocent words containing banned substrings', () => {
    // The Scunthorpe problem: substring matching would reject all of these.
    expect(validateDisplayName('Cassandra', ['ass'])).toBeNull();
    expect(validateDisplayName('Calculo', ['culo'])).toBeNull();
    expect(validateDisplayName('Sussex', ['sex'])).toBeNull();
  });

  it('blocks profanity including evasion spellings', () => {
    expect(validateDisplayName('fuck', BANNED)).toBe('blocked');
    expect(validateDisplayName('F_U_C_K', BANNED)).toBe('blocked');
    expect(validateDisplayName('sh1t', BANNED)).toBe('blocked');
    expect(validateDisplayName('coño', BANNED)).toBe('blocked');
  });

  it('enforces length and charset', () => {
    expect(validateDisplayName('ab', BANNED)).toBe('too-short');
    expect(validateDisplayName('a'.repeat(17), BANNED)).toBe('too-long');
    expect(validateDisplayName('Rita!', BANNED)).toBe('bad-chars');
  });
});
