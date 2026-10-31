// B12: what the player has already been shown — the tutorial and the
// first-time tips — kept on the main thread in localStorage, like progress.ts:
// missing, corrupt or blocked storage reads as a first-time player.

export const ONBOARDING_KEY = 'casino-v2-onboarding';
export const ONBOARDING_VERSION = 1;

export interface Onboarding {
  version: number;
  /** Opening Night finished (every step ticked). */
  tutorialDone: boolean;
  /** Tip ids already shown, so each appears once. */
  tips: string[];
}

export interface OnboardingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStore = (): OnboardingStore | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const freshOnboarding = (): Onboarding => ({
  version: ONBOARDING_VERSION,
  tutorialDone: false,
  tips: [],
});

export function loadOnboarding(store: OnboardingStore | null = browserStore()): Onboarding {
  try {
    const raw = store?.getItem(ONBOARDING_KEY);
    if (!raw) return freshOnboarding();
    const j = JSON.parse(raw) as Partial<Onboarding> | null;
    if (!j || typeof j !== 'object' || j.version !== ONBOARDING_VERSION) return freshOnboarding();
    return {
      version: ONBOARDING_VERSION,
      tutorialDone: j.tutorialDone === true,
      tips: Array.isArray(j.tips) ? j.tips.filter((t): t is string => typeof t === 'string') : [],
    };
  } catch {
    return freshOnboarding();
  }
}

export function saveOnboarding(
  o: Onboarding,
  store: OnboardingStore | null = browserStore(),
): void {
  try {
    store?.setItem(ONBOARDING_KEY, JSON.stringify(o));
  } catch {
    /* private mode or full: the player just sees the tips again */
  }
}

/** A first-time player: nothing won, no tutorial, nothing saved to resume. */
export function isFirstRun(o: Onboarding, wonAny: boolean, hasSaves: boolean): boolean {
  return !o.tutorialDone && !wonAny && !hasSaves;
}
