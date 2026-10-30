// Today's conditions, kept on screen under the HUD for the whole day. Each
// modifier also gets one ticker line at midnight, but that scrolls away and
// the condition doesn't: a heat wave still matters at 9 p.m.

import type { HudView } from '../../shared/contracts';
import { el, escapeHtml } from '../dom';

export class ConditionsBanner {
  readonly root = el('div', 'conditions');
  private key = '';

  constructor() {
    this.root.hidden = true;
  }

  update(mods: HudView['modifiers']): void {
    const list = mods ?? [];
    const key = list.map((m) => m.id).join('|');
    if (key === this.key) return;
    this.key = key;
    this.root.hidden = list.length === 0;
    this.root.replaceChildren(el('span', 'conditions-label', 'Today'));
    for (const m of list) {
      const chip = el(
        'span',
        'condition',
        `<b>${escapeHtml(m.name)}</b> <span>${escapeHtml(m.blurb)}</span>`,
      );
      chip.dataset.id = m.id;
      this.root.append(chip);
    }
  }
}
