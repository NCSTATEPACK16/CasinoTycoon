// Cards and chips on a card table's felt: a real round (RoundFx.cards) turned
// into a timed deal, and where each card and chip stack sits. Pure, so the
// order and the result can be tested; FxDirector plays the plan and
// FeltParts draws it.
//
// Positions are in the card-table hero's local frame (heroes.py card_table):
// the dealer's straight edge runs along z = ZB, the players' arc bows out to
// +z around (CX, ZB), the felt top is at FELT_Y, and the shoe sits at the
// dealer's right. A seat's spot on the felt follows the angle from (CX, ZB) to
// where its player sits, clamped to the arc so a guest on the dealer's side
// still bets on the felt.

import type { RoundFx } from '../../shared/contracts';
import { parseCard } from '../../sim/games/cards';

export const CX = 1.0;
export const ZB = 0.32;
export const FELT_Y = 0.762;
export const CARD_W = 0.056;
export const CARD_L = 0.078;
export const CHIP_R = 0.019;
export const CHIP_H = 0.0045;
/** Where dealt cards come from and where lost bets go (the shoe, the chip rack). */
export const SHOE = { x: 1.62, y: 0.84, z: 0.5 };
export const RACK = { x: 0.74, y: 0.78, z: 0.46 };
/** The cell index of the card back in the cardFaces sheet (52 faces, then the back). */
export const BACK = 52;

/** Seconds (before the speed scale) between cards, and the beats around them. */
const BET_S = 0.2;
const FIRST_CARD_S = 0.6;
const CARD_GAP_S = 0.38;
const DRAW_GAP_S = 0.5;
const FLIP_GAP_S = 0.55;
const SETTLE_GAP_S = 0.6;
const CLEAR_GAP_S = 1.3;

export type Slot =
  | { kind: 'hand'; hand: number; index: number }
  | { kind: 'dealer'; index: number }
  | { kind: 'board'; index: number };

export interface PlannedCard {
  /** 0..51 (cards.ts). */
  card: number;
  slot: Slot;
  /** When it leaves the shoe (s from the start of the round). */
  dealAt: number;
  /** Lands face up? */
  up: boolean;
  /** When it turns over (the hole card, the board, a fold), or null. */
  flipAt: number | null;
}

export type Result = 'win' | 'lose' | 'push';

export interface DealPlan {
  cards: PlannedCard[];
  hands: number;
  wagered: number;
  returned: number;
  result: Result;
  /** The bet goes down. */
  betAt: number;
  /** Paid or collected: the moment the result is revealed. */
  settleAt: number;
  /** Everything leaves the felt. */
  clearAt: number;
}

export function resultOf(wagered: number, returned: number): Result {
  if (returned > wagered + 1e-9) return 'win';
  if (returned < wagered - 1e-9) return 'lose';
  return 'push';
}

/** A dealt round's plan, or null for a round without cards. */
export function dealPlan(fx: RoundFx): DealPlan | null {
  const c = fx.cards;
  if (!c || !c.hands.length || c.dealer.length < 2) return null;
  const cards: PlannedCard[] = [];
  let t = FIRST_CARD_S;
  const deal = (label: string, slot: Slot, up = true, gap = CARD_GAP_S) => {
    const card: PlannedCard = { card: parseCard(label), slot, dealAt: t, up, flipAt: null };
    cards.push(card);
    t += gap;
    return card;
  };
  const hand = (h: number, index: number): Slot => ({ kind: 'hand', hand: h, index });
  const dealer = (index: number): Slot => ({ kind: 'dealer', index });
  let settleAt: number;
  if (c.board) {
    // Ultimate Texas Hold'em: two each, the five board cards face down; the
    // flop turns, then the turn and river, then the dealer shows. A folded
    // hand turns face down once the flop has shown.
    const p = c.hands[0]!;
    deal(p[0]!, hand(0, 0));
    deal(c.dealer[0]!, dealer(0), false);
    deal(p[1]!, hand(0, 1));
    const hole = deal(c.dealer[1]!, dealer(1), false);
    const board = c.board.map((b, i) => deal(b, { kind: 'board', index: i }, false, 0.22));
    t += FLIP_GAP_S;
    for (const b of board.slice(0, 3)) b.flipAt = t;
    t += FLIP_GAP_S * 2;
    if (c.folded) {
      for (const x of cards) if (x.slot.kind === 'hand') x.flipAt = t;
      t += FLIP_GAP_S;
    }
    for (const b of board.slice(3)) b.flipAt = t;
    t += FLIP_GAP_S * 2;
    cards[1]!.flipAt = t;
    hole.flipAt = t;
    settleAt = t + SETTLE_GAP_S;
  } else {
    // Blackjack: player, dealer up, player, dealer hole; then each hand's
    // draws in turn, the hole card turns, and the dealer draws out. After a
    // split the pair went one card to each of the first two hands, so both
    // open with it.
    const split = c.hands.length > 1;
    deal(c.hands[0]![0]!, hand(0, 0));
    deal(c.dealer[0]!, dealer(0));
    if (split) deal(c.hands[1]![0]!, hand(1, 0));
    else deal(c.hands[0]![1]!, hand(0, 1));
    const hole = deal(c.dealer[1]!, dealer(1), false, DRAW_GAP_S);
    c.hands.forEach((h, hi) => {
      // A re-split hand (a third or later) opens with a card the deal never showed.
      const from = !split ? 2 : hi <= 1 ? 1 : 0;
      for (let i = from; i < h.length; i++) deal(h[i]!, hand(hi, i), true, DRAW_GAP_S);
    });
    hole.flipAt = t;
    t += FLIP_GAP_S;
    for (let i = 2; i < c.dealer.length; i++) deal(c.dealer[i]!, dealer(i), true, DRAW_GAP_S);
    settleAt = t + SETTLE_GAP_S - DRAW_GAP_S / 2;
  }
  return {
    cards,
    hands: c.hands.length,
    wagered: fx.wagered,
    returned: fx.returned,
    result: resultOf(fx.wagered, fx.returned),
    betAt: BET_S,
    settleAt,
    clearAt: settleAt + CLEAR_GAP_S,
  };
}

// ---------- where things sit ----------

const ARC_MIN = Math.PI * 0.16;
const ARC_MAX = Math.PI * 0.84;

/** A seat's angle round the arc from where its player sits (table-local). */
export function seatAngle(px: number, pz: number): number {
  const a = Math.atan2((pz - ZB) / 1.38, CX - px);
  // Behind the dealer edge (a guest seated on the dealer's side): the nearer end.
  if (a < 0) return a < -Math.PI / 2 ? ARC_MAX : ARC_MIN;
  return Math.min(ARC_MAX, Math.max(ARC_MIN, a));
}

export interface Place {
  x: number;
  z: number;
  /** Turn about +y: the card's long side points at the player. */
  yaw: number;
}

const onArc = (a: number, r: number): Place => ({
  x: CX - Math.cos(a) * 0.86 * r,
  z: ZB + Math.sin(a) * 1.0 * r,
  yaw: a - Math.PI / 2,
});

/** The seat's betting circle. */
export function betSpot(a: number): Place {
  return onArc(a, 0.78);
}

/** Where a slot's card lies for a seat at angle a, with `hands` hands in play. */
export function slotPlace(slot: Slot, a: number, hands = 1): Place {
  // The dealer's row lies just in front of the chip rack (z 0.37–0.55); the
  // board between it and the players' cards.
  if (slot.kind === 'dealer') return { x: CX - 0.1 + slot.index * 0.065, z: ZB + 0.3, yaw: 0 };
  if (slot.kind === 'board') return { x: CX - 0.17 + slot.index * 0.085, z: ZB + 0.46, yaw: 0 };
  const base = onArc(a, 0.64);
  // Along the arc's tangent: hands side by side, each hand's cards fanned.
  const tx = Math.sin(a);
  const tz = Math.cos(a);
  const along = (slot.hand - (hands - 1) / 2) * 0.12 + slot.index * 0.022;
  const inward = slot.index * 0.012;
  return {
    x: base.x + tx * along + Math.cos(a) * inward,
    z: base.z + tz * along - Math.sin(a) * inward,
    yaw: base.yaw,
  };
}

// ---------- chips ----------

/** Denominations, largest first, with their chip colours. */
export const DENOMS: readonly { value: number; color: number }[] = [
  { value: 1000, color: 0xf08a1c },
  { value: 500, color: 0x7b3fb8 },
  { value: 100, color: 0x1a1a1a },
  { value: 25, color: 0x1f8f4a },
  { value: 5, color: 0xc8202e },
  { value: 1, color: 0xf2efe6 },
];
/** A stack never grows taller than this; the rest goes in a second stack. */
export const STACK_MAX = 10;

/**
 * The chips that make up an amount, bottom first: largest denominations at the
 * base, as a dealer stacks them. Cents round to the dollar; a stack too tall
 * keeps its largest chips and shows at most two stacks of STACK_MAX.
 */
export function chipsFor(amount: number): number[] {
  let left = Math.max(0, Math.round(amount));
  const out: number[] = [];
  for (const d of DENOMS)
    while (left >= d.value && out.length < STACK_MAX * 2) {
      out.push(d.value);
      left -= d.value;
    }
  return out;
}

export function chipColor(value: number): number {
  return DENOMS.find((d) => d.value === value)?.color ?? 0xf2efe6;
}
