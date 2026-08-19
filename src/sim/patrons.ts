import { PATRONS, patronTierFor, type PatronTier } from '../data/balance';
import { uniqueFlavorName } from '../data/names';
import type { GuestArchetype } from './entities/Guest';
import type { Rng } from './rng';

export interface PatronJSON {
  id: string;
  name: string;
  archetype: GuestArchetype;
  lifetimeTheo: number;
  visits: number;
  lastSeenDay: number;
  neglected: boolean;
}

export interface PatronRegistryJSON {
  patrons: PatronJSON[];
  /** Ids drawn to visit today, consumed one per spawn. */
  dueToday: string[];
  /** The day `dueToday` was drawn for, so a reload never re-draws it. */
  drawnForDay: number;
  nextPatronNum: number;
}

/**
 * One carded patron: a data record, not a live agent.
 *
 * Everything the player ever sees about a patron is on this object, and it is
 * deliberately tiny — name, tier inputs, and when they were last here. At the
 * roster cap the whole registry is on the order of 18KB of save, which is what
 * makes persistence affordable in a browser at all.
 */
export class Patron {
  lifetimeTheo = 0;
  visits = 0;
  lastSeenDay = 0;
  /** Set when a host-wanting patron left without being looked after. Halves
   *  their next return draw, and is cleared the moment they are comped. */
  neglected = false;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly archetype: GuestArchetype,
  ) {}

  get tier(): PatronTier {
    return patronTierFor(this.lifetimeTheo);
  }

  /** Chance this patron turns up on a given day, before the daily cap. */
  get returnChance(): number {
    const base = PATRONS.returnBaseChancePerDay + this.tier.returnBonus;
    return this.neglected ? base * PATRONS.hostNeglectReturnPenalty : base;
  }

  toJSON(): PatronJSON {
    return {
      id: this.id,
      name: this.name,
      archetype: this.archetype,
      lifetimeTheo: this.lifetimeTheo,
      visits: this.visits,
      lastSeenDay: this.lastSeenDay,
      neglected: this.neglected,
    };
  }
}

/** What a departure did to the roster, so the world can say so out loud. */
export interface DepartureOutcome {
  patron: Patron | null;
  /** True only on the visit that earned the card. */
  carded: boolean;
  /** The tier just reached, when this visit moved them up a rung. */
  promotedTo: PatronTier | null;
  /** A host-wanting patron who left with nothing comped. */
  neglected: boolean;
}

/**
 * P3 — the bounded patron roster.
 *
 * Guests stay anonymous and session-scoped; this sits beside them as a lookup
 * table with a promotion rule. It is not a second simulation — nothing here
 * ticks. Records are written when a guest leaves, drawn from at midnight, and
 * rehydrated into an ordinary `Guest` on the spawn that follows.
 *
 * The registry never touches the world's shared RNG. Its one stochastic step
 * (`drawForDay`) takes a dedicated stream, for the same reason archetypes and
 * modifiers do: a day's return draw must not shift the shared stream's call
 * count, or landing A1b silently re-rolls every payout and spawn for a given
 * world seed.
 */
export class PatronRegistry {
  private records = new Map<string, Patron>();
  private dueToday: string[] = [];
  private drawnForDay = 0;
  private nextPatronNum = 1;

  get size(): number {
    return this.records.size;
  }

  /** Patrons who are due in today and have not yet walked through the door. */
  get pendingArrivals(): number {
    return this.dueToday.length;
  }

  get(id: string): Patron | undefined {
    return this.records.get(id);
  }

  /** Roster ranked the way the player values it: by lifetime theo. */
  all(): Patron[] {
    return [...this.records.values()].sort((a, b) => b.lifetimeTheo - a.lifetimeTheo);
  }

  private takenNames(): Set<string> {
    return new Set([...this.records.values()].map((p) => p.name));
  }

  /**
   * Fold a departing guest into the roster.
   *
   * Called once, on the guest's actual departure — never at the midnight fold.
   * `Guest.theo()` accumulates across the whole visit and is never reset, so
   * crediting it at both points would double-count every guest who happens to
   * be on the floor at midnight.
   */
  recordDeparture(
    guest: {
      id: string;
      name: string;
      archetype: GuestArchetype;
      patronId: string | null;
      compsReceived: number;
      theo(): number;
    },
    day: number,
  ): DepartureOutcome {
    const theo = guest.theo();
    const existing = guest.patronId ? this.records.get(guest.patronId) : undefined;
    if (existing) {
      const before = existing.tier;
      existing.lifetimeTheo += theo;
      existing.visits++;
      existing.lastSeenDay = day;
      const after = existing.tier;
      const neglected = after.wantsHost && guest.compsReceived === 0;
      existing.neglected = neglected;
      return {
        patron: existing,
        carded: false,
        promotedTo: after.id === before.id ? null : after,
        neglected,
      };
    }
    if (theo < PATRONS.cardThresholdTheo) {
      return { patron: null, carded: false, promotedTo: null, neglected: false };
    }
    // Keep the name the player watched all evening whenever it is still free;
    // being carded should not rename someone. The probe only runs on a genuine
    // collision with a patron already on the roster.
    const taken = this.takenNames();
    const id = `p-${this.nextPatronNum++}`;
    const name = taken.has(guest.name) ? uniqueFlavorName(id, taken) : guest.name;
    const patron = new Patron(id, name, guest.archetype);
    patron.lifetimeTheo = theo;
    patron.visits = 1;
    patron.lastSeenDay = day;
    this.records.set(id, patron);
    this.enforceCap();
    return { patron, carded: true, promotedTo: null, neglected: false };
  }

  /** A comp clears the neglect flag: being looked after is the whole ask. */
  onComped(patronId: string): void {
    const patron = this.records.get(patronId);
    if (patron) patron.neglected = false;
  }

  /**
   * Draw the day's returning patrons, and drop the ones who have moved on.
   *
   * Idempotent per day, so a save reloaded mid-day does not hand the player a
   * second round of arrivals. Ranked by lifetime theo before the cap applies,
   * so when more patrons roll a return than the door has room for, the slots
   * go to the ones the player is most likely to have a relationship with.
   */
  drawForDay(day: number, rng: Rng): Patron[] {
    if (day === this.drawnForDay) return this.dueToday.map((id) => this.records.get(id)!).filter(Boolean);
    this.drawnForDay = day;
    this.prune(day);
    const due: Patron[] = [];
    for (const patron of this.all()) {
      if (due.length >= PATRONS.maxReturnsPerDay) break;
      if (patron.lastSeenDay === day) continue; // already here today
      if (rng.chance(patron.returnChance)) due.push(patron);
    }
    this.dueToday = due.map((p) => p.id);
    return due;
  }

  /**
   * Hand back the next patron due in, or null for an ordinary walk-in.
   *
   * Draws nothing — the day's roll already happened — so an arrival that
   * happens to be a returning patron costs the sim no randomness it would not
   * otherwise have spent.
   */
  takeDue(): Patron | null {
    while (this.dueToday.length > 0) {
      const id = this.dueToday.shift()!;
      const patron = this.records.get(id);
      if (patron) return patron;
    }
    return null;
  }

  /** Drop patrons who have not been seen inside the absence window. */
  prune(day: number): Patron[] {
    const dropped: Patron[] = [];
    for (const patron of this.records.values()) {
      if (day - patron.lastSeenDay > PATRONS.pruneAfterDaysAbsent) dropped.push(patron);
    }
    for (const patron of dropped) this.records.delete(patron.id);
    if (dropped.length > 0) {
      const gone = new Set(dropped.map((p) => p.id));
      this.dueToday = this.dueToday.filter((id) => !gone.has(id));
    }
    return dropped;
  }

  /** Evict from the bottom when the roster overflows its hard bound. */
  private enforceCap(): void {
    if (this.records.size <= PATRONS.rosterCap) return;
    const ranked = this.all();
    for (const patron of ranked.slice(PATRONS.rosterCap)) this.records.delete(patron.id);
    const kept = new Set(ranked.slice(0, PATRONS.rosterCap).map((p) => p.id));
    this.dueToday = this.dueToday.filter((id) => kept.has(id));
  }

  toJSON(): PatronRegistryJSON {
    return {
      patrons: this.all().map((p) => p.toJSON()),
      dueToday: [...this.dueToday],
      drawnForDay: this.drawnForDay,
      nextPatronNum: this.nextPatronNum,
    };
  }

  static fromJSON(data: PatronRegistryJSON | null | undefined): PatronRegistry {
    const registry = new PatronRegistry();
    if (!data) return registry;
    for (const raw of data.patrons ?? []) {
      if (!raw || typeof raw.id !== 'string') continue;
      const patron = new Patron(raw.id, raw.name ?? raw.id, raw.archetype ?? 'regular');
      patron.lifetimeTheo = raw.lifetimeTheo ?? 0;
      patron.visits = raw.visits ?? 0;
      patron.lastSeenDay = raw.lastSeenDay ?? 0;
      patron.neglected = raw.neglected ?? false;
      registry.records.set(patron.id, patron);
    }
    registry.dueToday = (data.dueToday ?? []).filter((id) => registry.records.has(id));
    registry.drawnForDay = data.drawnForDay ?? 0;
    // Never below the highest id in the file: a reused id would merge two
    // patrons into one record on the next carding.
    const highest = [...registry.records.keys()].reduce(
      (max, id) => Math.max(max, Number(id.slice(2)) || 0),
      0,
    );
    registry.nextPatronNum = Math.max(data.nextPatronNum ?? 1, highest + 1);
    return registry;
  }
}
