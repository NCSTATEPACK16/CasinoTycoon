// B10: marketing and events the player runs.
//
// Each def is booked from the Marketing tab (ui/panels/MarketingPanel.ts),
// costs its price up front, runs for its window and then cools down. Nothing
// here spawns a guest on its own except a junket, which is a fixed group the
// player paid to fly in: ads and tournaments only change who walks through
// the door, inside world.arrivalChance and rollArchetype, so the guest cap
// still binds. A scenario offers the ids in CampaignDef.marketing.

import type { GuestArchetype } from '../sim/entities/Guest';

export type EventKind = 'ad' | 'tournament' | 'junket' | 'show';

export type EventEffect =
  /** Arrivals of these archetypes multiplied by `mult` while it runs. */
  | { type: 'arrivals'; archetypes: readonly GuestArchetype[]; mult: number }
  /** A fixed group: `count` guests of one archetype at the start hour, with
   *  wallets times `walletMult`, who stay `stayHours` and go. */
  | {
      type: 'group';
      archetype: GuestArchetype;
      count: number;
      walletMult: number;
      stayHours: number;
    };

export interface EventDef {
  id: string;
  name: string;
  kind: EventKind;
  /** One line for the panel: what it is, in the player's words. */
  blurb: string;
  /** Paid when booked. */
  cost: number;
  /** How long it runs: whole days from booking, or hours from startHour. */
  durationDays?: number;
  durationHours?: number;
  /** For evening events: the clock hour it starts (today if not yet passed,
   *  else tomorrow). Omitted = starts when booked. */
  startHour?: number;
  /** Days after it ends before it can be booked again. */
  cooldownDays: number;
  effect: EventEffect;
  /** Slot tournament: arrivals in the window are entrants, prefer slots and
   *  pay this entry fee to the house. */
  entryFee?: number;
  /** Needs at least `count` of these objects on the floor. */
  requires?: { defIds: readonly string[]; count: number; label: string };
  /** Needs this object placed (B6's stage for the concert). */
  requiresObject?: string;
}

// Prices (B10, measured on a 36-slot, 3-table Sandbox floor, seeds 3/7/11/13,
// three days): a visit is worth $13–15 of theo whatever the archetype, and
// that floor takes ~170 arrivals a day, ~80% regulars and ~10% tourists.
// Radio then brings ~80 regulars over its 3 days (~$1,100 of theo for $900),
// billboards ~70 tourists (~$950 for $600): a little better than even where
// there is room, more on a big floor, and a loss once the cap binds
// (world.b10.test.ts "a full floor"). Mailers and the junket pay where high
// rollers have high-limit games to play; on a slot floor they lose. The
// billboard lift is 2.5×, not the brief's 1.3×: tourists are ~5–10% of
// arrivals, so 1.3× was a handful of guests a day, invisible on any chart.

/** A tournament entrant's liking for the slots, times their usual. */
export const TOURNAMENT_SLOT_PREF = 2;

/** Slot cabinets a tournament can run on. */
const SLOTS = ['slot-machine', 'penny-slots', 'video-poker'] as const;

export const EVENTS: readonly EventDef[] = [
  {
    id: 'billboards',
    name: 'Billboards',
    kind: 'ad',
    blurb: 'Signs on the highway. Tourists pull off to see what the fuss is.',
    cost: 600,
    durationDays: 3,
    cooldownDays: 4,
    effect: { type: 'arrivals', archetypes: ['tourist'], mult: 2.5 },
  },
  {
    id: 'mailers',
    name: 'Mailers',
    kind: 'ad',
    blurb: 'Glossy offers to the big players on the list.',
    cost: 300,
    durationDays: 3,
    cooldownDays: 4,
    effect: { type: 'arrivals', archetypes: ['highRoller'], mult: 1.5 },
  },
  {
    id: 'radio',
    name: 'Radio spots',
    kind: 'ad',
    blurb: 'Drive-time spots on the local station. The regulars come more often.',
    cost: 900,
    durationDays: 3,
    cooldownDays: 4,
    effect: { type: 'arrivals', archetypes: ['regular'], mult: 1.2 },
  },
  {
    id: 'slot-tournament',
    name: 'Slot tournament',
    kind: 'tournament',
    blurb: 'An evening of slot heats with a prize pool. Slot lovers pour in and play the slots.',
    cost: 800,
    startHour: 19,
    durationHours: 4,
    cooldownDays: 2,
    entryFee: 10,
    effect: { type: 'arrivals', archetypes: ['regular', 'tourist'], mult: 2 },
    requires: { defIds: SLOTS, count: 6, label: 'Needs 6 slots' },
  },
  {
    id: 'junket',
    name: 'High-roller junket',
    kind: 'junket',
    blurb: 'Fly in a group of big players for the night: flights, suites and comps on you.',
    cost: 700,
    startHour: 20,
    durationHours: 8,
    cooldownDays: 3,
    effect: { type: 'group', archetype: 'highRoller', count: 8, walletMult: 3, stayHours: 8 },
  },
  {
    // B6 adds the stage; until then the panel shows this disabled.
    id: 'concert',
    name: 'Concert',
    kind: 'show',
    blurb: 'A band on the stage for the evening. Everyone comes to see it.',
    cost: 1500,
    startHour: 20,
    durationHours: 3,
    cooldownDays: 3,
    effect: {
      type: 'arrivals',
      archetypes: ['regular', 'tourist', 'biker', 'highRoller'],
      mult: 1.6,
    },
    requiresObject: 'stage',
  },
];

export function getEventDef(id: string): EventDef | undefined {
  return EVENTS.find((e) => e.id === id);
}
