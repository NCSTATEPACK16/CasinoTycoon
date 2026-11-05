// B8: what a scenario asks of the player. A scenario lists one or more goals,
// and the run is won at the first midnight close where every one of them is
// met at once. Each goal reads only the facts below, so the rules are pure
// and the same wording drives the title card, the HUD's goal panel and the
// end card.
//
// Two kinds of goal behave differently on purpose:
// - records ("make $X in one day", "hold N guests at once") are kept once
//   reached, because a record is something the casino did;
// - states ("a rating of N", "no debt", an average or a hold band over the
//   last few days) must hold at the close that wins, because they describe
//   what the casino is.

export type Goal =
  /** Mean profit of the last `days` closed days (the P16 rule). */
  | { kind: 'avgProfit'; amount: number; days: number }
  /** One closed day at or above `amount`. A record. */
  | { kind: 'dayProfit'; amount: number }
  /** The rating at the close. */
  | { kind: 'rating'; min: number }
  /** Guests on the floor at once, read at each hour. A record. */
  | { kind: 'guests'; count: number }
  /** The games' pooled hold (win ÷ handle) over the last `days` closed days,
   *  inside [min, max], on at least `minHandle` of play a day on average. */
  | { kind: 'hold'; min: number; max: number; days: number; minHandle: number }
  /** Club members at `tier` or above on the roster (silver = every member). */
  | { kind: 'patrons'; tier: 'silver' | 'gold' | 'black'; count: number }
  /** Games standing on high-limit carpet. */
  | { kind: 'highLimit'; games: number }
  /** No loan outstanding and cash at or above zero at the close. */
  | { kind: 'noDebt' };

/** Everything a goal can be judged on. The scenario keeps the day-by-day
 *  numbers; the world supplies the rest at the close (and live, for the HUD). */
export interface GoalFacts {
  /** Profits of the most recent closed days, oldest first. */
  profits: readonly number[];
  bestDailyProfit: number | null;
  /** The games' handle and win per recent closed day, oldest first. */
  play: readonly { handle: number; win: number }[];
  peakGuests: number;
  rating: number;
  patrons: { silver: number; gold: number; black: number };
  highLimitGames: number;
  debt: number;
  cash: number;
}

export interface GoalProgress {
  /** What is asked, e.g. "Average $1,000 a day over 4 days". */
  text: string;
  /** Where the casino stands, e.g. "$640 over 2 of 4 days". */
  progress: string;
  /** 0–1, for a bar. */
  fraction: number;
  met: boolean;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many recent closed days the scenario must keep for these goals. */
export function windowDays(goals: readonly Goal[]): number {
  let n = 1;
  for (const g of goals) if (g.kind === 'avgProfit' || g.kind === 'hold') n = Math.max(n, g.days);
  return n;
}

export function goalText(g: Goal): string {
  switch (g.kind) {
    case 'avgProfit':
      return `Average ${usd(g.amount)} a day over ${plural(g.days, 'day')}`;
    case 'dayProfit':
      return `Make ${usd(g.amount)} in one day`;
    case 'rating':
      return `Close a day rated ★${g.min} or better`;
    case 'guests':
      return `Have ${g.count} guests on the floor at once`;
    case 'hold':
      return `Hold ${pct(g.min)}–${pct(g.max)} over ${plural(g.days, 'day')} (at least ${usd(g.minHandle)} wagered a day)`;
    case 'patrons':
      return g.tier === 'silver'
        ? `Sign ${plural(g.count, 'club member')}`
        : `Sign ${plural(g.count, `${g.tier === 'gold' ? 'Gold' : 'Black'} club member`)}`;
    case 'highLimit':
      return `Put ${plural(g.games, 'game')} on high-limit carpet`;
    case 'noDebt':
      return 'Close a day with no loans and no overdraft';
  }
}

export function evaluateGoal(g: Goal, f: GoalFacts): GoalProgress {
  const text = goalText(g);
  switch (g.kind) {
    case 'avgProfit': {
      const last = f.profits.slice(-g.days);
      const mean = last.length ? last.reduce((a, b) => a + b, 0) / last.length : 0;
      const full = last.length >= g.days;
      return {
        text,
        progress: last.length
          ? `${usd(mean)} a day over ${last.length} of ${g.days} days`
          : 'No day closed yet',
        // A part-filled window shows only its share, so the bar never says
        // "done" before the days are in.
        fraction: clamp01(mean / g.amount) * (last.length / g.days),
        met: full && mean >= g.amount,
      };
    }
    case 'dayProfit': {
      const best = f.bestDailyProfit ?? 0;
      return {
        text,
        progress: f.bestDailyProfit === null ? 'No day closed yet' : `Best day ${usd(best)}`,
        fraction: clamp01(best / g.amount),
        met: best >= g.amount,
      };
    }
    case 'rating':
      return {
        text,
        progress: `★${Math.round(f.rating)} now`,
        fraction: clamp01(f.rating / g.min),
        met: f.rating >= g.min,
      };
    case 'guests':
      return {
        text,
        progress: `Most at once: ${f.peakGuests}`,
        fraction: clamp01(f.peakGuests / g.count),
        met: f.peakGuests >= g.count,
      };
    case 'hold': {
      const last = f.play.slice(-g.days);
      const handle = last.reduce((a, d) => a + d.handle, 0);
      const win = last.reduce((a, d) => a + d.win, 0);
      const hold = handle > 0 ? win / handle : null;
      const busy = last.length > 0 && handle / last.length >= g.minHandle;
      const inBand = hold !== null && hold >= g.min && hold <= g.max;
      const full = last.length >= g.days;
      const parts = [
        hold === null ? 'No play yet' : `${pct(hold)} over ${last.length} of ${g.days} days`,
      ];
      if (last.length && !busy) parts.push(`${usd(handle / last.length)} wagered a day`);
      return {
        text,
        progress: parts.join(' · '),
        fraction: (inBand && busy ? 1 : hold === null ? 0 : 0.5) * (last.length / g.days),
        met: full && inBand && busy,
      };
    }
    case 'patrons': {
      const have = f.patrons[g.tier];
      return {
        text,
        progress: `${have} of ${g.count}`,
        fraction: clamp01(have / g.count),
        met: have >= g.count,
      };
    }
    case 'highLimit':
      return {
        text,
        progress: `${f.highLimitGames} of ${g.games}`,
        fraction: clamp01(f.highLimitGames / g.games),
        met: f.highLimitGames >= g.games,
      };
    case 'noDebt': {
      const owed = f.debt + Math.max(0, -f.cash);
      return {
        text,
        progress: owed > 0 ? `${usd(owed)} owed` : 'Debt free',
        fraction: owed > 0 ? 0 : 1,
        met: owed <= 0,
      };
    }
  }
}
