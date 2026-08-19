import { eventBus } from '../EventBus';
import { CLOUD_ENABLED, getSupabase } from './supabase';
import { LocalSaveService, MANUAL_SLOTS, setSaveBackend, type SaveService } from './SaveService';
import { hashPayload, planReconcile, type ReconcilePlan, type SlotSnapshot } from './reconcile';
import { LocalLeaderboard, setLeaderboardBackend } from './LeaderboardService';
import { SyncedSaveService } from './SyncedSaveService';
import { makeSaveTableClient, SupabaseSaveService } from './SupabaseSaveService';
import { makeBoardClient, SupabaseLeaderboard } from './SupabaseLeaderboard';
import { validateDisplayName } from './nameFilter';

export interface AuthState {
  status: 'signed-out' | 'signed-in' | 'needs-name';
  userId: string | null;
  displayName: string | null;
}

/** Pure state derivation, so the three-way status is testable on its own. */
export function reduceAuthState(userId: string | null, displayName: string | null): AuthState {
  if (!userId) return { status: 'signed-out', userId: null, displayName: null };
  if (!displayName) return { status: 'needs-name', userId, displayName: null };
  return { status: 'signed-in', userId, displayName };
}

let state: AuthState = { status: 'signed-out', userId: null, displayName: null };
const listeners = new Set<(s: AuthState) => void>();

export function getAuthState(): AuthState {
  return state;
}

export function onAuthChange(fn: (s: AuthState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Installs the right save/leaderboard backends for a given auth state. */
export function applyBackends(next: AuthState): void {
  const client = getSupabase();
  if (next.status !== 'signed-in' || !client || !next.userId) {
    setSaveBackend(new LocalSaveService());
    setLeaderboardBackend(new LocalLeaderboard());
    return;
  }
  const cloud = new SupabaseSaveService(makeSaveTableClient(client), next.userId);
  setSaveBackend(
    new SyncedSaveService(new LocalSaveService(), cloud, (op) => {
      if (op === 'save') {
        eventBus.emit('tickerMessage', { text: 'Saved locally — cloud sync failed.', severity: 'warn' });
      }
    }),
  );
  setLeaderboardBackend(new SupabaseLeaderboard(makeBoardClient(client), new LocalLeaderboard()));
}

function setState(next: AuthState): void {
  state = next;
  applyBackends(next);
  for (const fn of listeners) fn(next);
}

async function fetchDisplayName(userId: string): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data } = await client
    .from('profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { display_name: string } | null)?.display_name ?? null;
}

export function initAuth(): void {
  const client = getSupabase();
  if (!CLOUD_ENABLED || !client) return; // offline build: stay signed out forever
  client.auth.onAuthStateChange((_event, session) => {
    const userId = session?.user.id ?? null;
    if (!userId) {
      setState(reduceAuthState(null, null));
      return;
    }
    void fetchDisplayName(userId).then((name) => setState(reduceAuthState(userId, name)));
  });
}

export async function signInWithEmail(email: string): Promise<void> {
  const client = getSupabase();
  if (!client) throw new Error('Cloud features are not configured.');
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  await getSupabase()?.auth.signOut();
}

export async function claimDisplayName(
  name: string,
): Promise<'ok' | 'taken' | 'blocked' | 'error'> {
  const client = getSupabase();
  const userId = state.userId;
  if (!client || !userId) return 'error';
  // Client-side check is a courtesy for the error message; the DB trigger is
  // the real gate, so an empty local list here is not a security hole.
  if (validateDisplayName(name, []) === 'bad-chars') return 'error';

  const { error } = await client
    .from('profiles')
    .upsert({ user_id: userId, display_name: name.trim() });
  if (!error) {
    setState(reduceAuthState(userId, name.trim()));
    return 'ok';
  }
  if (error.message.includes('display_name_blocked')) return 'blocked';
  if (error.code === '23505') return 'taken'; // unique index on lower(display_name)
  return 'error';
}

/** Gathers both sides into the shape planReconcile wants. Pure I/O, no logic. */
async function snapshotsOf(svc: SaveService): Promise<SlotSnapshot[]> {
  const infos = await svc.list();
  const snaps: SlotSnapshot[] = [];
  for (const info of infos) {
    if (!(MANUAL_SLOTS as readonly string[]).includes(info.slot)) continue;
    const world = await svc.load(info.slot);
    if (!world) continue;
    snaps.push({
      slot: info.slot,
      savedAt: info.savedAt,
      day: info.day,
      cash: info.cash,
      hash: hashPayload(JSON.stringify(world)),
    });
  }
  return snaps;
}

/**
 * Runs once on first sign-in for a device. Uploads/pulls the unambiguous
 * slots immediately and returns any conflicts for the UI to resolve.
 * Non-destructive: a throw anywhere leaves local untouched.
 */
export async function reconcileSaves(
  local: SaveService,
  cloud: SaveService,
): Promise<ReconcilePlan> {
  const [localSnaps, cloudSnaps] = await Promise.all([snapshotsOf(local), snapshotsOf(cloud)]);
  const plan = planReconcile(localSnaps, cloudSnaps);

  for (const slot of plan.uploads) {
    const world = await local.load(slot);
    if (world) await cloud.save(slot, world);
  }
  for (const slot of plan.pulls) {
    const world = await cloud.load(slot);
    if (world) await local.save(slot, world);
  }
  return plan; // conflicts left for the caller to resolve
}

/**
 * The (local, cloud) pair for the signed-in user, so callers never have to
 * build a SupabaseSaveService themselves. Null whenever cloud sync does not
 * apply — signed out, no name claimed yet, or no client configured.
 */
function cloudPair(): { local: SaveService; cloud: SaveService } | null {
  const client = getSupabase();
  if (state.status !== 'signed-in' || !client || !state.userId) return null;
  return {
    local: new LocalSaveService(),
    cloud: new SupabaseSaveService(makeSaveTableClient(client), state.userId),
  };
}

// Once per user per page session. Re-running is harmless (identical hashes
// produce an empty plan) but it re-downloads every slot, and the sign-in
// listener can fire more than once per session — on token refresh, for one.
const reconciled = new Set<string>();

/**
 * Reconciles this device's manual slots against the account's on sign-in.
 * Returns null when there is nothing to do; conflicts come back for the UI
 * to resolve. A failure un-marks the user so a later attempt can retry.
 */
export async function reconcileForCurrentUser(): Promise<ReconcilePlan | null> {
  const pair = cloudPair();
  const userId = state.userId;
  if (!pair || !userId || reconciled.has(userId)) return null;
  reconciled.add(userId);
  try {
    return await reconcileSaves(pair.local, pair.cloud);
  } catch {
    reconciled.delete(userId);
    return null;
  }
}

/** Applies conflict-dialog choices against the current user's slot pair. */
export async function resolveConflictsForCurrentUser(
  choices: Record<string, 'local' | 'cloud'>,
): Promise<void> {
  const pair = cloudPair();
  if (pair) await resolveConflicts(pair.local, pair.cloud, choices);
}

/** Applies the player's per-slot choices from the conflict dialog. */
export async function resolveConflicts(
  local: SaveService,
  cloud: SaveService,
  choices: Record<string, 'local' | 'cloud'>,
): Promise<void> {
  for (const [slot, side] of Object.entries(choices)) {
    if (side === 'local') {
      const world = await local.load(slot);
      if (world) await cloud.save(slot, world);
    } else {
      const world = await cloud.load(slot);
      if (world) await local.save(slot, world);
    }
  }
}
