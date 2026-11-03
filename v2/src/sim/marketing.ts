// B10: the marketing book. Which events are booked or running, when each can
// run again, and what each did: guests through the door while it ran, and
// how many of them it added. Pure bookkeeping on the world's clock; the world
// applies the money and the arrivals (world.runEvent, arrivalChance,
// rollArchetype, marketingTick).
//
// "Added" is the arrival chance with the event's lift less the chance
// without it, summed over the ticks it ran with room on the floor: the same
// hours, without it. An earlier draft compared with the same hours on
// earlier days and read a 3-day radio ad as −145 guests, because day 1 was
// the floor's first and busiest; the difference of chances has no such
// confound, and still reads zero where the cap binds.

import { HOURS_PER_DAY, TICKS_PER_HOUR } from '../config';
import { getEventDef, type EventDef } from '../data/events';
import type { GuestArchetype } from './entities/Guest';

export const TICKS_PER_DAY = HOURS_PER_DAY * TICKS_PER_HOUR;
const MAX_RUNS = 60;

export interface Clock {
  tick: number;
  day: number;
  hour: number;
  tickInHour: number;
}

export interface EventRun {
  id: string;
  name: string;
  startTick: number;
  endTick: number;
  /** Absolute hour (day 1 00:00 = 0) the run starts and ends in. */
  startHourIndex: number;
  endHourIndex: number;
  cost: number;
  /** Guests through the door while it ran, and (a tournament) entrants and fees. */
  arrivals: number;
  /** Arrivals it added: each tick it ran with room on the floor, the
   *  arrival chance with its lift less the chance without it. A tick at the
   *  cap adds nothing, since nobody else could have come in either. */
  lifted: number;
  /** Ticks it ran, and how many of them the floor was full. */
  ticks: number;
  fullTicks: number;
  entrants: number;
  fees: number;
  /** A group event: its guests have arrived. */
  groupDone?: boolean;
  /** Set when it ends: what it did, in words, and the guests it added. */
  result?: string;
  extra?: number;
}

export interface MarketingJSON {
  runs: EventRun[];
}

export function hourIndex(day: number, hour: number): number {
  return (day - 1) * HOURS_PER_DAY + hour;
}

export function clockLabel(index: number): string {
  const day = Math.floor(index / HOURS_PER_DAY) + 1;
  const hour = index % HOURS_PER_DAY;
  return `day ${day} ${String(hour).padStart(2, '0')}:00`;
}

export class Marketing {
  runs: EventRun[] = [];

  /** Where a booking made now would run: ads from now, evening events at
   *  their next start hour (now, if the window is already open). */
  window(def: EventDef, now: Clock): { start: number; end: number } {
    const hourStart = now.tick - now.tickInHour;
    if (def.startHour === undefined) {
      const days = def.durationDays ?? 1;
      return { start: now.tick, end: now.tick + days * TICKS_PER_DAY };
    }
    const dur = (def.durationHours ?? 1) * TICKS_PER_HOUR;
    const sinceStart = (now.hour - def.startHour + HOURS_PER_DAY) % HOURS_PER_DAY;
    const lastStart = hourStart - sinceStart * TICKS_PER_HOUR;
    if (now.tick === lastStart) return { start: now.tick, end: now.tick + dur };
    // An evening already under way can still be joined; a group flies in at
    // its hour or not at all, so it waits for tomorrow's.
    if (def.effect.type !== 'group' && now.tick < lastStart + dur)
      return { start: now.tick, end: lastStart + dur };
    const next = lastStart + TICKS_PER_DAY;
    return { start: next, end: next + dur };
  }

  /** The run of this event not yet over, if any. */
  current(id: string, tick: number): EventRun | undefined {
    return this.runs.find((r) => r.id === id && tick < r.endTick);
  }

  /** The tick this event may be booked again (≤ now when it can). */
  readyAt(def: EventDef): number {
    let at = -Infinity;
    for (const r of this.runs)
      if (r.id === def.id) at = Math.max(at, r.endTick + def.cooldownDays * TICKS_PER_DAY);
    return at;
  }

  book(def: EventDef, now: Clock): EventRun {
    const { start, end } = this.window(def, now);
    const toIndex = (t: number) =>
      hourIndex(now.day, now.hour) + Math.floor((now.tickInHour + t - now.tick) / TICKS_PER_HOUR);
    const run: EventRun = {
      id: def.id,
      name: def.name,
      startTick: start,
      endTick: end,
      startHourIndex: toIndex(start),
      endHourIndex: toIndex(end - 1),
      cost: def.cost,
      arrivals: 0,
      lifted: 0,
      ticks: 0,
      fullTicks: 0,
      entrants: 0,
      fees: 0,
    };
    this.runs.push(run);
    // The charts look back 60 days at most; a long game books hundreds.
    if (this.runs.length > MAX_RUNS) this.runs.shift();
    return run;
  }

  /** Runs whose window holds this tick. */
  active(tick: number): EventRun[] {
    return this.runs.filter((r) => r.startTick <= tick && tick < r.endTick);
  }

  /** True while any arrival effect runs: the world's fast path skips the
   *  marketing maths entirely otherwise, so a casino that never books an
   *  event plays exactly as it did before B10. */
  liftsArrivals(tick: number): boolean {
    for (const r of this.runs) {
      if (r.startTick > tick || tick >= r.endTick) continue;
      if (getEventDef(r.id)?.effect.type === 'arrivals') return true;
    }
    return false;
  }

  /** The arrival multiplier for one archetype now. */
  lift(archetype: GuestArchetype, tick: number): number {
    let m = 1;
    for (const r of this.runs) {
      if (r.startTick > tick || tick >= r.endTick) continue;
      const e = getEventDef(r.id)?.effect;
      if (e?.type === 'arrivals' && e.archetypes.includes(archetype)) m *= e.mult;
    }
    return m;
  }

  /** The tournament running now, if a guest arriving now could enter it. */
  tournament(tick: number): { run: EventRun; def: EventDef } | null {
    for (const r of this.active(tick)) {
      const def = getEventDef(r.id);
      if (def?.kind === 'tournament') return { run: r, def };
    }
    return null;
  }

  /** Group events whose guests are due now. */
  dueGroups(tick: number): EventRun[] {
    return this.runs.filter(
      (r) => !r.groupDone && r.startTick <= tick && getEventDef(r.id)?.effect.type === 'group',
    );
  }

  /** Count a guest through the door against any event running. */
  countArrival(tick: number): void {
    for (const r of this.active(tick)) r.arrivals++;
  }

  toJSON(): MarketingJSON {
    return { runs: this.runs.map((r) => ({ ...r })) };
  }

  static fromJSON(data: MarketingJSON | undefined): Marketing {
    const m = new Marketing();
    if (data) m.runs = data.runs.map((r) => ({ ...r }));
    return m;
  }
}
