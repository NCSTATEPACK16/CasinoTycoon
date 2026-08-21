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

/** One object the house could sell, with everything the choice depends on. */
export interface LiquidationCandidate {
  id: string;
  defId: string;
  /** Never appears as a P1 revenue source — a plant, a sign, a marquee. */
  isDecor: boolean;
  /** The only toilet, or the only food stall. Guests depend on it. */
  isLastOfService: boolean;
  /** The only thing on the floor still taking money. */
  isLastRevenueObject: boolean;
  /** Attributed net over the last three closed days. */
  trailingNet: number;
  /** What selling it would return, at SELL_REFUND_RATIO. */
  refund: number;
}

/**
 * Which object the house takes, cheapest loss first: decor before earners,
 * then the weakest earner by trailing net.
 *
 * Returns null when nothing may be sold. That is not an error — it is the
 * insolvency condition, and the caller reads it as one.
 */
export function pickLiquidation(
  candidates: readonly LiquidationCandidate[],
): LiquidationCandidate | null {
  const allowed = candidates.filter((c) => !c.isLastOfService && !c.isLastRevenueObject);
  if (allowed.length === 0) return null;
  // Decor first, then weakest trailing net. Id breaks the tie so a forced sale
  // is reproducible for a given seed — a rollup that picks differently on
  // replay would make every campaign test flaky.
  const ranked = [...allowed].sort((a, b) => {
    if (a.isDecor !== b.isDecor) return a.isDecor ? -1 : 1;
    if (a.trailingNet !== b.trailingNet) return a.trailingNet - b.trailingNet;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return ranked[0]!;
}
