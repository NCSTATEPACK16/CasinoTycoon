import { afterEach, describe, expect, it } from 'vitest';
import {
  LocalSaveService,
  saveService,
  setSaveBackend,
  type KVStore,
  type SaveService,
} from './SaveService';
import { CasinoWorld } from '../sim/world';

class FakeStore implements KVStore {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

afterEach(() => setSaveBackend(new LocalSaveService(new FakeStore())));

describe('saveService facade', () => {
  it('routes calls to whichever backend is installed', async () => {
    const a = new LocalSaveService(new FakeStore());
    const b = new LocalSaveService(new FakeStore());
    const data = new CasinoWorld({ seed: 1 }).toJSON();

    setSaveBackend(a);
    await saveService.save('slot-1', data);
    expect(await a.load('slot-1')).toEqual(data);

    // Swap: the same imported reference must now hit the new backend.
    setSaveBackend(b);
    expect(await saveService.load('slot-1')).toBeNull();
    expect(await b.load('slot-1')).toBeNull();
  });

  it('keeps working for a consumer that captured the reference before the swap', async () => {
    const captured: SaveService = saveService; // what a consumer module does at import time
    const b = new LocalSaveService(new FakeStore());
    const data = new CasinoWorld({ seed: 1 }).toJSON();

    setSaveBackend(b);
    await captured.save('slot-1', data);
    expect(await b.load('slot-1')).toEqual(data);
  });
});
