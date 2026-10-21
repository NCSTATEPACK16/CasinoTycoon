import { DEBT } from '../data/balance';
import type { CasinoWorldJSON } from '../sim/world';

// Forward-only save migrations.
//
// Bumping SAVE_VERSION without a matching entry in MIGRATIONS is a bug: an old
// file would be unreadable, and because the reader used to answer "mismatch"
// with null, the player saw an *empty slot* rather than an error. Every schema
// change lands here in the same commit that bumps the version.

export const SAVE_VERSION = 6;

/** Loosely-typed world JSON. Migrations run on shapes older than the current
 *  CasinoWorldJSON, so they cannot be typed against it. */
export type SaveWorld = Record<string, unknown>;

/** One step of the ladder: the shape at version N-1 in, version N out. */
export type Migration = (world: SaveWorld) => SaveWorld;

/**
 * Keyed by the version each step produces. To add version N, write MIGRATIONS[N]
 * assuming the N-1 shape, commit a save-v{N-1}.json fixture, and bump
 * SAVE_VERSION — all together.
 *
 * Migrations must tolerate missing keys, nulls, and empty arrays. Files in the
 * wild are never as well-formed as the ones you wrote the migration against.
 */
export const MIGRATIONS: Record<number, Migration> = {
  // 2 → 3: Track 2's depth spine. A5 gives the world a modifier system and
  // A12 a reputation scalar; both are persistent, so a v2 file needs them
  // defaulted rather than absent. A v2 save has no history of either, so the
  // honest default is a clean slate: no conditions in force, reputation at
  // the neutral start.
  3: (w) => ({
    ...w,
    modifiers: { activeIds: [], drawnForDay: 0 },
    reputation: { value: 50, pendingDelta: 0 },
  }),
  // 3 → 4: Track 4's patron registry. A v3 file has no carded roster and no
  // honest way to invent one — theo was never accumulated per guest across
  // visits before this version — so it starts empty and the player earns it
  // from their next session onward.
  4: (w) => ({
    ...w,
    patrons: { patrons: [], dueToday: [], drawnForDay: 0, nextPatronNum: 1 },
  }),
  // 4 → 5: P16's sustained goal. A v4 file was played under a single-peak-day
  // win rule, so it has no streak and no honest way to infer one — zero is the
  // truthful default. Its embedded CampaignDef also predates the two fields the
  // rule needs, and leaving them absent is not harmless: `streak >= undefined`
  // is always false, so a migrated campaign could never be won. They default to
  // the rule the file was actually played under. Sandbox saves have a null
  // scenario and must pass through untouched rather than growing one.
  5: (w) => {
    if (!w.scenario || typeof w.scenario !== 'object') return w;
    const scenario = w.scenario as Record<string, unknown>;
    const def = (scenario.def ?? {}) as Record<string, unknown>;
    return {
      ...w,
      scenario: {
        ...scenario,
        consecutiveDaysAtGoal: 0,
        def: {
          ...def,
          goalConsecutiveDays: def.goalConsecutiveDays ?? 1,
          creditLimit: def.creditLimit ?? DEBT.defaultCreditLimit,
        },
      },
    };
  },
  // 5 → 6: P16's goal becomes a rolling average rather than a run of
  // qualifying days. A v5 file carries a streak counter, which does not convert
  // — a streak of 2 says two days cleared the goal but not by how much, and the
  // window needs the profits themselves. An empty window is the truthful
  // default: the player re-earns it over the next few days, and cannot lose a
  // run to it, since an unfilled window simply never wins.
  //
  // goalWindowDays takes the old streak length so a file keeps roughly the
  // commitment it was played under. Sandbox saves pass through untouched.
  6: (w) => {
    if (!w.scenario || typeof w.scenario !== 'object') return w;
    const scenario = w.scenario as Record<string, unknown>;
    const def = (scenario.def ?? {}) as Record<string, unknown>;
    const rest = { ...scenario };
    // The streak field goes rather than lingering as dead weight in every
    // future save; recentProfits replaces it outright.
    delete rest.consecutiveDaysAtGoal;
    return {
      ...w,
      scenario: {
        ...rest,
        recentProfits: [],
        def: {
          ...def,
          goalWindowDays: def.goalConsecutiveDays ?? 1,
        },
      },
    };
  },
};

/**
 * Replays every step from `from` to `to`. A v2 file reaching v5 runs 3, then 4,
 * then 5 — so each migration only ever has to understand one delta.
 */
export function migrateWorld(
  world: SaveWorld,
  from: number,
  to: number,
  registry: Record<number, Migration> = MIGRATIONS,
): SaveWorld {
  let out = world;
  for (let v = from + 1; v <= to; v++) {
    const step = registry[v];
    if (!step) throw new Error(`No save migration to version ${v}`);
    out = step(out);
  }
  return out;
}

export type EnvelopeStatus =
  /** Loadable — either current, or migrated up to current. */
  | 'ok'
  /** Written by a newer build. Never silently discard: it is the player's file. */
  | 'newer'
  /** Absent, corrupt, or a migration threw. */
  | 'unreadable';

export interface EnvelopeResult {
  status: EnvelopeStatus;
  savedAt: string | null;
  world: CasinoWorldJSON | null;
}

const UNREADABLE: EnvelopeResult = { status: 'unreadable', savedAt: null, world: null };

/**
 * The single gate both backends read through. Older files migrate forward;
 * newer files are reported rather than dropped, so the UI can say so.
 */
export function acceptEnvelope(
  raw: unknown,
  registry: Record<number, Migration> = MIGRATIONS,
): EnvelopeResult {
  if (!raw || typeof raw !== 'object') return UNREADABLE;
  const env = raw as { version?: unknown; savedAt?: unknown; world?: unknown };
  if (typeof env.version !== 'number' || !env.world || typeof env.world !== 'object') {
    return UNREADABLE;
  }
  const savedAt = typeof env.savedAt === 'string' ? env.savedAt : null;
  if (env.version > SAVE_VERSION) return { status: 'newer', savedAt, world: null };
  if (env.version === SAVE_VERSION) {
    return { status: 'ok', savedAt, world: env.world as CasinoWorldJSON };
  }
  try {
    const world = migrateWorld(env.world as SaveWorld, env.version, SAVE_VERSION, registry);
    return { status: 'ok', savedAt, world: world as unknown as CasinoWorldJSON };
  } catch {
    return UNREADABLE;
  }
}
