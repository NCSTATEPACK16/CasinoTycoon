// Eye-level prompts ("E — Inspect Blackjack Table") plus the crosshair and
// the mode hint shown while the avatar has the camera.

import './tools.css';
import type { CameraMode } from '../../camera/CameraDirector';

const HINTS: Record<CameraMode, string> = {
  god: '',
  third: 'WASD walk · Shift run · drag to look · V first person · Esc god view',
  first: 'WASD walk · Shift run · mouse to look · V god view · Esc god view',
  seat: 'F stand up · Esc god view',
};

export class InteractPrompt {
  private box: HTMLElement;
  private hint: HTMLElement;
  private cross: HTMLElement;
  private key = '';

  constructor(root: HTMLElement) {
    this.box = div('interact-prompt');
    this.hint = div('mode-hint');
    this.cross = div('crosshair');
    root.append(this.box, this.hint, this.cross);
  }

  set(lines: [key: string, label: string][] | null): void {
    const key = JSON.stringify(lines);
    if (key === this.key) return;
    this.key = key;
    this.box.classList.toggle('show', !!lines);
    this.box.innerHTML = (lines ?? [])
      .map(([k, label]) => `<div><kbd>${k}</kbd>${label}</div>`)
      .join('');
  }

  mode(m: CameraMode): void {
    this.hint.textContent = HINTS[m];
    this.hint.classList.toggle('show', m !== 'god');
    this.cross.classList.toggle('show', m === 'first');
    if (m === 'god') this.set(null);
  }
}

function div(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
