// The seam between sim and presentation. Sim emits domain events; render/UI subscribe.
// Typed event map keeps both sides honest.

export interface GameEvents {
  moneyChanged: { cash: number; delta: number };
  tickerMessage: { text: string };
  hourPassed: { hour: number; day: number };
  dayEnded: { day: number; profit: number };
  objectPlaced: { id: string; defId: string; col: number; row: number };
  objectSold: { id: string; defId: string; col: number; row: number; refund: number };
  buildModeChanged: { mode: 'off' | 'place' | 'bulldoze'; defId?: string };
  guestSpawned: { id: string };
  guestLeft: { id: string };
  guestThought: { guestId: string; text: string };
  machinePlayed: { machineId: string; guestId: string; wager: number; payout: number };
  machineBroke: { machineId: string };
  machineClicked: { machineId: string };
  // Extended as systems land (guestSpawned, machineBroke, ...). See PLAN.md catalog.
}

type Handler<T> = (payload: T) => void;

class TypedEventBus {
  private handlers = new Map<string, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as Handler<unknown>);
    return () => this.off(event, fn);
  }

  off<K extends keyof GameEvents>(event: K, fn: Handler<GameEvents[K]>): void {
    this.handlers.get(event)?.delete(fn as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    this.handlers.get(event)?.forEach((fn) => fn(payload));
  }

  clear(): void {
    this.handlers.clear();
  }
}

export const eventBus = new TypedEventBus();
