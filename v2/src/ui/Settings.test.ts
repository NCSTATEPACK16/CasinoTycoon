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
    saveQualityChoice(st, 'low');
    expect(m.get(QUALITY_KEY)).toBe('low');
    expect(loadQualityChoice(st)).toBe('low');
    // The old menu's Medium reads as Auto (A8: Auto / High / Low).
    m.set(QUALITY_KEY, 'medium');
    expect(loadQualityChoice(st)).toBe('auto');
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

  it('Auto starts at the suggested tier with stepping on; a fixed tier turns stepping off', () => {
    const calls: string[] = [];
    let suggested: 'high' | 'low' = 'low';
    const stage = {
      dynamicResolution: false,
      setQuality: (q: string) => void calls.push(q),
      suggestedQuality: () => suggested,
    };
    applyQuality(stage, 'auto');
    expect(stage.dynamicResolution).toBe(true);
    suggested = 'high';
    applyQuality(stage, 'auto');
    applyQuality(stage, 'low');
    expect(stage.dynamicResolution).toBe(false);
    applyQuality(stage, 'high');
    expect(stage.dynamicResolution).toBe(false);
    expect(calls).toEqual(['low', 'high', 'low', 'high']);
  });
});
