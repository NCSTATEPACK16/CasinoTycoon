import { eventBus } from '../EventBus';
import { world } from '../gameContext';
import { el } from './dom';
import { icon } from './icons';

/**
 * A5's standing banner: what is true about today, visible without opening
 * anything.
 *
 * A ticker line fires at the midnight draw too, but a ticker scrolls away —
 * and "players ignore the banner" is the documented under-tuned outcome for
 * this feature. A condition that changes how the floor behaves for a whole day
 * has to stay on screen for that day.
 *
 * Hidden entirely on a day with no conditions, so the quiet days read as quiet
 * rather than as an empty widget.
 */
export class ConditionsBanner {
  constructor(uiRoot: HTMLElement) {
    const bar = el('div', 'conditions');
    bar.hidden = true;
    uiRoot.appendChild(bar);

    const render = () => {
      const active = world.modifiers.activeModifiers;
      bar.replaceChildren();
      bar.hidden = active.length === 0;
      for (const m of active) {
        const chip = el('div', 'cond-chip bevel-raised');
        chip.appendChild(icon('modifier', 'cond-icon'));
        chip.appendChild(el('span', 'cond-name', m.name));
        // The blurb is the whole explanation — no panel to open, nothing to
        // hunt for. It is what tells the player what to do differently.
        chip.appendChild(el('span', 'cond-blurb', m.blurb));
        bar.appendChild(chip);
      }
    };

    render();
    eventBus.on('modifiersChanged', render);
    eventBus.on('worldReset', render);
    eventBus.on('worldLoaded', render);
  }
}
