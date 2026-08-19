// The seam between sim and presentation. Sim emits domain events; render/UI subscribe.
// Typed event map keeps both sides honest.

export interface GameEvents {
  moneyChanged: { cash: number; delta: number };
  /** Severity drives color and dwell time. Omitted means 'info' — the default
   *  keeps every existing emitter valid. */
  tickerMessage: { text: string; severity?: 'info' | 'warn' | 'alert' };
  hourPassed: { hour: number; day: number };
  dayEnded: { day: number; profit: number };
  objectPlaced: { id: string; defId: string; col: number; row: number };
  objectSold: { id: string; defId: string; col: number; row: number; refund: number };
  buildModeChanged: { mode: 'off' | 'place' | 'bulldoze'; defId?: string };
  guestSpawned: { id: string; archetype: import('./sim/entities/Guest').GuestArchetype };
  guestLeft: { id: string };
  guestThought: { guestId: string; thoughtId: string; text: string };
  /** null stops following. The camera resumes normal drag/edge control. */
  followGuest: { guestId: string | null };
  machinePlayed: { machineId: string; guestId: string; wager: number; payout: number };
  machineBroke: { machineId: string };
  machineFixed: { machineId: string };
  machineClicked: { machineId: string };
  foodStallClicked: { standId: string };
  messCreated: { id: string; col: number; row: number; kind: string };
  messCleaned: { id: string };
  staffHired: { id: string; kind: string };
  staffFired: { id: string; kind: string };
  goalReached: { campaignId: string; day: number; profit: number };
  scenarioFailed: { campaignId: string; day: number };
  worldReset: { scenarioId: string | null };
  worldLoaded: { scenarioId: string | null };
  speedChanged: { speed: number };
  /** A5: the day's conditions changed (midnight draw, or a save load). */
  modifiersChanged: { ids: string[] };
  /** A12: reputation rolled over at midnight. */
  reputationChanged: { value: number; delta: number };
  /** A1a: the player comped a specific guest. */
  compSent: { guestId: string; kind: string; cost: number };
  /** B3: the player switched the data overlay ('none' turns it off). */
  overlayChanged: { id: string };
  /** B3: tile under the cursor changed, with the active overlay's reading.
   *  null value means the overlay is off or that tile has no data. */
  overlayHover: { col: number; row: number; value: string | null };
  // Extended as systems land (guestSpawned, machineBroke, ...). See PLAN.md catalog.
}

type Handler<T> = (payload: T) => void;

export class TypedEventBus {
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
