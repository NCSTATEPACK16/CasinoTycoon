// P16 — solvency decisions, kept pure so they can be tested without a world.
// The world supplies the floor and applies the outcome; nothing here knows
// what a CasinoWorld is.

/**
 * Interest owed on a day's closing balance. Zero unless the house closed
 * under, so an intraday dip that recovers by midnight is free.
 */
export function interestFor(closingCash: number, rate: number): number {
  if (closingCash >= 0 || rate <= 0) return 0;
  return Math.round(-closingCash * rate);
}
