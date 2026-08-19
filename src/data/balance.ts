// All gameplay balancing numbers. Tuning never requires logic edits.

export const GUEST_BALANCE = {
  walletMin: 40,
  walletMax: 220,
  startHappiness: 70,
  decayPerTick: { energy: 0.02, bladder: 0.04, hunger: 0.03, thirst: 0.03 },
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
  signageBonusCap: 10,
} as const;

// Ambient-only staff: no job-queue behavior, just floor presence for a
// small capped rating bonus (same shape as neon-sign/marquee's ratingBonus,
// applied to staff instead of a placed object).
export const SECURITY_BALANCE = {
  bonusPerStaff: 1.5,
  bonusCap: 8,
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

// Roulette: a wide crowd table whose point is variance. The 1.5% branch pays
// 20x, which clears STRUT_BALANCE.payoutMultiplier and so drives the P11
// winner-strut and chip-arc jackpot that slots otherwise trigger alone.
export const ROULETTE_BALANCE = {
  costToPlay: 20,
  wearPerPlay: 0.2,
  playIntervalTicks: 10,
  playsMin: 4,
  playsMax: 10,
  seats: 6,
  payoutTable: [
    { p: 0.015, multiplier: 20 }, // straight-up number — the variance tail
    { p: 0.08, multiplier: 3 }, // column/dozen
    { p: 0.19, multiplier: 2 }, // even-money outside bet
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the roulette payout table (0.92 → 8% house edge). */
export function rouletteExpectedRtp(): number {
  return ROULETTE_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Big Six: cheap, fast, standing, and by far the worst odds in the house.
// extraHappinessOnLoss stacks on top of GUEST_BALANCE.happinessOnLoss (-1),
// so a losing spin costs -3 happiness in total. Without it the wheel is just
// a cheap slot with bad math and the profit-vs-happiness tension is invisible
// until it surfaces later as an unexplained rage quit.
export const BIG_SIX_BALANCE = {
  costToPlay: 5,
  wearPerPlay: 0.4,
  spinIntervalTicks: 5,
  spinsMin: 3,
  spinsMax: 10,
  extraHappinessOnLoss: -2,
  payoutTable: [
    { p: 0.3, multiplier: 2 },
    { p: 0.05, multiplier: 4 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the big six payout table (0.80 → 20% house edge). */
export function bigSixExpectedRtp(): number {
  return BIG_SIX_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Poker: guests play each other and the house takes a rake, so revenue is a
// steady percentage of volume rather than a house edge on a payout table.
// This is the only game that pays for guest COUNT rather than guest SPEND —
// and the only one that earns nothing at all when under-populated.
export const POKER_BALANCE = {
  costToPlay: 30,
  wearPerPlay: 0.15,
  playIntervalTicks: 15,
  playsMin: 6,
  playsMax: 15,
  seats: 6,
  minPlayers: 2,
  rake: 0.05,
  // How long a guest keeps a seat at a table that can't deal yet. Without a
  // bounded wait a lone guest vacates on its first zero-wager play attempt, so
  // the table only ever deals when two guests happen to sit within one play
  // interval of each other — 12 seconds of patience is what makes a poker room
  // fill up at all.
  maxWaitTicks: 120,
} as const;

// No expectedRtp helper — poker's return is computed from live table
// population, not a static payout table.

// High-limit: gated on wallet rather than archetype. highRollerChance is only
// 0.015, so an archetype gate would leave the table idle almost always; a
// wallet gate admits high rollers on arrival AND lets an ordinary guest who
// has won big graduate into it. Best odds in the house, so the VIP treatment
// is real rather than cosmetic.
export const HIGH_LIMIT_BALANCE = {
  costToPlay: 150,
  wearPerPlay: 0.2,
  playIntervalTicks: 14,
  playsMin: 3,
  playsMax: 8,
  seats: 3,
  minWallet: 400,
  payoutTable: [
    { p: 0.02, multiplier: 10 },
    { p: 0.12, multiplier: 3 },
    { p: 0.19, multiplier: 2 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the high-limit payout table (0.94 → 6% house edge). */
export function highLimitExpectedRtp(): number {
  return HIGH_LIMIT_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Staff: hourly wages come out of casino cash at each hour boundary.
export const STAFF_BALANCE = {
  moveTicksPerTile: 2,
  patrolIdleTicks: 20, // idle ticks between patrol strolls
  mechanic: { wagePerHour: 3, repairTicks: 40 },
  janitor: { wagePerHour: 2, cleanTicks: 25 },
  bartender: { wagePerHour: 3 },
  waitress: { wagePerHour: 3, deliverTicks: 15 },
  pitBoss: { wagePerHour: 4 },
  security: { wagePerHour: 3 },
  dealer: { wagePerHour: 4 },
  cashier: { wagePerHour: 4 },
} as const;

// Cashier + Cage: a cashier stationed at a cage lets guests running low on
// cash (but not yet broke) get a one-time wallet top-up for a fee — same
// "staffed booth, presence-gated" shape as the bar. No production timer
// (unlike the bartender) — the cage just needs a cashier physically there.
export const CASHIER_BALANCE = {
  walletThreshold: 30, // below this (but still affordable to keep playing) triggers a visit
  advanceAmount: 40,
  fee: 8,
} as const;

// Dealer: cosmetic-only staff member stationed at a blackjack/craps table.
// No sim interaction with seating/payout — just a small, capped rating bonus
// per dealt table (a fuller-looking floor reads as more legitimate).
export const DEALER_BALANCE = {
  dealerBonusPerTable: 2,
  dealerBonusCap: 10,
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

// Rage quit: broke AND unhappy leaves fast, angry, and dings the rating once.
export const RAGE_BALANCE = {
  happinessThreshold: 25, // below this + broke = raging; broke-but-content leaves calmly
  speedMult: 1.5,
  ratingDing: 4,
  maxRatingPenalty: 20, // stacked dings cap out so a bad run can't zero the rating
  dingDecayPerHour: 1,
} as const;

// Winner strut: a big win earns a brief celebration beat.
export const STRUT_BALANCE = {
  payoutMultiplier: 5, // payout >= wager * this triggers the strut
  durationTicks: 30,
  happinessBump: 6,
} as const;

// Bar: bartender brews on a timer into a capped stock; waitress delivers to
// seated guests, wandering guests self-serve like the food stall/toilet.
export const BAR_BALANCE = {
  maxStock: 6,
  brewTicks: 15, // one drink added roughly every 1.5s at 10 ticks/sec
  drinkPrice: 12,
  drinkCost: 4, // what the casino "pays" per drink brewed, for a real margin
  thirstRestore: 100,
  happinessOnSelfServe: 3, // matches GUEST_BALANCE.happinessOnService
  happinessOnDelivery: 5, // a little more — real table service feels better
} as const;

// Guest archetypes: a small independent weighted roll on spawn. biker/tourist
// are cosmetic-only (same needs/decay/wallet as regular) — highRoller is the
// one with real mechanical weight, via a much wider/higher wallet range so
// they visibly spend more and stick around longer. Deliberately bounded scope
// per the P10.6 roadmap — no new decay-rate or happiness-threshold behavior.
export const ARCHETYPE_BALANCE = {
  highRollerChance: 0.015,
  bikerChance: 0.05,
  touristChance: 0.05,
  highRollerWalletMin: 250, // ~6x GUEST_BALANCE.walletMin
  highRollerWalletMax: 1100, // ~5x GUEST_BALANCE.walletMax
} as const;

// Campaign score: profit-vs-goal ratio × day-efficiency × final rating,
// each factor weighted so no single one dominates (tuned by score.test.ts).
export const SCORE_BALANCE = {
  baseMultiplier: 100,
  // Reaching the goal early counts more than reaching it on the last day.
  dayEfficiencyFloor: 0.5, // never let a last-day win score below half credit
  ratingWeight: 0.01, // rating is 0-100; this keeps its influence proportional
} as const;

// ---------------------------------------------------------------------------
// Track 2 — the depth spine (A5 modifiers, A1a comps, A12 reputation).
//
// Sourcing convention from the research report: [industry] traces to casino
// operations sources; [design guess] has no authoritative basis and exists
// only to be tuned. Do not defend a design guess in review as though it were
// researched.
// ---------------------------------------------------------------------------

/** Per-defId expected return-to-player, so theoretical win can be weighted by
 *  each game's own house edge rather than one blended number.
 *
 *  Poker is absent on purpose: its return comes from the rake on live table
 *  population, not a static payout table, so it has no meaningful RTP. Callers
 *  fall back to `defaultHouseEdge` for anything missing here — a game with no
 *  entry earns comps at the fallback rate rather than none at all. */
export function expectedRtpFor(defId: string): number | null {
  switch (defId) {
    case 'slot-machine':
      return slotExpectedRtp();
    case 'blackjack-table':
      return blackjackExpectedRtp();
    case 'craps-table':
      return crapsExpectedRtp();
    case 'roulette-table':
      return rouletteExpectedRtp();
    case 'big-six-wheel':
      return bigSixExpectedRtp();
    case 'high-limit-table':
      return highLimitExpectedRtp();
    default:
      return null;
  }
}

// A1a — targeted comps.
//
// theo = Σ_game wagered[game] × (1 − expectedRtp(game)). The player sends a
// specific guest a specific comp and watches that guest respond.
//
// This is §G's stated fallback, taken deliberately. The global reinvestment
// dial it replaces measured as a pure tax: match play a guest recycles returns
// ≈100% of itself to the house as theo, and the happiness channel clamps at
// 100 within ~$50 of comps, so both upside channels saturate and only the cost
// remains. No value of a reinvestment rate produced the required "peak, then
// negative near 30%" curve, because nothing in the model made moderate
// comping pay. Discrete comps sidestep that: the spend is small, chosen, and
// legibly attached to one guest — the distinction RCT players drew between
// targeted coupons and diffuse marketing.
export const COMPS = {
  /** What each comp costs the house. [design guess] */
  compUnit: { drink: 4, meal: 14, matchPlay: 25 },
  /** Session theo a guest must generate before they are comp-eligible. Keeps
   *  the player from comping someone who has not played. */
  theoFloorToComp: 15, // [design guess]
  /** Need restored by the comp that targets it, out of 100. */
  needRestored: { drink: 45, meal: 55 },
  /** Happiness per comp dollar, applied on top of the need it restores. */
  happinessPerDollar: 0.6, // [design guess]
  /** Cap on comp value per guest per session, as a multiple of the wallet they
   *  arrived with. Bounds how far a single guest can be propped up. */
  maxSessionExtensionPct: 0.35, // [design guess]
} as const;

export type CompKind = keyof typeof COMPS.compUnit;

// A5 — challenge modifiers. All [design guess]; no external source applies.
export interface ModifierEffects {
  /** Multiplies the per-tick spawn chance. */
  spawnMult?: number;
  /** Multiplies an archetype's slice of the arrival roll. */
  archetypeBias?: Partial<Record<GuestArchetypeId, number>>;
  /** Multiplies a new guest's starting wallet. */
  walletMult?: number;
  /** Multiplies the cage's one-time advance amount. */
  cageCapacityMult?: number;
  /** Multiplies the per-tick thirst decay. */
  thirstDecayMult?: number;
  /** Charged at midnight unless the cleanliness floor was held all day. */
  requiresCleanliness?: number;
  failPenalty?: number;
}

export interface ModifierDef extends ModifierEffects {
  id: string;
  name: string;
  /** One line, player-facing — this is the whole banner. */
  blurb: string;
}

type GuestArchetypeId = 'regular' | 'highRoller' | 'biker' | 'tourist';

export const MODIFIERS = {
  maxActivePerDay: 2,
  drawChance: 0.55,
  catalog: [
    {
      id: 'convention',
      name: 'Convention in town',
      blurb: 'The hotel next door is full. Expect a crowd, and expect it to bet big.',
      spawnMult: 1.45,
      archetypeBias: { highRoller: 3.0 },
    },
    {
      id: 'health-inspection',
      name: 'Health inspection',
      blurb: 'An inspector walks the floor at midnight. Keep it clean or pay the fine.',
      requiresCleanliness: 80,
      failPenalty: 400,
    },
    {
      id: 'chip-shortage',
      name: 'Chip shortage',
      blurb: 'The cage is running light. Advances are half what they should be.',
      cageCapacityMult: 0.5,
    },
    {
      id: 'bus-junket',
      name: 'Bus junket',
      blurb: 'Two coaches of day-trippers. Lots of them, and not much in their pockets.',
      spawnMult: 1.8,
      archetypeBias: { tourist: 2.5 },
      walletMult: 0.7,
    },
    {
      id: 'heat-wave',
      name: 'Heat wave',
      blurb: 'Nobody can stop drinking. Stock the bar.',
      thirstDecayMult: 1.6,
    },
  ] as readonly ModifierDef[],
} as const;

// A12 — reputation memory. All [design guess]. One persistent scalar, no
// registry: the whole feature is "yesterday is visible in today's arrivals".
export const REPUTATION = {
  start: 50,
  min: 0,
  max: 100,
  deltaPerRageQuit: -0.8,
  deltaPerJackpotPayout: 0.5,
  deltaPerContentLeaver: 0.15,
  /** Fraction of the distance back to `start` closed each midnight. Without
   *  this the scalar is absorbing at both ends. */
  dailyDriftToMean: 0.05,
  /** Hard cap on one day's net movement. The drift term alone does not stop a
   *  death spiral — a bad day has to be survivable, not just recoverable. */
  maxDailyDelta: 8,
  /** Archetype arrival multipliers at reputation = max. Below `start` the
   *  reciprocal applies, so a ruined reputation inverts the mix rather than
   *  merely flattening it. */
  archetypeBiasAtMax: { highRoller: 2.0, tourist: 1.6, biker: 0.5 },
} as const;

// ---------------------------------------------------------------------------
// P4 / A2 — per-instance table minimums.
// ---------------------------------------------------------------------------

/**
 * A2 — table minimums, the first per-instance game setting.
 *
 * **Correction to the research report.** `handsPerHourByOccupancy` is real
 * casino-operations data, but it cannot be used as an absolute rate here: the
 * sim runs at ~100× compression, so blackjack deals about 4 hands per in-game
 * hour, not 52–209. The array is valid only as a *ratio* — see
 * `occupancyRateMult` on SeatedCasinoGame. A heads-up player then deals ~4× as
 * fast as a full table (209/52), which is the real relationship expressed in
 * the sim's own units, and it is what makes "fewer players at a higher
 * minimum" self-balancing without inventing an elasticity coefficient. No
 * published source gives one, so inventing it would be fiction.
 */
export const TABLE_MINIMUMS = {
  /** The dial's stops. A free-entry field invites $7 tables and teaches
   *  nothing; a ladder makes the comparison between rungs the decision. */
  tiers: [5, 10, 25, 50, 100, 200] as readonly number[],
  /**
   * The tier each table type opens at.
   *
   * **Departure from the report.** It gives absolute minimums, which would
   * replace the per-type `costToPlay` values this economy is tuned around —
   * roulette would fall from a $20 wager to $7 and every campaign becomes
   * unwinnable. So the minimum *scales* the tuned wager instead of setting it:
   * at the default tier the wager is exactly what it is today, and each rung
   * moves it proportionally. A2 then adds a dial without silently rebalancing
   * the whole game underneath it — a change the player opts into.
   */
  defaultByType: {
    'blackjack-table': 25,
    'craps-table': 10,
    'roulette-table': 10,
    'poker-table': 25,
    'high-limit-table': 100,
    'big-six-wheel': 5,
  } as Readonly<Record<string, number>>,
  /**
   * Wallet a guest needs before it will sit, as a multiple of the wager.
   *
   * The report's ×20 is against the *minimum* and calibrated for wallets far
   * larger relative to bets than this sim's — at ×20 a $10 table gates at $200
   * against a 40–220 regular wallet, so raising a minimum is not a decision but
   * a demolition. Expressed against the wager it is scale-free, and it reads as
   * a rule rather than a coefficient: a guest wants enough for a few hands, not
   * one. The elasticity stays emergent — this gate plus the plain affordability
   * test decide who clears it, and the archetype wallet distributions do the
   * rest. No published source gives a minimum-to-occupancy curve.
   */
  minWalletMultiple: 2, // [design guess]
  /** Hands per hour at 1..7 seated. [industry] — used as a ratio only. */
  handsPerHourByOccupancy: [209, 139, 105, 84, 70, 60, 52] as readonly number[],
} as const;

/** Tuned wager each table type takes at its default tier. */
const BASE_WAGER_BY_TYPE: Readonly<Record<string, number>> = {
  'blackjack-table': BLACKJACK_BALANCE.costToPlay,
  'craps-table': CRAPS_BALANCE.costToPlay,
  'roulette-table': ROULETTE_BALANCE.costToPlay,
  'poker-table': POKER_BALANCE.costToPlay,
  'high-limit-table': HIGH_LIMIT_BALANCE.costToPlay,
  'big-six-wheel': BIG_SIX_BALANCE.costToPlay,
};

/** True for game types that carry a table minimum at all. Slots have a coin
 *  size, not a minimum, so a "minimum" dial there would be the same lever
 *  wearing a misleading name. */
export function supportsTableMinimum(defId: string): boolean {
  return TABLE_MINIMUMS.defaultByType[defId] !== undefined;
}

/** The wager this table type takes at the given minimum, scaled from its
 *  tuned value at the default tier. */
export function wagerForMinimum(defId: string, minimum: number): number {
  const base = BASE_WAGER_BY_TYPE[defId];
  const def = TABLE_MINIMUMS.defaultByType[defId];
  if (base === undefined || def === undefined) return base ?? 0;
  return Math.max(1, Math.round((base * minimum) / def));
}

/**
 * How much faster this table deals at `seated` players than at a full house —
 * the multiplier applied to its tuned play interval.
 *
 * Normalized against the table's own capacity, so a heads-up player at a
 * four-seat table gets 209/84 and at a seven-seat table 209/52. The curve is
 * about how crowded *this* table is, not an absolute rate: the sim runs at
 * ~100x compression, where blackjack deals about four hands an in-game hour,
 * so the industry array is only ever valid as a ratio.
 */
// The report's `handsPerHourByOccupancy` curve is deliberately NOT wired to the
// play interval. It is real casino-operations data, and the intent — a thinner
// table deals faster, so revenue per occupied seat partly offsets the guests a
// higher minimum turns away — is sound in a casino. It does not hold here:
// a guest in this sim plays until broke or satisfied, so their contribution is
// bounded by their wallet, not by how fast the table deals. A faster table
// does not earn more from the same guest, it empties them sooner and then
// idles. Measured on the campaign guard, wiring it in any normalization —
// anchored at a full table, half-full, or heads-up — cost The High Roller Club
// four of seven winnable seeds, and the heads-up anchor cost every campaign
// nearly all of them. A2's trade is carried by the wager and the bankroll gate
// instead, which is where the elasticity was always specified to be emergent.
