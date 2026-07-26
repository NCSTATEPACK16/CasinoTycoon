import { MANUAL_SLOTS } from './SaveService';

// Pure classifier for first-sign-in save reconciliation. No I/O: the caller
// gathers both sides, this decides what to do, the caller executes. That
// split is deliberate — this is where data loss would live, so it is the
// part that gets exhaustively tested.

export interface SlotSnapshot {
  slot: string;
  savedAt: string;
  day: number;
  cash: number;
  hash: string;
}

export interface SlotConflict {
  slot: string;
  local: SlotSnapshot;
  cloud: SlotSnapshot;
}

export interface ReconcilePlan {
  uploads: string[];
  pulls: string[];
  conflicts: SlotConflict[];
}

/** FNV-1a. Not cryptographic — only needs to detect "these differ". */
export function hashPayload(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export function planReconcile(local: SlotSnapshot[], cloud: SlotSnapshot[]): ReconcilePlan {
  const byLocal = new Map(local.map((s) => [s.slot, s]));
  const byCloud = new Map(cloud.map((s) => [s.slot, s]));
  const plan: ReconcilePlan = { uploads: [], pulls: [], conflicts: [] };

  // Autosave is excluded by iterating MANUAL_SLOTS rather than the inputs.
  for (const slot of MANUAL_SLOTS) {
    const l = byLocal.get(slot);
    const c = byCloud.get(slot);
    if (l && !c) plan.uploads.push(slot);
    else if (!l && c) plan.pulls.push(slot);
    else if (l && c && l.hash !== c.hash) plan.conflicts.push({ slot, local: l, cloud: c });
    // both absent, or both present and identical: nothing to do
  }
  return plan;
}
