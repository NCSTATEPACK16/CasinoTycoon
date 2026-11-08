// B15e: a window's small chart. One line (with a soft area under it), a
// label and the latest value. It is patched in place, so a poll never
// rebuilds the window around it.

import { el } from '../dom';

const W = 100;
const H = 30;

/** The SVG path of `values` scaled into a W×H box (y up), or '' with < 2 points. */
export function sparkPath(values: number[], lo?: number, hi?: number): string {
  if (values.length < 2) return '';
  const min = lo ?? Math.min(...values);
  const max = hi ?? Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / span) * H;
      return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export class Sparkline {
  readonly root = el('figure', 'spark');
  private label = el('span');
  private value = el('b');
  private svg: SVGSVGElement;
  private line: SVGPathElement;
  private area: SVGPathElement;
  private zero: SVGLineElement;
  private empty = el('p', 'spark-empty');

  constructor(
    label: string,
    private emptyText = 'Not enough data yet.',
  ) {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('viewBox', `0 -2 ${W} ${H + 4}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    this.svg.setAttribute('aria-hidden', 'true');
    this.area = document.createElementNS(ns, 'path');
    this.area.setAttribute('class', 'spark-area');
    this.zero = document.createElementNS(ns, 'line');
    this.zero.setAttribute('class', 'spark-zero');
    this.line = document.createElementNS(ns, 'path');
    this.line.setAttribute('class', 'spark-line');
    this.svg.append(this.area, this.zero, this.line);
    this.label.textContent = label;
    const head = el('figcaption', 'spark-head');
    head.append(this.label, this.value);
    this.root.append(head, this.svg, this.empty);
  }

  /** `latest` is what the value slot shows; values are oldest first. */
  update(values: number[], latest: string): void {
    this.value.textContent = latest;
    const enough = values.length >= 2;
    this.svg.style.display = enough ? '' : 'none';
    this.empty.hidden = enough;
    this.empty.textContent = this.emptyText;
    if (!enough) return;
    // Charts of money cross zero: keep the zero line in view.
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const d = sparkPath(values, lo, hi);
    this.line.setAttribute('d', d);
    const zeroY = H - ((0 - lo) / (hi - lo || 1)) * H;
    this.area.setAttribute('d', `${d} L${W},${zeroY.toFixed(2)} L0,${zeroY.toFixed(2)} Z`);
    this.zero.setAttribute('x1', '0');
    this.zero.setAttribute('x2', String(W));
    this.zero.setAttribute('y1', zeroY.toFixed(2));
    this.zero.setAttribute('y2', zeroY.toFixed(2));
    this.zero.style.display = lo < 0 ? '' : 'none';
  }
}
