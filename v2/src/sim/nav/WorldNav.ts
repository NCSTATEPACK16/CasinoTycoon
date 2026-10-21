// Glue between CasinoWorld's walkers and the Recast crowd. A walker has an
// agent only while it is on its feet: seated guests and stationed staff are
// parked (removed from the crowd and pinned to their seat point), which both
// stops the crowd shoving a player off a slot stool and keeps the crowd
// update proportional to the people actually walking.
//
// The world calls step() once per tick, after every guest and staff member
// has acted, so a goal set this tick is walked this tick.

import type { CrowdAgent } from '@recast-navigation/core';
import type { CellRect } from '../../shared/contracts';
import type { Walker } from '../entities/Walker';
import type { CasinoWorld } from '../world';
import { NavSystem, initNav, type NavFilter, type Point } from './NavSystem';
import { floorNavSource } from './source';

/** Detour's DT_CROWDAGENT_STATE_INVALID: the agent is not on any polygon. */
const AGENT_STATE_INVALID = 0;

export interface NavStats {
  /** Times a walker made no progress for too long and its route was re-requested. */
  repaths: number;
  /** Times re-pathing failed too and the walker was moved to its goal outright. */
  teleports: number;
  /** Agents found off the mesh (a table built on top of them) and re-placed. */
  rescues: number;
}

export class WorldNav {
  readonly sys: NavSystem;
  private agents = new Map<Walker, CrowdAgent>();
  private speeds = new Map<Walker, number>();
  private filters = new Map<Walker, NavFilter>();
  readonly stats: NavStats = { repaths: 0, teleports: 0, rescues: 0 };
  /** Wall time of the last step's crowd update, for the perf HUD and tests. */
  lastStepMs = 0;

  constructor(cols: number, rows: number) {
    this.sys = new NavSystem(cols, rows);
  }

  /** Load the WASM if needed and size a navmesh for this world's lot. The
   *  bake happens in world.attachNav, which is the only way to wire one up. */
  static async create(world: CasinoWorld): Promise<WorldNav> {
    await initNav();
    return new WorldNav(world.floor.cols, world.floor.rows);
  }

  /** Full rebake — a new floor plan (scenario start, load). Every agent is
   *  dropped: the walkers that own them were cleared along with the floor. */
  rebuild(world: CasinoWorld): void {
    for (const agent of this.agents.values()) this.sys.removeAgent(agent);
    this.agents.clear();
    this.speeds.clear();
    this.filters.clear();
    this.sys.bakeAll(floorNavSource(world.floor, world.grid));
  }

  markDirty(rect: CellRect): void {
    this.sys.markDirty(rect.col0, rect.row0, rect.col1, rect.row1);
  }

  isParked(w: Walker): boolean {
    return !this.agents.has(w);
  }

  /** Put a walker on the crowd at its current position (no-op if already there). */
  private ensureAgent(w: Walker): CrowdAgent | null {
    const existing = this.agents.get(w);
    if (existing) return existing;
    const agent = this.sys.addAgent({ x: w.x, z: w.z }, w.navFilter, w.navSpeed);
    if (!agent) return null;
    this.agents.set(w, agent);
    this.speeds.set(w, w.navSpeed);
    this.filters.set(w, w.navFilter);
    const p = agent.position();
    w.x = p.x;
    w.z = p.z;
    return agent;
  }

  /** Take a walker off the crowd and pin it at a point (seat, station). */
  park(w: Walker, at: Point, heading: number): void {
    const agent = this.agents.get(w);
    if (agent) this.sys.removeAgent(agent);
    this.agents.delete(w);
    this.speeds.delete(w);
    this.filters.delete(w);
    w.x = at.x;
    w.z = at.z;
    w.heading = heading;
  }

  /** The point a walker should aim for to reach a cell — its centre, pulled
   *  onto the mesh for this walker's filter. */
  pointFor(cellCol: number, cellRow: number, filter: NavFilter): Point | null {
    return this.sys.closest({ x: cellCol + 0.5, z: cellRow + 0.5 }, filter, 0.5);
  }

  /** Can this walker get there from where it stands? */
  canReach(w: Walker, target: Point): boolean {
    return this.sys.reachable({ x: w.x, z: w.z }, target, w.navFilter);
  }

  /** Start walking to `target`. False (and nothing changes) if unreachable. */
  moveTo(w: Walker, target: Point): boolean {
    if (!this.canReach(w, target)) return false;
    const agent = this.ensureAgent(w);
    if (!agent) return false;
    return agent.requestMoveTarget({ x: target.x, y: 0, z: target.z });
  }

  /** Re-issue the current move request — a cheap first resort for a walker
   *  whose corridor went stale (a tile rebaked under it, a crowd jam). */
  repath(w: Walker, target: Point): void {
    this.stats.repaths++;
    this.agents.get(w)?.requestMoveTarget({ x: target.x, y: 0, z: target.z });
  }

  /** Last resort: put the walker on its goal. Counted, because a teleport is a
   *  visible glitch and the count is how tests and the HUD keep it rare. */
  teleport(w: Walker, target: Point): void {
    this.stats.teleports++;
    const agent = this.agents.get(w);
    if (agent) {
      agent.teleport({ x: target.x, y: 0, z: target.z });
      agent.resetMoveTarget();
    }
    w.x = target.x;
    w.z = target.z;
  }

  /** Move a walker without it counting as a recovery (pincer drop, load). */
  place(w: Walker, at: Point): void {
    const agent = this.agents.get(w);
    if (!agent) return;
    const p = this.sys.closest(at, w.navFilter, 2) ?? at;
    agent.teleport({ x: p.x, y: 0, z: p.z });
    agent.resetMoveTarget();
  }

  /** Stop where you are (goal cleared, still on the crowd). */
  halt(w: Walker): void {
    this.agents.get(w)?.resetMoveTarget();
  }

  /** Agents on the crowd right now. */
  get activeAgents(): number {
    return this.agents.size;
  }

  step(world: CasinoWorld): void {
    const t0 = performance.now();
    if (this.sys.hasDirtyTiles) this.sys.flush(floorNavSource(world.floor, world.grid));
    for (const [w, agent] of this.agents) {
      if (!w.isInWorld(world)) {
        this.sys.removeAgent(agent);
        this.agents.delete(w);
        this.speeds.delete(w);
        this.filters.delete(w);
        continue;
      }
      // Speed and filter follow the walker's state (a rage-quitter hurries, a
      // guest who just went broke loses the High-Limit room).
      const speed = w.navSpeed;
      const filter = w.navFilter;
      if (this.speeds.get(w) !== speed || this.filters.get(w) !== filter) {
        agent.updateParameters({ maxSpeed: speed, queryFilterType: filter });
        this.speeds.set(w, speed);
        this.filters.set(w, filter);
      }
    }
    this.sys.update();
    for (const [w, agent] of this.agents) {
      if (agent.state() === AGENT_STATE_INVALID) {
        // Something was built on top of this agent. Re-place it on the nearest
        // floor it may use; the walker's own goal logic then carries on.
        this.stats.rescues++;
        const at =
          this.sys.closest({ x: w.x, z: w.z }, w.navFilter, 3) ??
          this.sys.closest(
            { x: world.entranceTile.col + 0.5, z: world.entranceTile.row + 0.5 },
            w.navFilter,
            1,
          );
        if (at) agent.teleport({ x: at.x, y: 0, z: at.z });
      }
      const p = agent.position();
      const v = agent.velocity();
      w.applyNav(world, p.x, p.z, v.x, v.z);
    }
    this.lastStepMs = performance.now() - t0;
  }
}
