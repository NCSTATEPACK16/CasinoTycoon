/// <reference lib="webworker" />
// The simulation thread. Ticks CasinoWorld at a fixed 10 Hz × speed and posts
// one Snapshot per batch of ticks; the main thread only ever renders.

import { SIM_TICK_MS } from '../config';
import { eventBus } from '../EventBus';
import type { WorkerIn, WorkerOut } from '../shared/contracts';
import { recordBigSix } from '../sim/fx/bigSix';
import { lastRound } from '../sim/fx/rounds';
import { WorldNav } from '../sim/nav/WorldNav';
import { CasinoWorld } from '../sim/world';
import { runCommand } from './commands';
import { SnapshotBuilder } from './snapshot';

declare const self: DedicatedWorkerGlobalScope;

let world: CasinoWorld | null = null;
const snap = new SnapshotBuilder();
let last = 0;
let carry = 0;
/** Never run more than this many ticks per wake-up, or a backgrounded tab returns to a stampede. */
const MAX_TICKS_PER_PUMP = 40;

function post(msg: WorkerOut, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

/** The last round already sent per object, so one round is never shown twice. */
const sentSeq = new Map<string, number>();

function wireEvents(w: CasinoWorld): void {
  eventBus.clear();
  sentSeq.clear();
  eventBus.on('machinePlayed', (e) => {
    const o = w.state.getObject(e.machineId);
    if (!o) return;
    // Watched objects get the play's last round instead of its payout: the
    // client shows that round and its own win when the round is revealed.
    const m = w.machines.get(e.machineId);
    // The big six pays from a table, not an engine: its round is the spin itself.
    const six = m?.defId === 'big-six-wheel' ? recordBigSix(m, e.wager, e.payout) : null;
    const rec = snap.interest.has(e.machineId) ? (six ?? lastRound(m?.math)) : null;
    if (rec && sentSeq.get(e.machineId) !== rec.seq) {
      sentSeq.set(e.machineId, rec.seq);
      snap.pendingEvents.push({
        type: 'roundFx',
        objectId: e.machineId,
        x: o.col + 0.5,
        z: o.row + 0.5,
        fx: rec.fx,
      });
      return;
    }
    if (e.payout <= 0) return;
    snap.pendingEvents.push({
      type: 'payout',
      objectId: e.machineId,
      x: o.col + 0.5,
      z: o.row + 0.5,
      amount: e.payout,
    });
  });
  eventBus.on('tickerMessage', (e) =>
    snap.pendingEvents.push({ type: 'ticker', text: e.text, severity: e.severity ?? 'info' }),
  );
  eventBus.on('goalReached', () =>
    snap.pendingEvents.push({ type: 'gameOver', won: true, reason: 'Goal reached' }),
  );
  eventBus.on('scenarioFailed', (e) =>
    snap.pendingEvents.push({
      type: 'gameOver',
      won: false,
      reason: e.reason === 'insolvent' ? 'Bankrupt' : 'Out of time',
    }),
  );
}

function pump(): void {
  if (!world) return;
  const now = performance.now();
  carry += ((now - last) * snap.speed) / SIM_TICK_MS;
  last = now;
  let n = Math.min(MAX_TICKS_PER_PUMP, Math.floor(carry));
  carry = n === MAX_TICKS_PER_PUMP ? 0 : carry - n;
  if (n === 0 && snap.speed !== 0) return;
  while (n-- > 0) {
    const t0 = performance.now();
    world.tick();
    snap.recordTick(performance.now() - t0);
  }
  const s = snap.build(world, now);
  post({ type: 'snapshot', snap: s }, [s.agents.buffer]);
}

self.onmessage = async (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    // v2: the walled, zoned starter floor, dealers required to open tables,
    // and guests on the Recast crowd. The WASM loads before the first tick,
    // so no tick ever runs in grid mode.
    const w = new CasinoWorld({ seed: msg.seed, starterFloor: true, requireDealers: true });
    wireEvents(w);
    w.startScenario(null);
    w.attachNav(await WorldNav.create(w));
    world = w;
    last = performance.now();
    setInterval(pump, SIM_TICK_MS / 2);
    post({ type: 'ready' });
    return;
  }
  if (!world) return post({ type: 'reply', reqId: msg.reqId, ok: false, error: 'not initialised' });
  try {
    const r = runCommand(world, snap, msg.cmd);
    post(
      r.ok
        ? { type: 'reply', reqId: msg.reqId, ok: true, data: r.data }
        : { type: 'reply', reqId: msg.reqId, ok: false, error: r.error },
    );
  } catch (err) {
    post({ type: 'reply', reqId: msg.reqId, ok: false, error: String(err) });
  }
};
