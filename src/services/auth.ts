import { eventBus } from '../EventBus';
import { CLOUD_ENABLED, getSupabase } from './supabase';
import { LocalSaveService, setSaveBackend } from './SaveService';
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
        eventBus.emit('tickerMessage', { text: 'Saved locally — cloud sync failed.' });
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
