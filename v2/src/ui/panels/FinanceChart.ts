// The Finances tab's chart: one metric at a time, by hour (the last week) or
// by day (up to 60), drawn on a canvas with no chart library. Money metrics
// are bars, green above zero and red below; hold, guests and cash are lines.
// Hovering shows the exact value.

import { weekdayName } from '../../data/traffic';
import type { FinanceHistory, FinancePoint } from '../../worker/finance';
import { button, el, money, pct } from '../dom';

type MetricId = 'profit' | 'revenue' | 'win' | 'hold' | 'guests' | 'cash';
type Range = 'hours' | 'days';

interface Metric {
  id: MetricId;
  label: string;
  kind: 'bar' | 'line';
  get: (p: FinancePoint) => number | null;
  fmt: (v: number) => string;
  /** What the metric is, under the chart. */
  blurb: string;
}

const METRICS: Metric[] = [
  {
    id: 'profit',
    label: 'Profit',
    kind: 'bar',
    get: (p) => p.profit,
    fmt: (v) => money(v),
    blurb: 'Revenue less every cost: wages, upkeep, comps, stock, fines and interest.',
  },
  {
    id: 'revenue',
    label: 'Revenue',
    kind: 'bar',
    get: (p) => p.revenue,
    fmt: (v) => money(v),
    blurb: 'Everything taken in: the games’ win, food and drink, and fees.',
  },
  {
    id: 'win',
    label: 'Win',
    kind: 'bar',
    get: (p) => p.win,
    fmt: (v) => money(v),
    blurb: 'What the games kept: money wagered less money paid out.',
  },
  {
    id: 'hold',
    label: 'Hold %',
    kind: 'line',
    get: (p) => p.hold,
    fmt: (v) => pct(v, 1),
    blurb: 'Win ÷ handle. It swings hour to hour and settles toward the games’ edge over days.',
  },
  {
    id: 'guests',
    label: 'Guests',
    kind: 'line',
    get: (p) => p.guests,
    fmt: (v) => Math.round(v).toLocaleString(),
    blurb: 'By hour: guests on the floor at the hour’s close. By day: visits that day.',
  },
  {
    id: 'cash',
    label: 'Cash',
    kind: 'line',
    get: (p) => p.cash,
    fmt: (v) => money(v),
    blurb: 'Cash at each close, after wages, upkeep and any loan installments.',
  },
];

const PAD = { left: 56, right: 8, top: 10, bottom: 20 };
const COLORS = {
  up: '#58d68d',
  down: '#ff6b6b',
  line: '#f6c453',
  grid: 'rgba(255, 255, 255, 0.08)',
  zero: 'rgba(255, 255, 255, 0.25)',
  text: '#a99fb8',
};

/** Round-number gridlines covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
  return out;
}

export class FinanceChart {
  readonly root = el('div', 'fin-chart');
  private canvas = el('canvas');
  private tip = el('div', 'fin-chart-tip');
  private blurb = el('p', 'small dim');
  private data: FinanceHistory | null = null;
  private metric: Metric = METRICS[0]!;
  private range: Range = 'hours';
  private metricButtons = new Map<MetricId, HTMLButtonElement>();
  private rangeButtons = new Map<Range, HTMLButtonElement>();
  /** Plot geometry from the last draw, for hover. */
  private geom: { x0: number; step: number; points: FinancePoint[] } | null = null;

  constructor() {
    const metrics = el('div', 'seg');
    for (const m of METRICS) {
      const b = button(m.label, () => this.set({ metric: m }), 'small');
      this.metricButtons.set(m.id, b);
      metrics.append(b);
    }
    const ranges = el('div', 'seg');
    for (const [r, label] of [
      ['hours', 'By hour'],
      ['days', 'By day'],
    ] as const) {
      const b = button(label, () => this.set({ range: r }), 'small');
      this.rangeButtons.set(r, b);
      ranges.append(b);
    }
    const plot = el('div', 'fin-chart-plot');
    plot.append(this.canvas, this.tip);
    this.tip.hidden = true;
    this.root.append(el('h3', '', 'Trends'), el('div', 'fin-chart-controls'), plot, this.blurb);
    this.root.querySelector('.fin-chart-controls')!.append(metrics, ranges);
    this.canvas.addEventListener('mousemove', (e) => this.hover(e));
    this.canvas.addEventListener('mouseleave', () => (this.tip.hidden = true));
    new ResizeObserver(() => this.draw()).observe(this.canvas);
    this.set({});
  }

  update(h: FinanceHistory): void {
    this.data = h;
    this.draw();
  }

  private set(o: { metric?: Metric; range?: Range }): void {
    if (o.metric) this.metric = o.metric;
    if (o.range) this.range = o.range;
    for (const [id, b] of this.metricButtons) b.classList.toggle('active', id === this.metric.id);
    for (const [r, b] of this.rangeButtons) b.classList.toggle('active', r === this.range);
    this.blurb.textContent = this.metric.blurb;
    this.draw();
  }

  private points(): FinancePoint[] {
    if (!this.data) return [];
    return this.range === 'hours' ? this.data.hours : this.data.days;
  }

  private label(p: FinancePoint): string {
    const day = `${weekdayName(p.day)} ${p.day}`;
    if (p.hour !== undefined) return `${day} · ${String(p.hour).padStart(2, '0')}:00`;
    return p.partial ? `${day} (so far)` : day;
  }

  private draw(): void {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.font = '11px system-ui, sans-serif';
    const pts = this.points();
    const m = this.metric;
    const vals = pts.map((p) => m.get(p));
    const known = vals.filter((v): v is number => v !== null);
    if (known.length === 0) {
      g.fillStyle = COLORS.text;
      g.textAlign = 'center';
      g.fillText(this.range === 'hours' ? 'No hours closed yet.' : 'No days yet.', w / 2, h / 2);
      this.geom = null;
      return;
    }
    let lo = Math.min(...known);
    let hi = Math.max(...known);
    if (m.kind === 'bar' || m.id === 'guests') {
      lo = Math.min(0, lo);
      hi = Math.max(0, hi);
    }
    if (hi === lo) {
      hi += Math.abs(hi) * 0.1 || 1;
      lo -= Math.abs(lo) * 0.1 || (m.kind === 'bar' ? 0 : 1);
    }
    const ticks = niceTicks(lo, hi);
    lo = Math.min(lo, ticks[0]!);
    hi = Math.max(hi, ticks.at(-1)!);
    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top - PAD.bottom;
    const y = (v: number) => PAD.top + plotH * (1 - (v - lo) / (hi - lo));
    const step = plotW / pts.length;
    const x = (i: number) => PAD.left + step * (i + 0.5);
    this.geom = { x0: PAD.left, step, points: pts };

    // Gridlines and their labels.
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const t of ticks) {
      g.strokeStyle = t === 0 ? COLORS.zero : COLORS.grid;
      g.beginPath();
      g.moveTo(PAD.left, Math.round(y(t)) + 0.5);
      g.lineTo(w - PAD.right, Math.round(y(t)) + 0.5);
      g.stroke();
      g.fillStyle = COLORS.text;
      g.fillText(m.fmt(t), PAD.left - 6, y(t));
    }

    // Day boundaries on the hourly view; every few days on the daily one.
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const every = Math.max(1, Math.ceil(pts.length / 8));
    pts.forEach((p, i) => {
      const mark = this.range === 'hours' ? p.hour === 0 || i === 0 : i % every === 0;
      if (!mark) return;
      const at = PAD.left + step * i;
      g.strokeStyle = COLORS.grid;
      g.beginPath();
      g.moveTo(Math.round(at) + 0.5, PAD.top);
      g.lineTo(Math.round(at) + 0.5, h - PAD.bottom);
      g.stroke();
      g.fillStyle = COLORS.text;
      g.fillText(`${weekdayName(p.day)} ${p.day}`, at + 3, h - 6);
    });

    if (m.kind === 'bar') {
      const bw = Math.max(1, step * 0.72);
      vals.forEach((v, i) => {
        if (v === null) return;
        g.globalAlpha = pts[i]!.partial ? 0.45 : 1;
        g.fillStyle = v >= 0 ? COLORS.up : COLORS.down;
        const top = Math.min(y(v), y(0));
        g.fillRect(x(i) - bw / 2, top, bw, Math.max(1, Math.abs(y(v) - y(0))));
      });
      g.globalAlpha = 1;
    } else {
      g.strokeStyle = COLORS.line;
      g.lineWidth = 2;
      g.beginPath();
      let pen = false;
      vals.forEach((v, i) => {
        if (v === null) return void (pen = false);
        if (pen) g.lineTo(x(i), y(v));
        else g.moveTo(x(i), y(v));
        pen = true;
      });
      g.stroke();
      g.lineWidth = 1;
      if (pts.length <= 40) {
        g.fillStyle = COLORS.line;
        vals.forEach((v, i) => {
          if (v === null) return;
          g.beginPath();
          g.arc(x(i), y(v), 2.5, 0, Math.PI * 2);
          g.fill();
        });
      }
    }
  }

  private hover(e: MouseEvent): void {
    const geo = this.geom;
    if (!geo) return;
    const rect = this.canvas.getBoundingClientRect();
    const i = Math.floor((e.clientX - rect.left - geo.x0) / geo.step);
    const p = geo.points[i];
    if (!p) return void (this.tip.hidden = true);
    const v = this.metric.get(p);
    this.tip.textContent = `${this.label(p)} — ${this.metric.label} ${v === null ? '—' : this.metric.fmt(v)}`;
    this.tip.hidden = false;
    const left = Math.min(e.clientX - rect.left + 10, rect.width - this.tip.offsetWidth - 4);
    this.tip.style.left = `${Math.max(0, left)}px`;
  }
}
