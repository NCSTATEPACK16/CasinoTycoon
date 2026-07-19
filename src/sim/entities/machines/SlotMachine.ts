import { SLOT_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import { CasinoGame, type PlayResult } from './CasinoGame';

export class SlotMachine extends CasinoGame {
  constructor(id: string, costToPlay: number = SLOT_BALANCE.costToPlay) {
    super(id, 'slot-machine', costToPlay);
  }

  protected spin(rng: Rng): PlayResult {
    return { wager: this.costToPlay, payout: this.rollPayout(rng) };
  }

  protected wearPerPlay(): number {
    return SLOT_BALANCE.wearPerPlay;
  }

  /** Free Play (Machine Inspector): roll the RNG with no wear, profit, or cash movement. */
  testSpin(rng: Rng): number {
    return this.rollPayout(rng);
  }

  private rollPayout(rng: Rng): number {
    let r = rng.next();
    for (const outcome of SLOT_BALANCE.payoutTable) {
      if (r < outcome.p) return Math.round(this.costToPlay * outcome.multiplier);
      r -= outcome.p;
    }
    return 0;
  }
}
