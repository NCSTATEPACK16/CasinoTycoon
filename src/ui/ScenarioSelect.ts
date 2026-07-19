import { CAMPAIGNS } from '../data/campaigns';
import { world } from '../gameContext';
import { el, formatCash } from './dom';

// Fullscreen scenario picker: shown at boot and again from the end cards.
// Picking anything resets the world, so the sim idling behind it is harmless.
export function showScenarioSelect(uiRoot: HTMLElement): void {
  if (uiRoot.querySelector('.sc-overlay')) return;
  const overlay = el('div', 'sc-overlay');
  const panel = el('div', 'sc-panel bevel-raised');
  panel.appendChild(el('h1', 'sc-title', '🎰 CASINO TYCOON'));
  panel.appendChild(el('div', 'sc-subtitle', 'Choose a scenario'));

  const cards = el('div', 'sc-cards');
  for (const def of CAMPAIGNS) {
    const card = el('button', 'sc-card bevel-raised');
    card.appendChild(el('div', 'sc-card-name', def.name));
    card.appendChild(el('div', 'sc-card-tagline', def.tagline));
    const stats = el('div', 'sc-card-stats');
    stats.appendChild(el('span', '', `Start ${formatCash(def.startingCash)}`));
    stats.appendChild(el('span', '', `Goal ${formatCash(def.goalDailyProfit)}/day`));
    stats.appendChild(el('span', '', `${def.dayLimit} days`));
    if (def.allowedObjects) stats.appendChild(el('span', 'sc-badge', 'restricted floor'));
    card.appendChild(stats);
    card.addEventListener('click', () => {
      world.startScenario(def);
      overlay.remove();
    });
    cards.appendChild(card);
  }

  const sandbox = el('button', 'sc-card sc-sandbox bevel-raised');
  sandbox.appendChild(el('div', 'sc-card-name', 'Sandbox'));
  sandbox.appendChild(
    el('div', 'sc-card-tagline', 'No goals, no clock pressure. The floor is yours.'),
  );
  sandbox.addEventListener('click', () => {
    world.startScenario(null);
    overlay.remove();
  });
  cards.appendChild(sandbox);

  panel.appendChild(cards);
  overlay.appendChild(panel);
  uiRoot.appendChild(overlay);
}
