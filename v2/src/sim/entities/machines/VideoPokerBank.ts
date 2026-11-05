import { VIDEO_POKER_BALANCE } from '../../../data/balance';
import type { PlayCadence } from './CasinoGame';
import { EngineTable } from './EngineGame';

// Three Jacks or Better cabinets in one object (sim/games/videopoker). A thin
// edge sold on the fastest cadence, so it earns well with all three seats
// filled and close to nothing with one — the only earner whose value depends on
// the rest of the build. Seated rather than single-player precisely so
// occupancy is the dial; every cabinet deals its own hands, so the pace does
// not drop as seats fill.
export class VideoPokerBank extends EngineTable {
  constructor(id: string, costToPlay: number = VIDEO_POKER_BALANCE.costToPlay) {
    super(id, 'video-poker', 'videopoker', costToPlay, VIDEO_POKER_BALANCE.seats);
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

  protected wearPerPlay(): number {
    return VIDEO_POKER_BALANCE.wearPerPlay;
  }
}
