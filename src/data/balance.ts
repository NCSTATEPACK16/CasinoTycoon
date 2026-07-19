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
  foodPrice: 8,
  happinessOnWin: 4,
  happinessOnLoss: -1,
  happinessOnService: 3,
  maxGuests: 30,
  spawnBasePerTick: 0.004,
  spawnPerMachinePerTick: 0.01,
  spawnCapPerTick: 0.08,
} as const;

export interface SlotPayout {
  p: number; // probability of this outcome per spin
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
  ] as readonly SlotPayout[],
} as const;

/** Expected return-to-player fraction implied by the payout table (0.92 → 8% house edge). */
export function slotExpectedRtp(): number {
  return SLOT_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}
