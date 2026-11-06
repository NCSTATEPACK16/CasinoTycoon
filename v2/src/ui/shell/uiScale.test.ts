import { describe, expect, it } from 'vitest';
import { UI_SCALE_KEY, applyUiScale, clampUiScale, loadUiScale, saveUiScale } from './uiScale';

describe('UI scale', () => {
  it('clamps to 80–125% on 5% steps', () => {
    expect(clampUiScale(1)).toBe(1);
    expect(clampUiScale(0.5)).toBe(0.8);
    expect(clampUiScale(2)).toBe(1.25);
    expect(clampUiScale(1.07)).toBe(1.05);
    expect(clampUiScale(1.13)).toBe(1.15);
    expect(clampUiScale(Number.NaN)).toBe(1);
  });

  it('round-trips through storage and ignores junk', () => {
    const m = new Map<string, string>();
    const st = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    };
    expect(loadUiScale(st)).toBe(1);
    saveUiScale(st, 1.2);
    expect(m.get(UI_SCALE_KEY)).toBe('1.2');
    expect(loadUiScale(st)).toBe(1.2);
    m.set(UI_SCALE_KEY, 'huge');
    expect(loadUiScale(st)).toBe(1);
    m.set(UI_SCALE_KEY, '3');
    expect(loadUiScale(st)).toBe(1.25);
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
    expect(loadUiScale(bad)).toBe(1);
    expect(() => saveUiScale(bad, 0.9)).not.toThrow();
    expect(loadUiScale(null)).toBe(1);
  });

  it('sets the one root variable', () => {
    const props = new Map<string, string>();
    applyUiScale(
      { style: { setProperty: (k: string, v: string) => props.set(k, v) } } as never,
      0.8,
    );
    expect(props.get('--ui-scale')).toBe('0.8');
  });
});
