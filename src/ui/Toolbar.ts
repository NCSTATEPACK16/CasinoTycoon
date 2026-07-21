import { eventBus } from '../EventBus';
import { STARTING_CASH } from '../config';
import { el, formatCash } from './dom';
import type { PanelSpec, WindowManager } from './WindowManager';
import { makeBuildPanel } from './panels/BuildPanel';
import { makeFinancePanel } from './panels/FinancePanel';
import { makeGuestsPanel } from './panels/GuestsPanel';
import { makeStaffPanel } from './panels/StaffPanel';
import { makeObjectivesPanel } from './panels/ObjectivesPanel';
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
