import type { Cell } from '../grid/astar';
import type { CasinoWorld } from '../world';

// Shared grid-walking base for guests and staff.
// Movement: pos is the logical tile; while stepping, moveFrom→moveTo with
// moveTick/moveTicksPerTile progress. Render interpolates from these.
export abstract class Walker {
  pos: Cell;
  moveFrom: Cell;
  moveTo: Cell | null = null;
  moveTick = 0;
  protected path: Cell[] = [];

  constructor(start: Cell) {
    this.pos = { ...start };
    this.moveFrom = { ...start };
  }

  abstract get moveTicksPerTile(): number;
  /** Called when the queued route can no longer be walked or re-planned. */
  protected abstract onRouteLost(world: CasinoWorld): void;

  protected get arrived(): boolean {
    return this.moveTo === null && this.path.length === 0;
  }

  protected stepMovement(world: CasinoWorld): void {
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
      if (this.path.length > 0) this.beginStep(world);
    }
  }

  private beginStep(world: CasinoWorld): void {
    const next = this.path[0];
    if (!next) return;
    if (!world.grid.isWalkable(next.col, next.row)) {
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

  protected goTo(world: CasinoWorld, dest: Cell): boolean {
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
  }

  /** Teleport (pincer drop, load): lands cleanly on a tile with no step in flight. */
  placeAt(cell: Cell): void {
    this.pos = { ...cell };
    this.moveFrom = { ...cell };
    this.clearMovement();
  }
}
