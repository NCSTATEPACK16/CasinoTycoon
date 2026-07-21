import type { KVStore } from './SaveService';

// Per-campaign bests. Async interface so the P12 SupabaseLeaderboard drops in.
// `score` holds P11's composite campaign score (profit-vs-goal x day-efficiency
// x rating, see src/data/score.ts); P12 ranks by it.

const STORE_KEY = 'casino-leaderboard-v1';

export interface LeaderboardEntry {
  campaignId: string;
  bestDailyProfit: number;
  completedInDays: number;
  score: number | null;
}

export interface LeaderboardService {
  record(win: { campaignId: string; dailyProfit: number; day: number; score: number }): Promise<void>;
  getBest(campaignId: string): Promise<LeaderboardEntry | null>;
  getAll(): Promise<LeaderboardEntry[]>;
}

export class LocalLeaderboard implements LeaderboardService {
  constructor(private store: KVStore = globalThis.localStorage) {}

  async record(win: { campaignId: string; dailyProfit: number; day: number; score: number }): Promise<void> {
    const entries = this.readAll();
    const prev = entries[win.campaignId];
    entries[win.campaignId] = {
      campaignId: win.campaignId,
      bestDailyProfit: Math.max(prev?.bestDailyProfit ?? -Infinity, win.dailyProfit),
      completedInDays: Math.min(prev?.completedInDays ?? Infinity, win.day),
      score: Math.max(prev?.score ?? -Infinity, win.score),
    };
    this.store.setItem(STORE_KEY, JSON.stringify({ entries }));
  }

  async getBest(campaignId: string): Promise<LeaderboardEntry | null> {
    return this.readAll()[campaignId] ?? null;
  }

  async getAll(): Promise<LeaderboardEntry[]> {
    return Object.values(this.readAll());
  }

  private readAll(): Record<string, LeaderboardEntry> {
    const raw = this.store.getItem(STORE_KEY);
    if (!raw) return {};
    try {
      return (JSON.parse(raw) as { entries: Record<string, LeaderboardEntry> }).entries ?? {};
    } catch {
      return {};
    }
  }
}

export const leaderboard: LeaderboardService = new LocalLeaderboard();
