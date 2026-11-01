// Front-of-house screens: the title/scenario picker, save & load slots, and
// the win/lose card. Saves live on the main thread (workers have no
// localStorage): the worker hands over world JSON and takes it back.

import type { SimClient } from '../client/SimClient';
import { MEDAL_GLYPH, type Medal } from '../data/score';
import {
  isScenarioUnlocked,
  loadProgress,
  objectNames,
  recordWin,
  saveProgress,
  type Progress,
} from '../services/progress';
import { getCampaign } from '../data/campaigns';
import { isFirstRun, loadOnboarding } from '../services/onboarding';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, saveService, type SlotInfo } from '../services/SaveService';
import type { CasinoWorldJSON } from '../sim/world';
import type { ScenarioInfo } from '../worker/inspect';
import type { ScenarioResult } from '../worker/scenario';
import { button, el, escapeHtml, money } from './dom';

const MEDAL_NAME: Record<Medal, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };

export class Menus {
  readonly root = el('div', 'menus');
  onStarted: () => void = () => {};
  /** Before a new game or a load replaces the world. */
  onStarting: () => void = () => {};
  /** Set while the pause card is up: how to get back into the game. */
  private resume: (() => void) | null = null;
  /** B8: the career — medals, scores and what they unlock. */
  progress: Progress = loadProgress();
  /** The career changed (a first win, a better medal): relock the palette. */
  onProgress: (p: Progress) => void = () => {};

  constructor(private sim: SimClient) {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.resume = null;
  }

  private card(...children: (Node | string)[]): HTMLElement {
    const c = el('div', 'menu-card');
    c.append(...children);
    this.root.replaceChildren(c);
    this.root.hidden = false;
    this.resume = null;
    return c;
  }

  /** The in-game Menu. The caller has paused the sim; `resume` restarts it. */
  pauseMenu(resume: () => void, say: (t: string) => void): void {
    const back = () => this.pauseMenu(resume, say);
    const actions = el('div', 'menu-actions');
    actions.append(
      button('Resume', () => this.dismissPause(), 'primary'),
      button('Save game…', () => void this.saveMenu(say, back)),
      button('Load game…', () => void this.loadMenu(back)),
      // Autosave first, so the title's Continue picks up exactly here.
      button('Main menu', () => void this.autosave().finally(() => void this.title())),
    );
    this.card(el('div', 'title', '<h1>Paused</h1><h2>Space or Esc to resume</h2>'), actions);
    this.resume = resume;
  }

  /** Close the pause card and restart the sim. False when it isn't showing. */
  dismissPause(): boolean {
    const resume = this.resume;
    if (!resume) return false;
    this.close();
    resume();
    return true;
  }

  async title(): Promise<void> {
    const scenarios = await this.sim.command<ScenarioInfo[]>({ type: 'scenarios' });
    const slots = await saveService.list().catch(() => [] as SlotInfo[]);
    const p = this.progress;
    const career = el('div', 'scenario-list career');
    const free = el('div', 'scenario-list');
    const learn = el('div', 'scenario-list learn');
    const onboarding = loadOnboarding();
    let n = 0;
    for (const s of scenarios) {
      if (s.tutorial) {
        // B12: the lesson sits apart from the career: no number, no medal.
        const b = button(
          `<span class="medal ${onboarding.tutorialDone ? 'bronze' : 'none'}">${onboarding.tutorialDone ? '✓' : '★'}</span><b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.tagline)}</small><span class="dim small">Eight short steps · no goal, no clock · ${money(s.startingCash)} to start</span>`,
          () => void this.start(s.id),
          'scenario',
        );
        b.dataset.scenario = s.id;
        learn.append(b);
        continue;
      }
      if (s.sandbox) {
        free.append(
          button(
            `<b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.tagline)}</small><span class="dim small">Unlimited funds, no goal, every object you have unlocked</span>`,
            () => void this.start(s.id),
            'scenario',
          ),
        );
        continue;
      }
      n++;
      const def = getCampaign(s.id);
      const open = !def || isScenarioUnlocked(def, p);
      const rec = p.scenarios[s.id];
      const after = s.unlockAfter ? getCampaign(s.unlockAfter)?.name : null;
      const badge = rec
        ? `<span class="medal ${rec.medal}" title="${MEDAL_NAME[rec.medal]} · best score ${rec.score.toLocaleString()}">${MEDAL_GLYPH[rec.medal]}</span>`
        : open
          ? '<span class="medal none" title="Not won yet">○</span>'
          : '<span class="medal locked" title="Locked">🔒</span>';
      const md = s.medalDays;
      const lines = open
        ? `<span class="goals">${s.goals.map((g) => `<span>${escapeHtml(g)}</span>`).join('')}</span>
           <span class="dim small">Start ${money(s.startingCash)} · ${s.lot.cols}×${s.lot.rows} lot · by day ${s.dayLimit} · ${MEDAL_GLYPH.gold} ${md.gold} · ${MEDAL_GLYPH.silver} ${md.silver}${
             rec ? ` · best ${rec.score.toLocaleString()}` : ''
           }</span>${s.restriction ? `<span class="dim small">${escapeHtml(s.restriction)}</span>` : ''}`
        : `<span class="dim small">🔒 Win ${escapeHtml(after ?? 'the scenario before')} to unlock.</span>`;
      const b = button(
        `${badge}<b>${n}. ${escapeHtml(s.name)}</b><small>${escapeHtml(s.tagline)}</small>${lines}`,
        () => void this.start(s.id),
        'scenario',
      );
      b.dataset.scenario = s.id;
      if (!open) {
        b.disabled = true;
        b.classList.add('locked');
      }
      career.append(b);
    }
    const won = Object.values(p.scenarios);
    const tally = (m: Medal) => won.filter((r) => r.medal === m).length;
    const summary = el(
      'p',
      'career-summary dim',
      won.length
        ? `${won.length} of ${n} won · ${MEDAL_GLYPH.gold} ${tally('gold')} · ${MEDAL_GLYPH.silver} ${tally('silver')} · ${MEDAL_GLYPH.bronze} ${tally('bronze')}`
        : 'Win a scenario to open the next one and unlock new games.',
    );
    const resume = slots.find((s) => s.slot === AUTOSAVE_SLOT && s.status !== 'newer');
    const head = el('div', 'title', '<h1>Casino Tycoon</h1><h2>High Roller</h2>');
    const actions = el('div', 'menu-actions');
    if (resume)
      actions.append(
        button(
          `Continue · day ${resume.day} · ${money(resume.cash)}`,
          () => void this.load(AUTOSAVE_SLOT),
          'primary',
        ),
      );
    if (slots.some((s) => s.slot !== AUTOSAVE_SLOT))
      actions.append(button('Load game…', () => void this.loadMenu()));
    const rest = [el('h3', '', 'Career'), summary, career, el('h3', '', 'Free play'), free];
    if (isFirstRun(onboarding, won.length > 0, slots.length > 0)) {
      // B12: a clean first screen: the lesson, and everything else tucked away.
      const more = el('details', 'first-more');
      more.append(el('summary', '', 'Already know casinos? Pick a scenario'), ...rest);
      this.card(
        head,
        el(
          'p',
          'first-lead',
          'Welcome. Start with a short lesson: you will build a small casino and learn every control as you use it.',
        ),
        learn,
        more,
      );
      return;
    }
    this.card(head, actions, el('h3', '', 'Learn'), learn, ...rest);
  }

  private async start(id: string): Promise<void> {
    this.onStarting();
    await this.sim.command({ type: 'startScenario', scenarioId: id });
    await this.sim.command({ type: 'setSpeed', speed: 1 });
    this.close();
    this.onStarted();
  }

  async saveMenu(say: (t: string) => void, back?: () => void): Promise<void> {
    const done = back ?? (() => this.close());
    const slots = await saveService.list();
    const grid = el('div', 'slot-list');
    for (const slot of MANUAL_SLOTS) {
      const info = slots.find((s) => s.slot === slot);
      grid.append(
        button(
          `<b>${slot}</b><small>${info ? describe(info) : 'Empty'}</small>`,
          async () => {
            const json = await this.sim.command<CasinoWorldJSON>({ type: 'save' });
            await saveService.save(slot, json);
            say(`Saved to ${slot}`);
            done();
          },
          'slot',
        ),
      );
    }
    this.card(el('h3', '', 'Save game'), grid, button(back ? 'Back' : 'Cancel', done));
  }

  async loadMenu(back: () => void = () => void this.title()): Promise<void> {
    const slots = (await saveService.list()).filter((s) => s.status !== 'newer');
    const grid = el('div', 'slot-list');
    for (const info of slots)
      grid.append(
        button(
          `<b>${info.slot}</b><small>${describe(info)}</small>`,
          () => void this.load(info.slot),
          'slot',
        ),
      );
    if (!slots.length) grid.append(el('p', 'dim', 'No saves yet.'));
    this.card(el('h3', '', 'Load game'), grid, button('Back', back));
  }

  async load(slot: string): Promise<void> {
    const json = await saveService.load(slot);
    if (!json) return;
    this.onStarting();
    await this.sim.command({ type: 'load', json });
    await this.sim.command({ type: 'setSpeed', speed: 1 });
    this.close();
    this.onStarted();
  }

  async autosave(): Promise<void> {
    const json = await this.sim.command<CasinoWorldJSON>({ type: 'save' });
    await saveService.save(AUTOSAVE_SLOT, json);
  }

  /** The win or lose card, with the medal, score and goals (B8). A win is
   *  folded into the career first, so the card can say what it unlocked. */
  async gameOver(won: boolean, reason: string, keepPlaying: () => void): Promise<void> {
    const r = await this.sim.command<ScenarioResult | null>({ type: 'scenarioResult' });
    const actions = el('div', 'menu-actions');
    const goals = el('ul', 'end-goals');
    for (const g of r?.goals ?? [])
      goals.append(
        el(
          'li',
          g.met ? 'met' : '',
          `${g.met ? '✓' : '✗'} ${escapeHtml(g.text)} <span class="dim">${escapeHtml(g.progress)}</span>`,
        ),
      );
    if (won && r?.medal) {
      const before = this.progress.scenarios[r.scenarioId];
      const { progress, unlocked } = recordWin(this.progress, r.scenarioId, {
        medal: r.medal,
        score: r.score,
        day: r.day,
      });
      this.progress = progress;
      saveProgress(progress);
      this.onProgress(progress);
      const best = progress.scenarios[r.scenarioId]!;
      const news: string[] = [];
      if (unlocked.scenarios.length)
        news.push(
          `New scenario: <b>${unlocked.scenarios.map((d) => escapeHtml(d.name)).join(', ')}</b>`,
        );
      if (unlocked.objects.length)
        news.push(`Unlocked: <b>${escapeHtml(objectNames(unlocked.objects))}</b>`);
      const record =
        before && r.score > before.score
          ? ' · a new best'
          : before
            ? ` · best ${best.score.toLocaleString()}`
            : '';
      this.card(
        el('div', `medal-big ${r.medal}`, MEDAL_GLYPH[r.medal]),
        el('h1', 'good', `${MEDAL_NAME[r.medal]} medal`),
        el(
          'p',
          '',
          `${escapeHtml(r.name)} won on day ${r.day} of ${r.dayLimit}. Score <b>${r.score.toLocaleString()}</b>${record}.`,
        ),
        el(
          'p',
          'dim small',
          `${MEDAL_GLYPH.gold} by day ${r.medalDays.gold} · ${MEDAL_GLYPH.silver} by day ${r.medalDays.silver} · ${MEDAL_GLYPH.bronze} by day ${r.medalDays.bronze}`,
        ),
        goals,
        ...(news.length ? [el('p', 'unlocks', news.join('<br>'))] : []),
        actions,
      );
      actions.append(
        button(
          'Keep playing',
          () => {
            this.close();
            keepPlaying();
          },
          'primary',
        ),
      );
      const next = unlocked.scenarios[0];
      if (next)
        actions.append(button(`Play ${escapeHtml(next.name)}`, () => void this.start(next.id)));
    } else {
      this.card(
        el('h1', 'bad', won ? 'Jackpot!' : 'Closed for business'),
        el('p', '', `${escapeHtml(reason)}${r ? ` on day ${r.day} of ${r.dayLimit}` : ''}.`),
        ...(r ? [goals] : []),
        actions,
      );
      if (won)
        actions.append(
          button(
            'Keep playing',
            () => {
              this.close();
              keepPlaying();
            },
            'primary',
          ),
        );
      else if (r)
        actions.append(button('Try again', () => void this.start(r.scenarioId), 'primary'));
    }
    actions.append(button('Main menu', () => void this.title()));
  }
}

function describe(s: SlotInfo): string {
  const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
  return `${escapeHtml(s.scenarioName ?? 'Sandbox')} · day ${s.day} · ${money(s.cash)} <span class="dim">${when}</span>`;
}
