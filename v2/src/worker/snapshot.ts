// Turns a CasinoWorld into the wire Snapshot. Pure apart from the reusable
// buffer it owns, so it is unit-testable without a Worker.

import type { GameEvents } from '../EventBus';
import { footprintOf } from '../sim/build';
import type { CasinoWorld } from '../sim/world';
import type { CasinoGame } from '../sim/entities/machines/CasinoGame';
import { SeatedCasinoGame } from '../sim/entities/machines/SeatedCasinoGame';
import type { BlackjackRules } from '../sim/games/blackjack/rules';
import {
  AGENT_STRIDE,
  AgentKind,
  type Anim,
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

/** Blackjack felt rows: 3:2 S17, 3:2 H17, 6:5 S17, 6:5 H17 (see Atlas.ts). */
function decalRow(m: CasinoGame | undefined): number | undefined {
  const r = m?.math?.rules as Partial<BlackjackRules> | undefined;
  if (r?.blackjackPays === undefined) return undefined;
  return (r.blackjackPays === '6:5' ? 2 : 0) + (r.h17 ? 1 : 0);
}

function idNum(id: string): number {
  return Number(id.replace(/\D+/g, '')) || 0;
}

export class SnapshotBuilder {
  private agents = new Float32Array(512 * AGENT_STRIDE);
  private lastObjectsKey = '';
  /** world.floorRevision last sent; -1 so the first snapshot carries the floor. */
  private sentFloorRevision = -1;
  objectsVersion = 0;
  floorVersion = 0;
  speed = 1;
  pendingEvents: SimEvent[] = [];
  /** world.tick() wall times (ms), newest last, for the stats command. */
  readonly tickTimes: number[] = [];

  recordTick(ms: number): void {
    this.tickTimes.push(ms);
    if (this.tickTimes.length > 100) this.tickTimes.shift();
  }

  build(world: CasinoWorld, now: number): Snapshot {
    const total = world.guests.size + world.staff.size;
    // The previous buffer was transferred away; always hand out a fresh one.
    const cap = Math.max(512, total) * AGENT_STRIDE;
    this.agents = new Float32Array(cap);
    let i = 0;
    // Poses come straight from the walkers: float crowd positions in nav mode,
    // interpolated grid steps otherwise (see Walker.renderPose).
    for (const g of world.guests.values()) {
      if (g.state === 'gone') continue;
      const p = g.renderPose();
      this.write(
        i++,
        p.x,
        p.z,
        p.heading,
        g.anim,
        AgentKind.Guest,
        ARCHETYPE_VARIANT[g.archetype] ?? 0,
        g.needs.happiness / 100,
        idNum(g.id),
      );
    }
    for (const s of world.staff.values()) {
      if (s.state === 'carried') continue;
      const p = s.renderPose();
      const kind = STAFF_KIND[s.kind] ?? AgentKind.Staff;
      this.write(i++, p.x, p.z, p.heading, s.anim, kind, 0, 1, idNum(s.id));
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
    if (world.floorRevision !== this.sentFloorRevision) {
      this.sentFloorRevision = world.floorRevision;
      this.floorVersion++;
      snap.floorVersion = this.floorVersion;
      snap.floor = world.floor.toView();
    }
    snap.objectsVersion = this.objectsVersion;
    this.pendingEvents = [];
    return snap;
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
        rot: o.rot ?? 0,
        broken: m?.broken ?? false,
        open: m ? world.isTableOpen(o.id) : true,
        occupants: occupants(m),
        decalRow: decalRow(m),
      };
    });
    const key = views
      .map(
        (v) => `${v.id}:${v.broken ? 1 : 0}:${v.open ? 1 : 0}:${v.occupants}:${v.decalRow ?? ''}`,
      )
      .join('|');
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
            goal:
              sc.def.id === 'sandbox'
                ? 'Unlimited funds'
                : `Average $${sc.def.goalDailyProfit.toLocaleString()}/day by day ${sc.def.dayLimit}`,
            status:
              sc.def.id === 'sandbox'
                ? 'active'
                : sc.status === 'won' || sc.status === 'endless'
                  ? 'won'
                  : sc.status === 'failed'
                    ? 'lost'
                    : 'active',
          }
        : null,
      reputation: { value: world.reputation.value, label: world.reputation.label },
      modifiers: world.modifiers.activeModifiers.map((m) => ({
        id: m.id,
        name: m.name,
        blurb: m.blurb,
      })),
    };
  }
}

/** A ticker line for the wire, placed where its subject is right now: the
 *  centre of an object's footprint, or a guest's current pose. A subject that
 *  is already gone leaves the line unplaced rather than pointing at nothing. */
export function tickerEvent(world: CasinoWorld, e: GameEvents['tickerMessage']): SimEvent {
  const ev: Extract<SimEvent, { type: 'ticker' }> = {
    type: 'ticker',
    text: e.text,
    severity: e.severity ?? 'info',
  };
  const o = e.objectId ? world.state.getObject(e.objectId) : undefined;
  if (o) {
    const fp = footprintOf(o.defId, o.rot ?? 0);
    ev.objectId = o.id;
    ev.x = o.col + fp.w / 2;
    ev.z = o.row + fp.h / 2;
  }
  const g = e.guestId ? world.guests.get(e.guestId) : undefined;
  if (g && g.state !== 'gone') {
    const p = g.renderPose();
    ev.agentId = idNum(g.id);
    ev.x = p.x;
    ev.z = p.z;
  }
  return ev;
}
