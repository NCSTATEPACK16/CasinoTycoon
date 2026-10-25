import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  busGain,
  distanceGain,
  effectiveGain,
  listenerPoint,
  loadSettings,
  masterGain,
  saveSettings,
  sliderGain,
  type AudioSettings,
} from './mix';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('bus gain', () => {
  const s: AudioSettings = { master: 0.5, sfx: 1, ambience: 0.5, ui: 0, muted: false };

  it('squares the slider so its travel feels even', () => {
    expect(sliderGain(0)).toBe(0);
    expect(sliderGain(0.5)).toBeCloseTo(0.25);
    expect(sliderGain(1)).toBe(1);
    expect(sliderGain(2)).toBe(1);
    expect(sliderGain(-1)).toBe(0);
  });

  it('multiplies each bus by master', () => {
    expect(masterGain(s)).toBeCloseTo(0.25);
    expect(busGain(s, 'sfx')).toBe(1);
    expect(effectiveGain(s, 'sfx')).toBeCloseTo(0.25);
    expect(effectiveGain(s, 'ambience')).toBeCloseTo(0.0625);
    expect(effectiveGain(s, 'ui')).toBe(0);
  });

  it('mute silences master but keeps the slider positions', () => {
    const m = { ...s, muted: true };
    expect(masterGain(m)).toBe(0);
    expect(effectiveGain(m, 'sfx')).toBe(0);
    expect(busGain(m, 'sfx')).toBe(1);
  });
});

describe('settings persistence', () => {
  it('round-trips through storage', () => {
    const st = memoryStorage();
    const s: AudioSettings = { master: 0.3, sfx: 0.9, ambience: 0.1, ui: 0.4, muted: true };
    expect(saveSettings(st, s)).toBe(true);
    expect(loadSettings(st)).toEqual(s);
  });

  it('falls back to defaults for missing, corrupt or out-of-range entries', () => {
    const st = memoryStorage();
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    st.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    st.setItem(SETTINGS_KEY, JSON.stringify({ master: 7, sfx: 'loud', ui: -2, muted: 'yes' }));
    expect(loadSettings(st)).toEqual({ ...DEFAULT_SETTINGS, master: 1, ui: 0 });
  });

  it('survives storage that throws or is missing', () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwing, { ...DEFAULT_SETTINGS })).toBe(false);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(undefined, { ...DEFAULT_SETTINGS })).toBe(false);
  });

  it('never hands back the shared defaults object', () => {
    const a = loadSettings(null);
    a.master = 0;
    expect(DEFAULT_SETTINGS.master).toBe(0.8);
  });
});

describe('distance attenuation', () => {
  it('is full inside the reference distance and falls off inversely', () => {
    expect(distanceGain(0)).toBe(1);
    expect(distanceGain(5)).toBe(1);
    expect(distanceGain(10)).toBeCloseTo(5 / (5 + 1.2 * 5));
    expect(distanceGain(30)).toBeLessThan(distanceGain(20));
  });

  it('cuts to silence at the max distance', () => {
    expect(distanceGain(89.9)).toBeGreaterThan(0);
    expect(distanceGain(90)).toBe(0);
    expect(distanceGain(500)).toBe(0);
  });
});

describe('listener placement', () => {
  it('stays on the camera at eye level', () => {
    expect(listenerPoint({ x: 1, y: 1.6, z: 2 }, { x: 0, y: -0.2, z: 1 })).toEqual({
      x: 1,
      y: 1.6,
      z: 2,
    });
  });

  it('stays on the camera when looking level or up', () => {
    expect(listenerPoint({ x: 0, y: 40, z: 0 }, { x: 0, y: 0, z: 1 })).toEqual({
      x: 0,
      y: 40,
      z: 0,
    });
  });

  it('slides down the view ray from the god view', () => {
    // Looking 45° down from 60 m: ears at 4 + 56/4 = 18 m, 42 m along the ground.
    const f = { x: 0, y: -Math.SQRT1_2, z: Math.SQRT1_2 };
    const p = listenerPoint({ x: 10, y: 60, z: 0 }, f);
    expect(p.y).toBeCloseTo(18);
    expect(p.x).toBeCloseTo(10);
    expect(p.z).toBeCloseTo(42);
  });
});
