// The room's sound: four looped beds on the ambience bus, mixed from what the
// player can see and hear. Pure maths here; AudioEngine plays the beds and
// AmbienceFeed (main thread) gathers the inputs.
//
// - slots:  the machine room itself (reel chatter, bells far off). Always there
//           while machines stand near the ears, even with nobody playing.
// - crowd:  distant walla, growing with the guest count.
// - murmur: close conversation, the detail you only hear at eye level.
// - music:  a low lounge bed, louder by the bar and the food court.
//
// From the god view the room is quieter and wider: everything drops and a
// low-pass takes the edge off, as if heard from the gallery. Paused, it all
// ducks so the sim's stillness reads.

export type Bed = 'slots' | 'crowd' | 'murmur' | 'music';
export const BEDS: readonly Bed[] = ['slots', 'crowd', 'murmur', 'music'];

/** The looped file for each bed (public/audio, credits in assets/CREDITS.md). */
export const BED_FILES: Record<Bed, string> = {
  slots: 'amb-slots',
  crowd: 'amb-crowd',
  murmur: 'amb-murmur',
  music: 'music-lounge',
};

/** What is around the ears, distance-weighted (see AmbienceFeed.surroundings). */
export interface Surroundings {
  /** Slot and video machines, the big six, pachinko. */
  machines: number;
  /** Seated table games. */
  tables: number;
  /** The bar, food stalls and food-court floor. */
  lounge: number;
}

export interface AmbienceInput {
  guests: number;
  /** Camera height in metres: about 1.6 at eye level, 10–90 in the god view. */
  camY: number;
  /** Sim speed; 0 is paused. */
  speed: number;
  near: Surroundings;
  music: boolean;
}

export interface AmbienceMix extends Record<Bed, number> {
  /** Low-pass cutoff on the whole bed, Hz. */
  cutoff: number;
}

/** Guests at which the crowd is about two-thirds full. */
const CROWD_SCALE = 150;
/** Heights between which the mix moves from eye level to the full god view. */
const EYE_Y = 3;
const GOD_Y = 45;
/** Paused, the room drops to this. */
export const PAUSE_DUCK = 0.35;
const CUTOFF_EYE = 16000;
const CUTOFF_GOD = 2500;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 at eye level, 1 in the high god view. */
export function heightFactor(camY: number): number {
  return clamp01((camY - EYE_Y) / (GOD_Y - EYE_Y));
}

/** 0 for an empty floor, rising quickly then levelling off. */
export function crowdDensity(guests: number): number {
  return 1 - Math.exp(-Math.max(0, guests) / CROWD_SCALE);
}

/** The bed gains (before the ambience bus) and the low-pass for one moment. */
export function ambienceMix(i: AmbienceInput): AmbienceMix {
  const h = heightFactor(i.camY);
  const dens = crowdDensity(i.guests);
  const total = i.near.machines + i.near.tables + i.near.lounge;
  // How much of what is near the ears is the bar or food court. From high up
  // the ears take in the whole floor, so a corner's character fades.
  const lounge = (total > 0 ? i.near.lounge / total : 0) * (1 - 0.7 * h);
  const machines = clamp01(i.near.machines / 6);
  const level = (1 - 0.45 * h) * (i.speed === 0 ? PAUSE_DUCK : 1);
  return {
    slots: (0.3 + 0.5 * machines) * (1 - 0.6 * lounge) * level,
    crowd: 0.7 * dens * (1 + 0.3 * lounge) * level,
    murmur: 0.6 * dens * (1 - h) * (0.6 + 0.8 * lounge) * level,
    music: i.music ? (0.1 + 0.25 * lounge) * level : 0,
    cutoff: Math.exp(Math.log(CUTOFF_EYE) + (Math.log(CUTOFF_GOD) - Math.log(CUTOFF_EYE)) * h),
  };
}
