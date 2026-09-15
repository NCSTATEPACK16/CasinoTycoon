import { describe, expect, it } from 'vitest';
import {
  loadProgress,
  saveProgress,
  recordCampaignCompletion,
  markContinued,
  unlockedObjectIds,
  type Progress,
  type CampaignResult,
} from './progress';
import type { KVStore } from './SaveService';

/** Map-backed fake store — same seam SaveService.test.ts uses, no jsdom needed. */
function fakeStore(): KVStore {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const RESULT: CampaignResult = {
  completedInDays: 7,
  bestDailyProfit: 1250,
  score: 812,
  at: '2026-08-22T00:00:00.000Z',
  continued: false,
};

describe('loadProgress', () => {
  it('returns empty progress when nothing has been saved', () => {
    expect(loadProgress(fakeStore())).toEqual({ version: 1, completed: {}, unlocked: [] });
  });

  it('returns empty progress on corrupt JSON, never throws', () => {
    const store = fakeStore();
    store.setItem('casino-progress', '{not json');
    expect(() => loadProgress(store)).not.toThrow();
    expect(loadProgress(store)).toEqual({ version: 1, completed: {}, unlocked: [] });
  });

  it('returns empty progress on a shape that is valid JSON but not Progress', () => {
    const store = fakeStore();
    store.setItem('casino-progress', JSON.stringify({ hello: 'world' }));
    expect(loadProgress(store)).toEqual({ version: 1, completed: {}, unlocked: [] });
  });

  it('returns empty progress on a future version rather than trying to read it', () => {
    const store = fakeStore();
    store.setItem(
      'casino-progress',
      JSON.stringify({ version: 99, completed: { x: RESULT }, unlocked: ['sky-lounge'] }),
    );
    expect(loadProgress(store)).toEqual({ version: 1, completed: {}, unlocked: [] });
  });

  it('round-trips real progress written by saveProgress', () => {
    const store = fakeStore();
    const progress: Progress = { version: 1, completed: { 'dusty-dime': RESULT }, unlocked: ['plant'] };
    saveProgress(progress, store);
    expect(loadProgress(store)).toEqual(progress);
  });
});

describe('recordCampaignCompletion', () => {
  it('adds a completion to an empty store', () => {
    const store = fakeStore();
    const progress = recordCampaignCompletion('dusty-dime', RESULT, store);
    expect(progress.completed['dusty-dime']).toEqual(RESULT);
    expect(loadProgress(store).completed['dusty-dime']).toEqual(RESULT);
  });

  it('overwrites a prior completion of the same campaign rather than stacking', () => {
    const store = fakeStore();
    recordCampaignCompletion('dusty-dime', RESULT, store);
    const better = { ...RESULT, score: 999 };
    const progress = recordCampaignCompletion('dusty-dime', better, store);
    expect(progress.completed['dusty-dime']).toEqual(better);
  });

  it('leaves other campaigns and the unlocked list untouched', () => {
    const store = fakeStore();
    saveProgress({ version: 1, completed: {}, unlocked: ['plant'] }, store);
    const progress = recordCampaignCompletion('dusty-dime', RESULT, store);
    expect(progress.unlocked).toEqual(['plant']);
  });
});

describe('markContinued', () => {
  it('flips continued to true on an existing completion', () => {
    const store = fakeStore();
    recordCampaignCompletion('dusty-dime', RESULT, store);
    const progress = markContinued('dusty-dime', store);
    expect(progress.completed['dusty-dime']!.continued).toBe(true);
  });

  it('is a no-op if the campaign was never recorded as completed', () => {
    const store = fakeStore();
    const progress = markContinued('never-played', store);
    expect(progress).toEqual({ version: 1, completed: {}, unlocked: [] });
  });
});

describe('unlockedObjectIds', () => {
  it('is a pure passthrough of progress.unlocked', () => {
    const progress: Progress = { version: 1, completed: {}, unlocked: ['plant', 'marquee'] };
    expect(unlockedObjectIds(progress)).toEqual(['plant', 'marquee']);
  });
});
