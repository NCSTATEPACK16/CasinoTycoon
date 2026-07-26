import { describe, expect, it } from 'vitest';
import { reconcileSaves, reduceAuthState, resolveConflicts } from './auth';
import { LocalSaveService, type KVStore } from './SaveService';
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

describe('reduceAuthState', () => {
  it('is signed-out with no session', () => {
    expect(reduceAuthState(null, null)).toEqual({
      status: 'signed-out',
      userId: null,
      displayName: null,
    });
  });

  it('needs a name when a session exists but no profile does', () => {
    expect(reduceAuthState('user-1', null)).toEqual({
      status: 'needs-name',
      userId: 'user-1',
      displayName: null,
    });
  });

  it('is signed-in once both exist', () => {
    expect(reduceAuthState('user-1', 'Rita')).toEqual({
      status: 'signed-in',
      userId: 'user-1',
      displayName: 'Rita',
    });
  });
});

// The seed is not part of a world snapshot, so two fresh worlds serialize
// identically no matter their seeds. Payloads that must differ are given a
// distinct cash value — the same trick SyncedSaveService.test.ts uses.
const differing = (cash: number) => {
  const world = new CasinoWorld({ seed: 1 }).toJSON();
  world.state.cash = cash;
  return world;
};

describe('reconcileSaves', () => {
  it('uploads a local-only slot and pulls a cloud-only slot', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    const a = differing(1000);
    const b = differing(2000);
    await local.save('slot-1', a);
    await cloud.save('slot-2', b);

    const plan = await reconcileSaves(local, cloud);

    expect(plan.conflicts).toEqual([]);
    expect(await cloud.load('slot-1')).toEqual(a);
    expect(await local.load('slot-2')).toEqual(b);
  });

  it('reports a conflict without changing either side', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    const a = differing(1000);
    const b = differing(2000);
    await local.save('slot-1', a);
    await cloud.save('slot-1', b);

    const plan = await reconcileSaves(local, cloud);

    expect(plan.conflicts).toHaveLength(1);
    expect(await local.load('slot-1')).toEqual(a);
    expect(await cloud.load('slot-1')).toEqual(b);
  });

  it('applies the player choice per slot', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    const a = differing(1000);
    const b = differing(2000);
    await local.save('slot-1', a);
    await cloud.save('slot-1', b);

    await resolveConflicts(local, cloud, { 'slot-1': 'cloud' });
    expect(await local.load('slot-1')).toEqual(b);
  });

  it('leaves the autosave slot out of the sync entirely', async () => {
    const local = new LocalSaveService(new FakeStore());
    const cloud = new LocalSaveService(new FakeStore());
    await local.save('autosave', new CasinoWorld({ seed: 1 }).toJSON());

    const plan = await reconcileSaves(local, cloud);

    expect(plan).toEqual({ uploads: [], pulls: [], conflicts: [] });
    expect(await cloud.load('autosave')).toBeNull();
  });
});
