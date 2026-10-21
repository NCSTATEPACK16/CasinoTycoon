import { TABLE_MINIMUMS } from '../data/balance';

// P16 — the house's one repeating decision that costs no capital.
//
// Everything else the player decides is where to put money. A table minimum is
// different: it is free to change, it is set against the crowd the day's
// conditions have already announced, and it is wrong in both directions. Raise
// the gate on a bus junket and the floor empties; leave it at the default
// through a convention and the high rollers under-bet all night.

/** How rich a crowd has to look before the table reaches up a rung. */
const RICH_ENOUGH = 1.5;
/** How poor before it drops one. */
const POOR_ENOUGH = 0.9;

/**
 * The tier a table should sit at for today's crowd.
 *
 * `richBias` is the arrival multiplier for the archetype that can afford a
 * raised gate, and `walletMult` is what the day does to everyone's pocket. They
 * are multiplied rather than considered separately because a bus junket moves
 * both at once — more heads, thinner wallets — and reacting to the head count
 * alone is precisely the expensive mistake this decision exists to permit.
 */
export function tierForCrowd(defaultTier: number, richBias: number, walletMult: number): number {
  const tiers = TABLE_MINIMUMS.tiers;
  const at = tiers.indexOf(defaultTier);
  // A tier the ladder does not contain is not a tier to move from.
  if (at === -1) return defaultTier;
  const purse = richBias * walletMult;
  const step = purse >= RICH_ENOUGH ? 1 : purse <= POOR_ENOUGH ? -1 : 0;
  const next = Math.min(tiers.length - 1, Math.max(0, at + step));
  return tiers[next]!;
}
