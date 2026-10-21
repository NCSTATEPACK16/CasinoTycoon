// The construction toolbar: floor/zone paint (with a swatch row each), wall,
// bulldoze and the walk button, plus a one-line hint for the active tool.
// Object placement is started from the lead's palette through BuildTool.

import './tools.css';
import { FLOOR_TYPES, ZONES, type FloorType, type Zone } from '../../shared/contracts';
import type { BuildTool } from '../../input/BuildTool';
import { FLOOR_COLORS, FLOOR_PREVIEW_COST, ZONE_COLORS } from '../../input/tools/PaintTool';
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

export class BuildToolbar {
  private root: HTMLElement;
  private hint: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private floorRow: HTMLElement;
  private zoneRow: HTMLElement;

  constructor(
    parent: HTMLElement,
    private build: BuildTool,
    onWalk: () => void,
  ) {
    this.root = el('div', 'build-toolbar');
    this.hint = el('div', 'tool-hint');
    this.floorRow = el('div', 'swatches');
    this.zoneRow = el('div', 'swatches');

    this.button('paintFloor', 'Floor', () => build.paintFloor(build.floorType));
    this.root.append(this.floorRow);
    this.button('paintZone', 'Zone', () => build.paintZone(build.zone));
    this.root.append(this.zoneRow);
    this.button('wall', 'Walls', () => build.walls());
    this.button('bulldoze', 'Bulldoze <small>X</small>', () => build.select(null, 'bulldoze'));
    const walk = this.button('walk', 'Walk <small>V</small>', onWalk);
    walk.classList.add('walk');

    for (const f of FLOOR_TYPES)
      this.floorRow.append(
        this.swatch(
          LABEL[f]!,
          FLOOR_COLORS[f],
          FLOOR_PREVIEW_COST[f],
          () => {
            build.floorType = f as FloorType;
            build.paintFloor(f);
          },
          `floor:${f}`,
        ),
      );
    for (const z of ZONES)
      this.zoneRow.append(
        this.swatch(
          LABEL[z]!,
          ZONE_COLORS[z],
          0,
          () => {
            build.zone = z as Zone;
            build.paintZone(z);
          },
          `zone:${z}`,
        ),
      );
    parent.append(this.root, this.hint);
    build.addEventListener('change', () => this.refresh());
    this.refresh();
  }

  /** Hide while the avatar has the camera. */
  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    this.hint.classList.toggle('hidden', !v);
  }

  private refresh(): void {
    const id = this.build.toolId;
    for (const [k, b] of this.buttons) b.classList.toggle('active', k === id);
    this.floorRow.classList.toggle('open', id === 'paintFloor');
    this.zoneRow.classList.toggle('open', id === 'paintZone');
    for (const s of this.root.querySelectorAll<HTMLElement>('.swatch'))
      s.classList.toggle(
        'active',
        s.dataset.key === `floor:${this.build.floorType}` ||
          s.dataset.key === `zone:${this.build.zone}`,
      );
    this.hint.innerHTML = (id && HINTS[id]) ?? '';
    this.hint.classList.toggle('show', !!id);
  }

  private button(id: string, html: string, onClick: () => void): HTMLButtonElement {
    const b = el('button', 'tool-btn', html) as HTMLButtonElement;
    b.onclick = () => (this.build.toolId === id ? this.build.select(null) : onClick());
    this.buttons.set(id, b);
    this.root.append(b);
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
      `<i style="background:#${color.toString(16).padStart(6, '0')}"></i>${label}${cost ? `<small>${money(cost)}/m²</small>` : ''}`,
    );
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
