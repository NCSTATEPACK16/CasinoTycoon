// Data-driven guest thoughts: threshold predicates + per-thought cooldowns.

export interface ThoughtContext {
  wallet: number;
  energy: number;
  bladder: number;
  hunger: number;
  thirst: number;
  happiness: number;
  nearMess: boolean;
}

export interface ThoughtDef {
  id: string;
  text: string;
  cooldownTicks: number;
  when(ctx: ThoughtContext): boolean;
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
