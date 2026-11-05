import { describe, expect, it } from 'vitest';
import { labelText, packLabel } from './PayoutLabels';

const GLYPHS = '0123456789$+−,';

/** The shader's glyphAt, in TypeScript. */
function unpack(packed: [number, number, number], count: number): string {
  let s = '';
  for (let i = 0; i < count; i++) {
    const p = packed[Math.floor(i / 4)]!;
    s += GLYPHS[Math.floor(p / 16 ** (i % 4)) % 16];
  }
  return s;
}

describe('payout labels', () => {
  it('prints amounts as the old sprites did', () => {
    expect(labelText(1250)).toBe('+$1,250');
    expect(labelText(4.4)).toBe('+$4');
    expect(labelText(-30)).toBe('−$30');
  });

  it('packs the text into floats the shader spells back out exactly', () => {
    for (const amount of [0, 7, 1250, -30, 98_765_432]) {
      const text = labelText(amount);
      const { packed, count } = packLabel(text);
      expect(count).toBe(text.length);
      expect(unpack(packed, count)).toBe(text);
      // Each float stays an exact integer well inside float32's 24 bits.
      for (const p of packed) expect(p).toBeLessThan(2 ** 16);
    }
  });

  it('stops at twelve glyphs', () => {
    expect(packLabel(labelText(9_999_999_999)).count).toBe(12);
  });
});
