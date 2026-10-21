import { FOOD_BALANCE } from '../../data/balance';
import { DEFAULT_MENU, getDefaultMenuItem, type MenuAsset } from '../../data/foodMenu';
import type { Rng } from '../rng';

export interface FoodStallJSON {
  id: string;
  items: { id: string; currentPrice: number; isUnlocked: boolean }[];
}

export interface FoodPurchase {
  price: number;
  baseCost: number;
  hungerSatisfaction: number;
  ripoff: boolean;
}

// A placed Food Stall's own priced, toggleable menu, cloned from DEFAULT_MENU
// so each stall can diverge from every other.
export class FoodStall {
  readonly id: string;
  items: MenuAsset[];

  constructor(id: string, items: MenuAsset[] = DEFAULT_MENU.map((m) => ({ ...m }))) {
    this.id = id;
    this.items = items;
  }

  setPrice(itemId: string, price: number): void {
    const item = this.items.find((m) => m.id === itemId);
    if (!item) return;
    const min = item.baseCost * FOOD_BALANCE.priceFloorFactor;
    const max = item.baseCost * FOOD_BALANCE.priceCeilFactor;
    item.currentPrice = Math.min(max, Math.max(min, price));
  }

  toggle(itemId: string): void {
    const item = this.items.find((m) => m.id === itemId);
    if (item) item.isUnlocked = !item.isUnlocked;
  }

  /** A random unlocked item the wallet can afford, or null if none qualify. */
  pickAffordableItem(wallet: number, rng: Rng): MenuAsset | null {
    const candidates = this.items.filter((m) => m.isUnlocked && m.currentPrice <= wallet);
    if (candidates.length === 0) return null;
    return candidates[rng.int(0, candidates.length - 1)]!;
  }

  buy(wallet: number, rng: Rng): FoodPurchase | null {
    const item = this.pickAffordableItem(wallet, rng);
    if (!item) return null;
    return {
      price: item.currentPrice,
      baseCost: item.baseCost,
      hungerSatisfaction: item.hungerSatisfaction,
      ripoff: item.currentPrice > item.baseCost * FOOD_BALANCE.ripoffMultiplier,
    };
  }

  toJSON(): FoodStallJSON {
    return {
      id: this.id,
      items: this.items.map((m) => ({
        id: m.id,
        currentPrice: m.currentPrice,
        isUnlocked: m.isUnlocked,
      })),
    };
  }

  static fromJSON(data: FoodStallJSON): FoodStall {
    const items = data.items.map((saved) => {
      const def = getDefaultMenuItem(saved.id);
      return {
        id: saved.id,
        name: def?.name ?? saved.id,
        baseCost: def?.baseCost ?? 0,
        hungerSatisfaction: def?.hungerSatisfaction ?? 0,
        currentPrice: saved.currentPrice,
        isUnlocked: saved.isUnlocked,
      };
    });
    return new FoodStall(data.id, items);
  }
}
