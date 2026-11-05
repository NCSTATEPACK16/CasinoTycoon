// A card table's felt over time: the hand being shown (its deal plan, dealt
// card by card from the shoe), the chips of every seat that has bet lately,
// and the settle: a lost bet swept to the rack, a win paid beside the bet,
// then the winnings and cards cleared. FxDirector decides which round plays
// and when; this places the parts for a moment.
//
// The sim deals each seat its own dealer hand, so the felt shows one seat's
// round at a time with that round's dealer cards; the other seats show only
// their last bet.

import * as THREE from 'three';
import type { FeltParts } from './FeltParts';
import {
  betSpot,
  CHIP_H,
  chipColor,
  chipsFor,
  CX,
  FELT_Y,
  RACK,
  SHOE,
  slotPlace,
  STACK_MAX,
  ZB,
  type DealPlan,
} from './felt';

/** A seat's bet stays on the felt this long after its last round (s). */
const BET_LIFE_S = 20;
/** Card flight from the shoe, a flip, and the sweep off the felt (s, before the speed scale). */
const FLIGHT_S = 0.28;
const FLIP_S = 0.22;
const SWEEP_S = 0.45;
const DISCARD = { x: CX - 0.62, y: FELT_Y + 0.02, z: ZB + 0.16 };

export interface SeatBet {
  /** Seat angle round the arc (felt.seatAngle). */
  a: number;
  amount: number;
  at: number;
}

export interface FeltHand {
  plan: DealPlan;
  t0: number;
  dur: number;
  seat: number;
  a: number;
  /** Where the player sits, table-local: winnings slide this way. */
  player: { x: number; z: number };
}

export interface FeltState {
  hand?: FeltHand;
  bets: Map<number, SeatBet>;
}

const tmpL = new THREE.Matrix4();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (k: number) => 1 - (1 - k) ** 3;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Place one stack (or two side by side) of chips for an amount. */
export function stack(
  out: FeltParts,
  base: THREE.Matrix4,
  amount: number,
  x: number,
  z: number,
  a: number,
  y = FELT_Y,
): void {
  const chips = chipsFor(amount);
  chips.forEach((v, i) => {
    const s = Math.floor(i / STACK_MAX);
    const k = i % STACK_MAX;
    // A second stack sits beside the first, along the arc.
    const ox = s * Math.sin(a) * 0.042;
    const oz = s * Math.cos(a) * 0.042;
    tmpL.makeTranslation(x + ox, y + k * CHIP_H, z + oz);
    out.chip(tmpM.multiplyMatrices(base, tmpL), chipColor(v));
  });
}

/** Everything on one table's felt at `now`, through the table's world matrix. */
export function drawFelt(out: FeltParts, base: THREE.Matrix4, felt: FeltState, now: number): void {
  const h = felt.hand;
  for (const [seat, b] of felt.bets) {
    if (now - b.at > BET_LIFE_S) {
      felt.bets.delete(seat);
      continue;
    }
    if (h && seat === h.seat) continue;
    const s = betSpot(b.a);
    stack(out, base, b.amount, s.x, s.z, b.a);
  }
  if (!h) return;
  const p = h.plan;
  const tau = (now - h.t0) / h.dur;
  const end = p.clearAt + SWEEP_S;
  if (tau > end) {
    felt.hand = undefined;
    return;
  }
  // Cards: out of the shoe, onto their slot, turned when the plan says, swept at the clear.
  for (const c of p.cards) {
    if (tau < c.dealAt) continue;
    const place = slotPlace(c.slot, h.a, p.hands);
    const k = ease(clamp01((tau - c.dealAt) / FLIGHT_S));
    const stackY = c.slot.kind === 'hand' ? c.slot.index * 0.0006 : 0;
    let x = lerp(SHOE.x, place.x, k);
    let y = lerp(SHOE.y, FELT_Y + 0.0004 + stackY, k) + Math.sin(Math.PI * k) * 0.03;
    let z = lerp(SHOE.z, place.z, k);
    let yaw = lerp(0, place.yaw, k);
    // Turned over: π about the card's long axis shows the back.
    let up = c.up;
    let lift = 0;
    let roll = up ? 0 : Math.PI;
    if (c.flipAt !== null && tau >= c.flipAt) {
      const f = clamp01((tau - c.flipAt) / FLIP_S);
      up = !c.up;
      roll = lerp(c.up ? 0 : Math.PI, c.up ? Math.PI : 0, f);
      lift = Math.sin(Math.PI * f) * 0.02;
    }
    if (tau >= p.clearAt) {
      const s = ease(clamp01((tau - p.clearAt) / SWEEP_S));
      x = lerp(x, DISCARD.x, s);
      y = lerp(y, DISCARD.y, s);
      z = lerp(z, DISCARD.z, s);
      yaw = lerp(yaw, 0, s);
      roll = up ? 0 : Math.PI;
      lift = 0;
    }
    tmpQ.setFromAxisAngle(Y, yaw).multiply(tmpQ2.setFromAxisAngle(Z, roll));
    tmpL.compose(tmpP.set(x, y + lift, z), tmpQ, ONE);
    out.card(tmpM.multiplyMatrices(base, tmpL), c.card);
  }
  // Chips: the bet goes down, then is lost to the rack, pushed back or paid.
  if (tau < p.betAt) return;
  const bet = betSpot(h.a);
  const settled = tau >= p.settleAt;
  const s = ease(clamp01((tau - p.settleAt) / SWEEP_S));
  const c = ease(clamp01((tau - p.clearAt) / SWEEP_S));
  const toPlayer = (x: number, z: number, k: number) => ({
    x: lerp(x, h.player.x, k * 0.6),
    z: lerp(z, h.player.z, k * 0.6),
  });
  if (p.result === 'lose' && settled) {
    if (s < 1)
      stack(
        out,
        base,
        p.wagered,
        lerp(bet.x, RACK.x, s),
        lerp(bet.z, RACK.z, s),
        h.a,
        lerp(FELT_Y, RACK.y, s),
      );
  } else {
    const at = toPlayer(bet.x, bet.z, c);
    if (c < 1) stack(out, base, p.wagered, at.x, at.z, h.a);
  }
  if (p.result === 'win' && settled && c < 1) {
    // The dealer pays beside the bet, from the rack.
    const px = bet.x + Math.sin(h.a) * 0.05;
    const pz = bet.z + Math.cos(h.a) * 0.05;
    const from = { x: lerp(RACK.x, px, s), z: lerp(RACK.z, pz, s) };
    const at = toPlayer(from.x, from.z, c);
    stack(out, base, p.returned - p.wagered, at.x, at.z, h.a, lerp(RACK.y, FELT_Y, s));
  }
}
