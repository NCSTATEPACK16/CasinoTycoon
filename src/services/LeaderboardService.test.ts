import { describe, expect, it } from 'vitest';
import { LocalLeaderboard } from './LeaderboardService';
import type { KVStore } from './SaveService';

class FakeStore implements KVStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('LocalLeaderboard', () => {
  it('records a first win with a null score placeholder', async () => {
    const lb = new LocalLeaderboard(new FakeStore());
    await lb.record({ campaignId: 'dusty-dime', dailyProfit: 383, day: 2 });
    expect(await lb.getBest('dusty-dime')).toEqual({
      campaignId: 'dusty-dime',
      bestDailyProfit: 383,
      completedInDays: 2,
      score: null,
    });
  });

  it('keeps the best of each stat independently across wins', async () => {
    const lb = new LocalLeaderboard(new FakeStore());
    await lb.record({ campaignId: 'dusty-dime', dailyProfit: 383, day: 2 });
    await lb.record({ campaignId: 'dusty-dime', dailyProfit: 900, day: 3 }); // richer but slower
    const best = await lb.getBest('dusty-dime');
    expect(best!.bestDailyProfit).toBe(900); // higher profit kept
    expect(best!.completedInDays).toBe(2); // faster completion kept
  });

  it('getBest returns null for unplayed campaigns; getAll lists every entry', async () => {
    const lb = new LocalLeaderboard(new FakeStore());
    expect(await lb.getBest('neon-nights')).toBeNull();
    await lb.record({ campaignId: 'dusty-dime', dailyProfit: 1, day: 1 });
    await lb.record({ campaignId: 'high-roller', dailyProfit: 2, day: 1 });
    expect((await lb.getAll()).map((e) => e.campaignId).sort()).toEqual([
      'dusty-dime',
      'high-roller',
    ]);
  });

  it('treats corrupt stored JSON as empty instead of throwing', async () => {
    const store = new FakeStore();
    store.setItem('casino-leaderboard-v1', '{not json');
    const lb = new LocalLeaderboard(store);
    expect(await lb.getAll()).toEqual([]);
    expect(await lb.getBest('dusty-dime')).toBeNull();
    await lb.record({ campaignId: 'dusty-dime', dailyProfit: 100, day: 1 }); // overwrites garbage
    expect((await lb.getBest('dusty-dime'))!.bestDailyProfit).toBe(100);
  });
});
