import { getObjectDef } from '../../data/objects';
import { world } from '../../gameContext';
import { el } from '../dom';
import type { PanelSpec } from '../WindowManager';

const money = (n: number) => `$${n.toFixed(2)}`;

// Per-stall window: itemized menu with a profit-margin readout, a price
// spinner, and an enable/disable toggle per item.
export function makeFoodStallPanel(standId: string): PanelSpec {
  const content = el('div');
  const po = world.state.getObject(standId);
  const defName = po ? (getObjectDef(po.defId)?.name ?? po.defId) : 'Food Stall';

  content.appendChild(el('div', 'p-heading', 'Menu'));

  const stall = () => world.foodStalls.get(standId);

  const render = () => {
    const s = stall();
    // Rebuild the item rows each render — the list is tiny and this keeps
    // input/checkbox state trivially in sync with the sim.
    content.querySelectorAll('.food-item').forEach((n) => n.remove());
    if (!s) {
      content.appendChild(el('div', 'p-note', 'This stall has been sold.'));
      return;
    }
    for (const item of s.items) {
      const row = el('div', 'food-item p-row');

      const info = el('div', 'food-item-info');
      info.appendChild(el('span', '', item.name));
      const margin = el('span', 'val', `margin ${money(item.currentPrice - item.baseCost)}`);
      info.appendChild(margin);
      row.appendChild(info);

      const controls = el('div', 'food-item-controls');
      const price = document.createElement('input');
      price.type = 'number';
      price.step = '0.25';
      price.min = String(item.baseCost * 0.5);
      price.max = String(item.baseCost * 6);
      price.value = item.currentPrice.toFixed(2);
      price.addEventListener('change', () => {
        const v = parseFloat(price.value);
        if (!Number.isNaN(v)) s.setPrice(item.id, v);
        render();
      });
      controls.appendChild(price);

      const toggleLabel = el('label', 'food-item-toggle');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.isUnlocked;
      checkbox.addEventListener('change', () => {
        s.toggle(item.id);
        render();
      });
      toggleLabel.appendChild(checkbox);
      toggleLabel.appendChild(document.createTextNode(' on sale'));
      controls.appendChild(toggleLabel);

      row.appendChild(controls);
      content.appendChild(row);
    }
  };

  render();

  return {
    title: `${defName} ${standId.replace('obj-', '#')}`,
    width: 260,
    content,
  };
}
