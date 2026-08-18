import type { CasinoWorldJSON } from '../sim/world';
import {
  acceptEnvelope,
  SAVE_VERSION,
  type EnvelopeResult,
  type EnvelopeStatus,
} from './migrations';

// Persistence for full-world snapshots. Interface is async so the P12
// SupabaseSaveService can implement it unchanged; local remains the fallback.

// Re-exported so every existing `from './SaveService'` import keeps working;
// the constant lives with the migration ladder that has to stay in step with it.
export { SAVE_VERSION };
export const MANUAL_SLOTS = ['slot-1', 'slot-2', 'slot-3'] as const;
export const AUTOSAVE_SLOT = 'autosave';
const ALL_SLOTS = [...MANUAL_SLOTS, AUTOSAVE_SLOT];
const keyFor = (slot: string) => `casino-save-${slot}`;

/** Storage seam — localStorage in the browser, a Map-backed fake in tests. */
export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveEnvelope {
  version: number;
  savedAt: string; // ISO timestamp
  world: CasinoWorldJSON;
}

export interface SlotInfo {
  slot: string;
  savedAt: string;
  day: number;
  cash: number;
  scenarioName: string | null;
  /** 'newer' means the file was written by a later build. It is listed but not
   *  loadable — dropping it from the list would look like the save vanished. */
  status?: Extract<EnvelopeStatus, 'newer'>;
}

export interface SaveService {
  save(slot: string, world: CasinoWorldJSON): Promise<void>;
  load(slot: string): Promise<CasinoWorldJSON | null>;
  delete(slot: string): Promise<void>;
  list(): Promise<SlotInfo[]>;
}

/** Shared by both backends so a newer-version file lists identically either way. */
export function slotInfo(slot: string, res: EnvelopeResult): SlotInfo {
  if (res.status === 'newer') {
    return { slot, savedAt: res.savedAt ?? '', day: 0, cash: 0, scenarioName: null, status: 'newer' };
  }
  const world = res.world!;
  return {
    slot,
    savedAt: res.savedAt ?? '',
    day: world.time.day,
    cash: world.state.cash,
    scenarioName: world.scenario?.def.name ?? null,
  };
}

export class LocalSaveService implements SaveService {
  constructor(private store: KVStore = globalThis.localStorage) {}

  async save(slot: string, world: CasinoWorldJSON): Promise<void> {
    const env: SaveEnvelope = { version: SAVE_VERSION, savedAt: new Date().toISOString(), world };
    this.store.setItem(keyFor(slot), JSON.stringify(env));
  }

  async load(slot: string): Promise<CasinoWorldJSON | null> {
    return this.read(slot).world;
  }

  async delete(slot: string): Promise<void> {
    this.store.removeItem(keyFor(slot));
  }

  async list(): Promise<SlotInfo[]> {
    const infos: SlotInfo[] = [];
    for (const slot of ALL_SLOTS) {
      const res = this.read(slot);
      if (res.status === 'unreadable') continue;
      infos.push(slotInfo(slot, res));
    }
    return infos;
  }

  private read(slot: string): EnvelopeResult {
    const raw = this.store.getItem(keyFor(slot));
    if (!raw) return { status: 'unreadable', savedAt: null, world: null };
    try {
      return acceptEnvelope(JSON.parse(raw));
    } catch {
      return { status: 'unreadable', savedAt: null, world: null };
    }
  }
}

// `saveService` is a stable facade, not the implementation. Signing in swaps
// the inner backend; every consumer keeps its existing import and reference,
// including ones that captured it at module-eval time.
let backend: SaveService = new LocalSaveService();

export function setSaveBackend(inner: SaveService): void {
  backend = inner;
}

export function getSaveBackend(): SaveService {
  return backend;
}

export const saveService: SaveService = {
  save: (slot, world) => backend.save(slot, world),
  load: (slot) => backend.load(slot),
  delete: (slot) => backend.delete(slot),
  list: () => backend.list(),
};
