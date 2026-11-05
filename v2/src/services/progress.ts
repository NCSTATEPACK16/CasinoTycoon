// B8: the player's career — best medal and score per scenario — and what that
// unlocks. It lives on the main thread in localStorage under a versioned key,
// separate from saves: deleting a save never takes a medal away. Missing,
// corrupt or future-version progress reads as a fresh player, never a crash.

import { CAREER, getCampaign, type CampaignDef } from '../data/campaigns';
import { getObjectDef } from '../data/objects';
import { MEDAL_RANK, type Medal } from '../data/score';

export const PROGRESS_KEY = 'casino-v2-progress';
export const PROGRESS_VERSION = 1;

export interface ScenarioRecord {
  medal: Medal;
  /** Best score, which may come from a different run than the medal. */
  score: number;
  /** Earliest winning day. */
  day: number;
}

export interface Progress {
  version: typeof PROGRESS_VERSION;
  scenarios: Record<string, ScenarioRecord>;
}

/** The slice of Storage this needs, so tests can hand in a Map. */
export interface ProgressStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const freshProgress = (): Progress => ({ version: PROGRESS_VERSION, scenarios: {} });

function browserStore(): ProgressStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage blocked (private window, site data off)
  }
}

const MEDALS = new Set<string>(['bronze', 'silver', 'gold']);

export function loadProgress(store: ProgressStore | null = browserStore()): Progress {
  try {
    const raw = store?.getItem(PROGRESS_KEY);
    if (!raw) return freshProgress();
    const data = JSON.parse(raw) as Partial<Progress>;
    if (data?.version !== PROGRESS_VERSION || typeof data.scenarios !== 'object' || !data.scenarios)
      return freshProgress();
    const scenarios: Record<string, ScenarioRecord> = {};
    for (const [id, r] of Object.entries(data.scenarios)) {
      // Keep only well-formed records for scenarios that still exist.
      if (!getCampaign(id) || !r || !MEDALS.has(r.medal)) continue;
      scenarios[id] = {
        medal: r.medal,
        score: Number.isFinite(r.score) ? r.score : 0,
        day: Number.isFinite(r.day) ? r.day : 0,
      };
    }
    return { version: PROGRESS_VERSION, scenarios };
  } catch {
    return freshProgress();
  }
}

export function saveProgress(p: Progress, store: ProgressStore | null = browserStore()): void {
  try {
    store?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* full or blocked: the career simply isn't remembered this time */
  }
}

/** What a win newly opened up, for the end card. */
export interface Unlocked {
  scenarios: CampaignDef[];
  objects: string[];
}

/** Fold a win into the career: the best medal, the best score and the
 *  earliest day are each kept. Returns the new progress and what it unlocked. */
export function recordWin(
  p: Progress,
  scenarioId: string,
  result: ScenarioRecord,
): { progress: Progress; unlocked: Unlocked; firstWin: boolean } {
  const before = p.scenarios[scenarioId];
  const merged: ScenarioRecord = before
    ? {
        medal: MEDAL_RANK[result.medal] > MEDAL_RANK[before.medal] ? result.medal : before.medal,
        score: Math.max(before.score, result.score),
        day: Math.min(before.day, result.day),
      }
    : result;
  const progress: Progress = { ...p, scenarios: { ...p.scenarios, [scenarioId]: merged } };
  const unlocked: Unlocked = { scenarios: [], objects: [] };
  if (!before) {
    unlocked.scenarios = CAREER.filter(
      (d) => d.unlockAfter === scenarioId && isScenarioUnlocked(d, progress),
    );
    unlocked.objects = [...(getCampaign(scenarioId)?.unlocks ?? [])];
  }
  return { progress, unlocked, firstWin: !before };
}

export function isScenarioUnlocked(def: CampaignDef, p: Progress): boolean {
  return !def.unlockAfter || !!p.scenarios[def.unlockAfter];
}

/** defId → how to unlock it, for every object still behind a win. */
export function lockedObjects(p: Progress): Map<string, string> {
  const locked = new Map<string, string>();
  for (const def of CAREER) {
    if (p.scenarios[def.id]) continue;
    for (const id of def.unlocks ?? []) locked.set(id, `Win ${def.name} to unlock.`);
  }
  return locked;
}

/** The locks that apply inside one scenario: a scenario always offers what it
 *  lists by name (its own content), whatever the career has unlocked. */
export function locksFor(scenario: CampaignDef | undefined, p: Progress): Map<string, string> {
  const locked = lockedObjects(p);
  for (const id of scenario?.allowedObjects ?? []) locked.delete(id);
  return locked;
}

/** "Roulette Table, Keno Lounge" — for the end card. */
export function objectNames(ids: readonly string[]): string {
  return ids.map((id) => getObjectDef(id)?.name ?? id).join(', ');
}
