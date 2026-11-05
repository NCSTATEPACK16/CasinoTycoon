// The little price tag that rides next to the cursor while a build tool is
// active: cost, cell count, refund, or why a placement is blocked.

import './tools.css';

export type TagTone = 'ok' | 'bad' | 'info';

export class CursorTag {
  readonly el: HTMLElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cursor-tag';
    root.append(this.el);
  }

  show(clientX: number, clientY: number, html: string, tone: TagTone = 'info'): void {
    this.el.innerHTML = html;
    this.el.dataset.tone = tone;
    this.el.style.transform = `translate(${clientX + 18}px, ${clientY + 14}px)`;
    this.el.classList.add('show');
  }

  hide(): void {
    this.el.classList.remove('show');
  }
}

export const money = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`;
