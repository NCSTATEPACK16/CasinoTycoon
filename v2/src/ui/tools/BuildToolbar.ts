// The construction tools, in the dock (B15d): a Build category whose tray
// holds Walls & doors, Bulldoze and the floor swatches, a Zone category whose
// tray holds the zone swatches, and the Walk button; plus a one-line hint
// for the active tool in the hint row. Object placement is started from the
// palette's categories through BuildTool. Opening Zone starts painting with
// the last zone, as the old Zone button did; closing a tray drops its tool.

import './BuildToolbar.css';
import { Dock } from '../dock/Dock';
import { regionIn } from '../shell/Shell';
import { FLOOR_TYPES, ZONES, type FloorType, type Zone } from '../../shared/contracts';
import type { BuildTool } from '../../input/BuildTool';
import { FLOOR_PRICE_PER_CELL, ZONE_PRICE_PER_CELL } from '../../data/floorPrices';
import { FLOOR_COLORS, ZONE_COLORS } from '../../input/tools/PaintTool';
import { money } from './CursorTag';

const HINTS: Record<string, string> = {
  place:
    '<kbd>R</kbd> rotate · <kbd>Shift</kbd>+click or drag to place a row · <kbd>Esc</kbd> cancel',
  paintFloor: 'Drag a rectangle to lay floor · <kbd>Esc</kbd> cancel',
  paintZone: 'Drag a rectangle to zone it · <kbd>Esc</kbd> cancel',
  wall: 'Drag corner to corner for walls · click a wall for a door · <kbd>Alt</kbd>-drag removes',
  bulldoze: 'Click an object to sell it · <kbd>Esc</kbd> cancel',
};

const LABEL: Record<string, string> = {
  none: 'Erase',
  'carpet-red': 'Red carpet',
  'carpet-blue': 'Blue carpet',
  marble: 'Marble',
  wood: 'Wood',
  tile: 'Tile',
  gaming: 'Gaming',
  highLimit: 'High limit',
  foodCourt: 'Food court',
  restrooms: 'Restrooms',
  backOfHouse: 'Back of house',
};

/** Which dock category each construction tool belongs to. */
const TOOL_CAT: Record<string, 'build' | 'zone'> = {
  paintFloor: 'build',
  wall: 'build',
  bulldoze: 'build',
  paintZone: 'zone',
};

export class BuildToolbar {
  private dock: Dock;
  private hint: HTMLElement;
  private buildTray = el('div', 'tray build-tray');
  private zoneTray = el('div', 'tray zone-tray');
  private buttons = new Map<string, HTMLButtonElement>();
  private cats: Record<'build' | 'zone', HTMLButtonElement>;
  private walk: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private build: BuildTool,
    onWalk: () => void,
  ) {
    this.dock = Dock.for(parent);
    this.hint = el('div', 'tool-hint');

    const tools = el('div', 'tray-group');
    tools.append(
      this.button('wall', 'Walls & doors', 'Drag walls; click a wall for a door', () =>
        build.walls(),
      ),
      this.button('bulldoze', 'Bulldoze <small>X</small>', 'Sell what you click', () =>
        build.select(null, 'bulldoze'),
      ),
    );
    const floors = el('div', 'tray-group');
    floors.append(el('span', 'tray-label', 'Floor'));
    for (const f of FLOOR_TYPES)
      floors.append(
        this.swatch(
          LABEL[f]!,
          FLOOR_COLORS[f],
          FLOOR_PRICE_PER_CELL[f],
          () => {
            build.floorType = f as FloorType;
            build.paintFloor(f);
          },
          `floor:${f}`,
        ),
      );
    this.buildTray.append(tools, floors);
    const zones = el('div', 'tray-group');
    for (const z of ZONES)
      zones.append(
        this.swatch(
          LABEL[z]!,
          ZONE_COLORS[z],
          ZONE_PRICE_PER_CELL,
          () => {
            build.zone = z as Zone;
            build.paintZone(z);
          },
          `zone:${z}`,
        ),
      );
    this.zoneTray.append(
      zones,
      el('span', 'tray-note', 'Games need a Gaming or High limit zone; services their own.'),
    );

    const drop = (cat: 'build' | 'zone') => () => {
      const id = this.build.toolId;
      if (id && TOOL_CAT[id] === cat) this.build.select(null);
    };
    this.cats = {
      build: this.dock.addCategory(
        'build',
        'Build',
        'Floor, walls and doors, bulldoze',
        this.buildTray,
        { onClose: drop('build') },
      ),
      zone: this.dock.addCategory('zone', 'Zone', 'Paint zones', this.zoneTray, {
        onOpen: () => {
          if (this.build.toolId !== 'paintZone') build.paintZone(build.zone);
        },
        onClose: drop('zone'),
      }),
    };
    this.walk = el('button', 'dock-cat walk', 'Walk <small>V</small>') as HTMLButtonElement;
    this.walk.type = 'button';
    this.walk.title = 'Walk the floor as your avatar (V)';
    this.walk.onclick = onWalk;
    this.dock.addTool(this.walk);
    regionIn(parent, 'hint').append(this.hint);
    build.addEventListener('change', () => this.refresh());
    this.refresh();
  }

  /** Hide while the avatar has the camera. */
  setVisible(v: boolean): void {
    this.dock.setAvailable('build', v);
    this.dock.setAvailable('zone', v);
    this.walk.hidden = !v;
    this.hint.classList.toggle('hidden', !v);
  }

  private refresh(): void {
    const id = this.build.toolId;
    for (const [k, b] of this.buttons) b.classList.toggle('active', k === id);
    for (const s of [...this.buildTray.children, ...this.zoneTray.children].flatMap((g) => [
      ...g.querySelectorAll<HTMLElement>('.swatch'),
    ]))
      s.classList.toggle(
        'active',
        (id === 'paintFloor' && s.dataset.key === `floor:${this.build.floorType}`) ||
          (id === 'paintZone' && s.dataset.key === `zone:${this.build.zone}`),
      );
    // A category shows it holds the live tool, even with its tray closed.
    this.cats.build.classList.toggle('using', !!id && TOOL_CAT[id] === 'build');
    this.cats.zone.classList.toggle('using', id === 'paintZone');
    this.hint.innerHTML = (id && HINTS[id]) ?? '';
    this.hint.classList.toggle('show', !!id);
  }

  private button(id: string, html: string, title: string, onClick: () => void): HTMLElement {
    const b = el('button', 'tool-btn', html) as HTMLButtonElement;
    b.type = 'button';
    b.title = title;
    b.onclick = () => (this.build.toolId === id ? this.build.select(null) : onClick());
    this.buttons.set(id, b);
    return b;
  }

  private swatch(
    label: string,
    color: number,
    cost: number,
    onClick: () => void,
    key: string,
  ): HTMLElement {
    const b = el(
      'button',
      'swatch',
      `<i style="background:#${color.toString(16).padStart(6, '0')}"></i><span>${label}</span>${cost ? `<small>${money(cost)}/m²</small>` : ''}`,
    );
    (b as HTMLButtonElement).type = 'button';
    b.dataset.key = key;
    b.onclick = onClick;
    return b;
  }
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.innerHTML = html;
  return n;
}
