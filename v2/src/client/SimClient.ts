// Main-thread handle on the sim worker: request/reply commands and the
// latest two snapshots for interpolation.

import type { Command, Snapshot, WorkerIn, WorkerOut } from '../shared/contracts';

export class SimClient {
  private worker: Worker;
  private nextReq = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  prev: Snapshot | null = null;
  curr: Snapshot | null = null;
  /** main-thread performance.now() when curr arrived. */
  currAt = 0;
  private listeners = new Set<(s: Snapshot) => void>();

  constructor(seed = Date.now() >>> 0) {
    this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerOut>) => this.receive(ev.data);
    this.send({ type: 'init', seed });
  }

  private send(msg: WorkerIn): void {
    this.worker.postMessage(msg);
  }

  private receive(msg: WorkerOut): void {
    if (msg.type === 'snapshot') {
      this.prev = this.curr;
      this.curr = msg.snap;
      this.currAt = performance.now();
      for (const l of this.listeners) l(msg.snap);
    } else if (msg.type === 'reply') {
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error ?? 'command failed'));
    }
  }

  command<T = unknown>(cmd: Command): Promise<T> {
    const reqId = this.nextReq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ type: 'cmd', reqId, cmd });
    });
  }

  onSnapshot(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 0..1 progress from prev toward curr, for render interpolation. */
  alpha(now: number): number {
    if (!this.prev || !this.curr) return 1;
    const span = Math.max(1, this.curr.time - this.prev.time);
    return Math.min(1, (now - this.currAt) / span);
  }
}
