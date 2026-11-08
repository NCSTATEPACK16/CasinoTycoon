// B15e: floating windows (RollerCoaster Tycoon). Each window has a thin
// header with its title, a pin and a close button, optional underlined tabs,
// and a body that scrolls. Windows live in the shell's window layer, which
// already sits between the top bar and the dock and between the side
// columns, so a window can never cover the bar, the dock or the goals: it is
// dragged by its header and clamped inside the layer.
//
// A new window goes to the first free spot (left to right, then down, clear
// of every other window and anything else in the layer, such as Settings);
// when nothing is free it cascades from the last one. A window remembers
// where it was for the session, by key. Clicking a window raises it.
//
// Closed windows are hidden, not removed, so their DOM (and the audio's
// watch on it) survives for the next open.

import './Window.css';

export interface WinOptions {
  key: string;
  title: string;
  /** CSS width (rem), clamped to the layer. */
  width?: string;
  /** Underlined tabs under the header. */
  tabs?: { id: string; label: string }[];
  onTab?: (id: string) => void;
  /** Called after the window hides (by its ✕ or the manager). */
  onClose?: () => void;
  /** Called when the window shows (first open and every reopen). */
  onOpen?: () => void;
  /** What goes in the body when the window is made. */
  content?: HTMLElement;
}

const GAP = 8;
const CASCADE = 28;
/** The height a new window is planned at before its data fills it. */
const PLAN_HEIGHT_REM = 18;

export class Win {
  readonly root = el('section', 'win');
  readonly body = el('div', 'win-body');
  private head = el('header', 'win-head');
  private titleEl = el('h2', 'win-title');
  private tabBar = el('nav', 'win-tabs');
  private tabButtons = new Map<string, HTMLButtonElement>();
  private pinBtn: HTMLButtonElement;
  pinned = false;
  tab: string | null = null;

  constructor(
    readonly key: string,
    private opts: WinOptions,
    private wm: WindowManager,
  ) {
    this.root.dataset.win = key;
    this.root.setAttribute('role', 'dialog');
    this.root.style.width = opts.width ?? '24rem';
    this.title = opts.title;
    this.pinBtn = iconButton('win-pin', '📌', 'Pin: keep this window open');
    this.pinBtn.onclick = () => this.setPinned(!this.pinned);
    const close = iconButton('win-close', '✕', 'Close');
    close.onclick = () => this.close();
    this.head.append(this.titleEl, this.pinBtn, close);
    this.root.append(this.head, this.body);
    if (opts.content) this.body.append(opts.content);
    if (opts.tabs?.length) this.setTabs(opts.tabs);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', () => this.wm.raise(this), true);
    this.dragBy(this.head);
  }

  set title(t: string) {
    if (this.titleEl.textContent !== t) this.titleEl.textContent = t;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  setPinned(on: boolean): void {
    this.pinned = on;
    this.root.classList.toggle('pinned', on);
    this.pinBtn.setAttribute('aria-pressed', String(on));
    this.pinBtn.title = on ? 'Pinned: stays open (click to unpin)' : 'Pin: keep this window open';
  }

  /** Replace the tab bar; an empty list removes it. */
  setTabs(tabs: { id: string; label: string }[]): void {
    this.tabBar.replaceChildren();
    this.tabButtons.clear();
    if (!tabs.length) {
      this.tabBar.remove();
      this.tab = null;
      return;
    }
    for (const t of tabs) {
      const b = el('button', 'win-tab', t.label) as HTMLButtonElement;
      b.type = 'button';
      b.dataset.tab = t.id;
      b.onclick = () => this.showTab(t.id);
      this.tabButtons.set(t.id, b);
      this.tabBar.append(b);
    }
    if (!this.root.contains(this.tabBar)) this.root.insertBefore(this.tabBar, this.body);
    this.showTab(this.tab && this.tabButtons.has(this.tab) ? this.tab : tabs[0]!.id);
  }

  showTab(id: string): void {
    this.tab = id;
    for (const [k, b] of this.tabButtons) b.classList.toggle('active', k === id);
    this.opts.onTab?.(id);
  }

  close(): void {
    if (this.root.hidden) return;
    this.wm.remember(this);
    this.root.hidden = true;
    this.opts.onClose?.();
    this.wm.changed();
  }

  /** Header drag, clamped to the layer. Buttons in the header still click. */
  private dragBy(handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      const start = {
        x: e.clientX,
        y: e.clientY,
        left: this.root.offsetLeft,
        top: this.root.offsetTop,
      };
      handle.setPointerCapture(e.pointerId);
      this.root.classList.add('dragging');
      const move = (ev: PointerEvent) =>
        this.wm.place(this, start.left + ev.clientX - start.x, start.top + ev.clientY - start.y);
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        this.root.classList.remove('dragging');
        this.wm.remember(this);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }
}

export class WindowManager {
  private wins = new Map<string, Win>();
  private z = 1;
  /** Where each window was last, for the session. */
  private spots = new Map<string, { x: number; y: number }>();
  private last: Win | null = null;
  /** The open windows changed (keys of the open ones). */
  onChange: (open: string[]) => void = () => {};
  /** A window's root was made (main.ts hands it to the panel sounds). */
  onCreate: (root: HTMLElement) => void = () => {};

  /** The layer shrinks when a tray opens or the screen changes, and a window
   *  grows when its data arrives: keep every window inside the layer. */
  private ro = new ResizeObserver(() => {
    for (const w of this.wins.values())
      if (w.isOpen) this.place(w, w.root.offsetLeft, w.root.offsetTop);
  });

  constructor(readonly layer: HTMLElement) {
    this.ro.observe(layer);
  }

  get(key: string): Win | undefined {
    return this.wins.get(key);
  }

  /** The open windows, front to back. */
  get open(): Win[] {
    return [...this.wins.values()]
      .filter((w) => w.isOpen)
      .sort((a, b) => Number(b.root.style.zIndex) - Number(a.root.style.zIndex));
  }

  /** Make (first time) and show a window; an open one is just raised. */
  show(opts: WinOptions, spotKey = opts.key): Win {
    let w = this.wins.get(opts.key);
    if (!w) {
      w = new Win(opts.key, opts, this);
      this.wins.set(opts.key, w);
      this.layer.append(w.root);
      this.ro.observe(w.root);
      this.onCreate(w.root);
    }
    if (!w.isOpen) {
      w.root.hidden = false;
      const s = this.spots.get(spotKey);
      if (s) this.place(w, s.x, s.y);
      else this.autoPlace(w);
      opts.onOpen?.();
      this.changed();
    }
    this.raise(w);
    return w;
  }

  /** Forget a window entirely (an inspect window for something sold). */
  destroy(key: string): void {
    const w = this.wins.get(key);
    if (!w) return;
    w.close();
    this.ro.unobserve(w.root);
    w.root.remove();
    this.wins.delete(key);
  }

  raise(w: Win): void {
    if (w.root.style.zIndex !== String(this.z)) w.root.style.zIndex = String(++this.z);
    this.last = w;
  }

  /** Put a window at (x, y), clamped inside the layer. */
  place(w: Win, x: number, y: number): void {
    const lw = this.layer.clientWidth;
    const lh = this.layer.clientHeight;
    const ww = Math.min(w.root.offsetWidth, lw);
    const wh = Math.min(w.root.offsetHeight, lh);
    w.root.style.left = `${Math.round(inset(x, lw, ww))}px`;
    w.root.style.top = `${Math.round(inset(y, lh, wh))}px`;
  }

  /** Its placed position (style, so it still reads right once hidden). */
  remember(w: Win, spotKey = w.key): void {
    const x = parseFloat(w.root.style.left);
    const y = parseFloat(w.root.style.top);
    if (Number.isFinite(x) && Number.isFinite(y)) this.spots.set(spotKey, { x, y });
  }

  /** Remember a window's spot under another key too (inspect windows share one). */
  rememberAs(w: Win, spotKey: string): void {
    this.remember(w, spotKey);
  }

  changed(): void {
    this.onChange(this.open.map((w) => w.key));
  }

  /** First free spot, else a cascade step from the last window. */
  private autoPlace(w: Win): void {
    const lw = this.layer.clientWidth;
    const lh = this.layer.clientHeight;
    const ww = Math.min(w.root.offsetWidth, lw);
    // Its data has not arrived yet: plan for a window of a usual height.
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const wh = Math.min(Math.max(w.root.offsetHeight, PLAN_HEIGHT_REM * rem), lh);
    const others = [...this.layer.children]
      .filter((c): c is HTMLElement => c !== w.root && c instanceof HTMLElement && isShown(c))
      .map((c) => ({
        x: c.offsetLeft,
        y: c.offsetTop,
        r: c.offsetLeft + c.offsetWidth,
        b: c.offsetTop + c.offsetHeight,
      }));
    const from = this.last?.isOpen && this.last !== w ? this.last.root : null;
    const at =
      freeSpot(lw, lh, ww, wh, others) ??
      cascadeSpot(lw, lh, ww, from && { x: from.offsetLeft, y: from.offsetTop });
    this.place(w, at.x, at.y);
  }
}

export interface Box {
  x: number;
  y: number;
  /** Right and bottom edges. */
  r: number;
  b: number;
}

/** The first spot (top to bottom, then left to right) where a ww×wh window
 *  fits inside an lw×lh layer without touching any of `others`, or null. */
export function freeSpot(
  lw: number,
  lh: number,
  ww: number,
  wh: number,
  others: Box[],
): { x: number; y: number } | null {
  const xs = [GAP, ...others.map((o) => o.r + GAP)].sort((a, b) => a - b);
  const ys = [GAP, ...others.map((o) => o.b + GAP)].sort((a, b) => a - b);
  const free = (x: number, y: number) =>
    x + ww <= lw &&
    y + wh <= lh &&
    others.every((o) => x >= o.r || x + ww <= o.x || y >= o.b || y + wh <= o.y);
  for (const y of ys) for (const x of xs) if (free(x, y)) return { x, y };
  return null;
}

/** One step down and right of the last window, back to the corner at the edges. */
export function cascadeSpot(
  lw: number,
  lh: number,
  ww: number,
  from: { x: number; y: number } | null,
): { x: number; y: number } {
  const x = from ? from.x + CASCADE : GAP;
  const y = from ? from.y + CASCADE : GAP;
  return { x: x + ww > lw ? GAP : x, y: y + CASCADE * 4 > lh ? GAP : y };
}

function isShown(e: HTMLElement): boolean {
  return !e.hidden && e.offsetWidth > 0 && getComputedStyle(e).display !== 'none';
}

/** Clamp a window's edge inside the layer, a GAP in from its edges where it fits. */
function inset(v: number, layer: number, size: number): number {
  const m = layer - size >= 2 * GAP ? GAP : 0;
  return clamp(v, m, layer - size - m);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), v));
}

function iconButton(cls: string, glyph: string, title: string): HTMLButtonElement {
  const b = el('button', `win-btn ${cls}`, glyph) as HTMLButtonElement;
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.innerHTML = html;
  return n;
}
