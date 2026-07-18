import type { PanelSpec } from '../WindowManager';
import { el, row } from '../dom';

// P2 stub — real daily P&L history and live graphs arrive in P7.
export function makeFinancePanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Daily Profit'));

  const chart = el('canvas', 'p-chart');
  chart.width = 280;
  chart.height = 90;
  content.appendChild(chart);
  drawPlaceholderCurve(chart);

  content.appendChild(el('div', 'p-heading', 'Today'));
  content.appendChild(row('Revenue', '$0'));
  content.appendChild(row('Upkeep', '$0'));
  content.appendChild(row('Wages', '$0'));
  content.appendChild(row('Profit', '$0'));
  content.appendChild(
    el('div', 'p-note', 'The books open in P5 (economy) and P7 (daily rollups & real graphs).'),
  );
  return { title: 'Finance', width: 300, content };
}

function drawPlaceholderCurve(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width: w, height: h } = canvas;
  ctx.strokeStyle = '#3a5c3a';
  ctx.lineWidth = 1;
  for (let y = h / 4; y < h; y += h / 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#e8b93c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 4) {
    const t = x / w;
    const y = h * 0.75 - h * 0.45 * t * (0.6 + 0.4 * Math.sin(t * 9));
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
