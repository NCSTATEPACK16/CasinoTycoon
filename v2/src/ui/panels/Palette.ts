// The build palette: what you can put on the floor, in four tabs (Slots,
// Tables, Services, Decor). Items the scenario forbids stay visible but
// greyed, last in their tab, with the reason; a locked item (B8) shows a
// badge and how to unlock it. Hovering an item shows its price, upkeep, size,
// the zone it needs and what it holds, and the Shift hint for placing a row.

import { getCampaign } from '../../data/campaigns';
import { OBJECT_CATALOG, type ObjectDef } from '../../data/objects';
import type { BuildTool } from '../../input/BuildTool';
import { locksFor, type Progress } from '../../services/progress';
import { get3D } from '../../shared/catalog';
import { el, escapeHtml, money } from '../dom';

export type PaletteTab = 'slots' | 'tables' | 'services' | 'decor';

const TABS: { id: PaletteTab; label: string }[] = [
  { id: 'slots', label: 'Slots' },
  { id: 'tables', label: 'Tables' },
  { id: 'services', label: 'Services' },
  { id: 'decor', label: 'Decor' },
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

export function paletteTab(def: ObjectDef): PaletteTab {
  if (def.category === 'service') return 'services';
  if (def.category === 'decor') return 'decor';
  return SLOTS.has(def.id) ? 'slots' : 'tables';
}

export class Palette {
  readonly root = el('div', 'palette palette-v2');
  private tabs = el('div', 'pal-tabs');
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

  constructor(private build: BuildTool) {
    for (const t of TABS) {
      const b = el('button', 'pal-tab');
      b.type = 'button';
      b.dataset.tab = t.id;
      b.onclick = () => this.setTab(t.id);
      this.tabButtons.set(t.id, b);
      this.tabs.append(b);
    }
    const bulldoze = el('button', 'pal-item bulldoze', 'Bulldoze <small>X</small>');
    bulldoze.type = 'button';
    bulldoze.onclick = () => {
      build.select(null);
      build.bulldoze = true;
    };
    const hint = el('span', 'pal-hint', '<kbd>Shift</kbd>+click<br>places a row');
    for (const def of OBJECT_CATALOG) {
      const b = el('button', 'pal-item');
      b.type = 'button';
      b.dataset.def = def.id;
      b.innerHTML = `<span class="pal-name">${escapeHtml(def.name)}</span><small>${money(def.cost)}<i class="pal-lock" hidden></i></small>`;
      b.onclick = () => this.pick(def);
      b.onmouseenter = () => this.showCard(def, b);
      b.onmouseleave = () => this.hideCard();
      b.onfocus = () => this.showCard(def, b);
      b.onblur = () => this.hideCard();
      this.itemButtons.set(def.id, b);
    }
    this.card.hidden = true;
    // One row, so nothing that sits above the palette has to move.
    this.root.append(this.card, this.tabs, this.items, hint, bulldoze);
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
    // Land on a tab with something to place.
    if (this.countUsable(this.tab) === 0) {
      const first = TABS.find((t) => this.countUsable(t.id) > 0);
      if (first) this.tab = first.id;
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

  setTab(t: PaletteTab): void {
    this.tab = t;
    this.render();
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
      b.classList.toggle('active', t.id === this.tab);
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
      lock.textContent = lockHint ? '🔒' : forbidden ? 'Not here' : '';
    }
    this.syncActive();
  }

  private syncActive(): void {
    for (const [id, b] of this.itemButtons) b.classList.toggle('active', id === this.build.defId);
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
    // Sit above the item, clamped inside the palette.
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
