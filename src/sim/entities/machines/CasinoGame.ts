import { eventBus } from '../../../EventBus';
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
  reliability = 100;
  lifetimeProfit = 0;
  broken = false;
  reservedBy: string | null = null;

  constructor(id: string, defId: string, costToPlay: number) {
    this.id = id;
    this.defId = defId;
    this.costToPlay = costToPlay;
  }

  get isAvailable(): boolean {
    return !this.broken && this.reservedBy === null;
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
      eventBus.emit('tickerMessage', { text: 'A machine has broken down!' });
    }
  }
}
