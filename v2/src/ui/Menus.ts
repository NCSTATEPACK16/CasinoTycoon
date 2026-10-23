// Front-of-house screens: the title/scenario picker, save & load slots, and
// the win/lose card. Saves live on the main thread (workers have no
// localStorage): the worker hands over world JSON and takes it back.

import type { SimClient } from '../client/SimClient';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, saveService, type SlotInfo } from '../services/SaveService';
import type { CasinoWorldJSON } from '../sim/world';
import type { ScenarioInfo } from '../worker/inspect';
import { button, el, escapeHtml, money } from './dom';

export class Menus {
  readonly root = el('div', 'menus');
  onStarted: () => void = () => {};

  constructor(private sim: SimClient) {
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  private card(...children: (Node | string)[]): HTMLElement {
    const c = el('div', 'menu-card');
    c.append(...children);
    this.root.replaceChildren(c);
    this.root.hidden = false;
    return c;
  }

  async title(): Promise<void> {
    const scenarios = await this.sim.command<ScenarioInfo[]>({ type: 'scenarios' });
    const slots = await saveService.list().catch(() => [] as SlotInfo[]);
    const list = el('div', 'scenario-list');
    for (const s of scenarios) {
      const sandbox = s.id === 'sandbox';
      const b = button(
        `<b>${escapeHtml(s.name)}</b><small>${escapeHtml(s.tagline)}</small><span class="dim small">${
          sandbox
            ? 'Unlimited funds, no goal'
            : `Start ${money(s.startingCash)} · average ${money(s.goalDailyProfit)}/day over ${s.goalWindowDays} days by day ${s.dayLimit}`
        }</span>`,
        () => void this.start(s.id),
        'scenario',
      );
      list.append(b);
    }
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
    this.card(head, actions, el('h3', '', 'New game'), list);
  }

  private async start(id: string): Promise<void> {
    await this.sim.command({ type: 'startScenario', scenarioId: id });
    await this.sim.command({ type: 'setSpeed', speed: 1 });
    this.close();
    this.onStarted();
  }

  async saveMenu(say: (t: string) => void): Promise<void> {
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
            this.close();
          },
          'slot',
        ),
      );
    }
    this.card(
      el('h3', '', 'Save game'),
      grid,
      button('Cancel', () => this.close()),
    );
  }

  async loadMenu(): Promise<void> {
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
    this.card(
      el('h3', '', 'Load game'),
      grid,
      button('Back', () => void this.title()),
    );
  }

  async load(slot: string): Promise<void> {
    const json = await saveService.load(slot);
    if (!json) return;
    await this.sim.command({ type: 'load', json });
    await this.sim.command({ type: 'setSpeed', speed: 1 });
    this.close();
    this.onStarted();
  }

  async autosave(): Promise<void> {
    const json = await this.sim.command<CasinoWorldJSON>({ type: 'save' });
    await saveService.save(AUTOSAVE_SLOT, json);
  }

  gameOver(won: boolean, reason: string, keepPlaying: () => void): void {
    this.card(
      el('h1', won ? 'good' : 'bad', won ? 'Jackpot!' : 'Closed for business'),
      el(
        'p',
        '',
        won ? `${escapeHtml(reason)} — the board is impressed.` : `${escapeHtml(reason)}.`,
      ),
      el('div', 'menu-actions'),
    );
    const actions = this.root.querySelector('.menu-actions')!;
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
    actions.append(button('Main menu', () => void this.title()));
  }
}

function describe(s: SlotInfo): string {
  const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
  return `${escapeHtml(s.scenarioName ?? 'Sandbox')} · day ${s.day} · ${money(s.cash)} <span class="dim">${when}</span>`;
}
