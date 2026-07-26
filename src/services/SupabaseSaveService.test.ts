import { describe, expect, it } from 'vitest';
import { SupabaseSaveService, type SaveRow, type SaveTableClient } from './SupabaseSaveService';
import { SAVE_VERSION, type SaveEnvelope } from './SaveService';
import { CasinoWorld } from '../sim/world';

const snapshot = () => new CasinoWorld({ seed: 1 }).toJSON();

const envelope = (): SaveEnvelope => ({
  version: SAVE_VERSION,
  savedAt: '2026-07-26T00:00:00.000Z',
  world: snapshot(),
});

class FakeTable implements SaveTableClient {
  rows = new Map<string, SaveRow>();
  async upsertSave(userId: string, slot: string, payload: SaveEnvelope) {
    this.rows.set(slot, { user_id: userId, slot, payload, updated_at: payload.savedAt });
  }
  async selectSave(_userId: string, slot: string) {
    return this.rows.get(slot) ?? null;
  }
  async deleteSave(_userId: string, slot: string) {
    this.rows.delete(slot);
  }
  // Param omitted rather than named `_userId`: this repo's ESLint has no
  // underscore ignore pattern, and a trailing unused arg is an error.
  async listSaves() {
    return [...this.rows.values()];
  }
}

describe('SupabaseSaveService', () => {
  it('round-trips a world through a slot', async () => {
    const svc = new SupabaseSaveService(new FakeTable(), 'user-1');
    const data = snapshot();
    await svc.save('slot-1', data);
    expect(await svc.load('slot-1')).toEqual(data);
  });

  it('returns null for an empty slot', async () => {
    const svc = new SupabaseSaveService(new FakeTable(), 'user-1');
    expect(await svc.load('slot-1')).toBeNull();
  });

  it('returns null for a version-mismatched payload rather than throwing', async () => {
    const table = new FakeTable();
    table.rows.set('slot-1', {
      user_id: 'user-1',
      slot: 'slot-1',
      payload: { ...envelope(), version: SAVE_VERSION + 1 },
      updated_at: 'x',
    });
    const svc = new SupabaseSaveService(table, 'user-1');
    expect(await svc.load('slot-1')).toBeNull();
  });

  it('deletes a slot', async () => {
    const table = new FakeTable();
    const svc = new SupabaseSaveService(table, 'user-1');
    await svc.save('slot-1', snapshot());
    await svc.delete('slot-1');
    expect(await svc.load('slot-1')).toBeNull();
  });

  it('lists slots with day, cash and scenario derived from the payload', async () => {
    const svc = new SupabaseSaveService(new FakeTable(), 'user-1');
    await svc.save('slot-2', snapshot());
    const list = await svc.list();
    expect(list).toHaveLength(1);
    const [info] = list;
    expect(info?.slot).toBe('slot-2');
    expect(typeof info?.day).toBe('number');
    expect(typeof info?.cash).toBe('number');
  });
});
