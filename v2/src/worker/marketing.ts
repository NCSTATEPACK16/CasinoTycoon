// B10: the Marketing tab's view. Every event the scenario offers, with its
// price, how long it runs, its cooldown and what it should do at this floor
// right now (from the sim's own arrival curve), plus what is running and
// what past runs actually did. A pure function of the world, like inspect.ts.

import { HOURS_PER_DAY } from '../config';
import { getEventDef, type EventDef, type EventKind } from '../data/events';
import type { GuestArchetype } from '../sim/entities/Guest';
import { clockLabel } from '../sim/marketing';
import type { CasinoWorld } from '../sim/world';

export interface MarketingEventView {
  id: string;
  name: string;
  kind: EventKind;
  blurb: string;
  cost: number;
  /** "3 days" or "19:00–23:00". */
  runs: string;
  cooldown: string;
  /** The expected effect, in words, at this floor now. */
  expected: string;
  /** Why it can't be booked now, or null. */
  blocked: string | null;
}

export interface MarketingView {
  events: MarketingEventView[];
  running: { id: string; name: string; status: string }[];
  /** Finished runs, newest first: when, what it cost and what it did. */
  past: { name: string; when: string; cost: number; result: string; extra: number }[];
  guests: number;
  cap: number;
}

const PEOPLE: Record<GuestArchetype, string> = {
  regular: 'regulars',
  tourist: 'tourists',
  highRoller: 'high rollers',
  biker: 'bikers',
};

const hh = (h: number) => `${String(h % HOURS_PER_DAY).padStart(2, '0')}:00`;

function runsFor(def: EventDef): string {
  if (def.startHour === undefined) {
    const d = def.durationDays ?? 1;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${hh(def.startHour)}–${hh(def.startHour + (def.durationHours ?? 1))}`;
}

function expectedFor(world: CasinoWorld, def: EventDef): string {
  const e = def.effect;
  if (e.type === 'group')
    return `${e.count} ${PEOPLE[e.archetype]} with ${e.walletMult}× the usual bankroll, for ${e.stayHours} hours`;
  const who =
    e.archetypes.length >= 4 ? 'everyone' : e.archetypes.map((a) => PEOPLE[a]).join(' and ');
  const lift = `+${Math.round((e.mult - 1) * 100)}% ${who}`;
  const extra = world.expectedExtra(def);
  const days = def.durationDays ?? 1;
  const perDay = def.startHour === undefined && days > 1;
  const n = perDay ? Math.round(extra / days) : extra;
  const guests = `about +${n} guest${n === 1 ? '' : 's'}${perDay ? ' a day' : ''} at your rating`;
  const fee = def.entryFee ? `; entrants pay $${def.entryFee} and play the slots` : '';
  return `${lift}: ${guests}${fee}`;
}

export function marketingView(world: CasinoWorld): MarketingView {
  const events: MarketingEventView[] = [];
  for (const id of world.marketingOffered) {
    const def = getEventDef(id);
    if (!def) continue;
    events.push({
      id: def.id,
      name: def.name,
      kind: def.kind,
      blurb: def.blurb,
      cost: def.cost,
      runs: runsFor(def),
      cooldown: `${def.cooldownDays} day${def.cooldownDays === 1 ? '' : 's'}`,
      expected: expectedFor(world, def),
      blocked: world.eventBlocked(def),
    });
  }
  const past = world.marketing.runs
    .filter((r) => r.result !== undefined)
    .reverse()
    .map((r) => ({
      name: r.name,
      when: clockLabel(r.startHourIndex),
      cost: r.cost,
      result: r.result!,
      extra: r.extra ?? 0,
    }));
  return {
    events,
    running: world.eventsNow(),
    past,
    guests: world.guests.size,
    cap: world.guestCap(),
  };
}
