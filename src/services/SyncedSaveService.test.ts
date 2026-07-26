import { describe, expect, it, vi } from 'vitest';
import { SyncedSaveService } from './SyncedSaveService';
import { LocalSaveService, type KVStore, type SaveService } from './SaveService';
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

const snapshot = () => new CasinoWorld({ seed: 1 }).toJSON();

/** A cloud that always rejects — stands in for an offline device. */
const brokenCloud = (): SaveService => ({
  save: () => Promise.reject(new Error('offline')),
  load: () => Promise.reject(new Error('offline')),
  delete: () => Promise.reject(new Error('offline')),
  list: () => Promise.reject(new Error('offline')),
});

describe('SyncedSaveService', () => {
  it('writes to local even when the cloud write fails', async () => {
    const local = new LocalSaveService(new FakeStore());
    const onCloudError = vi.fn();
    const svc = new SyncedSaveService(local, brokenCloud(), onCloudError);
    const data = snapshot();

    await svc.save('slot-1', data); // must NOT throw

    expect(await local.load('slot-1')).toEqual(data);
    expect(onCloudError).toHaveBeenCalledWith('save');
  });

  it('prefers the cloud on load so another device wins over stale local', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore()); // a second store as "cloud"
    const stale = snapshot();
    const fresh = snapshot();
    fresh.state.cash = 999999;

    await local.save('slot-1', stale);
    await cloud.save('slot-1', fresh);

    const svc = new SyncedSaveService(local, cloud);
    expect((await svc.load('slot-1'))?.state.cash).toBe(999999);
  });

  it('falls back to local when the cloud read fails', async () => {
    const local = new LocalSaveService(new FakeStore());
    const data = snapshot();
    await local.save('slot-1', data);

    const onCloudError = vi.fn();
    const svc = new SyncedSaveService(local, brokenCloud(), onCloudError);
    expect(await svc.load('slot-1')).toEqual(data);
    expect(onCloudError).toHaveBeenCalledWith('load');
  });

  it('mirrors a cloud hit back into the local cache', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    const data = snapshot();
    await cloud.save('slot-2', data);

    const svc = new SyncedSaveService(local, cloud);
    await svc.load('slot-2');
    expect(await local.load('slot-2')).toEqual(data);
  });

  it('unions cloud and local-only slots in list()', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    await local.save('slot-1', snapshot());
    await cloud.save('slot-2', snapshot());

    const svc = new SyncedSaveService(local, cloud);
    const slots = (await svc.list()).map((i) => i.slot).sort();
    expect(slots).toEqual(['slot-1', 'slot-2']);
  });

  it('deletes from both sides', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    await local.save('slot-1', snapshot());
    await cloud.save('slot-1', snapshot());

    const svc = new SyncedSaveService(local, cloud);
    await svc.delete('slot-1');
    expect(await local.load('slot-1')).toBeNull();
    expect(await cloud.load('slot-1')).toBeNull();
  });

  it('never touches the cloud for the autosave slot', async () => {
    const local = new LocalSaveService(new FakeStore());
    const onCloudError = vi.fn();
    const svc = new SyncedSaveService(local, brokenCloud(), onCloudError);
    const data = snapshot();

    await svc.save('autosave', data);
    expect(await svc.load('autosave')).toEqual(data);
    await svc.delete('autosave');

    // A broken cloud that was never consulted reports no errors.
    expect(onCloudError).not.toHaveBeenCalled();
  });
});
