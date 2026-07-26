import { HIGH_LIMIT_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// The VIP table: three seats, the highest stake on the floor, and the best
// odds in the house (94% RTP). Access is gated on wallet rather than
// archetype — see HIGH_LIMIT_BALANCE — so a lucky ordinary guest can graduate
// into it rather than the table sitting idle waiting for a rare high roller.
export class HighLimitTable extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = HIGH_LIMIT_BALANCE.costToPlay) {
    super(id, 'high-limit-table', costToPlay, HIGH_LIMIT_BALANCE.seats);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: HIGH_LIMIT_BALANCE.playIntervalTicks,
      playsMin: HIGH_LIMIT_BALANCE.playsMin,
      playsMax: HIGH_LIMIT_BALANCE.playsMax,
    };
  }

  override get minWallet(): number {
    return HIGH_LIMIT_BALANCE.minWallet;
  }

  protected spin(rng: Rng): PlayResult {
    return {
      wager: this.costToPlay,
      payout: this.rollPayout(rng, HIGH_LIMIT_BALANCE.payoutTable),
    };
  }

  protected wearPerPlay(): number {
    return HIGH_LIMIT_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, HIGH_LIMIT_BALANCE.payoutTable);
  }
}
