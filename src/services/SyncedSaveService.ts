import type { CasinoWorldJSON } from '../sim/world';
import { AUTOSAVE_SLOT, type SaveService, type SlotInfo } from './SaveService';

export type CloudOp = 'save' | 'load' | 'list' | 'delete';

// Composes the local store with a cloud store. Ordering is the whole point:
//   save  -> local FIRST, then cloud  (a network blip must never lose a save)
//   load  -> cloud FIRST, local after (another device must win over stale local)
// Cloud failures are reported through onCloudError and never propagate; the
// local store alone is a fully working save system.

export class SyncedSaveService implements SaveService {
  constructor(
    private local: SaveService,
    private cloud: SaveService,
    private onCloudError: (op: CloudOp) => void = () => {},
  ) {}

  async save(slot: string, world: CasinoWorldJSON): Promise<void> {
    await this.local.save(slot, world);
    if (slot === AUTOSAVE_SLOT) return; // autosave never syncs
    try {
      await this.cloud.save(slot, world);
    } catch {
      this.onCloudError('save');
    }
  }

  async load(slot: string): Promise<CasinoWorldJSON | null> {
    if (slot !== AUTOSAVE_SLOT) {
      try {
        const remote = await this.cloud.load(slot);
        if (remote) {
          // Mirror into the local cache so a later offline load still works.
          await this.local.save(slot, remote);
          return remote;
        }
      } catch {
        this.onCloudError('load');
      }
    }
    return this.local.load(slot);
  }

  async delete(slot: string): Promise<void> {
    await this.local.delete(slot);
    if (slot === AUTOSAVE_SLOT) return;
    try {
      await this.cloud.delete(slot);
    } catch {
      this.onCloudError('delete');
    }
  }

  async list(): Promise<SlotInfo[]> {
    const localInfos = await this.local.list();
    let cloudInfos: SlotInfo[];
    try {
      cloudInfos = await this.cloud.list();
    } catch {
      this.onCloudError('list');
      return localInfos;
    }
    // Cloud wins per slot; local-only slots are kept so nothing disappears.
    const bySlot = new Map(localInfos.map((i) => [i.slot, i]));
    for (const info of cloudInfos) bySlot.set(info.slot, info);
    return [...bySlot.values()];
  }
}
