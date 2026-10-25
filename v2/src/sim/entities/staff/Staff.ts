import { BAR_BALANCE, STAFF_BALANCE } from '../../../data/balance';
import { Anim } from '../../../shared/contracts';
import { approachPose, dealerSpot } from '../../agents/seats';
import type { Cell } from '../../grid/astar';
import { NavFilter, STAFF_SPEED } from '../../nav/NavSystem';
import type { CasinoWorld } from '../../world';
import type { Guest } from '../Guest';
import { Walker } from '../Walker';

/** Security: how close (m) a guard must get to walk a guest out, and how
 *  often (ticks) the chase re-aims at a target who keeps moving. */
const ESCORT_REACH = 1.5;
const CHASE_RETARGET_TICKS = 10;

// guestId → staffId, per world: two guards never chase the same drunk. Held
// beside the world rather than on it, like the queue book.
const securityClaims = new WeakMap<CasinoWorld, Map<string, string>>();
function claims(world: CasinoWorld): Map<string, string> {
  let m = securityClaims.get(world);
  if (!m) securityClaims.set(world, (m = new Map()));
  return m;
}

export type StaffKind =
  'mechanic' | 'janitor' | 'bartender' | 'waitress' | 'pitBoss' | 'security' | 'dealer' | 'cashier';
export type StaffState =
  'idle' | 'patrol' | 'toJob' | 'working' | 'brewing' | 'stationed' | 'carried';

// One class for every role. Mechanic/janitor share the job-queue dispatch
// below (the only difference is which jobs the world hands them and how long
// the work takes); dealer is cosmetic-only and gets its own simpler branch
// (actDealer) dispatched separately, since it never enters the job queue.
export class Staff extends Walker {
  readonly id: string;
  readonly kind: StaffKind;
  state: StaffState = 'idle';
  jobId: string | null = null;
  assignedBarId: string | null = null;
  /** Dealer only: the table it's claimed/stationed at. */
  assignedTableId: string | null = null;
  /** Dealer only, cosmetic: someone is seated at its table, so it deals. */
  private dealing = false;
  /** Cashier only: the cage it's claimed/stationed at. */
  assignedCageId: string | null = null;
  private workTimer = 0;
  private brewTimer = 0;
  private idleTimer = 0;
  /** Security only: the guest being walked out. */
  targetGuestId: string | null = null;
  private chaseTimer = 0;

  constructor(id: string, kind: StaffKind, start: Cell) {
    super(start);
    this.id = id;
    this.kind = kind;
  }

  get moveTicksPerTile(): number {
    return STAFF_BALANCE.moveTicksPerTile;
  }

  get navSpeed(): number {
    return STAFF_SPEED;
  }

  get navFilter(): NavFilter {
    return NavFilter.Staff;
  }

  isInWorld(world: CasinoWorld): boolean {
    return world.staff.get(this.id) === this;
  }

  get anim(): Anim {
    if (this.walking) return Anim.Walk;
    // A stationed dealer deals while anyone sits at the table (the renderer
    // turns a dealer's Play into the deal clip) and stands idle at an empty one.
    if (this.kind === 'dealer' && this.state === 'stationed')
      return this.dealing ? Anim.Play : Anim.Idle;
    return this.state === 'working' || this.state === 'brewing' ? Anim.Play : Anim.Idle;
  }

  get wagePerHour(): number {
    return STAFF_BALANCE[this.kind].wagePerHour;
  }

  get workDurationTicks(): number {
    if (this.kind === 'mechanic') return STAFF_BALANCE.mechanic.repairTicks;
    if (this.kind === 'waitress') return STAFF_BALANCE.waitress.deliverTicks;
    return STAFF_BALANCE.janitor.cleanTicks;
  }

  protected onRouteLost(world: CasinoWorld): void {
    this.abandonJob(world);
  }

  tick(world: CasinoWorld): void {
    if (this.state === 'carried') return;
    this.stepMovement(world);
    this.act(world);
  }

  /** Pincer pickup: freeze in place and give the job back to the pool. */
  pickUp(world: CasinoWorld): void {
    this.abandonJob(world);
    this.assignedBarId = null;
    this.assignedTableId = null;
    this.assignedCageId = null;
    this.clearMovement();
    this.parkHere();
    this.state = 'carried';
  }

  drop(cell: Cell): void {
    this.placeAt(cell);
    this.state = 'idle';
  }

  private act(world: CasinoWorld): void {
    if (this.kind === 'bartender') {
      this.actBartender(world);
      return;
    }
    if (this.kind === 'dealer') {
      this.actDealer(world);
      return;
    }
    if (this.kind === 'cashier') {
      this.actCashier(world);
      return;
    }
    if (this.kind === 'security' && this.actSecurity(world)) return;
    switch (this.state) {
      case 'idle':
        this.findWork(world);
        break;
      case 'patrol':
        if (this.arrived) this.state = 'idle';
        break;
      case 'toJob':
        if (!this.jobId || !world.isJobStillValid(this)) {
          this.abandonJob(world);
          break;
        }
        if (this.arrived) {
          this.state = 'working';
          this.workTimer = 0;
        }
        break;
      case 'working':
        this.tickWork(world);
        break;
      case 'brewing':
      case 'stationed':
      case 'carried':
        break;
    }
  }

  /** Bartender: no job queue — assign to the nearest bar once, then brew
   * forever while stationed there. Doesn't fit claimJobFor/completeJob
   * since production never "completes." */
  private actBartender(world: CasinoWorld): void {
    if (this.state === 'carried') return;
    if (!this.assignedBarId || !world.bars.has(this.assignedBarId)) {
      this.assignedBarId = null;
      for (const po of world.state.allObjects()) {
        if (po.defId !== 'bar') continue;
        const stand = world.barStandTile(po.id);
        if (!stand || !this.goTo(world, stand)) continue;
        this.assignedBarId = po.id;
        this.state = 'toJob';
        break;
      }
      return;
    }
    if (this.state === 'toJob') {
      if (this.arrived) {
        this.state = 'brewing';
        this.brewTimer = 0;
      }
      return;
    }
    if (this.state !== 'brewing') return;
    this.brewTimer++;
    if (this.brewTimer < BAR_BALANCE.brewTicks) return;
    this.brewTimer = 0;
    world.brewDrink(this.assignedBarId);
  }

  /** Dealer: cosmetic-only — claim the nearest table without a dealer, walk
   * to its stand tile, then stay stationed forever. No timer, no job queue,
   * no payout interaction. Re-seeks only if its table is sold or its claim
   * is otherwise invalidated out from under it. */
  private actDealer(world: CasinoWorld): void {
    if (this.state === 'carried') return;
    if (this.assignedTableId && !world.isDealerAssignmentValid(this.id, this.assignedTableId)) {
      this.assignedTableId = null;
      this.state = 'idle';
    }
    if (this.state === 'stationed') {
      const table = this.assignedTableId ? world.machines.get(this.assignedTableId) : undefined;
      this.dealing = !!table && 'seatedCount' in table && (table.seatedCount as number) > 0;
      return;
    }
    this.dealing = false;
    if (this.state === 'toJob') {
      if (this.arrived) this.state = 'stationed';
      return;
    }
    const claim = world.claimDealerTable(this.id);
    if (!claim) return;
    // The table's dealer edge, facing the players; the old perimeter pick when
    // that cell is blocked (a table pushed against a wall).
    const spot = dealerSpot(world, claim.tableId);
    const stand = spot?.cell ?? this.dealerStation(world, claim.tableId) ?? claim.stand;
    const pose = spot?.pose ?? approachPose(world, stand, claim.tableId) ?? undefined;
    if (this.goTo(world, stand, pose)) {
      this.assignedTableId = claim.tableId;
      this.state = 'toJob';
      return;
    }
    world.releaseDealerClaim(claim.tableId); // claimed but unreachable — put it back
  }

  /**
   * Where a dealer stands: the first walkable perimeter cell past the table's
   * seats, so the dealer never takes a guest's chair. Seat cells come from the
   * world's own enumeration (the same one reserveMachine seats guests by).
   */
  private dealerStation(world: CasinoWorld, tableId: string): Cell | null {
    const po = world.state.getObject(tableId);
    const machine = world.machines.get(tableId);
    if (!po || !machine) return null;
    const seats = 'seatCount' in machine ? (machine.seatCount as number) : 0;
    const cells = world.seatCellsForTest(po);
    for (let i = seats; i < cells.length; i++) {
      const c = cells[i]!;
      if (world.grid.isWalkable(c.col, c.row)) return c;
    }
    return null;
  }

  /**
   * Security: pick the nearest unclaimed drunk or raging guest, chase them
   * down, and walk them out. Returns false when there is nobody to deal with,
   * so the guard falls back to the ambient patrol below.
   */
  private actSecurity(world: CasinoWorld): boolean {
    const book = claims(world);
    let target: Guest | undefined = this.targetGuestId
      ? world.guests.get(this.targetGuestId)
      : undefined;
    if (!target || target.escorted || target.state === 'gone') {
      if (this.targetGuestId) book.delete(this.targetGuestId);
      this.targetGuestId = null;
      target = undefined;
      let best = Infinity;
      for (const g of world.guests.values()) {
        if (!(g.drunk || g.raging) || g.escorted || g.state === 'gone' || book.has(g.id)) continue;
        const d = Math.hypot(g.x - this.x, g.z - this.z);
        if (d < best) [best, target] = [d, g];
      }
      if (!target) {
        if (this.state === 'toJob' && !this.jobId) this.state = 'idle';
        return false;
      }
      book.set(target.id, this.id);
      this.targetGuestId = target.id;
      this.chaseTimer = CHASE_RETARGET_TICKS;
    }
    const near =
      Math.abs(target.pos.col - this.pos.col) + Math.abs(target.pos.row - this.pos.row) <= 1 ||
      Math.hypot(target.x - this.x, target.z - this.z) <= ESCORT_REACH;
    if (near) {
      target.escortOut(world);
      book.delete(target.id);
      this.targetGuestId = null;
      this.clearMovement();
      this.state = 'idle';
      return true;
    }
    if (++this.chaseTimer >= CHASE_RETARGET_TICKS || this.arrived) {
      this.chaseTimer = 0;
      this.goTo(world, target.pos);
      this.state = 'toJob';
    }
    return true;
  }

  /** Cashier: same "assign once, stay stationed forever" shape as the
   * dealer, targeting a cage instead of a table. No timer — the cage just
   * needs the cashier physically present for guests to self-serve there. */
  private actCashier(world: CasinoWorld): void {
    if (this.state === 'carried') return;
    if (this.assignedCageId && !world.isCashierAssignmentValid(this.id, this.assignedCageId)) {
      this.assignedCageId = null;
      this.state = 'idle';
    }
    if (this.state === 'stationed') return;
    if (this.state === 'toJob') {
      if (this.arrived) this.state = 'stationed';
      return;
    }
    const claim = world.claimCashierCage(this.id);
    if (!claim) return;
    if (this.goTo(world, claim.stand)) {
      this.assignedCageId = claim.cageId;
      this.state = 'toJob';
      return;
    }
    world.releaseCashierClaim(claim.cageId); // claimed but unreachable — put it back
  }

  private findWork(world: CasinoWorld): void {
    const job = world.claimJobFor(this);
    if (job) {
      if (this.goTo(world, job.cell)) {
        this.jobId = job.jobId;
        this.state = 'toJob';
        return;
      }
      world.releaseJobs(this.id); // claimed but unreachable — put it back
    }
    this.idleTimer++;
    if (this.idleTimer < STAFF_BALANCE.patrolIdleTicks) return;
    this.idleTimer = 0;
    const target = world.randomWalkableTile();
    if (target && this.goTo(world, target)) this.state = 'patrol';
  }

  private tickWork(world: CasinoWorld): void {
    if (!this.jobId || !world.isJobStillValid(this)) {
      this.abandonJob(world);
      return;
    }
    this.workTimer++;
    if (this.workTimer < this.workDurationTicks) return;
    world.completeJob(this);
    this.jobId = null;
    this.state = 'idle';
  }

  private abandonJob(world: CasinoWorld): void {
    world.releaseJobs(this.id);
    this.jobId = null;
    this.state = 'idle';
  }
}
