import { BAR_BALANCE } from '../../data/balance';

export interface BarJSON {
  id: string;
  stock: number;
}

// A placed Bar's drink stock. No wager/payout — this isn't a CasinoGame.
// The bartender (Staff.ts) brews into it on a timer; the waitress delivers
// from it to seated guests; wandering guests self-serve directly.
export class Bar {
  readonly id: string;
  stock = 0;

  constructor(id: string) {
    this.id = id;
  }

  brew(): void {
    this.stock = Math.min(BAR_BALANCE.maxStock, this.stock + 1);
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
    return { id: this.id, stock: this.stock };
  }

  static fromJSON(data: BarJSON): Bar {
    const bar = new Bar(data.id);
    bar.stock = data.stock;
    return bar;
  }
}
