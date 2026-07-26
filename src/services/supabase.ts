import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The ONLY module that reads Supabase env vars. Everything else asks
// getSupabase() and handles null — cloud features are optional at every
// level, so a clone with no .env still plays the full game.

export interface CloudConfig {
  url: string;
  key: string;
}

/** Pure so it can be tested without touching import.meta.env. */
export function isCloudConfigured(cfg: CloudConfig): boolean {
  return cfg.url.length > 0 && cfg.key.length > 0;
}

const config: CloudConfig = {
  url: import.meta.env.VITE_SUPABASE_URL ?? '',
  key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
};

export const CLOUD_ENABLED = isCloudConfigured(config);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!CLOUD_ENABLED) return null;
  client ??= createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // magic-link return lands in the URL hash
    },
  });
  return client;
}

/** Test seam — drops the memoized client so a suite can re-create it. */
export function resetSupabaseForTest(): void {
  client = null;
}
