// B15d: the bottom dock (Cities: Skylines). A full-width bar of category
// buttons (Build, Zone, Slots, Tables, Services, Decor), the Walk button, and
// a labelled Manage group on the right. A category opens its tray of cards
// in a full-width strip above the bar; clicking it again closes the tray.
// Owners register their own categories and trays: the build toolbar adds
// Build and Zone, the palette the four item categories, main.ts Manage.
// The dock lives in the shell's dock region, so it grows that row and the
// window layer above it shrinks: nothing floats over the tray.

import './Dock.css';
import { regionIn } from '../shell/Shell';

interface Category {
  button: HTMLButtonElement;
  tray: HTMLElement;
  onOpen?: () => void;
  onClose?: () => void;
}

const docks = new WeakMap<HTMLElement, Dock>();

export class Dock {
  readonly root = el('div', 'dock');
  private tray = el('div', 'dock-tray');
  private cats = el('div', 'dock-cats');
  private tools = el('div', 'dock-tools');
  private manage = el('div', 'dock-manage');
  private categories = new Map<string, Category>();
  private openId: string | null = null;

  /** The one dock for a shell root, made on first use. */
  static for(root: HTMLElement): Dock {
    let d = docks.get(root);
    if (!d) {
      d = new Dock();
      docks.set(root, d);
      regionIn(root, 'dock').append(d.root);
    }
    return d;
  }

  private constructor() {
    const bar = el('div', 'dock-bar');
    this.manage.append(el('span', 'dock-label', 'Manage'));
    bar.append(this.cats, this.tools, el('span', 'dock-gap'), this.manage);
    this.tray.hidden = true;
    this.root.append(this.tray, bar);
  }

  /** A category button with its tray (several categories may share one). */
  addCategory(
    id: string,
    html: string,
    title: string,
    tray: HTMLElement,
    hooks: { onOpen?: () => void; onClose?: () => void } = {},
  ): HTMLButtonElement {
    const button = el('button', 'dock-cat', html) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.cat = id;
    button.title = title;
    button.onclick = () => this.toggle(id);
    if (!tray.parentElement) {
      tray.hidden = true;
      this.tray.append(tray);
    }
    this.categories.set(id, { button, tray, ...hooks });
    this.cats.append(button);
    return button;
  }

  /** A plain button after the categories (Walk). */
  addTool(button: HTMLElement): void {
    this.tools.append(button);
  }

  /** A button in the Manage group. */
  addManage(id: string, html: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'dock-man', html) as HTMLButtonElement;
    b.type = 'button';
    b.dataset.manage = id;
    b.title = title;
    b.onclick = onClick;
    this.manage.append(b);
    return b;
  }

  /** Light the Manage button whose window is showing (null: none). */
  markManage(id: string | null): void {
    for (const b of this.manage.querySelectorAll<HTMLElement>('.dock-man'))
      b.classList.toggle('open', b.dataset.manage === id);
  }

  get open(): string | null {
    return this.openId;
  }

  toggle(id: string): void {
    this.setOpen(this.openId === id ? null : id);
  }

  setOpen(id: string | null): void {
    if (id !== null && !this.categories.has(id)) return;
    const was = this.openId ? this.categories.get(this.openId) : undefined;
    if (id === this.openId) return;
    this.openId = id;
    const now = id ? this.categories.get(id) : undefined;
    for (const [k, c] of this.categories) c.button.classList.toggle('open', k === id);
    for (const t of this.tray.children) (t as HTMLElement).hidden = t !== now?.tray;
    this.tray.hidden = !now;
    if (was && was !== now) was.onClose?.();
    now?.onOpen?.();
  }

  /** Hide a category (and close it if open), e.g. building while walking. */
  setAvailable(id: string, on: boolean): void {
    const c = this.categories.get(id);
    if (!c) return;
    c.button.hidden = !on;
    if (!on && this.openId === id) this.setOpen(null);
  }
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.innerHTML = html;
  return n;
}
