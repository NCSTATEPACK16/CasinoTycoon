import { STAFF_BALANCE } from '../../../data/balance';
import type { Cell } from '../../grid/astar';
import type { CasinoWorld } from '../../world';
import { Walker } from '../Walker';

export type StaffKind = 'mechanic' | 'janitor';
export type StaffState = 'idle' | 'patrol' | 'toJob' | 'working' | 'carried';

// One class for both roles: the only difference is which jobs the world hands
// them (broken machines vs messes) and how long the work takes.
export class Staff extends Walker {
  readonly id: string;
  readonly kind: StaffKind;
  state: StaffState = 'idle';
  jobId: string | null = null;
  private workTimer = 0;
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
    return this.kind === 'mechanic'
      ? STAFF_BALANCE.mechanic.repairTicks
      : STAFF_BALANCE.janitor.cleanTicks;
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
    this.clearMovement();
    this.state = 'carried';
  }

  drop(cell: Cell): void {
    this.placeAt(cell);
    this.state = 'idle';
  }

  private act(world: CasinoWorld): void {
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
      case 'carried':
        break;
    }
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
