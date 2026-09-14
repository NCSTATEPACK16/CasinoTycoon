import { formatCash } from './dom';

// P16 — copy for the card that ends a run.
//
// Kept apart from the wiring in index.ts so the wording is testable on its own,
// the way ThoughtsPanel keeps aggregateThoughts out of its DOM.

export type EndCardOutcome =
  | { kind: 'won'; day: number; profit: number }
  | { kind: 'failed'; reason: 'timeUp' | 'insolvent'; day: number };

export interface EndCardCopy {
  heading: string;
  message: string;
}

/**
 * Both failures once shared a heading and the message "Day N ended without
 * hitting the goal." That is false of an insolvency — the bank sold the floor
 * out from under the player, and the goal never entered into it. The reason has
 * always been on the scenarioFailed event; this reads it.
 */
export function endCardCopy(outcome: EndCardOutcome): EndCardCopy {
  if (outcome.kind === 'won') {
    return {
      heading: 'Scenario complete!',
      message:
        `The books closed day ${outcome.day} at ${formatCash(outcome.profit)} profit — goal smashed. ` +
        `Keep playing and the floor opens up completely — no day limit, no restrictions on what you ` +
        `can build — but the bank still calls it if the balance runs out.`,
    };
  }
  if (outcome.reason === 'insolvent') {
    return {
      heading: 'The bank calls it in',
      message:
        `Day ${outcome.day} closed past the credit limit with nothing left worth selling. ` +
        `The debt is called and the floor goes with it.`,
    };
  }
  // Deliberately says nothing about the bank. The house was solvent when the
  // clock stopped — it simply never got there — and borrowing the other
  // ending's imagery is what made the two indistinguishable in the first place.
  return {
    heading: 'The backers walk',
    message: `Day ${outcome.day} ended with the goal still out of reach, and the run is out of days.`,
  };
}
