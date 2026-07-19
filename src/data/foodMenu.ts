// Default per-stall menu template. Every placed Food Stall clones its own
// copy so prices/enabled-state can diverge stall to stall.

export interface MenuAsset {
  id: string;
  name: string;
  baseCost: number;
  currentPrice: number;
  hungerSatisfaction: number;
  isUnlocked: boolean; // sellable/enabled for purchase
}

export const DEFAULT_MENU: readonly MenuAsset[] = [
  {
    id: 'burger',
    name: 'Burger',
    baseCost: 2.0,
    currentPrice: 5.0,
    hungerSatisfaction: 40,
    isUnlocked: true,
  },
  {
    id: 'soda',
    name: 'Soda',
    baseCost: 0.5,
    currentPrice: 2.5,
    hungerSatisfaction: 15,
    isUnlocked: true,
  },
  {
    id: 'fries',
    name: 'Fries',
    baseCost: 1.0,
    currentPrice: 3.5,
    hungerSatisfaction: 25,
    isUnlocked: true,
  },
];

export function getDefaultMenuItem(id: string): MenuAsset | undefined {
  return DEFAULT_MENU.find((m) => m.id === id);
}
