// The tiled Detour navmesh, its query object and the crowd that walks it.
// Owns no game state: it is handed a NavSource to bake from and told which
// cells changed. The world-facing glue (which walker is which agent, stuck
// recovery) lives in WorldNav.

import {
  Crowd,
  type CrowdAgent,
  Detour,
  init as initRecast,
  NavMesh,
  NavMeshParams,
  NavMeshQuery,
  type QueryFilter,
  statusFailed,
} from '@recast-navigation/core';
import { ZONES, type Zone } from '../../shared/contracts';
import { AGENT_HEIGHT, AGENT_RADIUS, NavBaker, TILE_METRES, type NavSource } from './NavBaker';

let ready: Promise<void> | null = null;

/** Load the Recast WASM once per thread (worker, or the Vitest process). */
export function initNav(): Promise<void> {
  ready ??= initRecast();
  return ready;
}

/** Crowd filter slots. Guests below the high-limit bankroll threshold never
 *  path through High-Limit; no guest paths through Back-of-House. */
export const NavFilter = { Guest: 0, HighRoller: 1, Staff: 2 } as const;
export type NavFilter = (typeof NavFilter)[keyof typeof NavFilter];

export const GUEST_SPEED = 1.3;
export const STAFF_SPEED = 1.6;
/** One crowd step per sim tick, always: the sim is deterministic per tick,
 *  and game speed is more ticks, never a longer dt. */
export const NAV_DT = 0.1;
export const MAX_AGENTS = 640;

const zoneBit = (z: Zone) => 1 << ZONES.indexOf(z);
const ALL_ZONES = (1 << ZONES.length) - 1;

/** Detour crowd update flags: anticipate turns, optimise the corridor both
 *  ways, avoid other agents and keep separation. */
const CROWD_FLAGS = 1 | 2 | 4 | 8 | 16;

export interface Point {
  x: number;
  z: number;
}

export class NavSystem {
  readonly navMesh = new NavMesh();
  readonly query: NavMeshQuery;
  readonly crowd: Crowd;
  private readonly baker: NavBaker;
  private dirty = new Set<number>();
  private readonly halfExtents = { x: 0.6, y: 1, z: 0.6 };
  /** Last full-bake and last rebake wall time in ms, for the perf report. */
  lastBakeMs = 0;
  lastRebakeMs = 0;
  tilesRebaked = 0;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.baker = new NavBaker(cols, rows);
    const tileBits = Math.ceil(Math.log2(Math.max(2, this.baker.tileCount)));
    const params = NavMeshParams.create({
      orig: { x: 0, y: 0, z: 0 },
      tileWidth: TILE_METRES,
      tileHeight: TILE_METRES,
      maxTiles: 1 << tileBits,
      maxPolys: 1 << (22 - tileBits),
    });
    if (!this.navMesh.initTiled(params)) throw new Error('navmesh initTiled failed');
    this.query = new NavMeshQuery(this.navMesh);
    this.crowd = new Crowd(this.navMesh, { maxAgents: MAX_AGENTS, maxAgentRadius: 0.5 });
    const bits = (zones: Zone[]) => zones.reduce((m, z) => m | zoneBit(z), 0);
    this.configure(NavFilter.Guest, ALL_ZONES & ~bits(['highLimit', 'backOfHouse']));
    this.configure(NavFilter.HighRoller, ALL_ZONES & ~bits(['backOfHouse']));
    this.configure(NavFilter.Staff, ALL_ZONES);
  }

  private configure(slot: NavFilter, include: number): void {
    const f = this.crowd.getFilter(slot);
    f.includeFlags = include;
    f.excludeFlags = 0;
  }

  filter(slot: NavFilter): QueryFilter {
    return this.crowd.getFilter(slot);
  }

  // ---------- baking ----------

  bakeAll(src: NavSource): void {
    const t0 = performance.now();
    for (let tz = 0; tz < this.baker.tilesZ; tz++) {
      for (let tx = 0; tx < this.baker.tilesX; tx++) this.rebakeTile(src, tx, tz);
    }
    this.dirty.clear();
    this.lastBakeMs = performance.now() - t0;
  }

  /** Queue the tiles a cell-rect change can reach. Padded by a cell because a
   *  wall gap or an object's erosion fringe spills into the neighbour tile's border. */
  markDirty(col0: number, row0: number, col1: number, row1: number): void {
    const tx0 = Math.max(0, Math.floor((col0 - 1) / TILE_METRES));
    const tx1 = Math.min(this.baker.tilesX - 1, Math.floor((col1 + 1) / TILE_METRES));
    const tz0 = Math.max(0, Math.floor((row0 - 1) / TILE_METRES));
    const tz1 = Math.min(this.baker.tilesZ - 1, Math.floor((row1 + 1) / TILE_METRES));
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) this.dirty.add(tz * this.baker.tilesX + tx);
    }
  }

  get hasDirtyTiles(): boolean {
    return this.dirty.size > 0;
  }

  /** Rebake whatever markDirty queued. Returns the number of tiles rebuilt. */
  flush(src: NavSource): number {
    if (this.dirty.size === 0) return 0;
    const t0 = performance.now();
    const n = this.dirty.size;
    for (const key of [...this.dirty].sort((a, b) => a - b)) {
      this.rebakeTile(src, key % this.baker.tilesX, Math.floor(key / this.baker.tilesX));
    }
    this.dirty.clear();
    this.lastRebakeMs = performance.now() - t0;
    this.tilesRebaked += n;
    return n;
  }

  rebakeTile(src: NavSource, tx: number, tz: number): number {
    const old = this.navMesh.getTileRefAt(tx, tz, 0);
    if (old) this.navMesh.removeTile(old);
    const bake = this.baker.bakeTile(src, tx, tz);
    if (!bake.data) return 0;
    const added = this.navMesh.addTile(bake.data, Detour.DT_TILE_FREE_DATA, 0);
    if (statusFailed(added.status)) throw new Error(`addTile ${tx},${tz} failed`);
    return bake.polys;
  }

  // ---------- queries ----------

  /** Nearest point on the mesh this filter may use, within ~0.6 m. */
  closest(p: Point, slot: NavFilter, reach = 0.6): Point | null {
    const r = this.query.findClosestPoint(
      { x: p.x, y: 0, z: p.z },
      { filter: this.filter(slot), halfExtents: { x: reach, y: 1, z: reach } },
    );
    if (!r.success || !r.polyRef) return null;
    return { x: r.point.x, z: r.point.z };
  }

  /** Whether an agent of this class can actually walk from a to b — a path
   *  that only gets "as close as it can" is a no. */
  reachable(a: Point, b: Point, slot: NavFilter): boolean {
    const r = this.query.computePath(
      { x: a.x, y: 0, z: a.z },
      { x: b.x, y: 0, z: b.z },
      { filter: this.filter(slot), halfExtents: this.halfExtents },
    );
    if (!r.success || r.path.length === 0) return false;
    const end = r.path[r.path.length - 1]!;
    return Math.hypot(end.x - b.x, end.z - b.z) < 0.35;
  }

  /** The waypoints of a path, for tests and the debug overlay. */
  path(a: Point, b: Point, slot: NavFilter): Point[] {
    const r = this.query.computePath(
      { x: a.x, y: 0, z: a.z },
      { x: b.x, y: 0, z: b.z },
      { filter: this.filter(slot), halfExtents: this.halfExtents },
    );
    return r.success ? r.path.map((p) => ({ x: p.x, z: p.z })) : [];
  }

  // ---------- crowd ----------

  addAgent(p: Point, slot: NavFilter, maxSpeed: number): CrowdAgent | null {
    const at = this.closest(p, slot, 2) ?? this.closest(p, NavFilter.Staff, 2);
    if (!at) return null;
    if (this.crowd.getActiveAgentCount() >= MAX_AGENTS) return null;
    return this.crowd.addAgent(
      { x: at.x, y: 0, z: at.z },
      {
        radius: AGENT_RADIUS,
        height: AGENT_HEIGHT,
        maxAcceleration: 6,
        maxSpeed,
        collisionQueryRange: AGENT_RADIUS * 8,
        pathOptimizationRange: AGENT_RADIUS * 30,
        separationWeight: 1.2,
        updateFlags: CROWD_FLAGS,
        obstacleAvoidanceType: 1,
        queryFilterType: slot,
      },
    );
  }

  removeAgent(agent: CrowdAgent): void {
    this.crowd.removeAgent(agent);
  }

  update(): void {
    this.crowd.update(NAV_DT);
  }

  destroy(): void {
    this.crowd.destroy();
    this.query.destroy();
    this.navMesh.destroy();
  }
}
