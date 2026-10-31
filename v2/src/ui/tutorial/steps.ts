// B12: Opening Night's steps and the tracker that ticks them. Pure: the DOM
// side (ui/Tutorial.ts) feeds it what the player did and what the floor
// looks like, and draws the result. The player may do things in any order;
// a step is ticked the moment it is true, and the pointer rests on the first
// step still open.

import type { Command, ObjectView } from '../../shared/contracts';

export type TutorialEvent =
  | { kind: 'command'; cmd: Command }
  | { kind: 'objects'; objects: readonly ObjectView[] }
  | { kind: 'rating' };

export interface TutorialStep {
  id: string;
  title: string;
  /** What to do, in the player's words. */
  body: string;
  /** Where the pointer goes (resolved by ui/Tutorial.ts). */
  target: 'zone-tool' | 'slot' | 'table' | 'staff-tab' | 'stall' | 'prices-tab' | 'rating';
  /** True once this event completes the step. */
  met(e: TutorialEvent): boolean;
}

/** Placed just now, or already standing (a saved lesson picked up again). */
const placed = (defId: string) => (e: TutorialEvent) =>
  (e.kind === 'command' && e.cmd.type === 'place' && e.cmd.defId === defId) ||
  (e.kind === 'objects' && e.objects.some((o) => o.defId === defId));

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'zone',
    title: 'Paint a zone',
    body: 'Games only go on Gaming ground. Pick Zone, choose Gaming, and drag over the bare carpet in the east half of the hall.',
    target: 'zone-tool',
    met: (e) => e.kind === 'command' && e.cmd.type === 'paintZone' && e.cmd.zone === 'gaming',
  },
  {
    id: 'slot',
    title: 'Place a slot machine',
    body: 'Open the Slots tab, pick Slot Machine, and click the Gaming floor. Machines earn without any staff.',
    target: 'slot',
    met: placed('slot-machine'),
  },
  {
    id: 'table',
    title: 'Place a blackjack table',
    body: 'Open the Tables tab and put a Blackjack table down. It stays closed until it has a dealer.',
    target: 'table',
    met: placed('blackjack-table'),
  },
  {
    id: 'dealer',
    title: 'Hire a dealer',
    body: 'Open Staff (H) and hire a Dealer. Wages are paid every day, so hire for the tables you have.',
    target: 'staff-tab',
    met: (e) => e.kind === 'command' && e.cmd.type === 'hire' && e.cmd.kind === 'dealer',
  },
  {
    id: 'open',
    title: 'Open the table',
    body: 'Once a dealer reaches the table it opens. Run the clock at 1× and watch for the table lights.',
    target: 'table',
    met: (e) =>
      e.kind === 'objects' && e.objects.some((o) => o.defId === 'blackjack-table' && o.open),
  },
  {
    id: 'stall',
    title: 'Build a food stall',
    body: 'Hungry guests leave. Under Services, put a Food Stall on the food court floor in the south-west corner.',
    target: 'stall',
    met: placed('food-stall'),
  },
  {
    id: 'price',
    title: 'Set a price',
    body: 'Open the Prices tab, pick your stall and change an item’s price. Too dear and guests feel ripped off.',
    target: 'prices-tab',
    met: (e) => e.kind === 'command' && e.cmd.type === 'setPrice',
  },
  {
    id: 'rating',
    title: 'Read the rating',
    body: 'Click the ★ rating in the top bar. It lists every term and what to do about it.',
    target: 'rating',
    met: (e) => e.kind === 'rating',
  },
];

export class TutorialTracker {
  readonly done = new Set<string>();

  constructor(private steps: readonly TutorialStep[] = TUTORIAL_STEPS) {}

  /** The first step still open. */
  get current(): TutorialStep | undefined {
    return this.steps.find((s) => !this.done.has(s.id));
  }

  get complete(): boolean {
    return this.done.size === this.steps.length;
  }

  /** Ticks every step this event completes; returns the newly ticked ids. */
  feed(e: TutorialEvent): string[] {
    const ticked: string[] = [];
    for (const s of this.steps)
      if (!this.done.has(s.id) && s.met(e)) {
        this.done.add(s.id);
        ticked.push(s.id);
      }
    return ticked;
  }
}
