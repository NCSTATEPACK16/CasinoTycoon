import type { IconName } from '../ui/icons.generated';
// Data-driven catalog of placeable objects. Balancing lives here, never in logic.
// spriteKey must exist in the placeholder generator (or, later, the atlas manifest).

export interface Footprint {
  w: number;
  h: number;
}

export type ObjectCategory = 'game' | 'service' | 'decor';

export interface ObjectDef {
  id: string;
  name: string;
  /** IconName in the UI sprite. Matches the def id — see scripts/build-icons.mjs. */
  icon: IconName;
  cost: number;
  upkeepPerDay: number;
  footprint: Footprint;
  spriteKey: string;
  // On-screen size in px for real (non-placeholder) art, since source images
  // are captured at arbitrary export resolution, not pre-sized to the iso grid.
  displaySize?: { w: number; h: number };
  ratingBonus?: number; // small, capped casino-rating contribution (RATING_BALANCE.signageBonusCap)
  category: ObjectCategory;
  /** `category: 'service'` covers both objects that take money (food stall,
   *  bar, cage) and one that doesn't (toilet) — the category alone can't
   *  tell liquidation's last-revenue-object protection which is which.
   *  Unset/false for everything else; games don't need it, since
   *  `category === 'game'` already implies revenue. */
  isRevenueSource?: boolean;
}

export const OBJECT_CATALOG: readonly ObjectDef[] = [
  {
    id: 'slot-machine',
    name: 'Slot Machine',
    icon: 'slot-machine',
    cost: 500,
    upkeepPerDay: 20,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-slot-machine',
    displaySize: { w: 77, h: 130 },
    category: 'game',
  },
  {
    id: 'blackjack-table',
    name: 'Blackjack Table',
    icon: 'blackjack-table',
    cost: 1200,
    upkeepPerDay: 50,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-blackjack-table',
    displaySize: { w: 220, h: 161 },
    category: 'game',
  },
  {
    id: 'craps-table',
    name: 'Craps Table',
    icon: 'craps-table',
    cost: 900,
    upkeepPerDay: 35,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-craps-table',
    displaySize: { w: 220, h: 144 },
    category: 'game',
  },
  {
    id: 'roulette-table',
    name: 'Roulette Table',
    icon: 'roulette-table',
    cost: 1800,
    upkeepPerDay: 50,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-roulette-table',
    displaySize: { w: 220, h: 135 },
    category: 'game',
  },
  {
    id: 'big-six-wheel',
    name: 'Big Six Wheel',
    icon: 'big-six-wheel',
    cost: 350,
    upkeepPerDay: 12,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-big-six-wheel',
    displaySize: { w: 81, h: 140 },
    category: 'game',
  },
  {
    // Guests play each other for a house rake, so it needs at least two
    // seated players before a hand is dealt — a lone guest earns nothing.
    id: 'poker-table',
    name: 'Poker Table',
    icon: 'poker-table',
    cost: 1200,
    upkeepPerDay: 40,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-poker-table',
    displaySize: { w: 220, h: 149 },
    category: 'game',
  },
  {
    // Only guests carrying at least HIGH_LIMIT_BALANCE.minWallet will sit —
    // the gate is wallet, not archetype, so a lucky guest can graduate in.
    id: 'high-limit-table',
    name: 'High-Limit Table',
    icon: 'high-limit-table',
    cost: 2500,
    upkeepPerDay: 80,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-high-limit-table',
    displaySize: { w: 212, h: 160 },
    category: 'game',
  },
  // P17 Part B Tier 1 — throughput. Cheap, small, fast: these fill dead floor
  // and pull volume, they do not make you rich. Costs and upkeeps are the
  // spec's ladder; the per-game balance (wager, RTP, variance, cadence, seats)
  // lives in src/data/balance.ts, which is also where each game documents the
  // two-plus axes it differs from every existing game on.
  //
  // Art is real: rendered by `npm run render-sprites` (the Blender iso rig in
  // scripts/render/), not hand-prompted.
  //
  // displaySize is exactly half the rendered PNG, NOT the round number from the
  // brief's delivery table. ObjectViews calls setDisplaySize(w, h), which
  // stretches each axis independently — so a declared size whose aspect differs
  // from the art's distorts the sprite. Against the brief's figures these were
  // out by up to 3%, which is a silly way to lose fidelity in a pipeline built
  // to make the projection exact. world.tier1.test.ts pins the two together.
  {
    id: 'penny-slots',
    name: 'Penny Slots',
    icon: 'penny-slots',
    cost: 180,
    upkeepPerDay: 8,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-penny-slots',
    displaySize: { w: 71, h: 120 },
    category: 'game',
  },
  {
    // The only game carrying a ratingBonus: a pachinko hall is loud and busy,
    // and that busyness is an amenity the floor gets paid for.
    id: 'pachinko',
    name: 'Pachinko Machine',
    icon: 'pachinko',
    cost: 320,
    upkeepPerDay: 12,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-pachinko',
    displaySize: { w: 78, h: 139 },
    ratingBonus: 1,
    category: 'game',
  },
  {
    // Six seats, slowest cadence, longest sessions, thickest edge. Cheap per
    // hour of guest occupancy and poor per square foot — worth four tiles only
    // when the floor has bodies and nowhere to put them.
    id: 'keno-lounge',
    name: 'Keno Lounge',
    icon: 'keno-lounge',
    cost: 450,
    upkeepPerDay: 14,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-keno-lounge',
    displaySize: { w: 217, h: 200 },
    category: 'game',
  },
  {
    // Thinnest edge in the house sold on the fastest cadence, across three
    // cabinets. Earns well with all three seats filled and close to nothing
    // with one, so its value depends on the rest of the build.
    id: 'video-poker',
    name: 'Video Poker Bank',
    icon: 'video-poker',
    cost: 560,
    upkeepPerDay: 18,
    footprint: { w: 1, h: 2 },
    spriteKey: 'img-video-poker',
    displaySize: { w: 170, h: 175 },
    category: 'game',
  },
  // P17 Part B Tier 2 — the working floor. Mid-price tables that carry a floor
  // once Tier 1 has filled it. displaySize is half the rendered PNG, per the
  // note on Tier 1 above. Sports Book is Tier 2's fifth game in the spec and is
  // deliberately absent — see the note in balance.ts.
  {
    id: 'sic-bo',
    name: 'Sic Bo Table',
    icon: 'sic-bo',
    cost: 780,
    upkeepPerDay: 28,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-sic-bo',
    displaySize: { w: 220, h: 146 },
    category: 'game',
  },
  {
    id: 'three-card-poker',
    name: 'Three-Card Poker',
    icon: 'three-card-poker',
    cost: 980,
    upkeepPerDay: 34,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-three-card-poker',
    displaySize: { w: 205, h: 150 },
    category: 'game',
  },
  {
    id: 'pai-gow',
    name: 'Pai Gow Poker',
    icon: 'pai-gow',
    cost: 1150,
    upkeepPerDay: 30,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-pai-gow',
    displaySize: { w: 205, h: 150 },
    category: 'game',
  },
  {
    // The largest ratingBonus on any game. A bingo hall is a poor direct earner
    // by design — twelve seats at a $4 card — and returns its cost in arrivals,
    // which fill everything else on the floor.
    id: 'bingo-hall',
    name: 'Bingo Hall',
    icon: 'bingo-hall',
    cost: 1450,
    upkeepPerDay: 45,
    footprint: { w: 4, h: 3 },
    spriteKey: 'img-bingo-hall',
    displaySize: { w: 332, h: 260 },
    ratingBonus: 3,
    category: 'game',
  },
  {
    id: 'toilet',
    name: 'Restroom',
    icon: 'toilet',
    cost: 300,
    upkeepPerDay: 10,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-restroom',
    displaySize: { w: 170, h: 189 },
    category: 'service',
  },
  {
    id: 'food-stall',
    name: 'Food Stall',
    icon: 'food-stall',
    cost: 400,
    upkeepPerDay: 15,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-food-stall',
    displaySize: { w: 190, h: 158 },
    category: 'service',
    isRevenueSource: true,
  },
  {
    id: 'plant',
    name: 'Plant',
    icon: 'plant',
    cost: 40,
    upkeepPerDay: 0,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-plant',
    displaySize: { w: 120, h: 144 },
    category: 'decor',
  },
  {
    id: 'neon-sign',
    name: 'Neon Sign',
    icon: 'neon-sign',
    cost: 250,
    upkeepPerDay: 5,
    footprint: { w: 1, h: 1 },
    spriteKey: 'img-neon-sign',
    displaySize: { w: 67, h: 110 },
    ratingBonus: 2,
    category: 'decor',
  },
  {
    id: 'marquee',
    name: 'Marquee',
    icon: 'marquee',
    cost: 600,
    upkeepPerDay: 12,
    footprint: { w: 2, h: 1 },
    spriteKey: 'img-marquee',
    displaySize: { w: 200, h: 141 },
    ratingBonus: 4,
    category: 'decor',
  },
  {
    id: 'bar',
    name: 'Bar',
    icon: 'bar',
    cost: 700,
    upkeepPerDay: 15,
    footprint: { w: 2, h: 1 },
    spriteKey: 'obj-bar',
    category: 'service',
    isRevenueSource: true,
  },
  {
    id: 'cage',
    name: 'VIP Cage',
    icon: 'cage',
    cost: 900,
    upkeepPerDay: 20,
    footprint: { w: 2, h: 2 },
    spriteKey: 'img-cage',
    displaySize: { w: 220, h: 120 },
    category: 'service',
    isRevenueSource: true,
  },
];

const BY_ID = new Map(OBJECT_CATALOG.map((d) => [d.id, d]));

export function getObjectDef(id: string): ObjectDef | undefined {
  return BY_ID.get(id);
}
