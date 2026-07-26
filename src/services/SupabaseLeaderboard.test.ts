import { describe, expect, it } from 'vitest';
import {
  embeddedName,
  SupabaseLeaderboard,
  type BoardClient,
  type BoardRow,
} from './SupabaseLeaderboard';
import { LocalLeaderboard } from './LeaderboardService';
import type { KVStore } from './SaveService';

class FakeStore implements KVStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

class FakeBoard implements BoardClient {
  wins: { campaignId: string; profit: number; day: number; score: number }[] = [];
  rows: BoardRow[] = [];
  async recordWin(campaignId: string, profit: number, day: number, score: number) {
    this.wins.push({ campaignId, profit, day, score });
  }
  async topRows(_campaignId: string, limit: number) {
    return this.rows.slice(0, limit);
  }
}

describe('SupabaseLeaderboard', () => {
  it('records to both the cloud RPC and the local delegate', async () => {
    const board = new FakeBoard();
    const local = new LocalLeaderboard(new FakeStore());
    const svc = new SupabaseLeaderboard(board, local);

    await svc.record({ campaignId: 'dusty-dime', dailyProfit: 500, day: 7, score: 88 });

    expect(board.wins).toEqual([{ campaignId: 'dusty-dime', profit: 500, day: 7, score: 88 }]);
    expect((await local.getBest('dusty-dime'))?.score).toBe(88);
  });

  it('still records locally when the cloud RPC fails', async () => {
    const board = new FakeBoard();
    board.recordWin = () => Promise.reject(new Error('offline'));
    const local = new LocalLeaderboard(new FakeStore());
    const svc = new SupabaseLeaderboard(board, local);

    await svc.record({ campaignId: 'dusty-dime', dailyProfit: 500, day: 7, score: 88 });
    expect((await local.getBest('dusty-dime'))?.score).toBe(88);
  });

  it('ranks getTop rows from 1 and fills a blank name for an orphaned row', async () => {
    const board = new FakeBoard();
    board.rows = [
      { display_name: 'Rita', score: 90, best_daily_profit: 900, completed_in_days: 5 },
      { display_name: null, score: 80, best_daily_profit: 800, completed_in_days: 6 },
    ];
    const svc = new SupabaseLeaderboard(board, new LocalLeaderboard(new FakeStore()));

    const top = await svc.getTop('dusty-dime', 10);
    expect(top).toEqual([
      { rank: 1, displayName: 'Rita', score: 90, bestDailyProfit: 900, completedInDays: 5 },
      { rank: 2, displayName: '', score: 80, bestDailyProfit: 800, completedInDays: 6 },
    ]);
  });

  it('returns an empty board rather than throwing when the read fails', async () => {
    const board = new FakeBoard();
    board.topRows = () => Promise.reject(new Error('offline'));
    const svc = new SupabaseLeaderboard(board, new LocalLeaderboard(new FakeStore()));
    expect(await svc.getTop('dusty-dime', 10)).toEqual([]);
  });

  it('delegates personal bests to the local store, which stays authoritative', async () => {
    const local = new LocalLeaderboard(new FakeStore());
    const svc = new SupabaseLeaderboard(new FakeBoard(), local);
    await svc.record({ campaignId: 'dusty-dime', dailyProfit: 500, day: 7, score: 88 });

    expect((await svc.getBest('dusty-dime'))?.bestDailyProfit).toBe(500);
    expect(await svc.getAll()).toHaveLength(1);
  });
});

describe('embeddedName', () => {
  // supabase-js types the profiles embed as an array; PostgREST sends an
  // object for a to-one foreign key. Both are handled so the board renders
  // names either way.
  it('reads the name from an object embed, an array embed, or neither', () => {
    expect(embeddedName({ display_name: 'Rita' })).toBe('Rita');
    expect(embeddedName([{ display_name: 'Rita' }])).toBe('Rita');
    expect(embeddedName([])).toBeNull();
    expect(embeddedName(null)).toBeNull();
  });
});

describe('LocalLeaderboard.getTop', () => {
  it('returns your own entry alone, labelled You', async () => {
    const local = new LocalLeaderboard(new FakeStore());
    await local.record({ campaignId: 'dusty-dime', dailyProfit: 500, day: 7, score: 88 });
    expect(await local.getTop('dusty-dime', 10)).toEqual([
      { rank: 1, displayName: 'You', score: 88, bestDailyProfit: 500, completedInDays: 7 },
    ]);
  });

  it('returns an empty board for a campaign never won', async () => {
    const local = new LocalLeaderboard(new FakeStore());
    expect(await local.getTop('never-played', 10)).toEqual([]);
  });
});
