// Card primitives shared by the dealt games. A card is an int 0..51:
// rank = card >> 2 (0 = deuce … 12 = ace), suit = card & 3. Integers rather
// than objects because the Monte Carlo suites deal tens of millions of them.

import type { RngLike } from '../../shared/games';

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'cdhs';

export const rankOf = (card: number): number => card >> 2;
export const suitOf = (card: number): number => card & 3;

export function cardLabel(card: number): string {
  return RANK_CHARS[rankOf(card)]! + SUIT_CHARS[suitOf(card)]!;
}

/** Parse "As", "Td"... — used by tests and the avatar's table UI. */
export function parseCard(label: string): number {
  const r = RANK_CHARS.indexOf(label[0]!.toUpperCase());
  const s = SUIT_CHARS.indexOf(label[1]!.toLowerCase());
  if (r < 0 || s < 0) throw new Error(`bad card ${label}`);
  return (r << 2) | s;
}

/** In-place Fisher–Yates over the first `n` entries. */
export function shuffle(cards: Uint8Array | number[], rng: RngLike, n = cards.length): void {
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = t;
  }
}

/** A fresh 52-card deck, ordered. */
export function freshDeck(): Uint8Array {
  return Uint8Array.from({ length: 52 }, (_, i) => i);
}
