// Skeleton HUD: cash/time/rating bar, speed buttons and a build palette.

import { OBJECT_CATALOG } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { HudView, SimEvent } from '../shared/contracts';
import type { SimClient } from '../client/SimClient';
import type { BuildTool } from '../input/BuildTool';

const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;

export class Hud {
  private bar: HTMLElement;
  private toast: HTMLElement;
  /** Top-bar menu buttons; main.ts binds what each opens. */
  readonly menu: Record<'finances' | 'staff' | 'save' | 'load', HTMLButtonElement>;

  constructor(root: HTMLElement, sim: SimClient, build: BuildTool) {
    this.bar = el('div', 'hud-bar');
    const speeds = el('div', 'hud-speeds');
    for (const s of [0, 1, 2, 4] as const) {
      const b = el('button', '', s === 0 ? '❚❚' : `${s}×`);
      b.onclick = () => void sim.command({ type: 'setSpeed', speed: s });
      speeds.append(b);
    }
    const palette = el('div', 'palette');
    for (const def of OBJECT_CATALOG) {
      const b = el('button', 'pal-item', `${def.name}<small>${money(def.cost)}</small>`);
      b.dataset.def = def.id;
      const zones = get3D(def.id).zones;
      b.title = zones.length ? `Needs a ${zones.join(' or ')} zone` : 'Fits anywhere with a floor';
      b.onclick = () => {
        build.select(build.defId === def.id ? null : def.id);
        palette
          .querySelectorAll('.pal-item')
          .forEach((n) =>
            n.classList.toggle('active', (n as HTMLElement).dataset.def === build.defId),
          );
      };
      palette.append(b);
    }
    const bulldoze = el('button', 'pal-item bulldoze', 'Bulldoze <small>X</small>');
    bulldoze.onclick = () => {
      build.select(null);
      build.bulldoze = true;
    };
    palette.append(bulldoze);
    this.toast = el('div', 'toast');
    const menu = el('div', 'hud-menu');
    const mk = (label: string, key: string) => {
      const b = el('button', '', `${label} <small>${key}</small>`) as HTMLButtonElement;
      menu.append(b);
      return b;
    };
    this.menu = {
      finances: mk('Finances', 'P'),
      staff: mk('Staff', 'H'),
      save: mk('Save', ''),
      load: mk('Menu', ''),
    };
    root.append(this.bar, menu, speeds, palette, this.toast);
  }

  update(h: HudView): void {
    const t = `Day ${h.day} · ${String(h.hour).padStart(2, '0')}:00`;
    const sc = h.scenario ? ` · ${h.scenario.name}: ${h.scenario.goal}` : ' · Sandbox';
    this.bar.innerHTML = `<b>${money(h.cash)}</b><span>${t}</span><span>★ ${Math.round(h.rating)}</span><span>${h.guests} guests</span><span>Today ${money(h.todayProfit)}</span><span class="dim">${sc}</span>`;
  }

  events(evs: SimEvent[]): void {
    for (const e of evs)
      if (e.type === 'ticker' || e.type === 'gameOver')
        this.say(e.type === 'ticker' ? e.text : e.reason);
  }

  say(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }
}

function el(tag: string, cls: string, html = ''): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  n.innerHTML = html;
  return n;
}
