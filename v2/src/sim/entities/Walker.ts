import type { Cell } from '../grid/astar';
import type { NavFilter, Point } from '../nav/NavSystem';
import type { WorldNav } from '../nav/WorldNav';
import type { CasinoWorld } from '../world';

// Shared walking base for guests and staff, in one of two modes.
//
// Grid mode (v1, and every world without a navmesh attached — which is the
// whole ported test suite): pos is the logical tile; while stepping,
// moveFrom→moveTo with moveTick/moveTicksPerTile progress.
//
// Nav mode (v2, world.nav set): the walker is a Recast crowd agent. x/z are
// its float position in metres, pos is the cell under it, and "arrived" means
// the crowd delivered it to the goal. Both modes expose the same goTo /
// arrived / clearMovement surface, so Guest and Staff logic is mode-blind.

/** Ticks with no progress toward the goal before the route is re-requested
 *  (3 s of sim time — long enough to wait out a doorway jam). */
const STUCK_TICKS = 30;
/** Moving less than this (m) over STUCK_TICKS counts as stalled. */
const STALL_DIST = 0.3;
/** Re-requests before giving up and teleporting. */
const MAX_REPATHS = 4;
/** Close enough to the goal to call it arrived, in metres. */
const ARRIVE_DIST = 0.2;
/** Near the goal and barely moving for this many ticks also counts — another
 *  agent standing on the exact spot must not hold a walker at bay forever. */
const SETTLE_DIST = 0.8;
const SETTLE_TICKS = 5;

export interface RenderPose {
  x: number;
  z: number;
  heading: number;
  moving: boolean;
}

export abstract class Walker {
  pos: Cell;
  moveFrom: Cell;
  moveTo: Cell | null = null;
  moveTick = 0;
  protected path: Cell[] = [];

  /** Nav mode: float position in metres and facing (0 = +z). In grid mode x/z
   *  track the tile centre and are only meaningful once renderPose() runs. */
  x: number;
  z: number;
  heading = 0;
  private nav: WorldNav | null = null;
  private navDest: Cell | null = null;
  private navTarget: Point | null = null;
  private navPark: { x: number; z: number; heading: number } | null = null;
  private navSpeedNow = 0;
  /** Where the walker was when the stall counter last reset. Progress is
   *  displacement, not closing distance: a route through a doorway often
   *  walks away from the goal for a while, and that is not being stuck. */
  private navAnchorX = 0;
  private navAnchorZ = 0;
  private navStill = 0;
  private navRepaths = 0;
  private navSettle = 0;

  constructor(start: Cell) {
    this.pos = { ...start };
    this.moveFrom = { ...start };
    this.x = start.col + 0.5;
    this.z = start.row + 0.5;
  }

  abstract get id(): string;
  abstract get moveTicksPerTile(): number;
  /** Crowd max speed in m/s (nav mode). */
  abstract get navSpeed(): number;
  /** Which zones this walker may path through (nav mode). */
  abstract get navFilter(): NavFilter;
  /** Still registered with the world — WorldNav drops agents whose walker left. */
  abstract isInWorld(world: CasinoWorld): boolean;
  /** Called when the queued route can no longer be walked or re-planned. */
  protected abstract onRouteLost(world: CasinoWorld): void;

  /** Fired once, the tick a walker completes a step onto a new tile. The one
   *  place footfall can be counted without either polling or double-counting a
   *  walker that stands still. Staff deliberately do not override it: the
   *  traffic map is about where *guests* go, and a janitor's patrol route is
   *  not a fact about guest demand. */
  protected onTileEntered(world: CasinoWorld): void {
    void world;
  }

  protected get arrived(): boolean {
    if (this.nav) return this.navDest === null;
    return this.moveTo === null && this.path.length === 0;
  }

  /** True while walking toward a goal (either mode). */
  get walking(): boolean {
    return this.nav ? this.navDest !== null : this.moveTo !== null || this.path.length > 0;
  }

  protected stepMovement(world: CasinoWorld): void {
    // Nav mode moves in WorldNav.step, after every walker has chosen a goal.
    if (this.nav) return;
    if (!this.moveTo) {
      if (this.path.length > 0) this.beginStep(world);
      return;
    }
    this.moveTick++;
    if (this.moveTick >= this.moveTicksPerTile) {
      this.pos = { ...this.moveTo };
      this.moveFrom = { ...this.moveTo };
      this.moveTo = null;
      this.moveTick = 0;
      this.onTileEntered(world);
      if (this.path.length > 0) this.beginStep(world);
    }
  }

  private beginStep(world: CasinoWorld): void {
    const next = this.path[0];
    if (!next) return;
    if (!world.grid.canStep(this.pos.col, this.pos.row, next.col, next.row)) {
      // Something was built across the route — re-path to the same destination.
      const dest = this.path[this.path.length - 1];
      const fresh = dest ? world.pathTo(this.pos, dest) : null;
      this.path = fresh ? fresh.slice(1) : [];
      if (this.path.length === 0) this.onRouteLost(world);
      return;
    }
    this.path.shift();
    this.moveTo = next;
    this.moveTick = 0;
  }

  /**
   * Walk to `dest`. With `park`, the walker is taken off the crowd on arrival
   * and pinned at that point and heading — a seat at a table, a station behind
   * a bar. Returns false (and changes nothing) when there is no route.
   */
  protected goTo(
    world: CasinoWorld,
    dest: Cell,
    park?: { x: number; z: number; heading: number },
  ): boolean {
    if (world.nav) {
      const nav = world.nav;
      const target = nav.pointFor(dest.col, dest.row, this.navFilter);
      if (!target || !nav.moveTo(this, target)) return false;
      this.nav = nav;
      this.navDest = { ...dest };
      this.navTarget = target;
      this.navPark = park ?? null;
      this.navAnchorX = this.x;
      this.navAnchorZ = this.z;
      this.navStill = 0;
      this.navRepaths = 0;
      this.navSettle = 0;
      this.path = [];
      this.moveTo = null;
      return true;
    }
    const path = world.pathTo(this.pos, dest);
    if (!path) return false;
    this.path = path.slice(1);
    this.moveTo = null;
    this.moveTick = 0;
    return true;
  }

  /** Halt in place, dropping any queued route. */
  protected clearMovement(): void {
    this.path = [];
    this.moveTo = null;
    this.moveTick = 0;
    if (this.nav) {
      this.nav.halt(this);
      this.navDest = null;
      this.navTarget = null;
      this.navPark = null;
    }
  }

  /** Teleport (pincer drop, load): lands cleanly on a tile with no step in flight. */
  placeAt(cell: Cell): void {
    this.pos = { ...cell };
    this.moveFrom = { ...cell };
    this.clearMovement();
    this.x = cell.col + 0.5;
    this.z = cell.row + 0.5;
    this.nav?.place(this, { x: this.x, z: this.z });
  }

  /** Take this walker off the crowd where it stands (carried staff, a guest
   *  being walked out by security is still on the crowd — this is for "gone
   *  from the floor without leaving the world"). */
  protected parkHere(): void {
    this.nav?.park(this, { x: this.x, z: this.z }, this.heading);
  }

  /**
   * WorldNav's per-tick write-back: where the crowd put this walker. Detects
   * arrival, and recovers a walker that has stopped making progress — first by
   * re-requesting the route, then by teleporting it to the goal (counted in
   * WorldNav.stats so tests can bound how often that happens).
   */
  applyNav(world: CasinoWorld, x: number, z: number, vx: number, vz: number): void {
    this.x = x;
    this.z = z;
    this.navSpeedNow = Math.hypot(vx, vz);
    if (this.navSpeedNow > 0.05) this.heading = Math.atan2(vx, vz);
    const col = Math.min(world.grid.cols - 1, Math.max(0, Math.floor(x)));
    const row = Math.min(world.grid.rows - 1, Math.max(0, Math.floor(z)));
    if (col !== this.pos.col || row !== this.pos.row) {
      this.pos = { col, row };
      this.moveFrom = { col, row };
      this.onTileEntered(world);
    }
    const target = this.navTarget;
    if (!this.navDest || !target || !this.nav) return;
    const d = Math.hypot(target.x - x, target.z - z);
    if (d < ARRIVE_DIST) return this.navArrive();
    if (d < SETTLE_DIST && this.navSpeedNow < 0.1) {
      if (++this.navSettle >= SETTLE_TICKS) return this.navArrive();
    } else {
      this.navSettle = 0;
    }
    if (Math.hypot(x - this.navAnchorX, z - this.navAnchorZ) > STALL_DIST) {
      this.navAnchorX = x;
      this.navAnchorZ = z;
      this.navStill = 0;
      this.navRepaths = 0;
      return;
    }
    if (++this.navStill < STUCK_TICKS) return;
    this.navStill = 0;
    if (this.navRepaths < MAX_REPATHS) {
      this.navRepaths++;
      this.nav.repath(this, target);
      return;
    }
    this.nav.teleport(this, target);
    this.navArrive();
  }

  private navArrive(): void {
    const nav = this.nav!;
    // The logical cell is the destination, exactly: guest and staff logic
    // compare pos against stand tiles, and the crowd may have stopped the
    // agent a few centimetres over a cell line.
    this.pos = { ...this.navDest! };
    this.moveFrom = { ...this.pos };
    this.navDest = null;
    this.navTarget = null;
    this.navSpeedNow = 0;
    if (this.navPark) {
      nav.park(this, this.navPark, this.navPark.heading);
      this.navPark = null;
    } else {
      nav.halt(this);
    }
  }

  /** Where to draw this walker this tick, in metres. */
  renderPose(): RenderPose {
    if (this.nav) {
      return {
        x: this.x,
        z: this.z,
        heading: this.heading,
        moving: this.navDest !== null && this.navSpeedNow > 0.05,
      };
    }
    const from = this.moveFrom;
    const to = this.moveTo;
    if (!to)
      return { x: this.pos.col + 0.5, z: this.pos.row + 0.5, heading: this.heading, moving: false };
    const t = Math.min(1, this.moveTick / Math.max(1, this.moveTicksPerTile));
    const dx = to.col - from.col;
    const dz = to.row - from.row;
    this.heading = Math.atan2(dx, dz);
    return {
      x: from.col + dx * t + 0.5,
      z: from.row + dz * t + 0.5,
      heading: this.heading,
      moving: true,
    };
  }
}
