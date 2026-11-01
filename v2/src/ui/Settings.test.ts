import { describe, expect, it } from 'vitest';
import { QUALITY_KEY, applyQuality, loadQualityChoice, saveQualityChoice } from './Settings';

describe('graphics quality choice', () => {
  it('round-trips a saved tier and defaults to Auto', () => {
    const m = new Map<string, string>();
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(loadQualityChoice(st)).toBe('auto');
    saveQualityChoice(st, 'medium');
    expect(m.get(QUALITY_KEY)).toBe('medium');
    expect(loadQualityChoice(st)).toBe('medium');
    m.set(QUALITY_KEY, 'ultra');
    expect(loadQualityChoice(st)).toBe('auto');
  });

  it('survives storage that throws', () => {
    const bad = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadQualityChoice(bad)).toBe('auto');
    expect(() => saveQualityChoice(bad, 'low')).not.toThrow();
    expect(loadQualityChoice(null)).toBe('auto');
  });

  it('Auto starts High with stepping on; a fixed tier turns stepping off', () => {
    const calls: string[] = [];
    const stage = { dynamicResolution: false, setQuality: (q: string) => void calls.push(q) };
    applyQuality(stage, 'auto');
    expect(stage.dynamicResolution).toBe(true);
    applyQuality(stage, 'low');
    expect(stage.dynamicResolution).toBe(false);
    expect(calls).toEqual(['high', 'low']);
  });
});
