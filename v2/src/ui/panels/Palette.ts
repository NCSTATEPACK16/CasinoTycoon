// The build palette: what you can put on the floor, as four dock categories
// (Slots, Tables, Services, Decor; B15d) sharing one tray of item cards. A
// card shows the name, price and one key stat; items the scenario forbids
// stay visible but greyed, last in their tray, with the reason; a locked item
// (B8) shows a badge and how to unlock it. Hovering a card shows its price,
// upkeep, size, the zone it needs and what it holds, and the Shift hint for
// placing a row.

import './Palette.css';
import { getCampaign } from '../../data/campaigns';
import { OBJECT_CATALOG, type ObjectDef } from '../../data/objects';
import type { BuildTool } from '../../input/BuildTool';
import { locksFor, type Progress } from '../../services/progress';
import { get3D } from '../../shared/catalog';
import type { Dock } from '../dock/Dock';
import { el, escapeHtml, money } from '../dom';

export type PaletteTab = 'slots' | 'tables' | 'services' | 'decor';

const TABS: { id: PaletteTab; label: string; title: string }[] = [
  { id: 'slots', label: 'Slots', title: 'Machines and draw games' },
  { id: 'tables', label: 'Tables', title: 'Tables and wheels (each needs a dealer)' },
  { id: 'services', label: 'Services', title: 'Toilets, food, drinks and the cage' },
  { id: 'decor', label: 'Decor', title: 'Plants and signs' },
];

/** Machines and draw games a guest plays alone or in a lounge; every other
 *  game is a table or a wheel with a dealer. */
const SLOTS = new Set([
  'slot-machine',
  'penny-slots',
  'video-poker',
  'pachinko',
  'keno-lounge',
  'bingo-hall',
]);

const ZONE_LABEL: Record<string, string> = {
  gaming: 'Gaming',
  highLimit: 'High limit',
  foodCourt: 'Food court',
  restrooms: 'Restrooms',
  backOfHouse: 'Back of house',
};

const SERVICE_BLURB: Record<string, string> = {
  toilet: 'Guests with a full bladder walk here; without one they leave unhappy.',
  'food-stall': 'Feeds hungry guests. Set its prices in Prices.',
  bar: 'Pours drinks; needs a bartender. Waitresses carry them to seated players.',
  cage: 'Cash advances for guests running dry; needs a cashier.',
};

/** The one line a service's card shows. */
const SERVICE_STAT: Record<string, string> = {
  toilet: 'Bladder',
  'food-stall': 'Hunger',
  bar: 'Drinks · bartender',
  cage: 'Cash · cashier',
};

export function paletteTab(def: ObjectDef): PaletteTab {
  if (def.category === 'service') return 'services';
  if (def.category === 'decor') return 'decor';
  return SLOTS.has(def.id) ? 'slots' : 'tables';
}

/** The key stat on an item's card. */
function keyStat(def: ObjectDef): string {
  if (def.category === 'game') {
    const seats = get3D(def.id).seats?.length ?? 0;
    return `${seats} seat${seats === 1 ? '' : 's'}${paletteTab(def) === 'tables' ? ' · dealer' : ''}`;
  }
  if (def.category === 'service') return SERVICE_STAT[def.id] ?? 'Service';
  return def.ratingBonus ? `+${def.ratingBonus} rating` : 'Decoration';
}

export class Palette {
  /** The tray: the cards of the open category, the Shift hint, the hover card. */
  readonly root = el('div', 'tray palette');
  private items = el('div', 'pal-items');
  private card = el('div', 'pal-card');
  private tabButtons = new Map<PaletteTab, HTMLButtonElement>();
  private itemButtons = new Map<string, HTMLButtonElement>();
  private tab: PaletteTab = 'slots';
  private scenarioId: string | null | undefined = undefined;
  /** defId → the reason it can't be placed in this scenario. */
  private forbidden = new Map<string, string>();
  /** defId → how to unlock it (B8). */
  private locked = new Map<string, string>();
  /** B8: the career, which decides what is locked. Null until main.ts hands
   *  it over (nothing is locked before then). */
  private progress: Progress | null = null;
  /** Where to report "can't pick that" (the HUD toast). */
  onMessage: (text: string) => void = () => {};

  constructor(
    private build: BuildTool,
    private dock: Dock,
  ) {
    for (const t of TABS) {
      const b = dock.addCategory(t.id, t.label, t.title, this.root, {
        onOpen: () => this.setTab(t.id),
      });
      this.tabButtons.set(t.id, b);
    }
    const hint = el('span', 'pal-hint', '<kbd>Shift</kbd>+click<br>places a row');
    for (const def of OBJECT_CATALOG) {
      const b = el('button', `pal-item tab-${paletteTab(def)}`);
      b.type = 'button';
      b.dataset.def = def.id;
      b.innerHTML = `<span class="pal-name">${escapeHtml(def.name)}</span><span class="pal-stat">${escapeHtml(keyStat(def))}</span><span class="pal-price">${money(def.cost)}</span><i class="pal-lock" hidden></i>`;
      b.onclick = () => this.pick(def);
      b.onmouseenter = () => this.showCard(def, b);
      b.onmouseleave = () => this.hideCard();
      b.onfocus = () => this.showCard(def, b);
      b.onblur = () => this.hideCard();
      this.itemButtons.set(def.id, b);
    }
    this.card.hidden = true;
    this.root.append(this.card, this.items, hint);
    // Esc, right-click and tool switches change the selection too: follow
    // the tool, not the click.
    build.addEventListener('change', () => this.syncActive());
    this.setScenario(null);
  }

  /** The HUD's scenario id; recomputes what is forbidden when it changes. */
  setScenario(id: string | null): void {
    if (id === this.scenarioId) return;
    this.scenarioId = id;
    this.forbidden.clear();
    const def = id ? getCampaign(id) : undefined;
    if (this.progress) this.locked = locksFor(def, this.progress);
    if (def?.allowedObjects) {
      const allowed = new Set(def.allowedObjects);
      const why = def.restriction ?? `Not part of ${def.name}.`;
      for (const o of OBJECT_CATALOG) if (!allowed.has(o.id)) this.forbidden.set(o.id, why);
    }
    this.render();
  }

  /** B8: lock an item behind progress (`hint` says how to unlock it), or
   *  unlock it with null. */
  setLock(defId: string, hint: string | null): void {
    if (hint) this.locked.set(defId, hint);
    else this.locked.delete(defId);
    this.render();
  }

  /** B8: the career changed (a win, or the game started): relock. */
  setProgress(p: Progress): void {
    this.progress = p;
    const id = this.scenarioId;
    this.locked = locksFor(id ? getCampaign(id) : undefined, p);
    this.render();
  }

  /** Show a category's cards (opening its tray in the dock). */
  setTab(t: PaletteTab): void {
    this.tab = t;
    this.render();
    if (this.dock.open !== t) this.dock.setOpen(t);
  }

  /** Why an item can't be picked right now, or null when it can. */
  blocked(defId: string): string | null {
    return this.forbidden.get(defId) ?? this.locked.get(defId) ?? null;
  }

  private pick(def: ObjectDef): void {
    const why = this.blocked(def.id);
    if (why) {
      this.onMessage(`${def.name}: ${why}`);
      return;
    }
    this.build.select(this.build.defId === def.id ? null : def.id);
  }

  private countUsable(t: PaletteTab): number {
    return OBJECT_CATALOG.filter((d) => paletteTab(d) === t && !this.blocked(d.id)).length;
  }

  private render(): void {
    for (const t of TABS) {
      const b = this.tabButtons.get(t.id)!;
      const all = OBJECT_CATALOG.filter((d) => paletteTab(d) === t.id).length;
      const usable = this.countUsable(t.id);
      b.innerHTML = `${t.label} <small>${usable === all ? all : `${usable}/${all}`}</small>`;
      b.classList.toggle('empty', usable === 0);
    }
    // Usable first, in catalogue order; blocked items after, still shown.
    const defs = OBJECT_CATALOG.filter((d) => paletteTab(d) === this.tab);
    const ordered = [
      ...defs.filter((d) => !this.blocked(d.id)),
      ...defs.filter((d) => this.blocked(d.id)),
    ];
    this.items.replaceChildren(...ordered.map((d) => this.itemButtons.get(d.id)!));
    for (const [id, b] of this.itemButtons) {
      const forbidden = this.forbidden.has(id);
      const lockHint = this.locked.get(id);
      b.classList.toggle('blocked', forbidden || !!lockHint);
      b.setAttribute('aria-disabled', String(forbidden || !!lockHint));
      const lock = b.querySelector<HTMLElement>('.pal-lock')!;
      lock.hidden = !forbidden && !lockHint;
      lock.textContent = lockHint ? `🔒 ${lockHint}` : forbidden ? 'Not here' : '';
      lock.title = lockHint ?? this.forbidden.get(id) ?? '';
    }
    this.syncActive();
  }

  private syncActive(): void {
    const using = this.build.defId;
    for (const [id, b] of this.itemButtons) b.classList.toggle('active', id === using);
    const def = using ? OBJECT_CATALOG.find((d) => d.id === using) : undefined;
    for (const [t, b] of this.tabButtons)
      b.classList.toggle('using', !!def && paletteTab(def) === t);
  }

  private showCard(def: ObjectDef, anchor: HTMLElement): void {
    const g = get3D(def.id);
    const zones = g.zones.length
      ? `Needs a ${g.zones.map((z) => ZONE_LABEL[z] ?? z).join(' or ')} zone`
      : 'Fits anywhere with a floor';
    const seats = g.seats?.length ?? 0;
    const what =
      def.category === 'game'
        ? `${seats} seat${seats === 1 ? '' : 's'}${paletteTab(def) === 'tables' ? ' · needs a dealer' : ''}`
        : def.category === 'service'
          ? (SERVICE_BLURB[def.id] ?? '')
          : def.ratingBonus
            ? `Adds ${def.ratingBonus} to the rating (signage counts up to +10 in all).`
            : 'Decoration.';
    const why = this.blocked(def.id);
    this.card.innerHTML = `<b>${escapeHtml(def.name)}</b>
      <div class="pal-card-grid"><span>Price</span><b>${money(def.cost)}</b><span>Upkeep</span><b>${money(def.upkeepPerDay)}/day</b><span>Size</span><b>${def.footprint.w}×${def.footprint.h} m</b></div>
      <div class="small dim">${zones}. ${escapeHtml(what)}</div>
      ${why ? `<div class="small bad">${this.locked.has(def.id) ? '🔒 ' : ''}${escapeHtml(why)}</div>` : '<div class="small dim"><kbd>Shift</kbd>+click places a row · <kbd>R</kbd> rotates</div>'}`;
    this.card.hidden = false;
    // Sit above the card, clamped inside the tray.
    const pr = this.root.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const w = this.card.offsetWidth;
    const left = Math.min(Math.max(0, ar.left - pr.left), pr.width - w);
    this.card.style.left = `${left}px`;
  }

  private hideCard(): void {
    this.card.hidden = true;
  }
}
