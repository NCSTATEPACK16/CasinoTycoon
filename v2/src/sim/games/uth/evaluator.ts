// Poker hand evaluator for 5–7 cards. Returns a single integer score where a
// higher score is a better hand and equal scores are true ties:
//
//   score = category << 20 | k1 << 16 | k2 << 12 | k3 << 8 | k4 << 4 | k5
//
// with the kickers as ranks 0 (deuce) … 12 (ace), most significant first.
// Everything runs off rank bitmasks and counts in preallocated scratch arrays,
// so the hot path allocates nothing — the Monte Carlo suites call this tens
// of millions of times.

import { rankOf, suitOf } from '../cards';

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
] as const;

/** Top rank of the best straight in a 13-bit rank mask, or -1. The wheel
 *  (A-2-3-4-5) counts with a top of 3, the five. */
const STRAIGHT_HIGH = new Int8Array(8192);
/** The highest five set bits of a rank mask, packed as five kicker nibbles. */
const TOP5 = new Int32Array(8192);
for (let m = 0; m < 8192; m++) {
  let high = -1;
  for (let top = 12; top >= 4 && high < 0; top--) {
    if (((m >> (top - 4)) & 0x1f) === 0x1f) high = top;
  }
  if (high < 0 && (m & 0x100f) === 0x100f) high = 3; // A,2,3,4,5
  STRAIGHT_HIGH[m] = high;
  let packed = 0;
  let n = 0;
  for (let r = 12; r >= 0 && n < 5; r--) {
    if (m & (1 << r)) {
      packed |= r << (16 - 4 * n);
      n++;
    }
  }
  TOP5[m] = packed;
}

const counts = new Int8Array(13);
const suitMask = new Int32Array(4);
const suitCount = new Int8Array(4);

/** Score the best five-card hand among `n` cards (5..7). */
export function evaluate(cards: ArrayLike<number>, n: number = cards.length): number {
  counts.fill(0);
  suitMask[0] = suitMask[1] = suitMask[2] = suitMask[3] = 0;
  suitCount[0] = suitCount[1] = suitCount[2] = suitCount[3] = 0;
  let rankMask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i]!;
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]!++;
    suitMask[s]! |= 1 << r;
    suitCount[s]!++;
    rankMask |= 1 << r;
  }

  let flushScore = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s]! >= 5) {
      const m = suitMask[s]!;
      const sf = STRAIGHT_HIGH[m]!;
      if (sf >= 0) return (HandCategory.StraightFlush << 20) | (sf << 16);
      flushScore = (HandCategory.Flush << 20) | TOP5[m]!;
    }
  }

  // Walk ranks high to low collecting the made groups.
  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = counts[r]!;
    if (k === 4) quad = r;
    else if (k === 3) {
      if (trip1 < 0) trip1 = r;
      else if (trip2 < 0) trip2 = r;
    } else if (k === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    const kick = 31 - Math.clz32(rankMask & ~(1 << quad));
    return (HandCategory.Quads << 20) | (quad << 16) | (kick << 12);
  }
  if (trip1 >= 0 && (trip2 >= 0 || pair1 >= 0)) {
    const two = Math.max(trip2, pair1);
    return (HandCategory.FullHouse << 20) | (trip1 << 16) | (two << 12);
  }
  if (flushScore >= 0) return flushScore;
  const st = STRAIGHT_HIGH[rankMask]!;
  if (st >= 0) return (HandCategory.Straight << 20) | (st << 16);
  if (trip1 >= 0) {
    const rest = (TOP5[rankMask & ~(1 << trip1)]! >> 4) & 0xff00; // top two kickers
    return (HandCategory.Trips << 20) | (trip1 << 16) | rest;
  }
  if (pair2 >= 0) {
    // A third pair's rank can still play as the kicker.
    const kick = 31 - Math.clz32(rankMask & ~(1 << pair1) & ~(1 << pair2));
    return (HandCategory.TwoPair << 20) | (pair1 << 16) | (pair2 << 12) | (kick << 8);
  }
  if (pair1 >= 0) {
    const rest = (TOP5[rankMask & ~(1 << pair1)]! >> 4) & 0xfff0; // top three kickers
    return (HandCategory.Pair << 20) | (pair1 << 16) | rest;
  }
  return TOP5[rankMask]!;
}

export function categoryOf(score: number): HandCategory {
  return (score >> 20) as HandCategory;
}
