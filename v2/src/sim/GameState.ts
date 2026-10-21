import { STARTING_CASH } from '../config';

// Core mutable game state: funds + placed-object registry. Pure data — build
// orchestration lives in build.ts. Serialization built alongside per PLAN.md.

export interface PlacedObject {
  id: string;
  defId: string;
  col: number;
  row: number;
}

export interface GameStateJSON {
  cash: number;
  nextObjectId: number;
  objects: PlacedObject[];
}

export class GameState {
  cash: number = STARTING_CASH;
  private nextObjectIdNum = 1;
  private objects = new Map<string, PlacedObject>();

  newObjectId(): string {
    return `obj-${this.nextObjectIdNum++}`;
  }

  addObject(po: PlacedObject): void {
    this.objects.set(po.id, po);
  }

  getObject(id: string): PlacedObject | undefined {
    return this.objects.get(id);
  }

  removeObject(id: string): void {
    this.objects.delete(id);
  }

  allObjects(): PlacedObject[] {
    return [...this.objects.values()];
  }

  /** Scenario reset — wipes funds and objects in place so aliases stay valid. */
  reset(cash: number): void {
    this.cash = cash;
    this.nextObjectIdNum = 1;
    this.objects.clear();
  }

  toJSON(): GameStateJSON {
    return { cash: this.cash, nextObjectId: this.nextObjectIdNum, objects: this.allObjects() };
  }

  static fromJSON(data: GameStateJSON): GameState {
    const state = new GameState();
    state.cash = data.cash;
    state.nextObjectIdNum = data.nextObjectId;
    for (const po of data.objects) state.addObject({ ...po });
    return state;
  }

  /** In-place restore — wipes and refills so gameContext aliases stay valid. */
  load(data: GameStateJSON): void {
    this.cash = data.cash;
    this.nextObjectIdNum = data.nextObjectId;
    this.objects.clear();
    for (const po of data.objects) this.addObject({ ...po });
  }
}
