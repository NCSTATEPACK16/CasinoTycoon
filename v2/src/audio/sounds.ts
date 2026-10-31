// Every sound the game plays, by name. Files live in public/audio (credits in
// assets/CREDITS.md). A name with several files picks one at random each
// time, and `jitter` detunes it by up to ± that many cents, so repeats don't
// sound like a loop.

import type { Bus } from './mix';

export interface SoundDef {
  files: string[];
  bus: Bus;
  /** Linear gain before the bus. */
  volume: number;
  /** Who wins a voice when the pool is full: higher keeps playing. */
  priority: number;
  /** Simultaneous instances of this sound; one more restarts the oldest. */
  maxVoices: number;
  jitter?: number;
}

const range = (stem: string, n: number) => Array.from({ length: n }, (_, i) => `${stem}-${i + 1}`);

export const SOUNDS = {
  // Floor
  coin: {
    files: range('sfx-coin', 2),
    bus: 'sfx',
    volume: 0.5,
    priority: 1,
    maxVoices: 4,
    jitter: 150,
  },
  hopper: { files: ['sfx-coin-hopper'], bus: 'sfx', volume: 0.45, priority: 4, maxVoices: 2 },
  jackpot: { files: ['sfx-jackpot'], bus: 'sfx', volume: 0.6, priority: 5, maxVoices: 1 },
  // Table play
  card: {
    files: range('sfx-card', 5),
    bus: 'sfx',
    volume: 0.7,
    priority: 2,
    maxVoices: 4,
    jitter: 100,
  },
  chips: {
    files: range('sfx-chips', 6),
    bus: 'sfx',
    volume: 0.7,
    priority: 2,
    maxVoices: 4,
    jitter: 100,
  },
  dice: {
    files: range('sfx-dice', 4),
    bus: 'sfx',
    volume: 0.8,
    priority: 2,
    maxVoices: 2,
    jitter: 80,
  },
  shuffle: { files: ['sfx-shuffle'], bus: 'sfx', volume: 0.7, priority: 2, maxVoices: 1 },
  ball: { files: ['sfx-roulette-ball'], bus: 'sfx', volume: 0.8, priority: 2, maxVoices: 2 },
  // Wheels (A4): the ball running down the track, the big six clapper.
  ballRoll: { files: ['sfx-roulette-slow'], bus: 'sfx', volume: 0.45, priority: 2, maxVoices: 2 },
  bigSixSpin: { files: ['sfx-bigsix-spin'], bus: 'sfx', volume: 0.5, priority: 2, maxVoices: 2 },
  win: { files: ['sfx-victory'], bus: 'sfx', volume: 0.5, priority: 4, maxVoices: 1 },
  // Slot reels (A3): the spin, a clunk as each reel stops, a bell on a win.
  reelSpin: {
    files: ['sfx-reel-spin'],
    bus: 'sfx',
    volume: 0.35,
    priority: 2,
    maxVoices: 3,
    jitter: 60,
  },
  reelStop: {
    files: range('sfx-reel-clunk', 3),
    bus: 'sfx',
    volume: 0.4,
    priority: 2,
    maxVoices: 4,
    jitter: 120,
  },
  bell: { files: ['sfx-bell'], bus: 'sfx', volume: 0.45, priority: 3, maxVoices: 2, jitter: 40 },
  // Build and management
  place: { files: ['ui-place'], bus: 'ui', volume: 0.7, priority: 3, maxVoices: 3, jitter: 80 },
  sell: { files: ['ui-sell'], bus: 'ui', volume: 0.7, priority: 3, maxVoices: 2 },
  hire: { files: ['ui-hire'], bus: 'ui', volume: 0.7, priority: 3, maxVoices: 2 },
  // Interface
  click: { files: ['ui-click'], bus: 'ui', volume: 0.45, priority: 3, maxVoices: 2, jitter: 50 },
  open: { files: ['ui-open'], bus: 'ui', volume: 0.5, priority: 3, maxVoices: 1 },
  close: { files: ['ui-close'], bus: 'ui', volume: 0.5, priority: 3, maxVoices: 1 },
  error: { files: ['ui-error'], bus: 'ui', volume: 0.6, priority: 3, maxVoices: 1 },
} satisfies Record<string, SoundDef>;

export type SoundName = keyof typeof SOUNDS;
