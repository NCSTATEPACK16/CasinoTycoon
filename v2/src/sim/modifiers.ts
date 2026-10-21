import { MODIFIERS } from '../data/balance';
import type { ModifierDef } from '../data/balance';
import { eventBus } from '../EventBus';
import type { GuestArchetype } from './entities/Guest';
import type { Rng } from './rng';

export interface ModifierSystemJSON {
  /** Catalog ids, not defs — the catalog is code, and a save that inlined it
   *  would resurrect a modifier we later deleted or retuned. */
  activeIds: string[];
  /** The day the current draw belongs to, so reloading mid-day doesn't redraw
   *  and hand the player a different set than the one they were playing. */
  drawnForDay: number;
}

const CATALOG_BY_ID = new Map<string, ModifierDef>(MODIFIERS.catalog.map((m) => [m.id, m]));

/**
 * A5 — challenge modifiers. Up to `maxActivePerDay` conditions drawn at each
 * midnight, in force for the whole following day.
 *
 * Everything here is a *query*: the system owns no simulation of its own, and
 * every caller asks it for a multiplier at the point of use. That keeps the
 * modifiers from becoming a parallel set of rules that can drift out of sync
 * with the systems they modify.
 */
export class ModifierSystem {
  private active: ModifierDef[] = [];
  private drawnForDay = 0;

  /** The day's conditions, for the banner and the daily report. */
  get activeModifiers(): readonly ModifierDef[] {
    return this.active;
  }

  isActive(id: string): boolean {
    return this.active.some((m) => m.id === id);
  }

  /**
   * Draw the next day's conditions. Called once at each midnight with the day
   * that is *starting*, so a reload inside that day is a no-op rather than a
   * fresh roll.
   */
  drawForDay(day: number, rng: Rng): void {
    if (day === this.drawnForDay) return;
    this.drawnForDay = day;
    this.active = [];
    if (!rng.chance(MODIFIERS.drawChance)) return;
    // Draw without replacement: two copies of "heat wave" would silently
    // square its multiplier, which is not what a second draw should mean.
    const pool = [...MODIFIERS.catalog];
    const count = rng.int(1, MODIFIERS.maxActivePerDay);
    for (let i = 0; i < count && pool.length > 0; i++) {
      const pick = rng.int(0, pool.length - 1);
      this.active.push(pool.splice(pick, 1)[0]!);
    }
    for (const m of this.active) {
      eventBus.emit('tickerMessage', { text: `${m.name} — ${m.blurb}`, severity: 'warn' });
    }
    eventBus.emit('modifiersChanged', { ids: this.active.map((m) => m.id) });
  }

  // ---------- queries ----------

  /** Product of every active spawn multiplier (1 when none apply). */
  spawnMult(): number {
    return this.active.reduce((mult, m) => mult * (m.spawnMult ?? 1), 1);
  }

  archetypeBias(archetype: GuestArchetype): number {
    return this.active.reduce((mult, m) => mult * (m.archetypeBias?.[archetype] ?? 1), 1);
  }

  walletMult(): number {
    return this.active.reduce((mult, m) => mult * (m.walletMult ?? 1), 1);
  }

  cageCapacityMult(): number {
    return this.active.reduce((mult, m) => mult * (m.cageCapacityMult ?? 1), 1);
  }

  thirstDecayMult(): number {
    return this.active.reduce((mult, m) => mult * (m.thirstDecayMult ?? 1), 1);
  }

  /**
   * Fines owed at midnight for conditions the floor failed to meet. Returns a
   * positive dollar total plus the reasons, so the caller charges once and the
   * player is told which condition cost them.
   */
  settleDay(cleanlinessPct: number): { penalty: number; reasons: string[] } {
    let penalty = 0;
    const reasons: string[] = [];
    for (const m of this.active) {
      if (m.requiresCleanliness === undefined) continue;
      if (cleanlinessPct >= m.requiresCleanliness) continue;
      penalty += m.failPenalty ?? 0;
      reasons.push(m.name);
    }
    return { penalty, reasons };
  }

  // ---------- serialization ----------

  toJSON(): ModifierSystemJSON {
    return { activeIds: this.active.map((m) => m.id), drawnForDay: this.drawnForDay };
  }

  static fromJSON(data: ModifierSystemJSON | null | undefined): ModifierSystem {
    const sys = new ModifierSystem();
    if (!data) return sys;
    sys.drawnForDay = data.drawnForDay ?? 0;
    // Unknown ids are dropped rather than thrown on: a modifier retired from
    // the catalog must not make an otherwise-good save unloadable.
    sys.active = (data.activeIds ?? [])
      .map((id) => CATALOG_BY_ID.get(id))
      .filter((m): m is ModifierDef => m !== undefined);
    return sys;
  }
}
