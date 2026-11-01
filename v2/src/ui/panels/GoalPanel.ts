// B8: the scenario's goals, under the HUD. One row per goal with a bar and
// where the casino stands, the deadline and the medal days. The HUD's goal
// text folds it away and back; the choice is remembered per browser.

import { getCampaign } from '../../data/campaigns';
import { MEDAL_GLYPH, medalDays } from '../../data/score';
import type { HudView } from '../../shared/contracts';
import { el, escapeHtml } from '../dom';

const PREF = 'casino-v2-goals-folded';

type Goals = NonNullable<HudView['goals']>;

export class GoalPanel {
  readonly root = el('div', 'goal-panel');
  private head = el('div', 'goal-head');
  private list = el('div', 'goal-list');
  private rows: { root: HTMLElement; progress: HTMLElement; fill: HTMLElement }[] = [];
  private key = '';
  private folded = readPref();

  constructor() {
    this.root.append(this.head, this.list);
    this.root.hidden = true;
    this.head.onclick = () => this.toggle();
    this.head.title = 'Fold the goals away (click the goal in the bar to bring them back)';
  }

  toggle(): void {
    this.folded = !this.folded;
    writePref(this.folded);
    this.list.hidden = this.folded;
    this.root.classList.toggle('folded', this.folded);
  }

  update(h: HudView): void {
    const goals = h.goals;
    const def = h.scenario ? getCampaign(h.scenario.id) : undefined;
    if (!goals?.length || !def) {
      this.root.hidden = true;
      this.key = '';
      return;
    }
    this.root.hidden = false;
    const key = `${def.id}|${goals.map((g) => g.text).join('|')}`;
    if (key !== this.key) this.build(def.id, goals);
    const d = medalDays(def);
    const left = def.dayLimit - h.day;
    const medal =
      h.day <= d.gold
        ? `${MEDAL_GLYPH.gold} by day ${d.gold}`
        : h.day <= d.silver
          ? `${MEDAL_GLYPH.silver} by day ${d.silver}`
          : `${MEDAL_GLYPH.bronze} by day ${d.bronze}`;
    const met = goals.filter((g) => g.met).length;
    setHtml(
      this.head,
      `<b>Goals ${met}/${goals.length}</b> <span class="dim">· Day ${h.day} of ${def.dayLimit}${
        left > 0 ? ` (${left} left)` : ''
      } · ${medal}</span> <span class="goal-fold">${this.folded ? '▸' : '▾'}</span>`,
    );
    goals.forEach((g, i) => {
      const r = this.rows[i]!;
      r.root.classList.toggle('met', g.met);
      setText(r.progress, g.progress);
      r.fill.style.width = `${Math.round(g.fraction * 100)}%`;
    });
  }

  private build(id: string, goals: Goals): void {
    this.key = `${id}|${goals.map((g) => g.text).join('|')}`;
    this.rows = goals.map((g) => {
      const root = el('div', 'goal-row');
      const fill = el('i', '');
      const bar = el('span', 'goal-bar');
      bar.append(fill);
      const progress = el('span', 'goal-progress dim');
      root.append(el('span', 'goal-text', escapeHtml(g.text)), progress, bar);
      return { root, progress, fill };
    });
    this.list.replaceChildren(...this.rows.map((r) => r.root));
    this.list.hidden = this.folded;
    this.root.classList.toggle('folded', this.folded);
  }
}

function setText(e: HTMLElement, t: string): void {
  if (e.textContent !== t) e.textContent = t;
}

function setHtml(e: HTMLElement, h: string): void {
  if (e.innerHTML !== h) e.innerHTML = h;
}

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF) === '1';
  } catch {
    return false;
  }
}

function writePref(folded: boolean): void {
  try {
    localStorage.setItem(PREF, folded ? '1' : '0');
  } catch {
    /* not remembered */
  }
}
