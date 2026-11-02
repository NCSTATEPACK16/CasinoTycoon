import { BIG_SIX_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineCabinet } from './EngineGame';

// The cheapest, fastest, meanest game on the floor: a 1x1 standing money wheel
// with no seats (sim/games/bigsix). Its edge on the guests' spread (about 15%)
// is among the worst in the house, and it is the only game that overrides
// extraHappinessOnLoss — that penalty stacks on the global
// GUEST_BALANCE.happinessOnLoss, making a losing spin cost -3 in total.
export class BigSixWheel extends EngineCabinet {
  constructor(id: string, costToPlay: number = BIG_SIX_BALANCE.costToPlay) {
    super(id, 'big-six-wheel', 'bigsix', costToPlay);
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

  protected wearPerPlay(): number {
    return BIG_SIX_BALANCE.wearPerPlay;
  }
}
