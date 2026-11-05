// Comp buttons, shared by the guest inspector and the patrons roster. Each
// says what it costs and, when it can't be given, why not.

import type { GuestInspect } from '../../worker/inspect';
import { button, el, money } from '../dom';

export type CompKind = 'drink' | 'meal' | 'matchPlay';

const COMP_LABEL: Record<CompKind, string> = {
  drink: 'Drink',
  meal: 'Meal',
  matchPlay: 'Match play',
};

const COMP_BLURB: Record<CompKind, string> = {
  drink: 'Quenches thirst and lifts their mood',
  meal: 'Fills them up and lifts their mood',
  matchPlay: 'Chips to keep playing with, and goodwill',
};

export function compButtons(
  comp: GuestInspect['comp'],
  onComp: (kind: CompKind) => void,
): HTMLElement {
  const row = el('div', 'comp-row');
  for (const kind of ['drink', 'meal', 'matchPlay'] as const) {
    const cost = comp.costs[kind];
    const b = button(
      `${COMP_LABEL[kind]} <small>${money(cost)}</small>`,
      () => onComp(kind),
      'small',
    );
    b.dataset.kind = kind;
    if (!comp.eligible) {
      b.disabled = true;
      b.title = 'They have to play a while before a comp means anything';
    } else if (cost > comp.headroom) {
      b.disabled = true;
      b.title = `This visit's comp budget has ${money(comp.headroom)} left`;
    } else b.title = `${COMP_BLURB[kind]}. Costs the house ${money(cost)}.`;
    row.append(b);
  }
  return row;
}

/** A short line on where a guest stands for comps. */
export function compStatus(comp: GuestInspect['comp']): string {
  if (!comp.eligible) return 'Not comp-eligible yet: they have to play a while first.';
  return `Comped ${money(comp.received)} this visit · ${money(comp.headroom)} left in their budget.`;
}
