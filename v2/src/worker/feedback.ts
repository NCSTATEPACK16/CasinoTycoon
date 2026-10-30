// B5: the feedback loop. What guests are thinking across the floor, every
// guest for the Guests list, and the mood/traffic heat maps for the overlay.
// Pure functions of the world, like inspect.ts and finance.ts.

import { TICKS_PER_HOUR } from '../config';
import { THOUGHT_EMOJI } from '../data/thoughts';
import type { CasinoWorld } from '../sim/world';

/** Thoughts this recent count; the trend compares its two halves. */
export const THOUGHT_WINDOW_TICKS = 4 * TICKS_PER_HOUR;

export type Sentiment = 'good' | 'bad' | 'neutral';

const GOOD = new Set(['great', 'game-love', 'flush', 'content', 'celebrate']);
const NEUTRAL = new Set(['homeTime', 'waiting-for-players']);

/** What the player can do about a thought. Null where there's nothing to
 *  act on, so the panel never shows a number without a lever. */
const ADVICE: Record<string, string> = {
  bathroom: 'Restrooms are too few or too far: add more near the games.',
  'no-toilet': 'There is no restroom. Build one.',
  hungry: 'Add food stalls near the floor, and check their prices.',
  'no-food': 'There is no food stall. Build one.',
  thirsty: 'Add a bar with a bartender, or hire waitresses for seated players.',
  'no-bar': 'There is no bar. Build one and hire a bartender.',
  'low-cash': 'Guests are running dry: lower table minimums, or comp your regulars.',
  broke: 'Guests are going broke: lower minimums, or comp the losers.',
  awful: 'Unhappy guests: the Rating tab shows what is dragging them down.',
  filthy: 'Messes on the floor: hire janitors.',
  'game-rigged': 'A losing streak on one game: a comp softens it.',
  'too-rich': 'Minimums are too high for these guests: lower them in the game’s rules.',
  ripoff: 'Prices are past the rip-off line: lower them in Prices.',
  raging: 'Guests are storming out broke: lower minimums and comp the losers.',
  drunk: 'Hire security to see drunk guests out.',
  'waiting-for-players': 'Poker needs players: fewer poker tables, or more guests.',
};

export interface ThoughtLine {
  id: string;
  /** The latest wording of this thought (some name their game). */
  text: string;
  glyph: string;
  /** Guests who had it within the window. */
  count: number;
  /** Guests in the newer half of the window minus the older half. */
  trend: number;
  sentiment: Sentiment;
  advice: string | null;
  /** Up to 12 of the guests who had it most recently, for the list's filter. */
  agentIds: number[];
}

export interface ThoughtSummary {
  /** Guests on the floor right now. */
  guests: number;
  windowHours: number;
  /** Most-held first. */
  lines: ThoughtLine[];
}

type Guest = CasinoWorld['guests'] extends Map<string, infer G> ? G : never;

const agentIdOf = (g: Guest) => Number(g.id.replace(/\D+/g, '')) || 0;
const live = (world: CasinoWorld) => [...world.guests.values()].filter((g) => g.state !== 'gone');

export function thoughtSummary(world: CasinoWorld): ThoughtSummary {
  const now = world.tickCount;
  const from = now - THOUGHT_WINDOW_TICKS;
  const mid = now - THOUGHT_WINDOW_TICKS / 2;
  const acc = new Map<
    string,
    { text: string; at: number; older: Set<string>; newer: Set<string>; who: Map<number, number> }
  >();
  const guests = live(world);
  for (const g of guests) {
    for (const t of g.thoughts) {
      if (t.atTick < from) continue;
      let a = acc.get(t.id);
      if (!a) {
        a = { text: t.text, at: t.atTick, older: new Set(), newer: new Set(), who: new Map() };
        acc.set(t.id, a);
      }
      if (t.atTick >= a.at) {
        a.text = t.text;
        a.at = t.atTick;
      }
      (t.atTick >= mid ? a.newer : a.older).add(g.id);
      const id = agentIdOf(g);
      a.who.set(id, Math.max(a.who.get(id) ?? 0, t.atTick));
    }
  }
  const lines: ThoughtLine[] = [...acc].map(([id, a]) => ({
    id,
    text: a.text,
    glyph: THOUGHT_EMOJI[id] ?? '💭',
    count: new Set([...a.older, ...a.newer]).size,
    trend: a.newer.size - a.older.size,
    sentiment: GOOD.has(id) ? 'good' : NEUTRAL.has(id) ? 'neutral' : 'bad',
    advice: ADVICE[id] ?? null,
    agentIds: [...a.who]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
      .map(([agent]) => agent),
  }));
  lines.sort((x, y) => y.count - x.count || x.id.localeCompare(y.id));
  return { guests: guests.length, windowHours: THOUGHT_WINDOW_TICKS / TICKS_PER_HOUR, lines };
}

// ---------- the Guests list ----------

export interface GuestRow {
  agentId: number;
  id: string;
  name: string;
  archetype: string;
  state: string;
  happiness: number;
  wallet: number;
  /** Won (+) or lost (−) at the games this visit, from the guest's side. */
  net: number;
  tier: string | null;
  /** The most pressing need under 40, if any. */
  need: { kind: string; value: number } | null;
  thought: { id: string; glyph: string; text: string } | null;
  /** Thought ids within the summary's window, for its filter. */
  thoughtIds: string[];
  hoursOnFloor: number;
}

const NEEDS = ['energy', 'bladder', 'hunger', 'thirst'] as const;

export function guestList(world: CasinoWorld): GuestRow[] {
  const from = world.tickCount - THOUGHT_WINDOW_TICKS;
  return live(world).map((g) => {
    let need: GuestRow['need'] = null;
    for (const k of NEEDS) {
      const v = g.needs[k];
      if (v < 40 && (!need || v < need.value)) need = { kind: k, value: v };
    }
    const last = g.thoughts[g.thoughts.length - 1];
    return {
      agentId: agentIdOf(g),
      id: g.id,
      name: g.name,
      archetype: g.archetype,
      state: g.state,
      happiness: g.needs.happiness,
      wallet: g.wallet,
      net: g.netResult,
      tier: g.patronTier?.name ?? null,
      need,
      thought: last
        ? { id: last.id, glyph: THOUGHT_EMOJI[last.id] ?? '💭', text: last.text }
        : null,
      thoughtIds: [...new Set(g.thoughts.filter((t) => t.atTick >= from).map((t) => t.id))],
      hoursOnFloor: (world.tickCount - g.arrivedTick) / TICKS_PER_HOUR,
    };
  });
}

// ---------- heat maps ----------

export interface HeatMap {
  kind: 'mood' | 'traffic';
  cols: number;
  rows: number;
  /** Row-major, one per cell: mood 0–100, or traffic 0–1 (1 = as busy as
   *  the busiest tenth of the floor, or busier); −1 where too little has been
   *  seen to say. */
  values: number[];
  /** Mood: the floor's average where seen. Traffic: the busiest tile's count. */
  summary: number | null;
}

/** Traffic is scaled to this percentile of the visited tiles, not to the
 *  busiest one: every guest walks through the door, so the entrance would
 *  otherwise outshine the whole floor and the map would show one corridor. */
const TRAFFIC_SCALE_PERCENTILE = 0.9;
/** Below this share of the scale (or 1.5 visits) a tile is noise. */
const TRAFFIC_CUTOFF = 0.1;

export function heatMap(world: CasinoWorld, kind: 'mood' | 'traffic'): HeatMap {
  const { cols, rows } = world.grid;
  const values = new Array<number>(cols * rows).fill(-1);
  if (kind === 'mood') {
    let sum = 0;
    let n = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const v = world.mood.moodAt(c, r);
        if (v === null) continue;
        values[r * cols + c] = Math.round(v);
        sum += v;
        n++;
      }
    return { kind, cols, rows, values, summary: n ? sum / n : null };
  }
  const raw = new Float64Array(cols * rows);
  const seen: number[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const v = world.traffic.rawAt(c, r);
      raw[r * cols + c] = v;
      if (v >= 1) seen.push(v);
    }
  if (seen.length === 0) return { kind, cols, rows, values, summary: null };
  seen.sort((a, b) => a - b);
  const scale = Math.max(1.5, seen[Math.floor((seen.length - 1) * TRAFFIC_SCALE_PERCENTILE)]!);
  const cutoff = Math.max(1.5, scale * TRAFFIC_CUTOFF);
  for (let i = 0; i < raw.length; i++)
    if (raw[i]! >= cutoff) values[i] = Math.round(Math.min(1, raw[i]! / scale) * 1000) / 1000;
  return { kind, cols, rows, values, summary: world.traffic.busiest };
}
