import { VIDEO_POKER_BALANCE } from '../../../data/balance';
import type { Rng } from '../../rng';
import type { PlayCadence, PlayResult } from './CasinoGame';
import { SeatedCasinoGame } from './SeatedCasinoGame';

// Three cabinets in one object. The thinnest edge in the house (4%) sold on the
// fastest cadence, so it earns well with all three seats filled and close to
// nothing with one — the only earner whose value depends on the rest of the
// build. Seated rather than single-player precisely so occupancy is the dial.
export class VideoPokerBank extends SeatedCasinoGame {
  constructor(id: string, costToPlay: number = VIDEO_POKER_BALANCE.costToPlay) {
    super(id, 'video-poker', costToPlay, VIDEO_POKER_BALANCE.seats);
  }

  // Three cabinets, not a table. Without this a hired dealer would station at a
  // bank of machines and earn the +2 rating a dealt table pays — rating the
  // floor did not earn, from an object nobody deals at.
  override get needsDealer(): boolean {
    return false;
  }

  get cadence(): PlayCadence {
    return {
      intervalTicks: VIDEO_POKER_BALANCE.playIntervalTicks,
      playsMin: VIDEO_POKER_BALANCE.playsMin,
      playsMax: VIDEO_POKER_BALANCE.playsMax,
    };
  }

  protected spin(rng: Rng): PlayResult {
    return {
      wager: this.costToPlay,
      payout: this.rollPayout(rng, VIDEO_POKER_BALANCE.payoutTable),
    };
  }

  protected wearPerPlay(): number {
    return VIDEO_POKER_BALANCE.wearPerPlay;
  }

  testSpin(rng: Rng): number {
    return this.rollPayout(rng, VIDEO_POKER_BALANCE.payoutTable);
  }
}
