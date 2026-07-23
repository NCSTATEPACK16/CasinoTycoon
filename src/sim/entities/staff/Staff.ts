import { BAR_BALANCE, STAFF_BALANCE } from '../../../data/balance';
import type { Cell } from '../../grid/astar';
import type { CasinoWorld } from '../../world';
import { Walker } from '../Walker';

export type StaffKind =
  | 'mechanic'
  | 'janitor'
  | 'bartender'
  | 'waitress'
  | 'pitBoss'
  | 'security'
  | 'dealer'
  | 'cashier';
export type StaffState = 'idle' | 'patrol' | 'toJob' | 'working' | 'brewing' | 'stationed' | 'carried';

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
  /** Cashier only: the cage it's claimed/stationed at. */
  assignedCageId: string | null = null;
  private workTimer = 0;
  private brewTimer = 0;
  private idleTimer = 0;

  constructor(id: string, kind: StaffKind, start: Cell) {
    super(start);
    this.id = id;
    this.kind = kind;
  }

  get moveTicksPerTile(): number {
    return STAFF_BALANCE.moveTicksPerTile;
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
    if (this.state === 'stationed') return;
    if (this.state === 'toJob') {
      if (this.arrived) this.state = 'stationed';
      return;
    }
    const claim = world.claimDealerTable(this.id);
    if (!claim) return;
    if (this.goTo(world, claim.stand)) {
      this.assignedTableId = claim.tableId;
      this.state = 'toJob';
      return;
    }
    world.releaseDealerClaim(claim.tableId); // claimed but unreachable — put it back
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
