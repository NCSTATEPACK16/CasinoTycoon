import type { CasinoWorldJSON } from '../sim/world';

// Forward-only save migrations.
//
// Bumping SAVE_VERSION without a matching entry in MIGRATIONS is a bug: an old
// file would be unreadable, and because the reader used to answer "mismatch"
// with null, the player saw an *empty slot* rather than an error. Every schema
// change lands here in the same commit that bumps the version.

export const SAVE_VERSION = 4;

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
