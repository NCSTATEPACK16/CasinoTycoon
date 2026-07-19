import { eventBus } from '../../../EventBus';
import type { Rng } from '../../rng';

export interface PlayResult {
  wager: number;
  payout: number;
}

// Base for every gambling machine: reliability wear, lifetime P&L, reservation.
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

  play(rng: Rng): PlayResult {
    if (this.broken) return { wager: 0, payout: 0 };
    const result = this.spin(rng);
    this.lifetimeProfit += result.wager - result.payout;
    this.applyWear();
    return result;
  }

  protected abstract spin(rng: Rng): PlayResult;
  protected abstract wearPerPlay(): number;

  private applyWear(): void {
    this.reliability = Math.max(0, this.reliability - this.wearPerPlay());
    if (this.reliability <= 0 && !this.broken) {
      this.broken = true;
      eventBus.emit('machineBroke', { machineId: this.id });
      eventBus.emit('tickerMessage', { text: 'A machine has broken down!' });
    }
  }
}
