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
  // P16 — both terms scaled up 12% (0.004 / 0.06) to hold average traffic flat
  // while the modifier magnitudes came down. Milder events cut the expected
  // daily spawn multiplier from 1.216 to 1.084, and leaving these alone would
  // have shipped a 10.9% traffic nerf under the banner of a variance fix.
  spawnBasePerTick: 0.0045,
  // Word of mouth: rating 0–100 scales this on top of the base rate.
  spawnRatingScalePerTick: 0.0673,
  spawnCapPerTick: 0.08,
  /** P16 — how much of word of mouth is the casino's standing rather than the
   *  state of the floor right now. Reputation moves a few points a day at most
   *  and drifts back to neutral, so this is the term that makes yesterday
   *  predict today; at 0 the formula is the pre-P16 rating-only one. */
  spawnReputationWeight: 0.5, // [design guess]
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
  // P16 — reshaped at an identical 0.92 RTP to cut per-pull variance.
  //
  // A day's profit is a few hundred pulls summed, so the 8% edge only shows
  // through once the pull count is large next to the payout spread. The old
  // table (0.25@2x, 0.10@3x, 0.008@15x) had a per-pull sd 21x the edge, needing
  // ~450 pulls before the edge dominated — several times what a small floor
  // sees in a day. Daily profit was therefore a coin flip by construction, and
  // no amount of retuning the modifiers could have fixed it.
  //
  // Most of that variance lived in the 15x tail, so it is rarer here, and the
  // RTP it gives up comes back as a frequent 1x "money back" band — which is
  // how real slot floors hold players at low volatility. Same edge, same
  // jackpot, sd now 11.8x the edge: ~140 pulls, which a day does reach.
  payoutTable: [
    { p: 0.49, multiplier: 1 },
    { p: 0.2, multiplier: 2 },
    { p: 0.002, multiplier: 15 },
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

// ---------------------------------------------------------------------------
// P17 Part B, Tier 1 — throughput.
//
// Cheap, small, fast. These fill dead floor and pull volume; they do not make
// you rich. The spec's non-negotiable design rule is that every new game must
// differ from every existing one on at least TWO of: costToPlay, RTP, payout
// variance, cadence, session length, seats, minWallet, wearPerPlay, footprint,
// upkeep, ratingBonus. Each table below says which two (or more) it moves.
//
// None of the four carries a table minimum. That is deliberate and follows the
// rule CasinoGame already states for slots: these are fixed-denomination
// machines and a fixed-price keno ticket, so they have a coin size, not a
// minimum. A "minimum" dial on them would be the same lever wearing a
// misleading name. Tier 2's sic-bo / three-card-poker / pai-gow are the real
// table games, and they are where TABLE_MINIMUMS.defaultByType grows.

// Penny slots: the cheapest way to occupy a tile. Differs from slot-machine on
// costToPlay (2 vs 10), variance (sd/edge 6.9 vs 11.8), cadence (5 vs 8 ticks),
// session length (5-14 vs 3-8 spins) and RTP (0.90 vs 0.92).
//
// The higher hold is not a nerf dressed as flavour — a low-denomination machine
// really does hold more, and it is what keeps a $2 wager worth building at all.
export const PENNY_SLOT_BALANCE = {
  costToPlay: 2,
  wearPerPlay: 0.35,
  spinIntervalTicks: 5,
  spinsMin: 5,
  spinsMax: 14,
  // RTP 0.90. Deliberately the flattest table in the house: a big 1x "money
  // back" band, a modest 2x, and a 5x tail small enough that it never drives a
  // day. sd/edge = 6.9, well under the 12 bar — this game's identity is that it
  // pays out predictably and slowly, so a floor of them is a floor you can plan
  // around rather than gamble on.
  payoutTable: [
    { p: 0.55, multiplier: 1 },
    { p: 0.17, multiplier: 2 },
    { p: 0.002, multiplier: 5 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the penny-slot payout table (0.90 → 10% house edge). */
export function pennySlotExpectedRtp(): number {
  return PENNY_SLOT_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Pachinko: noise as an amenity. Differs from penny-slots on costToPlay (5 vs
// 2), RTP (0.88 vs 0.90), cadence (6 vs 5), upkeep and — the one that matters —
// ratingBonus, which no other game in the catalogue carries. A pachinko hall is
// loud and busy, and the rating bonus is that busyness paying rent.
export const PACHINKO_BALANCE = {
  costToPlay: 5,
  wearPerPlay: 0.45,
  spinIntervalTicks: 6,
  spinsMin: 4,
  spinsMax: 10,
  // RTP 0.88. sd/edge = 7.2.
  payoutTable: [
    { p: 0.42, multiplier: 1 },
    { p: 0.2, multiplier: 2 },
    { p: 0.012, multiplier: 5 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the pachinko payout table (0.88 → 12% house edge). */
export function pachinkoExpectedRtp(): number {
  return PACHINKO_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Keno lounge: cheap per hour of guest occupancy, poor per square foot. The
// slowest cadence and the longest sessions in the game, against the highest
// house edge — which is what real keno is. Differs from every existing game on
// cadence (30 ticks vs blackjack's 12), session length (10-24 vs 4-10), seats
// (6), RTP (0.75) and footprint-to-earnings.
//
// It parks six guests somewhere for a long time and takes a little from each.
// That is worth building when the floor has bodies and nowhere to put them, and
// a waste of four tiles when it does not.
export const KENO_BALANCE = {
  costToPlay: 6,
  wearPerPlay: 0.1, // barely anything moves — a board and a blower
  playIntervalTicks: 30,
  playsMin: 10,
  playsMax: 24,
  seats: 6,
  // RTP 0.75 — the thickest edge in the house, and still the lowest variance
  // (sd/edge = 2.7). High edge plus low variance is exactly why a keno lounge
  // is a reliable earner rather than an exciting one.
  payoutTable: [
    { p: 0.5, multiplier: 1 },
    { p: 0.12, multiplier: 2 },
    { p: 0.0025, multiplier: 4 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the keno payout table (0.75 → 25% house edge). */
export function kenoExpectedRtp(): number {
  return KENO_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Video poker: the thinnest edge in the house, sold on throughput. Three
// cabinets in one object, the fastest cadence of any game (4 ticks), and a 4%
// edge — so it earns well with three guests on it and close to nothing with
// one. It rewards a busy floor and punishes a quiet one, which is the only
// earner in the catalogue whose value depends on the rest of the build.
//
// NO JACKPOT BAND, and that is a finding rather than an omission. At a 4% edge
// the variance bar is brutal: a 0.0005 chance of 20x on its own takes sd/edge
// from 11.1 to 15.6, and even a 0.0002 tail lands at 13.1. A thin edge simply
// cannot carry a tail and still leave a day's takings meaningful — sd/edge
// scales as 1/edge. So the royal flush is deliberately not modelled, and video
// poker's identity is grind, not glory.
export const VIDEO_POKER_BALANCE = {
  costToPlay: 5,
  wearPerPlay: 0.3,
  playIntervalTicks: 4,
  playsMin: 8,
  playsMax: 20,
  seats: 3, // one per cabinet in the bank
  // RTP 0.96. sd/edge = 11.1.
  payoutTable: [
    { p: 0.8, multiplier: 1 },
    { p: 0.08, multiplier: 2 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the video-poker payout table (0.96 → 4% house edge). */
export function videoPokerExpectedRtp(): number {
  return VIDEO_POKER_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// ---------------------------------------------------------------------------
// P17 Part B, Tier 2 — the working floor.
//
// Mid-price tables that carry a floor once Tier 1 has filled it. Same
// non-negotiable rule as Tier 1: every game differs from every other on at
// least two axes, now enforced mechanically — payoutVariance.test.ts checks all
// pairs in the catalogue and names the axes an offending pair shares.
//
// EVERY WAGER AND EDGE BELOW WAS CUT after measurement. The first pass gave sic
// bo a $20 wager at an 11% edge and three-card poker $30 at 6%, and the
// `workingFloor` bot then won 14/14 with best days of $2,371-$4,181 against
// goals of $700 and $1,000 — several times what a comparable shipped table
// earns. The dominant term is extraction per guest, not price: a guest plays
// playsMin..playsMax times and leaves, so a table's take is roughly
// plays x wager x edge. Sic bo was pulling $26 a guest against blackjack's $10.
//
// Three of the four carry a real table minimum (sic-bo, three-card-poker,
// pai-gow are dealt table games, so the dial means something on them) and are
// registered in TABLE_MINIMUMS.defaultByType and BASE_WAGER_BY_TYPE below.
// Bingo is a fixed-price card, like keno — a coin size, not a minimum.
//
// Sports Book is specified in the P17 spec as Tier 2's fifth game and is NOT
// here. Its defining property is that "revenue settles on a schedule rather
// than per-guest", which needs a per-tick machine hook, a pending-stake pool
// and its own revenue attribution path — none of which exist. That is a new sim
// pattern of the same shape the bar got its own spec for in P10.6, not a
// balance table. Its art is rendered and committed; the mechanic is deferred.

// Sic Bo: the swingiest table in the house, and the number is deliberate. At
// sd/edge 11.4 it sits just inside the bar — high variance is a legitimate
// design choice, but the spec requires it be a choice with a figure attached
// rather than an accident of picking multipliers that looked exciting.
export const SIC_BO_BALANCE = {
  costToPlay: 12,
  wearPerPlay: 0.3,
  playIntervalTicks: 9,
  playsMin: 5,
  playsMax: 12,
  seats: 4,
  // RTP 0.91, sd/edge 11.3. The 10x branch is what makes a sic bo day swing, and
  // it is fat enough to clear JACKPOT_PAYOUT_MULT so the table drives P11's
  // strut and jackpot beats — but only 0.6% likely, because a thinner edge
  // pushes sd/edge up and the first cut of this table (11% edge, 1.2% tail)
  // measured 13.9, outside the bar.
  payoutTable: [
    { p: 0.43, multiplier: 1 },
    { p: 0.21, multiplier: 2 },
    { p: 0.006, multiplier: 10 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the sic bo payout table (0.91 → 9% house edge). */
export function sicBoExpectedRtp(): number {
  return SIC_BO_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Three-Card Poker: the reliable mid table. Four seats, fast rounds, a moderate
// edge and no tail at all — nothing about it is exciting, which is the point.
// It is what a floor buys when it wants the day to be predictable.
export const THREE_CARD_POKER_BALANCE = {
  costToPlay: 18,
  wearPerPlay: 0.22,
  playIntervalTicks: 9,
  playsMin: 5,
  playsMax: 12,
  seats: 4,
  // RTP 0.94, sd/edge 11.7 — high only because the edge is thin, not because
  // the spread is wide (the table's largest multiplier is 2x). Same effect that
  // puts blackjack at 24.3; see payoutVariance.test.ts.
  payoutTable: [
    { p: 0.5, multiplier: 1 },
    { p: 0.22, multiplier: 2 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the three-card-poker payout table (0.94 → 6% edge). */
export function threeCardPokerExpectedRtp(): number {
  return THREE_CARD_POKER_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Pai Gow Poker: the steady pick. Very slow, very long sessions, and a huge
// push band — the lowest per-play standard deviation of any game in the
// catalogue at 0.610, under keno's 0.677.
//
// Note keno still has the lower sd/EDGE ratio (2.7 against 5.2), because its
// edge is thicker. Both statements are true and they are different claims: pai
// gow swings least in absolute dollars per hand, keno needs fewest hands before
// its edge shows through.
export const PAI_GOW_BALANCE = {
  costToPlay: 22,
  wearPerPlay: 0.12,
  playIntervalTicks: 22,
  playsMin: 8,
  playsMax: 18,
  seats: 6,
  // RTP 0.91. The 0.62 band at 1x is the push — pai gow's real signature, and
  // what flattens the distribution.
  payoutTable: [
    { p: 0.62, multiplier: 1 },
    { p: 0.145, multiplier: 2 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the pai gow payout table (0.91 → 9% house edge). */
export function paiGowExpectedRtp(): number {
  return PAI_GOW_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
}

// Bingo Hall: a crowd draw that pays in arrivals more than in takings. Twelve
// seats at a $4 card, so the per-head margin is trivial and the object only
// works if it is full — and its ratingBonus of 3 (the largest on any game) is
// the real return, pulling the arrivals that fill everything else on the floor.
// Four tiles wide by three deep, so it is also the most expensive object in the
// game per square foot of floor it eats.
export const BINGO_BALANCE = {
  costToPlay: 4,
  wearPerPlay: 0.08,
  playIntervalTicks: 20,
  playsMin: 6,
  playsMax: 14,
  seats: 12,
  // RTP 0.86, sd/edge 4.85 — thick edge on a tiny wager, so a bingo hall is
  // reliable and nearly irrelevant as a direct earner.
  payoutTable: [
    { p: 0.52, multiplier: 1 },
    { p: 0.17, multiplier: 2 },
  ] as readonly PayoutOutcome[],
} as const;

/** Expected RTP implied by the bingo payout table (0.86 → 14% house edge). */
export function bingoExpectedRtp(): number {
  return BINGO_BALANCE.payoutTable.reduce((sum, o) => sum + o.p * o.multiplier, 0);
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

/**
 * P16 — the cost of running the house on credit.
 *
 * Before this, `state.cash` was a plain signed number with no consequence for
 * going under, which made "spend past zero" strictly dominant: free leverage.
 * Interest is charged on the *closing* balance only, so recovering by midnight
 * costs nothing.
 */
export const DEBT = {
  /** Charged at midnight on a negative closing balance. */
  dailyInterestRate: 0.05, // [design guess]
  /** How far below zero the house may run when a campaign names no limit of
   *  its own. Deliberately loose — Task 9 tightens the per-campaign values
   *  under measurement. Sandbox uses this permanently. */
  defaultCreditLimit: 10_000, // [design guess]
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
  // Deliberately left at 0.55 while P16 cut the magnitudes below. Every spawn
  // modifier in the catalog is upside, so making events *rarer* lowers average
  // traffic rather than its swing — it cuts the mean, not the variance, which
  // is the opposite of what was wanted. Milder events on the same cadence keep
  // the flavour and take the noise out.
  drawChance: 0.55,
  catalog: [
    {
      id: 'convention',
      name: 'Convention in town',
      blurb: 'The hotel next door is full. Expect a crowd, and expect it to bet big.',
      // P16 — was 1.45. The archetype bias is the interesting half of a
      // convention; the raw volume spike was mostly variance.
      spawnMult: 1.2,
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
      // P16 — was 1.8 / 0.7. A near-doubling of arrivals on a coin flip put
      // more variance into one day than a whole build order did.
      spawnMult: 1.3,
      archetypeBias: { tourist: 2.5 },
      walletMult: 0.85,
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
    // P17 Tier 2 — dealt table games, so the minimum dial is a real decision on
    // them. Bingo and keno are fixed-price cards and deliberately absent.
    'sic-bo': 10,
    'three-card-poker': 25,
    'pai-gow': 25,
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
  'sic-bo': SIC_BO_BALANCE.costToPlay,
  'three-card-poker': THREE_CARD_POKER_BALANCE.costToPlay,
  'pai-gow': PAI_GOW_BALANCE.costToPlay,
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

// ---------------------------------------------------------------------------
// P3 / A1b — the persistent patron registry.
// ---------------------------------------------------------------------------

/**
 * A1b — carded patrons.
 *
 * The anonymous crowd stays the economic base; a bounded roster of carded
 * patrons sits beside it as lightweight data records, rehydrated into a live
 * guest only on a return visit. That is the Cities: Skylines instanced-vs-data
 * split, and it is what makes a persistent roster affordable in a browser: at
 * `rosterCap` records of roughly 120 bytes the whole registry is ~18KB of save.
 *
 * **Promotion is on theo, not visit count** — mirroring real player
 * development, and reusing the math A1a already ships. **Tier thresholds are
 * geometric**: real ladders step 2.5-10x (Caesars 15k -> 25k -> 75k -> 150k
 * tier credits; MGM 20k -> 75k -> 200k), and the ~4x steps below are that
 * shape at this game's scale. The *ratios* are the researched part; the
 * absolute numbers are tuned against this economy.
 */
export const PATRONS = {
  /** Lifetime theo at which a guest gets carded. Roughly four times A1a's
   *  comp floor, so being carded means more than having sat down once. */
  cardThresholdTheo: 60, // [design guess]
  /** Hard bound on the roster. Records past it are evicted lowest-theo first,
   *  which is also who the player is least likely to have noticed. */
  rosterCap: 150,
  /** A patron unseen this long is dropped. Without a prune the roster is a
   *  ratchet, and the save grows for a player who has moved on. */
  pruneAfterDaysAbsent: 12,
  /** Base chance, per patron per day, that they turn up. Tier adds to it. */
  returnBaseChancePerDay: 0.12, // [design guess]
  /** Cap on how many patrons can be due on one day. Without it a mature
   *  roster front-loads the door with returning faces and the anonymous crowd
   *  stops being the base — plus every one of them holds a spawn slot. */
  maxReturnsPerDay: 8,
  /** A patron who wanted a host and left un-comped is less likely to come
   *  back. This is the whole weight behind `wantsHost` — a tier benefit the
   *  player can lose is a tier benefit the player can feel. */
  hostNeglectReturnPenalty: 0.5,
  /**
   * The ladder. `returnBonus` adds to the daily return chance; `compRate`
   * scales the session comp budget A1a bounds, so a black-tier regular can be
   * looked after in a way a walk-in cannot. Carded patrons also skip A1a's
   * theo floor entirely — their lifetime record already cleared a far higher
   * bar than one session's play ever asks for.
   */
  tiers: [
    { id: 'silver', name: 'Silver', theo: 0, returnBonus: 0.05, compRate: 0.15, wantsHost: false },
    { id: 'gold', name: 'Gold', theo: 400, returnBonus: 0.18, compRate: 0.22, wantsHost: false },
    { id: 'black', name: 'Black', theo: 1600, returnBonus: 0.35, compRate: 0.35, wantsHost: true },
  ],
} as const;

export type PatronTierId = (typeof PATRONS.tiers)[number]['id'];
export type PatronTier = (typeof PATRONS.tiers)[number];

/** The highest tier this lifetime theo has earned. Never null — a carded
 *  patron is at least the base tier. */
export function patronTierFor(lifetimeTheo: number): PatronTier {
  let best: PatronTier = PATRONS.tiers[0]!;
  for (const tier of PATRONS.tiers) {
    if (lifetimeTheo >= tier.theo) best = tier;
  }
  return best;
}
