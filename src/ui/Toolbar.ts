import { eventBus } from '../EventBus';
import { STARTING_CASH } from '../config';
import { world } from '../gameContext';
import { el, formatCash } from './dom';
import type { PanelSpec, WindowManager } from './WindowManager';
import { makeBuildPanel } from './panels/BuildPanel';
import { makeFinancePanel } from './panels/FinancePanel';
import { makeGuestsPanel } from './panels/GuestsPanel';
import { makePatronsPanel } from './panels/PatronsPanel';
import { makeThoughtsPanel } from './panels/ThoughtsPanel';
import { makeStaffPanel } from './panels/StaffPanel';
import { makeObjectivesPanel } from './panels/ObjectivesPanel';
import { makeOverlayPanel } from './panels/OverlayPanel';
import { makeRatingPanel } from './panels/RatingPanel';
import { makeSoundPanel } from './panels/SoundPanel';
import { makeSavePanel } from './panels/SavePanel';
import { makeLoginPanel } from './panels/LoginPanel';
import { makeLeaderboardPanel } from './panels/LeaderboardPanel';
import { icon, type IconName } from './icons';

interface ToolbarButton {
  id: string;
  label: string;
  icon: IconName;
  make: () => PanelSpec;
}

// Bottom toolbar: panel toggles on the left, cash + clock readouts on the right.
export class Toolbar {
  constructor(uiRoot: HTMLElement, windows: WindowManager) {
    const BUTTONS: ToolbarButton[] = [
      { id: 'build', label: 'Build', icon: 'build', make: makeBuildPanel },
      { id: 'finance', label: 'Finance', icon: 'finance', make: () => makeFinancePanel(windows) },
      { id: 'guests', label: 'Guests', icon: 'guests', make: makeGuestsPanel },
      { id: 'patrons', label: 'Patrons', icon: 'patrons', make: makePatronsPanel },
      { id: 'thoughts', label: 'Thoughts', icon: 'thought', make: makeThoughtsPanel },
      { id: 'staff', label: 'Staff', icon: 'staff', make: makeStaffPanel },
      { id: 'overlays', label: 'Overlays', icon: 'overlay', make: makeOverlayPanel },
      { id: 'objectives', label: 'Objectives', icon: 'objectives', make: makeObjectivesPanel },
      { id: 'sound', label: 'Sound', icon: 'sound', make: makeSoundPanel },
      { id: 'save', label: 'Save', icon: 'save', make: makeSavePanel },
      { id: 'account', label: 'Account', icon: 'account', make: makeLoginPanel },
      { id: 'leaderboard', label: 'Ranks', icon: 'leaderboard', make: makeLeaderboardPanel },
    ];

    let currentSpeed = 1;
    let resumeSpeed = 1;

    const bar = el('div', 'ui-toolbar bevel-raised');
    uiRoot.appendChild(bar);

    const group = el('div', 'tb-group');
    bar.appendChild(group);
    const buttons = new Map<string, HTMLButtonElement>();
    for (const [i, def] of BUTTONS.entries()) {
      const btn = el('button', 'tb-btn');
      btn.appendChild(icon(def.icon, 'tb-icon'));
      btn.appendChild(el('span', '', def.label));
      // Shortcut discoverability lives in the tooltip: no extra chrome, and the
      // binding is derived from position so it can never drift from the key.
      const key = i < 9 ? String(i + 1) : i === 9 ? '0' : null;
      btn.title = key ? `${def.label} (${key})` : def.label;
      btn.addEventListener('click', () => windows.toggle(def.id, def.make));
      group.appendChild(btn);
      buttons.set(def.id, btn);
    }

    // Keyboard shortcuts. Modern players expect these regardless of art
    // direction, and they cost one handler.
    window.addEventListener('keydown', (e) => {
      // Never steal a key from a field the player is typing into.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape') {
        const top = windows.topWindowId();
        if (top) {
          windows.close(top);
          e.preventDefault();
        }
        return;
      }
      if (e.key === ' ') {
        // Space activates a focused button. Since opening a panel now moves
        // focus into it, claiming the key unconditionally would pause the game
        // every time a keyboard player pressed a panel control.
        if ((document.activeElement as HTMLElement | null)?.closest('button, a, [role="button"]')) {
          return;
        }
        // Toggle, and resume at whatever speed was running before the pause
        // rather than snapping back to 1x.
        eventBus.emit('speedChanged', { speed: currentSpeed === 0 ? resumeSpeed : 0 });
        e.preventDefault();
        return;
      }
      const digit = e.key === '0' ? 10 : Number(e.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= BUTTONS.length) {
        const def = BUTTONS[digit - 1]!;
        windows.toggle(def.id, def.make);
        e.preventDefault();
      }
    });
    windows.onChange((id, open) => buttons.get(id)?.classList.toggle('pressed', open));

    // Game speed: pause / 1× / 3× (render-side tick multiplier).
    const speedGroup = el('div', 'tb-group tb-speed');
    const speedButtons: [number, HTMLButtonElement][] = [];
    for (const [label, value] of [
      ['pause', 0],
      ['1\u00d7', 1],
      ['3\u00d7', 3],
    ] as const) {
      const btn = el('button', 'tb-btn tb-speed-btn');
      // Pause is a glyph; the speeds are numerals and stay type.
      if (label === 'pause') btn.appendChild(icon('pause'));
      else btn.textContent = label;
      btn.title = label === 'pause' ? 'Pause' : `Speed ${label}`;
      btn.addEventListener('click', () => eventBus.emit('speedChanged', { speed: value }));
      speedGroup.appendChild(btn);
      speedButtons.push([value, btn]);
    }
    bar.appendChild(speedGroup);
    const syncSpeed = (speed: number) => {
      currentSpeed = speed;
      if (speed !== 0) resumeSpeed = speed;
      for (const [value, btn] of speedButtons) btn.classList.toggle('pressed', value === speed);
    };
    eventBus.on('speedChanged', ({ speed }) => syncSpeed(speed));
    syncSpeed(1);

    bar.appendChild(el('div', 'tb-spacer'));

    const cash = el('div', 'tb-readout tb-cash bevel-sunken');
    const cashIcon = icon('cash', 'ro-icon');
    const cashValue = el('span', '', formatCash(STARTING_CASH));
    cash.append(cashIcon, cashValue);
    bar.appendChild(cash);

    const clock = el('div', 'tb-readout bevel-sunken');
    const clockIcon = icon('clock', 'ro-icon');
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
    guestsRo.append(icon('guests', 'ro-icon'), el('span', '', '0'));
    bar.appendChild(guestsRo);

    const moodRo = el('div', 'tb-readout bevel-sunken');
    moodRo.title = 'Average guest happiness';
    moodRo.append(icon('mood', 'ro-icon'), el('span', '', '—'));
    bar.appendChild(moodRo);

    // A12: reputation sits beside rating because they are easy to confuse and
    // the difference matters — rating is the floor right now, reputation is
    // what the town remembers. The band label carries the meaning; the raw
    // scalar alone tells the player nothing.
    const repRo = el('div', 'tb-readout bevel-sunken');
    repRo.append(icon('reputation', 'ro-icon'), el('span', '', '—'));
    bar.appendChild(repRo);

    const ratingRo = el('div', 'tb-readout bevel-sunken');
    ratingRo.id = 'tb-rating';
    ratingRo.append(icon('rating', 'ro-icon'), el('span', '', '0/100'));
    ratingRo.classList.add('tb-readout-btn');
    ratingRo.title = 'Casino rating — click for a breakdown';
    ratingRo.addEventListener('click', () => windows.toggle('rating', makeRatingPanel));
    bar.appendChild(ratingRo);

    const syncStats = () => {
      const breakdown = world.ratingBreakdown();
      (guestsRo.lastChild as HTMLElement).textContent = String(world.guests.size);
      (moodRo.lastChild as HTMLElement).textContent = `${Math.round(world.averageHappiness)}%`;
      (ratingRo.lastChild as HTMLElement).textContent = `${breakdown.total}/100`;
      const rep = world.reputation;
      (repRo.lastChild as HTMLElement).textContent = rep.label;
      repRo.title = `Reputation ${Math.round(rep.value)}/100 — shapes who walks in tomorrow`;
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

    // P16: debt is a real state now — interest is charged on it and the bank
    // liquidates the floor past the credit limit. Tracking the *displayed*
    // figure rather than the target keeps the colour and the digits agreeing
    // for the whole interpolation, instead of flipping a frame early.
    const syncNegative = () => cash.classList.toggle('tb-cash--negative', displayedCash < 0);

    const stepTickUp = (now: number) => {
      const t = Math.min(1, (now - animStart) / TICKUP_MS);
      displayedCash = animFrom + (targetCash - animFrom) * easeOutQuad(t);
      cashValue.textContent = formatCash(Math.round(displayedCash));
      syncNegative();
      if (t < 1) {
        rafHandle = requestAnimationFrame(stepTickUp);
      } else {
        displayedCash = targetCash;
        cashValue.textContent = formatCash(targetCash);
        syncNegative();
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
