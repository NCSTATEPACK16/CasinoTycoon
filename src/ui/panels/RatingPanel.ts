import { DEALER_BALANCE, RATING_BALANCE, SECURITY_BALANCE } from '../../data/balance';
import { world } from '../../gameContext';
import { el, row } from '../dom';
import type { PanelSpec } from '../WindowManager';

const REFRESH_MS = 500;

const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n * 10) / 10}`;

// Casino rating, term by term. The bare number in ObjectivesPanel tells the
// player nothing about which of the nine contributors is holding them back.
export function makeRatingPanel(): PanelSpec {
  const content = el('div');

  const render = () => {
    content.textContent = '';
    const b = world.ratingBreakdown();

    content.appendChild(el('div', 'p-heading', `Casino rating: ${b.total}/100`));
    content.appendChild(el('div', 'p-note', 'Rating drives how many new guests hear about you.'));

    const term = (label: string, value: number, cap?: number) => {
      const atCap = cap !== undefined && Math.round(value * 10) / 10 >= cap;
      content.appendChild(row(label, atCap ? `${signed(value)} (max)` : signed(value)));
    };

    term('Guest happiness', b.happiness);
    term('Games on the floor', b.machines, RATING_BALANCE.machineCap);
    term('Game variety', b.variety, RATING_BALANCE.varietyBonus);
    term('Cleanliness', b.cleanliness, RATING_BALANCE.cleanlinessMax);
    term('Broken machines', b.broken);
    term('Signage', b.signage, RATING_BALANCE.signageBonusCap);
    term('Security presence', b.security, SECURITY_BALANCE.bonusCap);
    term('Dealers', b.dealers, DEALER_BALANCE.dealerBonusCap);
    term('Rage quits', b.rage);

    // The nine terms are clamped to 0..100 to reach the total, so say so when
    // the clamp is what the player is actually looking at.
    const raw =
      b.happiness +
      b.machines +
      b.variety +
      b.cleanliness +
      b.broken +
      b.signage +
      b.security +
      b.dealers +
      b.rage;
    if (Math.round(raw) !== b.total) {
      content.appendChild(
        el('div', 'p-note', `Terms sum to ${signed(raw)}, clamped to ${b.total}/100.`),
      );
    }
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);

  return {
    title: 'Casino Rating',
    width: 300,
    content,
    onClose: () => window.clearInterval(timer),
  };
}
