import { describe, expect, it } from 'vitest';
import { CAREER, getCampaign } from '../data/campaigns';
import {
  freshProgress,
  isScenarioUnlocked,
  loadProgress,
  locksFor,
  lockedObjects,
  PROGRESS_KEY,
  recordWin,
  saveProgress,
  type ProgressStore,
} from './progress';

const memory = (
  init: Record<string, string> = {},
): ProgressStore & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
};

describe('B8 progress storage', () => {
  it('reads nothing, garbage, a future version or a throwing store as a fresh player', () => {
    expect(loadProgress(memory())).toEqual(freshProgress());
    expect(loadProgress(memory({ [PROGRESS_KEY]: '{not json' }))).toEqual(freshProgress());
    expect(loadProgress(memory({ [PROGRESS_KEY]: '{"version":2,"scenarios":{}}' }))).toEqual(
      freshProgress(),
    );
    expect(loadProgress(memory({ [PROGRESS_KEY]: 'null' }))).toEqual(freshProgress());
    const throwing: ProgressStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadProgress(throwing)).toEqual(freshProgress());
    expect(() => saveProgress(freshProgress(), throwing)).not.toThrow();
    expect(loadProgress(null)).toEqual(freshProgress());
  });

  it('round-trips, and drops records it cannot trust', () => {
    const store = memory();
    const { progress } = recordWin(freshProgress(), 'dusty-dime', {
      medal: 'silver',
      score: 900,
      day: 8,
    });
    saveProgress(progress, store);
    expect(JSON.parse(store.data.get(PROGRESS_KEY)!).version).toBe(1);
    expect(loadProgress(store)).toEqual(progress);
    store.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        version: 1,
        scenarios: {
          'dusty-dime': { medal: 'gold', score: 1, day: 3 },
          'no-such-scenario': { medal: 'gold', score: 1, day: 1 },
          'neon-nights': { medal: 'platinum', score: 1, day: 1 },
        },
      }),
    );
    expect(Object.keys(loadProgress(store).scenarios)).toEqual(['dusty-dime']);
  });

  it('keeps the best medal, the best score and the earliest day, each on its own', () => {
    let p = recordWin(freshProgress(), 'dusty-dime', {
      medal: 'gold',
      score: 500,
      day: 5,
    }).progress;
    const again = recordWin(p, 'dusty-dime', { medal: 'bronze', score: 800, day: 11 });
    p = again.progress;
    expect(p.scenarios['dusty-dime']).toEqual({ medal: 'gold', score: 800, day: 5 });
    expect(again.firstWin).toBe(false);
    expect(again.unlocked).toEqual({ scenarios: [], objects: [] });
  });

  it('opens the career one scenario at a time and says what a first win unlocked', () => {
    const p0 = freshProgress();
    const open = CAREER.filter((d) => isScenarioUnlocked(d, p0)).map((d) => d.id);
    expect(open).toEqual(['dusty-dime']);
    const win = recordWin(p0, 'dusty-dime', { medal: 'bronze', score: 100, day: 12 });
    expect(win.firstWin).toBe(true);
    expect(win.unlocked.scenarios.map((d) => d.id)).toEqual(['lucky-strike']);
    expect(win.unlocked.objects).toEqual(['roulette-table', 'keno-lounge', 'marquee']);
    expect(isScenarioUnlocked(getCampaign('lucky-strike')!, win.progress)).toBe(true);
    expect(isScenarioUnlocked(getCampaign('neon-nights')!, win.progress)).toBe(false);
  });

  it('locks objects until their scenario is won, except where a scenario names them', () => {
    const fresh = lockedObjects(freshProgress());
    expect(fresh.get('roulette-table')).toBe('Win The Dusty Dime to unlock.');
    expect(fresh.has('slot-machine')).toBe(false);
    const won = recordWin(freshProgress(), 'dusty-dime', { medal: 'bronze', score: 1, day: 12 });
    expect(lockedObjects(won.progress).has('roulette-table')).toBe(false);
    // House Rules lists pachinko and bingo by name: they are its content.
    const houseRules = getCampaign('house-rules')!;
    expect(locksFor(houseRules, freshProgress()).has('pachinko')).toBe(false);
    expect(locksFor(undefined, freshProgress()).has('pachinko')).toBe(true);
  });
});
