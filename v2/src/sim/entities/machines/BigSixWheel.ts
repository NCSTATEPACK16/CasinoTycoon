import { BIG_SIX_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayCadence, type PlayResult } from './CasinoGame';

// The cheapest, fastest, meanest game on the floor: a 1x1 standing wheel with
// no seats, so it extends CasinoGame directly rather than SeatedCasinoGame.
// Its 20% house edge is the worst in the house, and it is the only game that
// overrides extraHappinessOnLoss — that penalty stacks on the global
// GUEST_BALANCE.happinessOnLoss, making a losing spin cost -3 in total.
export class BigSixWheel extends CasinoGame {
  constructor(id: string, costToPlay: number = BIG_SIX_BALANCE.costToPlay) {
    super(id, 'big-six-wheel', costToPlay);
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: BIG_SIX_BALANCE.spinIntervalTicks,
      playsMin: BIG_SIX_BALANCE.spinsMin,
      playsMax: BIG_SIX_BALANCE.spinsMax,
    };
  }

  override get extraHappinessOnLoss(): number {
    return BIG_SIX_BALANCE.extraHappinessOnLoss;
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng, BIG_SIX_BALANCE.payoutTable) };
  }

  protected wearPerPlay(): number {
    return BIG_SIX_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, BIG_SIX_BALANCE.payoutTable);
  }
}
