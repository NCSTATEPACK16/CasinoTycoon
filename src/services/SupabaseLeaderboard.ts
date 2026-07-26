import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeaderboardEntry, LeaderboardRow, LeaderboardService } from './LeaderboardService';

// Cloud leaderboard. Personal bests (getBest/getAll) stay local by design —
// only getTop and record's cloud half are new behavior, so this class keeps a
// local delegate rather than reimplementing them.

export interface BoardRow {
  display_name: string | null;
  score: number;
  best_daily_profit: number;
  completed_in_days: number;
}

export interface BoardClient {
  recordWin(campaignId: string, profit: number, day: number, score: number): Promise<void>;
  topRows(campaignId: string, limit: number): Promise<BoardRow[]>;
}

/** What the `profiles(display_name)` embed can look like on the wire. */
type Embedded = { display_name: string } | { display_name: string }[] | null;

export interface JoinedBoardRow extends Omit<BoardRow, 'display_name'> {
  profiles: Embedded;
}

/**
 * Pulls the name out of a PostgREST embed regardless of cardinality. Exported
 * for its own test: whether this embed arrives as an object or a one-element
 * array is a PostgREST detail worth being immune to rather than betting on.
 */
export function embeddedName(profiles: Embedded): string | null {
  if (!profiles) return null;
  if (Array.isArray(profiles)) return profiles[0]?.display_name ?? null;
  return profiles.display_name;
}

export function makeBoardClient(client: SupabaseClient): BoardClient {
  return {
    async recordWin(campaignId, profit, day, score) {
      const { error } = await client.rpc('record_win', {
        p_campaign: campaignId,
        p_profit: profit,
        p_day: day,
        p_score: score,
      });
      if (error) throw new Error(error.message);
    },
    async topRows(campaignId, limit) {
      // The embed resolves through leaderboard.user_id -> profiles.user_id;
      // PostgREST needs that foreign key to exist, which is why the schema
      // points it at profiles rather than auth.users.
      // LEFT join: posting is gated on a profile existing, so an orphan row
      // is impossible through the app — but manual DB surgery should degrade
      // to a blank name, not drop the row off the board.
      const { data, error } = await client
        .from('leaderboard')
        .select('score, best_daily_profit, completed_in_days, profiles(display_name)')
        .eq('campaign_id', campaignId)
        .order('score', { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      // A forward foreign-key embed is to-one, so PostgREST sends `profiles`
      // as an object — but supabase-js cannot infer cardinality without
      // generated database types and declares it an array. embeddedName()
      // accepts either, so this cannot break on whichever shape arrives.
      return (((data ?? []) as unknown) as JoinedBoardRow[]).map((r) => ({
        display_name: embeddedName(r.profiles),
        score: r.score,
        best_daily_profit: r.best_daily_profit,
        completed_in_days: r.completed_in_days,
      }));
    },
  };
}

export class SupabaseLeaderboard implements LeaderboardService {
  constructor(
    private db: BoardClient,
    private local: LeaderboardService,
  ) {}

  async record(win: {
    campaignId: string;
    dailyProfit: number;
    day: number;
    score: number;
  }): Promise<void> {
    // Local always records — a cloud failure must not cost the personal best.
    await this.local.record(win);
    try {
      await this.db.recordWin(win.campaignId, win.dailyProfit, win.day, win.score);
    } catch {
      /* offline: the local record above still stands */
    }
  }

  getBest(campaignId: string): Promise<LeaderboardEntry | null> {
    return this.local.getBest(campaignId);
  }

  getAll(): Promise<LeaderboardEntry[]> {
    return this.local.getAll();
  }

  async getTop(campaignId: string, limit: number): Promise<LeaderboardRow[]> {
    let rows: BoardRow[];
    try {
      rows = await this.db.topRows(campaignId, limit);
    } catch {
      return []; // an unreachable board renders empty, never throws into the UI
    }
    return rows.map((r, i) => ({
      rank: i + 1,
      displayName: r.display_name ?? '',
      score: r.score,
      bestDailyProfit: r.best_daily_profit,
      completedInDays: r.completed_in_days,
    }));
  }
}
