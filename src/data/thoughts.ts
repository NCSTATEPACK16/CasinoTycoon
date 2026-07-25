// Data-driven guest thoughts: threshold predicates + per-thought cooldowns.
// This file imports types only — Guest builds the context, so the data never
// needs to know about the world.

export interface ThoughtContext {
  wallet: number;
  energy: number;
  bladder: number;
  hunger: number;
  thirst: number;
  happiness: number;
  nearMess: boolean;
  /** The game the guest is currently playing, if any. */
  currentGame: { defId: string; name: string; costToPlay: number } | null;
  /** Consecutive losing plays at the current machine. */
  lossStreak: number;
  /** Consecutive winning plays at the current machine. */
  winStreak: number;
  hasToilet: boolean;
  hasBar: boolean;
  hasFoodStall: boolean;
  /** Seated at a poker table that doesn't have enough players to deal. */
  waitingForPlayers: boolean;
}

export interface ThoughtDef {
  id: string;
  /** Static text, or a builder so a thought can name what it's about. */
  text: string | ((ctx: ThoughtContext) => string);
  cooldownTicks: number;
  when(ctx: ThoughtContext): boolean;
  /**
   * Distinguishes what this thought is *about*, so the cooldown is tracked
   * per subject. Without it, "That Roulette is rigged!" would suppress "That
   * Big Six is rigged!" for the full cooldown — the system would look broken
   * precisely when the player has built variety.
   */
  subject?: (ctx: ThoughtContext) => string;
}

export const THOUGHTS: readonly ThoughtDef[] = [
  { id: 'bathroom', text: 'I need a bathroom!', cooldownTicks: 300, when: (c) => c.bladder < 25 },
  { id: 'hungry', text: "I'm hungry…", cooldownTicks: 300, when: (c) => c.hunger < 25 },
  {
    id: 'thirsty',
    text: 'I could really use a drink.',
    cooldownTicks: 300,
    when: (c) => c.thirst < 25,
  },
  { id: 'tired', text: "I'm exhausted.", cooldownTicks: 400, when: (c) => c.energy < 20 },
  {
    id: 'low-cash',
    text: 'My wallet is getting light.',
    cooldownTicks: 500,
    when: (c) => c.wallet < 30 && c.wallet >= 10,
  },
  { id: 'broke', text: "I'm broke!", cooldownTicks: 100000, when: (c) => c.wallet < 10 },
  { id: 'great', text: 'This place is great!', cooldownTicks: 600, when: (c) => c.happiness > 85 },
  { id: 'awful', text: 'This place is a dump…', cooldownTicks: 600, when: (c) => c.happiness < 30 },
  { id: 'filthy', text: 'This place is filthy!', cooldownTicks: 400, when: (c) => c.nearMess },
];
