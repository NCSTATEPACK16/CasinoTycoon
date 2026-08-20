import { eventBus } from '../../EventBus';
import { world } from '../../gameContext';
import { el, formatCash, row } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { showScenarioSelect } from '../ScenarioSelect';
import { iconLabel } from '../icons';

const REFRESH_MS = 500;

// Live campaign progress: goal, best day so far, days remaining, rating.
export function makeObjectivesPanel(): PanelSpec {
  const content = el('div');
  // render() rebuilds from world.scenario.status alone, which only says
  // *that* the run failed. The reason lives on the event, so it is captured
  // here and read back in on the next render.
  let failReason: 'timeUp' | 'insolvent' | null = null;
  const offFailed = eventBus.on('scenarioFailed', (e) => {
    failReason = e.reason;
  });

  const render = () => {
    content.textContent = '';
    const sm = world.scenario;
    if (!sm) {
      content.appendChild(el('div', 'p-heading', 'Sandbox'));
      content.appendChild(row('Goal', 'None — free play'));
      content.appendChild(row('Casino rating', `${world.rating}/100`));
      const pick = el('button', 'p-tool');
      pick.appendChild(iconLabel('objectives', 'Choose a scenario\u2026'));
      pick.addEventListener('click', () => {
        const uiRoot = document.getElementById('ui-root');
        if (uiRoot) showScenarioSelect(uiRoot);
      });
      content.appendChild(pick);
      return;
    }

    content.appendChild(el('div', 'p-heading', sm.def.name));
    content.appendChild(el('div', 'p-note', sm.def.tagline));
    content.appendChild(row('Goal', `${formatCash(sm.def.goalDailyProfit)} daily profit`));
    content.appendChild(
      row('Best day', sm.bestDailyProfit === null ? '—' : formatCash(sm.bestDailyProfit)),
    );
    content.appendChild(
      row('Day', `${Math.min(world.time.day, sm.def.dayLimit)} of ${sm.def.dayLimit}`),
    );
    content.appendChild(
      row("Today's take", formatCash(world.ledger.todayRevenue - world.ledger.todayExpenses)),
    );
    content.appendChild(row('Casino rating', `${world.rating}/100`));

    const progress = el('div', 'p-progress');
    const fill = el('i');
    const frac = sm.bestDailyProfit === null ? 0 : sm.bestDailyProfit / sm.def.goalDailyProfit;
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
    progress.appendChild(fill);
    content.appendChild(progress);

    if (sm.status === 'won') {
      const won = el('div', 'p-heading');
      won.appendChild(iconLabel('celebrate', 'Scenario complete!'));
      content.appendChild(won);
    } else if (sm.status === 'failed') {
      const lost = el('div', 'p-heading');
      lost.appendChild(
        iconLabel(
          'fail',
          failReason === 'insolvent' ? 'Scenario failed — insolvent' : 'Scenario failed — out of time',
        ),
      );
      content.appendChild(lost);
    }
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
