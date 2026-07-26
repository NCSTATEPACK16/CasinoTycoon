import type { CasinoWorldJSON } from '../sim/world';

// Persistence for full-world snapshots. Interface is async so the P12
// SupabaseSaveService can implement it unchanged; local remains the fallback.

export const SAVE_VERSION = 2;
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
}

export interface SaveService {
  save(slot: string, world: CasinoWorldJSON): Promise<void>;
  load(slot: string): Promise<CasinoWorldJSON | null>;
  delete(slot: string): Promise<void>;
  list(): Promise<SlotInfo[]>;
}

export class LocalSaveService implements SaveService {
  constructor(private store: KVStore = globalThis.localStorage) {}

  async save(slot: string, world: CasinoWorldJSON): Promise<void> {
    const env: SaveEnvelope = { version: SAVE_VERSION, savedAt: new Date().toISOString(), world };
    this.store.setItem(keyFor(slot), JSON.stringify(env));
  }

  async load(slot: string): Promise<CasinoWorldJSON | null> {
    return this.read(slot)?.world ?? null;
  }

  async delete(slot: string): Promise<void> {
    this.store.removeItem(keyFor(slot));
  }

  async list(): Promise<SlotInfo[]> {
    const infos: SlotInfo[] = [];
    for (const slot of ALL_SLOTS) {
      const env = this.read(slot);
      if (!env) continue;
      infos.push({
        slot,
        savedAt: env.savedAt,
        day: env.world.time.day,
        cash: env.world.state.cash,
        scenarioName: env.world.scenario?.def.name ?? null,
      });
    }
    return infos;
  }

  private read(slot: string): SaveEnvelope | null {
    const raw = this.store.getItem(keyFor(slot));
    if (!raw) return null;
    try {
      const env = JSON.parse(raw) as SaveEnvelope;
      return env.version === SAVE_VERSION ? env : null;
    } catch {
      return null;
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
