// Tuning for the v2 guest brain and staff dispatch. Kept beside the code it
// tunes rather than in data/balance.ts, which is the economy session's file:
// these numbers decide *where guests go*, not what anything costs.

import type { GuestArchetype } from '../entities/Guest';

export const AI = {
  /** A guest re-scores mid-activity this often (ticks) to notice a pressing need. */
  rethinkEveryTicks: 25,
  /** A new activity must beat the current one by this factor to interrupt it. */
  hysteresis: 1.3,
  /** Distance falloff: score × 1 / (1 + metres / this). */
  distanceScale: 18,
  /** A full table is still worth queueing for at this fraction of its score. */
  queueFactor: 0.7,
  /** A line this long is a reason to play something else instead. */
  maxQueueLength: 3,
  /** Guests per service stand cell (using or on the way) before it counts as full. */
  serviceStandCap: 2,
  /** Longest a guest waits in a queue before re-thinking (ticks). */
  maxQueueTicks: 300,
  /** Ambling score, so a guest with nothing worth doing still drifts about. */
  wanderScore: 0.12,
  /** Nav mode: how far (cells) a browsing guest strolls, and how many
   *  fruitless looks before giving up on a full casino. */
  browseRadius: 6,
  /** Nav mode: a leaving guest this close (m) to the entrance has left. */
  exitReach: 2.5,
  maxIdleLooks: 4,
  /** Bankroll a guest needs to be allowed into High-Limit at all. */
  highLimitBankroll: 400,
  /** Leave when happiness sinks this low, broke or not. */
  leaveUnhappy: 12,
  /** Drinks within one visit that make a guest drunk. */
  drunkAfterDrinks: 3,
  drunkSpeedMult: 0.7,
  /** Drunk guests drop spills this many times as often. */
  drunkMessMult: 3,
} as const;

export interface ArchetypeAI {
  /** Unit bet as a fraction of the session bankroll. */
  riskFrac: [number, number];
  /** Fraction of the bankroll the guest will lose before walking. */
  stopLoss: [number, number];
  /** Fractional win that sends the guest home happy. Held at the top of
   *  SPEC's 30–150% band: a winner who walks leaves content, and content
   *  departures lift reputation and arrivals — at the low end of the band that
   *  feedback was enough to let a build-and-abandon run win a campaign
   *  (data/campaigns/difficulty.test.ts). */
  winGoal: [number, number];
  /** Blackjack basic-strategy error rate. */
  bjError: [number, number];
  /** How much a comp moves this guest (0..1). */
  compSensitivity: [number, number];
  /** Game preference by catalog GameKind (or defId for non-engine games). */
  prefs: Record<string, number>;
}

const BASE_PREFS: Record<string, number> = {
  slots: 1,
  blackjack: 0.8,
  roulette: 0.7,
  craps: 0.6,
  uth: 0.5,
  other: 0.5,
};

export const ARCHETYPE_AI: Record<GuestArchetype, ArchetypeAI> = {
  regular: {
    riskFrac: [0.03, 0.08],
    stopLoss: [0.6, 1],
    winGoal: [0.8, 1.5],
    bjError: [0.05, 0.2],
    compSensitivity: [0.3, 0.7],
    prefs: BASE_PREFS,
  },
  tourist: {
    riskFrac: [0.05, 0.12],
    stopLoss: [0.6, 0.9],
    winGoal: [0.6, 1.2],
    bjError: [0.12, 0.25],
    compSensitivity: [0.1, 0.4],
    prefs: { ...BASE_PREFS, slots: 1.2, roulette: 0.9, craps: 0.4, uth: 0.3 },
  },
  biker: {
    riskFrac: [0.04, 0.1],
    stopLoss: [0.8, 1],
    winGoal: [1, 1.5],
    bjError: [0.08, 0.22],
    compSensitivity: [0.2, 0.5],
    prefs: { ...BASE_PREFS, craps: 1.1, slots: 0.7 },
  },
  highRoller: {
    riskFrac: [0.02, 0.06],
    stopLoss: [0.7, 1],
    winGoal: [1, 1.5],
    bjError: [0, 0.06],
    compSensitivity: [0.6, 1],
    prefs: { ...BASE_PREFS, blackjack: 1.2, craps: 1, uth: 0.9, slots: 0.6 },
  },
};
