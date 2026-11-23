// B15e: the management windows. It replaces the side panel with the same
// calls (toggle, open, inspect, close and the callbacks), but every Manage
// tab is now its own window and several can be open at once; clicking a
// machine, guest or staff member opens a window for it. A new inspect window
// takes the place of the last one unless that one is pinned.
//
// Only open windows poll the worker: each starts a 1 s refresh when it shows
// and stops it when it closes.

import type { SimClient } from '../../client/SimClient';
import type { Command } from '../../shared/contracts';
import type { CompKind } from '../panels/comps';
import { InspectView, inspectKey, type Target } from './InspectView';
import { MANAGE, makeView, type DeskCtx, type ManageTab, type View } from './views';
import { WindowManager, type Win } from './WindowManager';

export type { ManageTab, Target };
/** The side panel's old name for a Manage tab. */
export type PanelTab = ManageTab;

const POLL_MS = 1000;
/** Inspect windows share one remembered spot. */
const INSPECT_SPOT = 'inspect';

const isManage = (k: string): k is ManageTab => k in MANAGE;

export class Desk {
  readonly wm: WindowManager;
  private views = new Map<string, View>();
  private timers = new Map<string, number>();
  /** Set while one inspect window is swapped for another (no deselect). */
  private swapping = false;

  onSell: (objectId: string) => void = () => {};
  /** Take the camera to a guest on the floor (by numeric agent id). */
  onLocateGuest: (agentId: number) => void = () => {};
  /** Keep the camera on a guest as they move (B5). */
  onFollowGuest: (agentId: number, name: string) => void = () => {};
  /** An object's window closed (main.ts clears the selection). */
  onClose: () => void = () => {};
  /** The Manage windows now open (the dock lights them). */
  onWindows: (open: ManageTab[]) => void = () => {};
  /** A comp or price action's outcome, for the toast. */
  onMessage: (text: string) => void = () => {};
  /** Opens the last closed day's report card. */
  onReport: () => void = () => {};

  private ctx: DeskCtx;

  constructor(
    private sim: SimClient,
    layer: HTMLElement,
  ) {
    this.wm = new WindowManager(layer);
    this.wm.onChange = (keys) => this.onWindows(keys.filter(isManage));
    this.ctx = {
      sim,
      act: (cmd, done) => this.act(cmd, done),
      comp: (guestId, kind) => this.comp(guestId, kind),
      setPrice: (objectId, itemId, price) =>
        sim.command<number>({ type: 'setPrice', objectId, itemId, price }),
      locateGuest: (id) => this.onLocateGuest(id),
      followGuest: (id, name) => this.onFollowGuest(id, name),
      report: () => this.onReport(),
    };
  }

  /** Any window open. */
  get isOpen(): boolean {
    return this.wm.open.length > 0;
  }

  isShowing(tab: ManageTab): boolean {
    return !!this.wm.get(tab)?.isOpen;
  }

  toggle(tab: ManageTab): void {
    if (this.isShowing(tab)) this.wm.get(tab)!.close();
    else this.open(tab);
  }

  open(tab: ManageTab): Win {
    const m = MANAGE[tab];
    let view = this.views.get(tab);
    if (!view) {
      view = makeView(tab, this.ctx);
      this.views.set(tab, view);
    }
    const v = view;
    const w = this.wm.show({
      key: tab,
      title: m.title,
      width: m.width,
      tabs: m.tabs,
      onTab: (id) => v.showPane?.(id),
      onOpen: () => this.startPolling(tab),
      onClose: () => this.stopPolling(tab),
      content: v.root,
    });
    return w;
  }

  inspect(target: Target): Win {
    const key = inspectKey(target);
    const existing = this.wm.get(key);
    if (existing?.isOpen) {
      this.wm.raise(existing);
      void this.views.get(key)?.refresh(false);
      return existing;
    }
    // The last unpinned inspect window gives up its place to this one.
    this.swapping = true;
    for (const w of this.wm.open)
      if (w.key.startsWith('inspect:') && !w.pinned) {
        this.wm.rememberAs(w, INSPECT_SPOT);
        this.wm.destroy(w.key);
      }
    this.swapping = false;
    const view = new InspectView(target, this.ctx, () => this.wm.get(key), {
      sell: (objectId) => this.onSell(objectId),
      gone: () => this.wm.get(key)?.close(),
    });
    this.views.set(key, view);
    const w = this.wm.show(
      {
        key,
        title: 'objectId' in target ? 'Inspect' : 'Guest',
        width: '22rem',
        onTab: (id) => view.showPane(id),
        onOpen: () => this.startPolling(key),
        onClose: () => {
          this.stopPolling(key);
          const win = this.wm.get(key);
          if (win) this.wm.rememberAs(win, INSPECT_SPOT);
          this.views.delete(key);
          // Closed for good: the next inspect builds a fresh window.
          this.wm.destroy(key);
          if ('objectId' in target && !this.swapping) this.onClose();
        },
        content: view.root,
      },
      INSPECT_SPOT,
    );
    return w;
  }

  /** Close an object's window (it was sold). */
  forget(objectId: string): void {
    this.wm.get(inspectKey({ objectId }))?.close();
  }

  /** Close every window that is not pinned. */
  close(): void {
    for (const w of this.wm.open) if (!w.pinned) w.close();
  }

  private startPolling(key: string): void {
    this.stopPolling(key);
    const v = this.views.get(key);
    if (!v) return;
    const run = (first: boolean) => void v.refresh(first).catch(() => {});
    run(true);
    this.timers.set(
      key,
      window.setInterval(() => run(false), POLL_MS),
    );
  }

  private stopPolling(key: string): void {
    const t = this.timers.get(key);
    if (t !== undefined) window.clearInterval(t);
    this.timers.delete(key);
  }

  /** How many windows are polling the worker (only the open ones). */
  get polling(): string[] {
    return [...this.timers.keys()];
  }

  private refreshOpen(): Promise<unknown> {
    return Promise.all(
      [...this.timers.keys()].map((k) =>
        this.views
          .get(k)
          ?.refresh(false)
          .catch(() => {}),
      ),
    );
  }

  private async act(cmd: Command, done?: string): Promise<void> {
    try {
      await this.sim.command(cmd);
      if (done) this.onMessage(done);
    } catch (err) {
      this.onMessage((err as Error).message);
    }
    await this.refreshOpen();
  }

  private async comp(guestId: string, kind: CompKind): Promise<void> {
    try {
      await this.sim.command({ type: 'sendComp', guestId, kind });
      this.onMessage(`Comp sent: ${kind === 'matchPlay' ? 'match play' : `a ${kind}`}.`);
    } catch (err) {
      this.onMessage((err as Error).message);
    }
    await this.refreshOpen();
  }
}
