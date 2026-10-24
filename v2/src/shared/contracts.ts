// The sim ↔ render contract. The sim runs in a Web Worker; everything that
// crosses the boundary is declared here and nowhere else. Changing this file
// is an integration decision, not a module-local one — see docs/SPEC.md §4.

/** World units are metres. One build cell is one metre square. Cell (col,row)
 *  occupies x ∈ [col, col+1), z ∈ [row, row+1); y is up. */
export const CELL_SIZE = 1;

export type Rotation = 0 | 1 | 2 | 3; // quarter turns clockwise, seen from above

// ---------- floor plan ----------

export const FLOOR_TYPES = ['none', 'carpet-red', 'carpet-blue', 'marble', 'wood', 'tile'] as const;
export type FloorType = (typeof FLOOR_TYPES)[number];

export const ZONES = [
  'none',
  'gaming',
  'highLimit',
  'foodCourt',
  'restrooms',
  'backOfHouse',
] as const;
export type Zone = (typeof ZONES)[number];

/** A wall sits on a cell edge: 'n' is the edge at z=row, 'w' the edge at x=col.
 *  South/east edges are the neighbour's n/w, so every edge has exactly one owner. */
export interface WallSegment {
  col: number;
  row: number;
  edge: 'n' | 'w';
  door: boolean;
}

export interface FloorPlanView {
  cols: number;
  rows: number;
  /** Index into FLOOR_TYPES, row-major (row * cols + col). */
  floor: Uint8Array;
  /** Index into ZONES, row-major. */
  zone: Uint8Array;
  walls: WallSegment[];
  entrance: { col: number; row: number };
}

// ---------- agents ----------

export const AgentKind = {
  Guest: 0,
  Dealer: 1,
  Janitor: 2,
  Security: 3,
  Staff: 4,
  Avatar: 5,
} as const;
export type AgentKind = (typeof AgentKind)[keyof typeof AgentKind];

export const Anim = { Idle: 0, Walk: 1, Sit: 2, Play: 3, Cheer: 4, Sad: 5, Eat: 6 } as const;
export type Anim = (typeof Anim)[keyof typeof Anim];

/** Floats per agent in Snapshot.agents. Order is fixed:
 *  [0] x  [1] z  [2] heading (radians, 0 = +z, CCW)  [3] Anim
 *  [4] AgentKind  [5] variant (archetype/outfit index)  [6] mood 0..1  [7] numeric id */
export const AGENT_STRIDE = 8;

// ---------- objects ----------

export interface ObjectView {
  id: string;
  defId: string;
  col: number;
  row: number;
  rot: Rotation;
  /** Machine/table status flags, for lights, signage and inspectors. */
  broken: boolean;
  open: boolean;
  occupants: number;
  /** Decal row picked by the object's rules (the blackjack felt prints its
   *  payout and soft-17 rule); absent when the renderer may pick any row. */
  decalRow?: number;
}

// ---------- snapshot (worker → main, every sim tick) ----------

export interface HudView {
  cash: number;
  day: number;
  hour: number;
  minute: number;
  rating: number;
  guests: number;
  speed: number;
  todayProfit: number;
  scenario: { id: string; name: string; goal: string; status: 'active' | 'won' | 'lost' } | null;
}

export type SimEvent =
  | { type: 'payout'; objectId: string; x: number; z: number; amount: number }
  | { type: 'ticker'; text: string; severity: 'info' | 'warn' | 'alert' }
  | { type: 'gameOver'; won: boolean; reason: string };

export interface Snapshot {
  tick: number;
  /** performance.now() in the worker when this tick finished — render interpolates between the last two. */
  time: number;
  agentCount: number;
  /** Transferable. Length >= agentCount * AGENT_STRIDE. */
  agents: Float32Array;
  /** Increments whenever the object set or any object's state changes. */
  objectsVersion: number;
  /** Present only when objectsVersion changed since the previous snapshot. */
  objects?: ObjectView[];
  floorVersion: number;
  /** Present only when floorVersion changed. */
  floor?: FloorPlanView;
  hud: HudView;
  events: SimEvent[];
}

// ---------- commands (main → worker) ----------

export interface CellRect {
  col0: number;
  row0: number;
  col1: number; // inclusive
  row1: number; // inclusive
}

export type Command =
  | { type: 'place'; defId: string; col: number; row: number; rot: Rotation }
  | { type: 'sell'; objectId: string }
  | { type: 'canPlace'; defId: string; col: number; row: number; rot: Rotation }
  | { type: 'paintFloor'; rect: CellRect; floor: FloorType }
  | { type: 'paintZone'; rect: CellRect; zone: Zone }
  | {
      type: 'wall';
      from: { col: number; row: number };
      to: { col: number; row: number };
      remove: boolean;
    }
  | { type: 'door'; col: number; row: number; edge: 'n' | 'w' }
  | { type: 'setSpeed'; speed: 0 | 1 | 2 | 4 }
  | { type: 'setRules'; objectId: string; rules: unknown }
  | { type: 'hire'; kind: string }
  | { type: 'fire'; staffId: string }
  | { type: 'startScenario'; scenarioId: string | null }
  | { type: 'inspect'; target: { objectId: string } | { agentId: number } }
  // Read-only panel data: P&L, staff roster, scenario list.
  | { type: 'financials' }
  | { type: 'staffList' }
  | { type: 'scenarios' }
  // After a win: keep the casino open with the campaign's limits lifted.
  | { type: 'continueScenario' }
  // Workers have no localStorage: save replies with the world JSON and the
  // main thread persists it; load hands that JSON back.
  | { type: 'save' }
  | { type: 'load'; json: unknown }
  // Avatar play: take a seat (replies an error when every seat is taken), begin
  // a round as the player, act until the round settles, and stand to free it.
  | { type: 'sit'; objectId: string }
  | { type: 'stand' }
  | { type: 'roundBegin'; objectId: string; bets: { spot: string; amount: number }[] }
  | { type: 'roundAct'; objectId: string; action: string }
  // Dev/perf: spawn guests past the arrival cap, and read worker timings.
  | {
      type: 'debugSpawn';
      count: number;
      archetype?: 'regular' | 'highRoller' | 'biker' | 'tourist';
    }
  | { type: 'stats' }
  // Run N ticks synchronously in the worker and reply with their timings —
  // unaffected by background-tab timer throttling, unlike the pump.
  | { type: 'debugTicks'; count: number };

/** Reply to { type: 'stats' }. */
export interface SimStats {
  guests: number;
  staff: number;
  /** Agents walking on the crowd (seated/stationed walkers are parked off it). */
  crowdAgents: number;
  /** Mean and worst world.tick() wall time over the last 100 ticks, ms. */
  tickMeanMs: number;
  tickMaxMs: number;
  nav: { repaths: number; teleports: number; rescues: number; lastRebakeMs: number } | null;
}

export type WorkerIn =
  { type: 'init'; seed: number } | { type: 'cmd'; reqId: number; cmd: Command };

export type WorkerOut =
  | { type: 'ready' }
  | { type: 'snapshot'; snap: Snapshot }
  | { type: 'reply'; reqId: number; ok: boolean; data?: unknown; error?: string };
