import { eventBus } from '../../../EventBus';
import { supportsTableMinimum, TABLE_MINIMUMS, wagerForMinimum } from '../../../data/balance';
import type { PayoutOutcome } from '../../../data/balance';
import type { Rng } from '../../rng';

export interface PlayResult {
  wager: number;
  payout: number;
}

/** How often and how long a guest plays this game type. */
export interface PlayCadence {
  intervalTicks: number;
  playsMin: number;
  playsMax: number;
}

// Base for every gambling machine: reliability wear, lifetime P&L, reservation.
// Single-player games use `reservedBy`; multi-seat games override the
// reservation hooks (isPlayableBy/release/releaseAll/isAvailable).
export abstract class CasinoGame {
  readonly id: string; // placed-object id — links machine to its world object
  readonly defId: string;
  costToPlay: number;
  /** P4/A2 — this table's minimum bet, or null for a fixed-denomination game.
   *  Slots have a coin size, not a minimum, so they are deliberately excluded:
   *  a "minimum" dial on a slot machine would be the same lever wearing a
   *  misleading name. */
  private minimum: number | null = null;
  reliability = 100;
  lifetimeProfit = 0;
  broken = false;
  reservedBy: string | null = null;

  constructor(id: string, defId: string, costToPlay: number) {
    this.id = id;
    this.defId = defId;
    this.costToPlay = costToPlay;
    // At the default tier the wager is exactly the type's tuned costToPlay, so
    // constructing a table changes nothing until the player moves the dial.
    if (supportsTableMinimum(defId)) this.minimum = TABLE_MINIMUMS.defaultByType[defId]!;
  }

  /** True for games the player can set a minimum on. */
  get supportsMinimum(): boolean {
    return this.minimum !== null;
  }

  get tableMinimum(): number | null {
    return this.minimum;
  }

  /**
   * Move this table's minimum. Rejects anything off the tier ladder, so a
   * corrupt save or a stray caller cannot produce a $7 table that no UI can
   * represent and no player asked for.
   */
  setTableMinimum(minimum: number): boolean {
    if (this.minimum === null) return false;
    if (!TABLE_MINIMUMS.tiers.includes(minimum)) return false;
    this.minimum = minimum;
    this.costToPlay = wagerForMinimum(this.defId, minimum);
    return true;
  }

  get isAvailable(): boolean {
    return !this.broken && this.reservedBy === null;
  }

  /**
   * Extra happiness delta applied on a losing play, on top of the global
   * GUEST_BALANCE.happinessOnLoss. Only games that are deliberately punishing
   * override this.
   */
  get extraHappinessOnLoss(): number {
    return 0;
  }

  /**
   * Minimum wallet a guest needs before they'll be seated, checked in
   * world.reserveMachine on top of the universal `wallet >= costToPlay` test.
   * 0 = no gate, so every game that doesn't override this is unaffected.
   */
  get minWallet(): number {
    // The elasticity is emergent, not a coefficient: raising the minimum
    // raises this gate, and the archetype wallet distributions decide who
    // still clears it. No published source gives a minimum-to-occupancy
    // curve, so deriving one from the gate is the honest construction.
    if (this.minimum === null) return 0;
    // Zero at the house minimum, and only then. A table sitting at its default
    // tier must gate exactly as it always did — otherwise landing A2 makes the
    // base game harder before the player has touched anything, which measured
    // as four lost campaign seeds. Above the default the bankroll test scales
    // with how far the table has been raised, and that is A2's whole trade:
    // a richer table turns away everyone who cannot show up with a stake.
    const ratio = this.minimum / (TABLE_MINIMUMS.defaultByType[this.defId] ?? this.minimum);
    if (ratio <= 1) return 0;
    // P16 — measured against the wager at the *default* tier, not the raised
    // one. Using costToPlay here made the gate quadratic in the tier (the wager
    // scales with ratio, and it was multiplied by ratio - 1 again) while
    // revenue per hand is only linear. Raising a table therefore shed occupancy
    // faster than it gained stake at every rung and for every crowd, so the
    // default was the only sensible setting and the dial was not a decision at
    // all: `tuned`, `mistuned` and a bot that never touched it finished within
    // one seed of each other over 21 runs. Linear in (ratio - 1) makes the
    // trade two-sided, which is the whole point of having the dial.
    const wagerAtDefault = this.costToPlay / ratio;
    return wagerAtDefault * TABLE_MINIMUMS.minWalletMultiple * (ratio - 1);
  }

  /**
   * Whether a hired dealer can station at this game.
   *
   * P13 made this a capability check rather than a list of defIds, which was
   * right, but expressed it as `instanceof SeatedCasinoGame` at the call site —
   * so "has seats" and "has a dealer" were the same fact. P17's video poker
   * bank is the case that separates them: three cabinets bolted together have
   * seats and emphatically do not have a dealer. Seating still implies a dealer
   * by default, so every P13 table is unchanged; a game that seats players
   * without being dealt to says so itself.
   */
  get needsDealer(): boolean {
    return false;
  }

  isPlayableBy(guestId: string): boolean {
    return !this.broken && this.reservedBy === guestId;
  }

  release(guestId: string): void {
    if (this.reservedBy === guestId) this.reservedBy = null;
  }

  releaseAll(): void {
    this.reservedBy = null;
  }

  play(rng: Rng): PlayResult {
    if (this.broken) return { wager: 0, payout: 0 };
    const result = this.spin(rng);
    this.lifetimeProfit += result.wager - result.payout;
    this.applyWear();
    return result;
  }

  abstract get cadence(): PlayCadence;
  /** Free Play (Machine Inspector): roll the RNG with no wear, profit, or cash movement. */
  abstract testSpin(rng: Rng): number;
  protected abstract spin(rng: Rng): PlayResult;
  protected abstract wearPerPlay(): number;

  protected rollPayout(rng: Rng, table: readonly PayoutOutcome[]): number {
    let r = rng.next();
    for (const outcome of table) {
      if (r < outcome.p) return Math.round(this.costToPlay * outcome.multiplier);
      r -= outcome.p;
    }
    return 0;
  }

  private applyWear(): void {
    this.reliability = Math.max(0, this.reliability - this.wearPerPlay());
    if (this.reliability <= 0 && !this.broken) {
      this.broken = true;
      eventBus.emit('machineBroke', { machineId: this.id });
      eventBus.emit('tickerMessage', { text: 'A machine has broken down!', severity: 'alert' });
    }
  }
}
