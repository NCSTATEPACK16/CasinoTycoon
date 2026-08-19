import type { SupabaseClient } from '@supabase/supabase-js';
import type { CasinoWorldJSON } from '../sim/world';
import {
  SAVE_VERSION,
  slotInfo,
  type SaveEnvelope,
  type SaveService,
  type SlotInfo,
} from './SaveService';
import { acceptEnvelope } from './migrations';

// Raw cloud CRUD against the `saves` table. Depends on a narrow
// SaveTableClient rather than the whole SupabaseClient type, so tests use a
// small fake instead of mocking the entire SDK.

export interface SaveRow {
  user_id: string;
  slot: string;
  payload: SaveEnvelope;
  updated_at: string;
}

export interface SaveTableClient {
  upsertSave(userId: string, slot: string, payload: SaveEnvelope): Promise<void>;
  selectSave(userId: string, slot: string): Promise<SaveRow | null>;
  deleteSave(userId: string, slot: string): Promise<void>;
  listSaves(userId: string): Promise<SaveRow[]>;
}

/** Adapts a real supabase-js client to the narrow seam above. */
export function makeSaveTableClient(client: SupabaseClient): SaveTableClient {
  return {
    async upsertSave(userId, slot, payload) {
      const { error } = await client
        .from('saves')
        .upsert({ user_id: userId, slot, payload, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    async selectSave(userId, slot) {
      const { data, error } = await client
        .from('saves')
        .select('user_id, slot, payload, updated_at')
        .eq('user_id', userId)
        .eq('slot', slot)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as SaveRow | null) ?? null;
    },
    async deleteSave(userId, slot) {
      const { error } = await client.from('saves').delete().eq('user_id', userId).eq('slot', slot);
      if (error) throw new Error(error.message);
    },
    async listSaves(userId) {
      const { data, error } = await client
        .from('saves')
        .select('user_id, slot, payload, updated_at')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data as SaveRow[] | null) ?? [];
    },
  };
}

export class SupabaseSaveService implements SaveService {
  constructor(
    private db: SaveTableClient,
    private userId: string,
  ) {}

  async save(slot: string, world: CasinoWorldJSON): Promise<void> {
    const env: SaveEnvelope = { version: SAVE_VERSION, savedAt: new Date().toISOString(), world };
    await this.db.upsertSave(this.userId, slot, env);
  }

  async load(slot: string): Promise<CasinoWorldJSON | null> {
    const row = await this.db.selectSave(this.userId, slot);
    if (!row) return null;
    return acceptEnvelope(row.payload).world;
  }

  async delete(slot: string): Promise<void> {
    await this.db.deleteSave(this.userId, slot);
  }

  async list(): Promise<SlotInfo[]> {
    const rows = await this.db.listSaves(this.userId);
    const infos: SlotInfo[] = [];
    for (const row of rows) {
      const res = acceptEnvelope(row.payload);
      if (res.status === 'unreadable') continue;
      infos.push(slotInfo(row.slot, res));
    }
    return infos;
  }
}
