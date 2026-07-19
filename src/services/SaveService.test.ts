import { describe, expect, it } from 'vitest';
import { AUTOSAVE_SLOT, LocalSaveService, MANUAL_SLOTS, SAVE_VERSION } from './SaveService';
import type { KVStore } from './SaveService';
import { CasinoWorld } from '../sim/world';

class FakeStore implements KVStore {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

const snapshot = () => new CasinoWorld({ seed: 1 }).toJSON();

describe('LocalSaveService', () => {
  it('round-trips a world snapshot through a slot', async () => {
    const svc = new LocalSaveService(new FakeStore());
    const data = snapshot();
    await svc.save('slot-1', data);
    expect(await svc.load('slot-1')).toEqual(data);
  });

  it('returns null for empty, corrupt, and version-mismatched slots', async () => {
    const store = new FakeStore();
    const svc = new LocalSaveService(store);
    expect(await svc.load('slot-1')).toBeNull();
    store.setItem('casino-save-slot-1', '{not json');
    expect(await svc.load('slot-1')).toBeNull();
    store.setItem(
      'casino-save-slot-2',
      JSON.stringify({ version: SAVE_VERSION + 1, savedAt: 'x', world: snapshot() }),
    );
    expect(await svc.load('slot-2')).toBeNull();
  });

  it('delete empties a slot', async () => {
    const svc = new LocalSaveService(new FakeStore());
    await svc.save('slot-1', snapshot());
    await svc.delete('slot-1');
    expect(await svc.load('slot-1')).toBeNull();
  });

  it('list returns metadata for occupied slots only, in fixed slot order', async () => {
    const svc = new LocalSaveService(new FakeStore());
    await svc.save('slot-2', snapshot());
    await svc.save(AUTOSAVE_SLOT, snapshot());
    const infos = await svc.list();
    expect(infos.map((i) => i.slot)).toEqual(['slot-2', AUTOSAVE_SLOT]);
    expect(infos[0]).toMatchObject({ day: 1, cash: 2000, scenarioName: null });
    expect(typeof infos[0]!.savedAt).toBe('string');
    expect(MANUAL_SLOTS).toEqual(['slot-1', 'slot-2', 'slot-3']);
  });
});
