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

/**
 * Thought ids emitted directly by Guest rather than polled from THOUGHTS —
 * one-off reactions to an event. They still need a bubble glyph, so
 * THOUGHT_EMOJI's coverage test has to know about them.
 */
export const EVENT_THOUGHT_IDS = ['celebrate', 'ripoff', 'raging'] as const;

/**
 * Bubble glyph per thought id. Lives here rather than next to the bubble
 * renderer so a sim test can assert coverage — the renderer imports Phaser, so
 * nothing under src/sim can reach it, and a thought added without a glyph would
 * otherwise degrade silently to the generic fallback in the real game only.
 */
export const THOUGHT_EMOJI: Record<string, string> = {
  bathroom: '🚽',
  hungry: '🍔',
  thirsty: '🍸',
  tired: '😴',
  'low-cash': '💸',
  broke: '💰',
  great: '🤩',
  awful: '😠',
  filthy: '🤢',
  raging: '😡',
  celebrate: '💰',
  ripoff: '🤬',
  'game-rigged': '🤬',
  'game-love': '😍',
  'too-rich': '😬',
  'waiting-for-players': '⏳',
  'no-toilet': '🚻',
  'no-food': '🍽️',
  'no-bar': '🍹',
  flush: '🍀',
  'worn-out': '🪑',
  content: '🙂',
};

export const THOUGHTS: readonly ThoughtDef[] = [
  // The three need thoughts are guarded on the facility existing — otherwise a
  // guest asks for a bathroom in a casino that has three, and the player is
  // told nothing. The no-X thoughts below cover the opposite case.
  {
    id: 'bathroom',
    text: 'I need a bathroom!',
    cooldownTicks: 300,
    when: (c) => c.bladder < 25 && c.hasToilet,
  },
  {
    id: 'hungry',
    text: "I'm hungry…",
    cooldownTicks: 300,
    when: (c) => c.hunger < 25 && c.hasFoodStall,
  },
  {
    id: 'thirsty',
    text: 'I could really use a drink.',
    cooldownTicks: 300,
    when: (c) => c.thirst < 25 && c.hasBar,
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
  // --- Object-aware: these name what the player actually built. ---
  {
    id: 'game-rigged',
    text: (c) => `That ${c.currentGame?.name} is rigged!`,
    cooldownTicks: 400,
    when: (c) => c.currentGame !== null && c.lossStreak >= 3,
    subject: (c) => c.currentGame?.defId ?? '',
  },
  {
    id: 'game-love',
    text: (c) => `I love this ${c.currentGame?.name}!`,
    cooldownTicks: 400,
    when: (c) => c.currentGame !== null && c.winStreak >= 2,
    subject: (c) => c.currentGame?.defId ?? '',
  },
  {
    id: 'too-rich',
    text: (c) => `${c.currentGame?.name} is too rich for my blood.`,
    cooldownTicks: 500,
    when: (c) => c.currentGame !== null && c.currentGame.costToPlay > c.wallet * 0.3,
    subject: (c) => c.currentGame?.defId ?? '',
  },
  {
    id: 'waiting-for-players',
    text: 'Waiting for someone to join…',
    cooldownTicks: 200,
    when: (c) => c.waitingForPlayers,
  },
  // --- Absence-aware: turn a vague complaint into a build instruction. ---
  {
    id: 'no-toilet',
    text: "There's nowhere to go!",
    cooldownTicks: 400,
    when: (c) => c.bladder < 20 && !c.hasToilet,
  },
  {
    id: 'no-food',
    text: 'Doesn’t anyone sell food here?',
    cooldownTicks: 400,
    when: (c) => c.hunger < 20 && !c.hasFoodStall,
  },
  {
    id: 'no-bar',
    text: 'I’d kill for a bar in this place.',
    cooldownTicks: 400,
    when: (c) => c.thirst < 20 && !c.hasBar,
  },
  // --- Scalar tiers filling gaps in the original set. ---
  { id: 'flush', text: 'I’m feeling lucky tonight.', cooldownTicks: 600, when: (c) => c.wallet > 400 },
  { id: 'worn-out', text: 'I need to sit down.', cooldownTicks: 500, when: (c) => c.energy < 10 },
  {
    id: 'content',
    text: 'Not a bad little place.',
    cooldownTicks: 700,
    when: (c) => c.happiness >= 60 && c.happiness <= 75,
  },
];
