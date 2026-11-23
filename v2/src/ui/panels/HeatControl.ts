// The info views (B15f, Variant B): a strip of view buttons under the top bar
// on the left (Mood, Traffic and B6's Appeal), with the legend of the
// view on screen below it. M, T and L toggle; clicking the lit view turns it
// off. While a view is up it asks the worker for fresh data once a second and
// hands it to the render overlay.

import './HeatControl.css';
import type { SimClient } from '../../client/SimClient';
import { heatColor, type HeatKind, type HeatOverlay } from '../../render/HeatOverlay';
import type { HeatMap } from '../../worker/feedback';
import { button, el } from '../dom';

/** Stroke icons, the mockup's set. */
const ICON: Record<HeatKind, string> = {
  mood: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8M9 9.5h.01M15 9.5h.01"/>',
  traffic: '<path d="M5 19l4-14M19 19L15 5M12 6v2M12 11v2M12 16v2"/>',
  appeal: '<path d="M12 3.5l2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
};

const VIEWS: { kind: HeatKind; label: string; key: string }[] = [
  { kind: 'mood', label: 'Mood', key: 'M' },
  { kind: 'traffic', label: 'Traffic', key: 'T' },
  { kind: 'appeal', label: 'Appeal', key: 'L' },
];

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
  appeal: {
    left: 'Plain',
    right: 'Stunning',
    blurb: 'What decor and fine floors do for each spot. Guests are happier here and games here draw more players; the floor\'s average is the rating\'s Decor term.',
    ends: [0, 30, 60, 100],
  },
};

export class HeatControl {
  readonly root = el('div', 'heat-control');
  private kind: HeatKind | null = null;
  private timer = 0;
  private buttons = new Map<HeatKind, HTMLButtonElement>();
  private legend = el('div', 'heat-legend');
  /** Fired from set() whenever the view changes (null: off). A12's thought
   *  bubbles listen for the Mood view. */
  onChange: (kind: HeatKind | null) => void = () => {};

  constructor(
    private sim: SimClient,
    private overlay: HeatOverlay,
  ) {
    const row = el('div', 'heat-buttons');
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'Info views');
    for (const v of VIEWS) {
      const b = button(
        `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[v.kind]}</svg><span class="lbl">${v.label}</span><kbd>${v.key}</kbd>`,
        () => this.toggle(v.kind),
        'heat-view',
      );
      b.dataset.view = v.kind;
      b.title = `${v.label} view (${v.key}); click again to turn it off`;
      this.buttons.set(v.kind, b);
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
    for (const [k, b] of this.buttons) {
      b.classList.toggle('active', kind === k);
      b.setAttribute('aria-pressed', String(kind === k));
    }
    window.clearInterval(this.timer);
    this.overlay.setVisible(false);
    this.legend.hidden = kind === null;
    this.onChange(kind);
    if (!kind) return;
    const l = LEGEND[kind];
    const top = l.ends.at(-1)!;
    const stops = l.ends.map((v) => `${css(heatColor(kind, v))} ${(v / top) * 100}%`);
    const name = VIEWS.find((v) => v.kind === kind)!.label;
    this.legend.innerHTML = `<b class="heat-name">${name}</b><i class="heat-ramp" style="background:linear-gradient(90deg, ${stops.join(', ')})"></i><div class="heat-ends small"><span>${l.left}</span><span class="heat-summary"></span><span>${l.right}</span></div><p class="small dim">${l.blurb}</p>`;
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 1000);
  }

  private async refresh(): Promise<void> {
    const kind = this.kind;
    if (!kind) return;
    try {
      const m = await this.sim.command<HeatMap>(
        kind === 'appeal' ? { type: 'appealMap' } : { type: 'heatMap', kind },
      );
      if (this.kind !== kind) return;
      this.overlay.setData(kind, m.cols, m.rows, m.values);
      this.overlay.setVisible(true);
      const summary = this.legend.querySelector('.heat-summary');
      if (summary)
        summary.textContent =
          m.summary === null
            ? 'no data yet'
            : kind === 'traffic'
              ? `busiest tile ${Math.round(m.summary)} visits`
              : `average ${Math.round(m.summary)}`;
    } catch {
      // Between games the world may be resetting; the next poll catches up.
    }
  }
}
