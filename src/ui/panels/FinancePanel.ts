import { world } from '../../gameContext';
import type { HourlySample } from '../../sim/economy';
import { el, formatCash, row } from '../dom';
import type { PanelSpec } from '../WindowManager';

const REFRESH_MS = 1000;
const WINDOW_HOURS = 48;
const CHART_W = 264;

// Validated against the #241c30 chart surface (dataviz six checks, dark mode).
const SURFACE = '#241c30';
const GRID_INK = '#3a3348';
const ZERO_INK = '#565068';
const TEXT_INK = '#b8aec8';
const REVENUE = '#b8861d';
const EXPENSES = '#1fa3ad';
const GUESTS = '#44a468';

interface Series {
  color: string;
  values: number[];
}

// Live P&L: today's running numbers, two hourly line charts (cash flow and
// guest count get separate charts — different units), and the daily history.
export function makeFinancePanel(): PanelSpec {
  const content = el('div');

  const todayHead = el('div', 'p-heading', 'Today');
  const revRow = row('Revenue', '$0');
  const expRow = row('Expenses', '$0');
  const profitRow = row('Profit', '$0');

  const cashHead = el('div', 'p-heading', `Cash flow / hour — last ${WINDOW_HOURS}h`);
  const legend = el('div', 'p-note');
  legend.append(chip(REVENUE), ' Revenue   ', chip(EXPENSES), ' Expenses');
  const cashChart = makeCanvas(84);
  const cashReadout = el('div', 'p-note', ' ');

  const guestHead = el('div', 'p-heading', 'Guests on the floor');
  const guestChart = makeCanvas(56);
  const guestReadout = el('div', 'p-note', ' ');

  const historyHead = el('div', 'p-heading', 'Daily profit');
  const historyList = el('div');

  content.append(
    todayHead,
    revRow,
    expRow,
    profitRow,
    cashHead,
    legend,
    cashChart.wrap,
    cashReadout,
    guestHead,
    guestChart.wrap,
    guestReadout,
    historyHead,
    historyList,
  );

  let samples: HourlySample[] = [];
  let cashHover: number | null = null;
  let guestHover: number | null = null;

  const render = () => {
    const { ledger } = world;
    setVal(revRow, formatCash(ledger.todayRevenue));
    setVal(expRow, formatCash(ledger.todayExpenses));
    setVal(profitRow, formatCash(ledger.todayRevenue - ledger.todayExpenses));

    samples = ledger.hourly.slice(-WINDOW_HOURS);
    drawLines(
      cashChart.canvas,
      samples,
      [
        { color: REVENUE, values: samples.map((s) => s.revenue) },
        { color: EXPENSES, values: samples.map((s) => s.expenses) },
      ],
      true,
      cashHover,
    );
    drawLines(
      guestChart.canvas,
      samples,
      [{ color: GUESTS, values: samples.map((s) => s.guests) }],
      false,
      guestHover,
    );
    updateReadout(
      cashReadout,
      samples,
      cashHover,
      (s) => `rev ${formatCash(s.revenue)} · exp ${formatCash(s.expenses)}`,
    );
    updateReadout(guestReadout, samples, guestHover, (s) => `${s.guests} guests`);

    historyList.textContent = '';
    const days = ledger.history.slice(-4).reverse();
    if (days.length === 0) {
      historyList.appendChild(el('div', 'p-note', 'The books close at midnight.'));
    }
    for (const r of days) {
      historyList.appendChild(row(`Day ${r.day}`, formatCash(r.profit)));
    }
  };

  attachHover(cashChart.canvas, (i) => {
    cashHover = i;
    render();
  });
  attachHover(guestChart.canvas, (i) => {
    guestHover = i;
    render();
  });

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return { title: 'Finance', width: 300, content, onClose: () => window.clearInterval(timer) };
}

function chip(color: string): HTMLElement {
  const c = el('span');
  c.style.cssText = `display:inline-block;width:8px;height:8px;background:${color};border-radius:2px;`;
  return c;
}

function setVal(r: HTMLElement, text: string): void {
  const val = r.querySelector('.val');
  if (val) val.textContent = text;
}

function makeCanvas(cssHeight: number): { wrap: HTMLElement; canvas: HTMLCanvasElement } {
  const wrap = el('div');
  const canvas = el('canvas', 'p-chart');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = CHART_W * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = `${CHART_W}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.getContext('2d')?.scale(dpr, dpr);
  wrap.appendChild(canvas);
  return { wrap, canvas };
}

function attachHover(canvas: HTMLCanvasElement, onIndex: (i: number | null) => void): void {
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    onIndex(Math.round(((e.clientX - rect.left) / rect.width) * (WINDOW_HOURS - 1)));
  });
  canvas.addEventListener('mouseleave', () => onIndex(null));
}

function updateReadout(
  target: HTMLElement,
  samples: HourlySample[],
  hover: number | null,
  fmt: (s: HourlySample) => string,
): void {
  const idx = hover === null ? samples.length - 1 : Math.min(hover, samples.length - 1);
  const s = idx >= 0 ? samples[idx] : undefined;
  target.textContent = s ? `Day ${s.day} ${String(s.hour).padStart(2, '0')}:00 — ${fmt(s)}` : ' ';
}

function drawLines(
  canvas: HTMLCanvasElement,
  samples: HourlySample[],
  series: Series[],
  includeZero: boolean,
  hover: number | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = CHART_W;
  const h = canvas.height / (window.devicePixelRatio || 1);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, w, h);

  if (samples.length < 2) {
    ctx.fillStyle = TEXT_INK;
    ctx.font = '11px Verdana';
    ctx.textAlign = 'center';
    ctx.fillText('Needs an hour of trading…', w / 2, h / 2 + 4);
    return;
  }

  const all = series.flatMap((s) => s.values);
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (includeZero) min = Math.min(0, min);
  if (max === min) max = min + 1;
  const pad = (max - min) * 0.1;
  max += pad;
  if (min < 0) min -= pad;
  const x = (i: number) => (i / (WINDOW_HOURS - 1)) * (w - 26) + 2;
  const y = (v: number) => h - 4 - ((v - min) / (max - min)) * (h - 10);

  // Recessive grid: three horizontals + a slightly stronger zero line.
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID_INK;
  for (const frac of [0.25, 0.5, 0.75]) {
    const gy = 4 + frac * (h - 10);
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
  if (includeZero && min < 0) {
    ctx.strokeStyle = ZERO_INK;
    ctx.beginPath();
    ctx.moveTo(0, y(0));
    ctx.lineTo(w, y(0));
    ctx.stroke();
  }

  if (hover !== null && hover < samples.length) {
    ctx.strokeStyle = ZERO_INK;
    ctx.beginPath();
    ctx.moveTo(x(hover), 2);
    ctx.lineTo(x(hover), h - 2);
    ctx.stroke();
  }

  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.values.forEach((v, i) => {
      if (i === 0) ctx.moveTo(x(i), y(v));
      else ctx.lineTo(x(i), y(v));
    });
    ctx.stroke();
    // Selective direct label: the latest value, in ink beside the line end.
    const last = s.values[s.values.length - 1]!;
    ctx.fillStyle = TEXT_INK;
    ctx.font = '10px Verdana';
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.round(last)), x(s.values.length - 1) + 4, y(last) + 3);
  }
}
