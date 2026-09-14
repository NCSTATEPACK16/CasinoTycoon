import type { KVStore } from './SaveService';

// Local, cross-run progress: which campaigns have been completed and which
// objects that has unlocked. Deliberately separate from the world save (its
// own key, its own version) — completion is cross-run, saves are per-run,
// and coupling them would force a SAVE_VERSION bump every time progression
// changes. See docs/superpowers/specs/2026-08-22-progression-catalog-highrollers-design.md, Part A2.

const STORAGE_KEY = 'casino-progress';
const PROGRESS_VERSION = 1;

export interface CampaignResult {
  completedInDays: number;
  bestDailyProfit: number;
  score: number;
  at: string; // ISO
  /** Did the player continue past the win (endless mode), rather than stop. */
  continued: boolean;
}

export interface Progress {
  version: 1;
  completed: Record<string, CampaignResult>;
  /** Objects permanently unlocked by play, independent of any one campaign. */
  unlocked: string[];
}

function emptyProgress(): Progress {
  return { version: PROGRESS_VERSION, completed: {}, unlocked: [] };
}

function isCampaignResult(v: unknown): v is CampaignResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.completedInDays === 'number' &&
    typeof r.bestDailyProfit === 'number' &&
    typeof r.score === 'number' &&
    typeof r.at === 'string' &&
    typeof r.continued === 'boolean'
  );
}

function isProgress(v: unknown): v is Progress {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  if (p.version !== PROGRESS_VERSION) return false;
  if (!p.completed || typeof p.completed !== 'object') return false;
  if (!Array.isArray(p.unlocked) || !p.unlocked.every((id) => typeof id === 'string')) return false;
  return Object.values(p.completed as Record<string, unknown>).every(isCampaignResult);
}

/**
 * Tolerates absent, corrupt, and wrong-version data by returning an empty
 * Progress — never throws, never wipes anything (there is nothing to wipe;
 * this only reads). Same discipline as migrations.ts's acceptEnvelope.
 */
export function loadProgress(store: KVStore = globalThis.localStorage): Progress {
  // `store` can be undefined where there is no localStorage at all — the Vitest
  // node environment, an SSR pass — and the contract above says this never
  // throws. Reading through an optional chain makes that literally true rather
  // than true-by-not-being-called-yet.
  const raw = store?.getItem(STORAGE_KEY);
  if (!raw) return emptyProgress();
  try {
    const parsed: unknown = JSON.parse(raw);
    return isProgress(parsed) ? parsed : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

/**
 * Writes progress, and swallows a storage failure rather than propagating it.
 *
 * recordCampaignCompletion is called synchronously from main.ts's `goalReached`
 * handler, so an exception here would take the victory flow down with it —
 * losing the end card and the leaderboard write over a failed bookkeeping
 * entry. setItem genuinely does throw in the wild: quota exhaustion, and Safari
 * private browsing. Losing a completion record is a small, recoverable harm;
 * losing the win is not. Returns whether the write landed, so a caller that
 * cares can tell.
 */
export function saveProgress(progress: Progress, store: KVStore = globalThis.localStorage): boolean {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/** Reads, merges in one campaign's result (overwriting any prior result for
 *  the same id — a completion is replaced, not stacked), writes, and returns
 *  the new Progress. */
export function recordCampaignCompletion(
  campaignId: string,
  result: CampaignResult,
  store: KVStore = globalThis.localStorage,
): Progress {
  const progress = loadProgress(store);
  const next: Progress = {
    ...progress,
    completed: { ...progress.completed, [campaignId]: result },
  };
  saveProgress(next, store);
  return next;
}

/** Flips `continued` on an already-recorded completion. No-op — including no
 *  write — if the campaign was never recorded as completed. */
export function markContinued(campaignId: string, store: KVStore = globalThis.localStorage): Progress {
  const progress = loadProgress(store);
  const existing = progress.completed[campaignId];
  if (!existing) return progress;
  return recordCampaignCompletion(campaignId, { ...existing, continued: true }, store);
}

/** Pure — the single controlled read path for unlocked object ids, so
 *  callers never reach into progress.unlocked directly. */
export function unlockedObjectIds(progress: Progress): string[] {
  // A copy: this is documented as the controlled read path, and returning the
  // live array would let any caller mutate stored progress through it.
  return [...progress.unlocked];
}
