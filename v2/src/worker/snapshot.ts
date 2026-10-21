// Turns a CasinoWorld into the wire Snapshot. Pure apart from the reusable
// buffer it owns, so it is unit-testable without a Worker.

import type { CasinoWorld } from '../sim/world';
import type { Walker } from '../sim/entities/Walker';
import type { CasinoGame } from '../sim/entities/machines/CasinoGame';
import { SeatedCasinoGame } from '../sim/entities/machines/SeatedCasinoGame';
import {
  AGENT_STRIDE,
  AgentKind,
  Anim,
  type HudView,
  type ObjectView,
  type SimEvent,
  type Snapshot,
} from '../shared/contracts';

const ARCHETYPE_VARIANT: Record<string, number> = {
  regular: 0,
  highRoller: 1,
  biker: 2,
  tourist: 3,
};
const STAFF_KIND: Record<string, AgentKind> = {
  dealer: AgentKind.Dealer,
  janitor: AgentKind.Janitor,
  security: AgentKind.Security,
};

function occupants(m: CasinoGame | undefined): number {
  if (!m) return 0;
  if (m instanceof SeatedCasinoGame) return m.seatedCount;
  return m.reservedBy ? 1 : 0;
}

function idNum(id: string): number {
  return Number(id.replace(/\D+/g, '')) || 0;
}

/** Interpolated centre of a grid walker, in metres. */
function walkerXZ(w: Walker): { x: number; z: number; heading: number; moving: boolean } {
  const from = w.moveFrom;
  const to = w.moveTo;
  if (!to) return { x: w.pos.col + 0.5, z: w.pos.row + 0.5, heading: NaN, moving: false };
  const t = Math.min(1, w.moveTick / Math.max(1, w.moveTicksPerTile));
  const dx = to.col - from.col;
  const dz = to.row - from.row;
  return {
    x: from.col + dx * t + 0.5,
    z: from.row + dz * t + 0.5,
    heading: Math.atan2(dx, dz),
    moving: true,
  };
}

export class SnapshotBuilder {
  private agents = new Float32Array(512 * AGENT_STRIDE);
  private headings = new Map<string, number>();
  private lastObjectsKey = '';
  objectsVersion = 0;
  floorVersion = 0;
  speed = 1;
  pendingEvents: SimEvent[] = [];

  build(world: CasinoWorld, now: number): Snapshot {
    const total = world.guests.size + world.staff.size;
    // The previous buffer was transferred away; always hand out a fresh one.
    const cap = Math.max(512, total) * AGENT_STRIDE;
    this.agents = new Float32Array(cap);
    let i = 0;
    for (const g of world.guests.values()) {
      if (g.state === 'gone') continue;
      const p = walkerXZ(g);
      const heading = this.heading(g.id, p.heading);
      const anim = p.moving
        ? Anim.Walk
        : g.state === 'play'
          ? Anim.Play
          : g.state === 'service'
            ? Anim.Eat
            : Anim.Idle;
      this.write(
        i++,
        p.x,
        p.z,
        heading,
        anim,
        AgentKind.Guest,
        ARCHETYPE_VARIANT[g.archetype] ?? 0,
        g.needs.happiness / 100,
        idNum(g.id),
      );
    }
    for (const s of world.staff.values()) {
      if (s.state === 'carried') continue;
      const p = walkerXZ(s);
      const heading = this.heading(s.id, p.heading);
      const kind = STAFF_KIND[s.kind] ?? AgentKind.Staff;
      this.write(i++, p.x, p.z, heading, p.moving ? Anim.Walk : Anim.Idle, kind, 0, 1, idNum(s.id));
    }

    const snap: Snapshot = {
      tick: world.tickCount,
      time: now,
      agentCount: i,
      agents: this.agents,
      objectsVersion: this.objectsVersion,
      floorVersion: this.floorVersion,
      hud: this.hud(world),
      events: this.pendingEvents,
    };
    const objects = this.objects(world);
    if (objects) snap.objects = objects;
    snap.objectsVersion = this.objectsVersion;
    this.pendingEvents = [];
    return snap;
  }

  private heading(id: string, h: number): number {
    if (!Number.isNaN(h)) this.headings.set(id, h);
    return this.headings.get(id) ?? 0;
  }

  private write(
    i: number,
    x: number,
    z: number,
    h: number,
    anim: Anim,
    kind: AgentKind,
    variant: number,
    mood: number,
    id: number,
  ): void {
    const o = i * AGENT_STRIDE;
    const a = this.agents;
    a[o] = x;
    a[o + 1] = z;
    a[o + 2] = h;
    a[o + 3] = anim;
    a[o + 4] = kind;
    a[o + 5] = variant;
    a[o + 6] = mood;
    a[o + 7] = id;
  }

  /** Object list, only when something about it changed since the last call. */
  private objects(world: CasinoWorld): ObjectView[] | undefined {
    const views: ObjectView[] = world.state.allObjects().map((o) => {
      const m = world.machines.get(o.id);
      return {
        id: o.id,
        defId: o.defId,
        col: o.col,
        row: o.row,
        rot: 0,
        broken: m?.broken ?? false,
        open: true,
        occupants: occupants(m),
      };
    });
    const key = views.map((v) => `${v.id}:${v.broken ? 1 : 0}:${v.occupants}`).join('|');
    if (key === this.lastObjectsKey) return undefined;
    this.lastObjectsKey = key;
    this.objectsVersion++;
    return views;
  }

  private hud(world: CasinoWorld): HudView {
    const sc = world.scenario;
    return {
      cash: world.state.cash,
      day: world.time.day,
      hour: world.time.hour,
      minute: 0,
      rating: world.rating,
      guests: world.guests.size,
      speed: this.speed,
      todayProfit: world.ledger.todayRevenue - world.ledger.todayExpenses,
      scenario: sc
        ? {
            id: sc.def.id,
            name: sc.def.name,
            goal: `Average $${sc.def.goalDailyProfit.toLocaleString()}/day by day ${sc.def.dayLimit}`,
            status:
              sc.status === 'won' || sc.status === 'endless'
                ? 'won'
                : sc.status === 'failed'
                  ? 'lost'
                  : 'active',
          }
        : null,
    };
  }
}
