import { describe, expect, it } from 'vitest';
import {
  freshOnboarding,
  isFirstRun,
  loadOnboarding,
  ONBOARDING_KEY,
  saveOnboarding,
  type OnboardingStore,
} from './onboarding';

const memory = (init: Record<string, string> = {}) => {
  const data = new Map(Object.entries(init));
  const store: OnboardingStore & { data: Map<string, string> } = {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  return store;
};

describe('B12 onboarding storage', () => {
  it('reads nothing, garbage, another version or a blocked store as a first-time player', () => {
    expect(loadOnboarding(memory())).toEqual(freshOnboarding());
    expect(loadOnboarding(memory({ [ONBOARDING_KEY]: '{oops' }))).toEqual(freshOnboarding());
    expect(
      loadOnboarding(memory({ [ONBOARDING_KEY]: '{"version":9,"tutorialDone":true}' })),
    ).toEqual(freshOnboarding());
    const blocked: OnboardingStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadOnboarding(blocked)).toEqual(freshOnboarding());
    expect(() => saveOnboarding(freshOnboarding(), blocked)).not.toThrow();
    expect(loadOnboarding(null)).toEqual(freshOnboarding());
  });

  it('round-trips what has been shown, and ignores junk in the tip list', () => {
    const store = memory();
    saveOnboarding(
      { ...freshOnboarding(), tutorialDone: true, tips: ['controls', 'guests'] },
      store,
    );
    expect(loadOnboarding(store)).toMatchObject({
      tutorialDone: true,
      tips: ['controls', 'guests'],
    });
    store.setItem(ONBOARDING_KEY, '{"version":1,"tutorialDone":"yes","tips":["a",3,null]}');
    expect(loadOnboarding(store)).toMatchObject({ tutorialDone: false, tips: ['a'] });
  });

  it('is a first run only when nothing has been done or saved', () => {
    const o = freshOnboarding();
    expect(isFirstRun(o, false, false)).toBe(true);
    expect(isFirstRun(o, true, false)).toBe(false);
    expect(isFirstRun(o, false, true)).toBe(false);
    expect(isFirstRun({ ...o, tutorialDone: true }, false, false)).toBe(false);
  });
});
