import { eventBus } from '../EventBus';
import { STARTING_CASH } from '../config';
import { world } from '../gameContext';
import { el, formatCash } from './dom';
import type { PanelSpec, WindowManager } from './WindowManager';
import { makeBuildPanel } from './panels/BuildPanel';
import { makeFinancePanel } from './panels/FinancePanel';
import { makeGuestsPanel } from './panels/GuestsPanel';
import { makeStaffPanel } from './panels/StaffPanel';
import { makeObjectivesPanel } from './panels/ObjectivesPanel';
import { makeRatingPanel } from './panels/RatingPanel';
import { makeSoundPanel } from './panels/SoundPanel';
import { makeSavePanel } from './panels/SavePanel';

interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  make: () => PanelSpec;
}

// Bottom toolbar: panel toggles on the left, cash + clock readouts on the right.
export class Toolbar {
  constructor(uiRoot: HTMLElement, windows: WindowManager) {
    const BUTTONS: ToolbarButton[] = [
      { id: 'build', label: 'Build', icon: '🔨', make: makeBuildPanel },
      { id: 'finance', label: 'Finance', icon: '💰', make: () => makeFinancePanel(windows) },
      { id: 'guests', label: 'Guests', icon: '👥', make: makeGuestsPanel },
      { id: 'staff', label: 'Staff', icon: '🔧', make: makeStaffPanel },
      { id: 'objectives', label: 'Objectives', icon: '🎯', make: makeObjectivesPanel },
      { id: 'sound', label: 'Sound', icon: '🔊', make: makeSoundPanel },
      { id: 'save', label: 'Save', icon: '💾', make: makeSavePanel },
    ];

    const bar = el('div', 'ui-toolbar bevel-raised');
    uiRoot.appendChild(bar);

    const group = el('div', 'tb-group');
    bar.appendChild(group);
    const buttons = new Map<string, HTMLButtonElement>();
    for (const def of BUTTONS) {
      const btn = el('button', 'tb-btn');
      btn.appendChild(el('span', 'tb-icon', def.icon));
      btn.appendChild(el('span', '', def.label));
      btn.addEventListener('click', () => windows.toggle(def.id, def.make));
      group.appendChild(btn);
      buttons.set(def.id, btn);
    }
    windows.onChange((id, open) => buttons.get(id)?.classList.toggle('pressed', open));

    // Game speed: pause / 1× / 3× (render-side tick multiplier).
    const speedGroup = el('div', 'tb-group tb-speed');
    const speedButtons: [number, HTMLButtonElement][] = [];
    for (const [label, value] of [
      ['⏸', 0],
      ['1×', 1],
      ['3×', 3],
    ] as const) {
      const btn = el('button', 'tb-btn tb-speed-btn', label);
      btn.addEventListener('click', () => eventBus.emit('speedChanged', { speed: value }));
      speedGroup.appendChild(btn);
      speedButtons.push([value, btn]);
    }
    bar.appendChild(speedGroup);
    const syncSpeed = (speed: number) => {
      for (const [value, btn] of speedButtons) btn.classList.toggle('pressed', value === speed);
    };
    eventBus.on('speedChanged', ({ speed }) => syncSpeed(speed));
    syncSpeed(1);

    bar.appendChild(el('div', 'tb-spacer'));

    const cash = el('div', 'tb-readout tb-cash bevel-sunken');
    const cashIcon = el('span', 'ro-icon', '💵');
    const cashValue = el('span', '', formatCash(STARTING_CASH));
    cash.append(cashIcon, cashValue);
    bar.appendChild(cash);

    const clock = el('div', 'tb-readout bevel-sunken');
    const clockIcon = el('span', 'ro-icon', '🕗');
    const clockValue = el('span', '', 'Day 1 · 12:00');
    clock.append(clockIcon, clockValue);
    bar.appendChild(clock);

    // Polled rather than event-driven: ratingBreakdown is an
    // O(guests + machines + objects + staff) pass, and emitting it per tick
    // would run that ten times a second at full guest load. 500ms matches the
    // REFRESH_MS precedent in ObjectivesPanel/GuestsPanel.
    const REFRESH_MS = 500;

    const guestsRo = el('div', 'tb-readout bevel-sunken');
    guestsRo.title = 'Guests on the floor';
    guestsRo.append(el('span', 'ro-icon', '👥'), el('span', '', '0'));
    bar.appendChild(guestsRo);

    const moodRo = el('div', 'tb-readout bevel-sunken');
    moodRo.title = 'Average guest happiness';
    moodRo.append(el('span', 'ro-icon', '😊'), el('span', '', '—'));
    bar.appendChild(moodRo);

    const ratingRo = el('div', 'tb-readout bevel-sunken');
    ratingRo.id = 'tb-rating';
    ratingRo.append(el('span', 'ro-icon', '⭐'), el('span', '', '0/100'));
    ratingRo.classList.add('tb-readout-btn');
    ratingRo.title = 'Casino rating — click for a breakdown';
    ratingRo.addEventListener('click', () => windows.toggle('rating', makeRatingPanel));
    bar.appendChild(ratingRo);

    const syncStats = () => {
      const breakdown = world.ratingBreakdown();
      (guestsRo.lastChild as HTMLElement).textContent = String(world.guests.size);
      (moodRo.lastChild as HTMLElement).textContent = `${Math.round(world.averageHappiness)}%`;
      (ratingRo.lastChild as HTMLElement).textContent = `${breakdown.total}/100`;
    };
    syncStats();
    // Toolbar lives for the lifetime of the page, so this interval is
    // deliberately never cleared.
    window.setInterval(syncStats, REFRESH_MS);

    // A scenario change or save load must not leave a stale readout on screen
    // for up to half a poll interval.
    eventBus.on('worldReset', syncStats);
    eventBus.on('worldLoaded', syncStats);

    let displayedCash = STARTING_CASH;
    let targetCash = STARTING_CASH;
    let animStart = 0;
    let animFrom = STARTING_CASH;
    let rafHandle = 0;
    const TICKUP_MS = 400;

    const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);

    const stepTickUp = (now: number) => {
      const t = Math.min(1, (now - animStart) / TICKUP_MS);
      displayedCash = animFrom + (targetCash - animFrom) * easeOutQuad(t);
      cashValue.textContent = formatCash(Math.round(displayedCash));
      if (t < 1) {
        rafHandle = requestAnimationFrame(stepTickUp);
      } else {
        displayedCash = targetCash;
        cashValue.textContent = formatCash(targetCash);
      }
    };

    eventBus.on('moneyChanged', ({ cash: total, delta }) => {
      // Retarget the running interpolation from wherever it currently is —
      // rapid-fire plays shouldn't restart from the old target each time.
      animFrom = displayedCash;
      animStart = performance.now();
      targetCash = total;
      cancelAnimationFrame(rafHandle);
      rafHandle = requestAnimationFrame(stepTickUp);

      const flash = delta >= 0 ? 'flash-up' : 'flash-down';
      cash.classList.remove('flash-up', 'flash-down');
      // Force a reflow so re-adding the class restarts the CSS animation.
      void cash.offsetWidth;
      cash.classList.add(flash);
    });
    eventBus.on('hourPassed', ({ hour, day }) => {
      clockValue.textContent = `Day ${day} · ${String(hour).padStart(2, '0')}:00`;
    });
  }
}
