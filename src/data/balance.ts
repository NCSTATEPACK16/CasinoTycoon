// All gameplay balancing numbers. Tuning never requires logic edits.

export const GUEST_BALANCE = {
  walletMin: 40,
  walletMax: 220,
  startHappiness: 70,
  decayPerTick: { energy: 0.02, bladder: 0.04, hunger: 0.03 },
  // Below this a need sends the guest hunting for the matching service object.
  needThreshold: 25,
  // Needs this starved actively drain happiness.
  criticalThreshold: 10,
  criticalHappinessDrainPerTick: 0.05,
  leaveEnergy: 5,
  // Below this wallet a guest gives up and heads for the exit.
  brokeWallet: 10,
  moveTicksPerTile: 2,
  serviceTicks: 20,
  happinessOnWin: 4,
  happinessOnLoss: -1,
  happinessOnService: 3,
  maxGuests: 30,
  spawnBasePerTick: 0.004,
  // Word of mouth: rating 0–100 scales this on top of the base rate.
  spawnRatingScalePerTick: 0.06,
  spawnCapPerTick: 0.08,
} as const;

// Casino rating (0–100): happiness carries half; games, variety, and
// cleanliness make up the rest; breakdowns subtract.
export const RATING_BALANCE = {
  neutralHappiness: 65, // assumed when the floor is empty
  happinessWeight: 0.5,
  perMachine: 5,
  machineCap: 25,
  varietyBonus: 10, // at least two distinct game types on the floor
  cleanlinessMax: 15,
  perMessPenalty: 3,
  perBrokenPenalty: 5,
} as const;

export interface PayoutOutcome {
  p: number; // probability of this outcome per play
  multiplier: number; // payout as a multiple of cost-to-play
}

export const SLOT_BALANCE = {
  costToPlay: 10,
  wearPerPlay: 0.5,
  spinIntervalTicks: 8,
  spinsMin: 3,
  spinsMax: 8,
  payoutTable: [
    { p: 0.25, multiplier: 2 },
    { p: 0.1, multiplier: 3 },
    { p: 0.008, multiplier: 15 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected return-to-player fraction implied by the payout table (0.92 → 8% house edge). */
export function slotExpectedRtp(): number {
  return SLOT_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Blackjack: higher stakes, gentler house edge, slower rounds, communal table.
export const BLACKJACK_BALANCE = {
  costToPlay: 25,
  wearPerPlay: 0.25,
  playIntervalTicks: 12,
  playsMin: 4,
  playsMax: 10,
  seats: 4,
  payoutTable: [
    { p: 0.4, multiplier: 2 }, // win — even money
    { p: 0.09, multiplier: 1 }, // push — wager back
    { p: 0.028, multiplier: 2.5 }, // blackjack — 3:2
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the blackjack payout table (0.96 → 4% house edge). */
export function blackjackExpectedRtp(): number {
  return BLACKJACK_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Craps: fast communal rounds, dice-flavored payout table, same 4-seat table shape as blackjack.
export const CRAPS_BALANCE = {
  costToPlay: 15,
  wearPerPlay: 0.3,
  playIntervalTicks: 6,
  playsMin: 5,
  playsMax: 12,
  seats: 4,
  payoutTable: [
    { p: 0.35, multiplier: 2 }, // pass-line win
    { p: 0.05, multiplier: 3 }, // hot roll
    { p: 0.01, multiplier: 6 }, // rare proposition hit
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the craps payout table. */
export function crapsExpectedRtp(): number {
  return CRAPS_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Staff: hourly wages come out of casino cash at each hour boundary.
export const STAFF_BALANCE = {
  moveTicksPerTile: 2,
  patrolIdleTicks: 20, // idle ticks between patrol strolls
  mechanic: { wagePerHour: 3, repairTicks: 40 },
  janitor: { wagePerHour: 2, cleanTicks: 25 },
} as const;

// Trash and spills: unhappy guests drop them; nearby guests sour further.
export const MESS_BALANCE = {
  unhappyThreshold: 40,
  dropChancePerTick: 0.003,
  happinessDrainPerTickNearby: 0.04,
  maxDrainStacks: 3, // cap on how many messes stack their drain
  radius: 3, // Chebyshev tiles
  maxMesses: 40,
} as const;

// Food Stall menu pricing: player-tunable price band and the gouging threshold
// that triggers a guest's "rip-off" reaction.
export const FOOD_BALANCE = {
  priceFloorFactor: 0.5,
  priceCeilFactor: 6,
  ripoffMultiplier: 3,
  happinessOnRipoff: -6,
} as const;
