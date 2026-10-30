import { BAR_BALANCE, PRICE_BALANCE } from '../../data/balance';

export interface BarJSON {
  id: string;
  stock: number;
  /** B2: absent in older saves, which means the default price. */
  price?: number;
}

// A placed Bar's drink stock. No wager/payout — this isn't a CasinoGame.
// The bartender (Staff.ts) brews into it on a timer; the waitress delivers
// from it to seated guests; wandering guests self-serve directly.
export class Bar {
  readonly id: string;
  stock = 0;
  /** What a drink sells for here; the player sets it (B2). */
  price: number = BAR_BALANCE.drinkPrice;

  constructor(id: string) {
    this.id = id;
  }

  setPrice(price: number): void {
    const p = PRICE_BALANCE;
    this.price = Math.round(Math.min(p.barPriceCeil, Math.max(p.barPriceFloor, price)));
  }

  /** Price over the default: 1 untouched, 2 at double. */
  get priceIndex(): number {
    return this.price / BAR_BALANCE.drinkPrice;
  }

  /** One more drink into stock; false at a full bar, where nothing is poured. */
  brew(): boolean {
    if (this.stock >= BAR_BALANCE.maxStock) return false;
    this.stock++;
    return true;
  }

  hasStock(): boolean {
    return this.stock > 0;
  }

  /** Consume one drink; false if the shelf was actually empty. */
  takeDrink(): boolean {
    if (this.stock <= 0) return false;
    this.stock--;
    return true;
  }

  toJSON(): BarJSON {
    return { id: this.id, stock: this.stock, price: this.price };
  }

  static fromJSON(data: BarJSON): Bar {
    const bar = new Bar(data.id);
    bar.stock = data.stock;
    if (data.price !== undefined) bar.setPrice(data.price);
    return bar;
  }
}
