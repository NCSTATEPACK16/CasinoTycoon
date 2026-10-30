// The map control: Off · Mood · Traffic (M and T toggle), with a legend for
// the map on screen. While a map is up it asks the worker for fresh data once
// a second and hands it to the render overlay.

import type { SimClient } from '../../client/SimClient';
import { heatColor, type HeatKind, type HeatOverlay } from '../../render/HeatOverlay';
import type { HeatMap } from '../../worker/feedback';
import { button, el } from '../dom';

const css = ([r, g, b]: [number, number, number]) => `rgb(${r},${g},${b})`;

const LEGEND: Record<HeatKind, { left: string; right: string; blurb: string; ends: number[] }> = {
  mood: {
    left: 'Miserable',
    right: 'Happy',
    blurb: 'How guests feel where they stand, lately. Blank: nobody has been there.',
    ends: [0, 40, 60, 100],
  },
  traffic: {
    left: 'Some',
    right: 'Busiest',
    blurb: 'Where guests walk. Hot corridors want aisles; dead corners want a reason to visit.',
    ends: [0, 0.5, 1],
  },
};

export class HeatControl {
  readonly root = el('div', 'heat-control');
  private kind: HeatKind | null = null;
  private timer = 0;
  private buttons = new Map<HeatKind | 'off', HTMLButtonElement>();
  private legend = el('div', 'heat-legend');

  constructor(
    private sim: SimClient,
    private overlay: HeatOverlay,
  ) {
    const row = el('div', 'heat-buttons');
    row.append(el('span', 'small dim', 'Map'));
    for (const [k, label] of [
      ['off', 'Off'],
      ['mood', 'Mood <small>M</small>'],
      ['traffic', 'Traffic <small>T</small>'],
    ] as const) {
      const b = button(label, () => this.set(k === 'off' ? null : k), 'small');
      this.buttons.set(k, b);
      row.append(b);
    }
    this.root.append(row, this.legend);
    this.set(null);
  }

  /** M/T: show that map, or hide it when it is already up. */
  toggle(kind: HeatKind): void {
    this.set(this.kind === kind ? null : kind);
  }

  set(kind: HeatKind | null): void {
    this.kind = kind;
    for (const [k, b] of this.buttons) b.classList.toggle('active', (kind ?? 'off') === k);
    window.clearInterval(this.timer);
    this.overlay.setVisible(false);
    this.legend.hidden = kind === null;
    if (!kind) return;
    const l = LEGEND[kind];
    const top = l.ends.at(-1)!;
    const stops = l.ends.map((v) => `${css(heatColor(kind, v))} ${(v / top) * 100}%`);
    this.legend.innerHTML = `<i class="heat-ramp" style="background:linear-gradient(90deg, ${stops.join(', ')})"></i><div class="heat-ends small"><span>${l.left}</span><span class="heat-summary"></span><span>${l.right}</span></div><p class="small dim">${l.blurb}</p>`;
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 1000);
  }

  private async refresh(): Promise<void> {
    const kind = this.kind;
    if (!kind) return;
    try {
      const m = await this.sim.command<HeatMap>({ type: 'heatMap', kind });
      if (this.kind !== kind) return;
      this.overlay.setData(kind, m.cols, m.rows, m.values);
      this.overlay.setVisible(true);
      const summary = this.legend.querySelector('.heat-summary');
      if (summary)
        summary.textContent =
          m.summary === null
            ? 'no data yet'
            : kind === 'mood'
              ? `average ${Math.round(m.summary)}`
              : `busiest tile ${Math.round(m.summary)} visits`;
    } catch {
      // Between games the world may be resetting; the next poll catches up.
    }
  }
}
