import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { el, formatCash, row } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { showScenarioSelect } from '../ScenarioSelect';
import { iconLabel } from '../icons';

const REFRESH_MS = 500;

/** A label/value row whose value can be rewritten without rebuilding it. */
function liveRow(label: string): {
  el: HTMLElement;
  val: HTMLElement;
  set: (value: string) => void;
} {
  const r = row(label, '—');
  const val = r.lastElementChild as HTMLElement;
  return { el: r, val, set: (value) => (val.textContent = value) };
}

// Live campaign progress: goal, best day so far, days remaining, rating, and
// (P16) the goal streak and how much credit is left before the bank starts
// selling the floor.
//
// Built once and updated in place. An earlier version rebuilt the whole list
// every render, which at 2Hz threw away the sandbox branch's "Choose a
// scenario…" button — and any click in flight on it — twice a second.
export function makeObjectivesPanel(): PanelSpec {
  const content = el('div');
  // render() reads world.scenario.status, which only says *that* the run
  // failed. The reason lives on the event, so it is captured here and read
  // back in on the next render.
  let failReason: 'timeUp' | 'insolvent' | null = null;
  const offFailed = eventBus.on('scenarioFailed', (e) => {
    failReason = e.reason;
  });

  // --- Sandbox branch ---
  const sandbox = el('div');
  sandbox.appendChild(el('div', 'p-heading', 'Sandbox'));
  sandbox.appendChild(row('Goal', 'None — free play'));
  const sandboxRating = liveRow('Casino rating');
  sandbox.appendChild(sandboxRating.el);
  const pick = el('button', 'p-tool');
  pick.appendChild(iconLabel('objectives', 'Choose a scenario…'));
  pick.addEventListener('click', () => {
    const uiRoot = document.getElementById('ui-root');
    if (uiRoot) showScenarioSelect(uiRoot);
  });
  sandbox.appendChild(pick);

  // --- Campaign branch ---
  const campaign = el('div');
  const name = el('div', 'p-heading');
  const tagline = el('div', 'p-note');
  const goal = liveRow('Goal');
  const streak = liveRow('3-day average');
  const best = liveRow('Best day');
  const day = liveRow('Day');
  const take = liveRow("Today's take");
  const credit = liveRow('Room to fall');
  const rating = liveRow('Casino rating');
  const progress = el('div', 'p-progress');
  const fill = el('i');
  progress.appendChild(fill);
  const status = el('div', 'p-heading');
  campaign.append(
    name,
    tagline,
    goal.el,
    streak.el,
    best.el,
    day.el,
    take.el,
    credit.el,
    rating.el,
    progress,
    status,
  );
  content.append(sandbox, campaign);

  const render = () => {
    const sm = world.scenario;
    sandbox.hidden = sm !== null;
    campaign.hidden = sm === null;
    if (!sm) {
      sandboxRating.set(`${world.rating}/100`);
      return;
    }

    name.textContent = sm.def.name;
    tagline.textContent = sm.def.tagline;
    goal.set(`${formatCash(sm.def.goalDailyProfit)} daily profit`);
    // P16: a win is sustained and measured as an average, so the running mean
    // is the number the player is actually playing towards. Days counted is
    // shown alongside it, because an average over one day is not yet a claim
    // about anything — the window has to fill before it can win.
    streak.el.firstElementChild!.textContent = `${sm.def.goalWindowDays}-day average`;
    const avg = sm.windowAverage;
    streak.set(
      avg === null
        ? '—'
        : `${formatCash(Math.round(avg))} (${sm.recentProfits.length}/${sm.def.goalWindowDays} days)`,
    );
    best.set(sm.bestDailyProfit === null ? '—' : formatCash(sm.bestDailyProfit));
    day.set(`${Math.min(world.time.day, sm.def.dayLimit)} of ${sm.def.dayLimit}`);
    take.set(formatCash(world.ledger.todayRevenue - world.ledger.todayExpenses));
    // Headroom, not the limit itself: what the player needs to know is how far
    // they can still fall before the bank sells something.
    //
    // This is cash *plus* the credit line, so it is emphatically not "credit
    // remaining" — at $5,000 cash against a $1,000 limit the credit line is
    // untouched and the answer is $6,000. Labelling that "Credit remaining"
    // misreported the one system the campaign layer is built on, so the row is
    // named for the quantity it actually holds. When the house is in the red
    // the two coincide, which is how the old name survived being read.
    const headroom = world.creditLimit + world.state.cash;
    credit.set(formatCash(headroom));
    // Reuses the panel's existing loss colour rather than inventing one.
    credit.val.classList.toggle('down', world.state.cash < 0);
    rating.set(`${world.rating}/100`);

    // Tracks the average rather than the best day: the bar should show progress
    // towards the thing that actually wins the run.
    const frac = avg === null ? 0 : avg / sm.def.goalDailyProfit;
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;

    status.hidden = sm.status === 'active';
    if (sm.status === 'active') return;
    status.textContent = '';
    status.appendChild(
      sm.status === 'won'
        ? iconLabel('celebrate', 'Scenario complete!')
        : iconLabel(
            'fail',
            failReason === 'insolvent'
              ? 'Scenario failed — insolvent'
              : 'Scenario failed — out of time',
          ),
    );
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return {
    title: 'Objectives',
    width: 292,
    content,
    onClose: () => {
      window.clearInterval(timer);
      offFailed();
    },
  };
}
