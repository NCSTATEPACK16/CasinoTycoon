import { PACHINKO_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayCadence, type PlayResult } from './CasinoGame';

// Noise as an amenity: the only game that carries a ratingBonus (set on its
// ObjectDef, not here). Single-player, fast, thicker edge than a penny slot.
export class PachinkoMachine extends CasinoGame {
  constructor(id: string, costToPlay: number = PACHINKO_BALANCE.costToPlay) {
    super(id, 'pachinko', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: PACHINKO_BALANCE.spinIntervalTicks,
      playsMin: PACHINKO_BALANCE.spinsMin,
      playsMax: PACHINKO_BALANCE.spinsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, PACHINKO_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return PACHINKO_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, PACHINKO_BALANCE.payoutTable);
  }
}
