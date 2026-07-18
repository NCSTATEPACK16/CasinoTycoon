import type { PanelSpec } from '../WindowManager';
import { el, row } from '../dom';

// P2 stub — ScenarioManager and campaign goals arrive in P7.
export function makeObjectivesPanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Sandbox'));
  content.appendChild(row('Goal', 'None yet'));
  const progress = el('div', 'p-progress');
  const fill = el('i');
  fill.style.width = '0%';
  progress.appendChild(fill);
  content.appendChild(progress);
  content.appendChild(
    el('div', 'p-note', 'Campaign scenarios (starting with "The Dusty Dime") arrive in P7.'),
  );
  return { title: 'Objectives', width: 280, content };
}
