import { audio } from '../services/AudioService';
import { el } from './dom';

// RCT-style window system: singleton windows by id, draggable by title bar,
// minimize/close buttons, click-to-front z-order. Lives in the #ui-root DOM
// overlay; each window re-enables pointer-events so the canvas keeps
// receiving everything else.

export interface PanelSpec {
  title: string;
  width: number;
  content: HTMLElement;
  /** Cleanup hook (unsubscribe EventBus handlers etc.); runs when the window closes. */
  onClose?: () => void;
}

interface ManagedWindow {
  root: HTMLElement;
  minimized: boolean;
  onClose?: () => void;
}

const CASCADE_STEP = 28;
const TOOLBAR_CLEARANCE = 54; // keep title bars above the bottom toolbar
const TITLEBAR_GRAB = 40; // min pixels of title bar that must stay on screen

export class WindowManager {
  private layer: HTMLElement;
  private windows = new Map<string, ManagedWindow>();
  private zTop = 10;
  private openedEver = 0;
  private changeListeners = new Set<(id: string, open: boolean) => void>();

  constructor(uiRoot: HTMLElement) {
    this.layer = el('div', 'ui-windows');
    uiRoot.appendChild(this.layer);
    window.addEventListener('resize', () => {
      for (const win of this.windows.values()) this.clamp(win.root);
    });
  }

  onChange(fn: (id: string, open: boolean) => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  isOpen(id: string): boolean {
    return this.windows.has(id);
  }

  /** Open if closed (bring to front if already open), close if open. Returns the new open state. */
  toggle(id: string, make: () => PanelSpec): boolean {
    if (this.windows.has(id)) {
      this.close(id);
      return false;
    }
    this.open(id, make());
    return true;
  }

  open(id: string, spec: PanelSpec): void {
    const existing = this.windows.get(id);
    if (existing) {
      this.bringToFront(existing.root);
      return;
    }

    const root = el('section', 'ui-window win-opening');
    root.style.width = `${spec.width}px`;
    root.addEventListener('animationend', () => root.classList.remove('win-opening'), {
      once: true,
    });
    audio.play('ui-open', { volume: 0.6 });

    const titlebar = el('header', 'win-titlebar');
    const title = el('span', 'win-title', spec.title);
    const minBtn = el('button', 'win-btn', '–');
    minBtn.title = 'Minimize';
    const closeBtn = el('button', 'win-btn win-close', '✕');
    closeBtn.title = 'Close';
    titlebar.append(title, minBtn, closeBtn);

    const body = el('div', 'win-body');
    body.appendChild(spec.content);
    root.append(titlebar, body);
    this.layer.appendChild(root);

    // Cascade from top-left, wrapping so windows never spawn off-screen.
    const step = (this.openedEver++ % 8) * CASCADE_STEP;
    root.style.left = `${16 + step}px`;
    root.style.top = `${16 + step}px`;

    const win: ManagedWindow = { root, minimized: false, onClose: spec.onClose };
    this.windows.set(id, win);

    root.addEventListener('pointerdown', () => this.bringToFront(root));
    minBtn.addEventListener('click', () => {
      win.minimized = !win.minimized;
      root.classList.toggle('minimized', win.minimized);
      minBtn.textContent = win.minimized ? '▢' : '–';
      minBtn.title = win.minimized ? 'Restore' : 'Minimize';
    });
    closeBtn.addEventListener('click', () => this.close(id));
    this.makeDraggable(root, titlebar);

    this.bringToFront(root);
    this.clamp(root);
    this.notify(id, true);
  }

  close(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;
    this.windows.delete(id);
    win.onClose?.();
    audio.play('ui-close', { volume: 0.6 });
    // Play the close animation out before removing; input off immediately.
    const root = win.root;
    root.style.pointerEvents = 'none';
    root.classList.remove('win-opening');
    root.classList.add('win-closing');
    const remove = () => root.remove();
    root.addEventListener('animationend', remove, { once: true });
    window.setTimeout(remove, 300); // fallback if animations are disabled
    this.notify(id, false);
  }

  private notify(id: string, open: boolean): void {
    this.changeListeners.forEach((fn) => fn(id, open));
  }

  private bringToFront(root: HTMLElement): void {
    root.style.zIndex = String(++this.zTop);
  }

  private makeDraggable(root: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (down: PointerEvent) => {
      if ((down.target as HTMLElement).closest('.win-btn')) return;
      down.preventDefault();
      const startLeft = root.offsetLeft;
      const startTop = root.offsetTop;
      const startX = down.clientX;
      const startY = down.clientY;
      handle.setPointerCapture(down.pointerId);

      const onMove = (move: PointerEvent) => {
        root.style.left = `${startLeft + move.clientX - startX}px`;
        root.style.top = `${startTop + move.clientY - startY}px`;
        this.clamp(root);
      };
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  /** Keep enough of the title bar on screen that the window can always be grabbed. */
  private clamp(root: HTMLElement): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = root.offsetWidth;
    const minLeft = TITLEBAR_GRAB - w;
    const maxLeft = vw - TITLEBAR_GRAB;
    const maxTop = vh - TOOLBAR_CLEARANCE - 24;
    root.style.left = `${Math.min(Math.max(root.offsetLeft, minLeft), maxLeft)}px`;
    root.style.top = `${Math.min(Math.max(root.offsetTop, 0), maxTop)}px`;
  }
}
