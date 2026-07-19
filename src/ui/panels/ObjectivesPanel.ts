import { world } from '../../gameContext';
import { el, formatCash, row } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { showScenarioSelect } from '../ScenarioSelect';

const REFRESH_MS = 500;

// Live campaign progress: goal, best day so far, days remaining, rating.
export function makeObjectivesPanel(): PanelSpec {
  const content = el('div');

  const render = () => {
    content.textContent = '';
    const sm = world.scenario;
    if (!sm) {
      content.appendChild(el('div', 'p-heading', 'Sandbox'));
      content.appendChild(row('Goal', 'None — free play'));
      content.appendChild(row('Casino rating', `${world.rating}/100`));
      const pick = el('button', 'p-tool', '🎯 Choose a scenario…');
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
      content.appendChild(el('div', 'p-heading', '🎉 Scenario complete!'));
    } else if (sm.status === 'failed') {
      content.appendChild(el('div', 'p-heading', '💸 Scenario failed'));
    }
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return { title: 'Objectives', width: 292, content, onClose: () => window.clearInterval(timer) };
}
