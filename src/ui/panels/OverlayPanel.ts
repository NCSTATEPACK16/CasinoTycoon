import { eventBus } from '../../EventBus';
import { colorFor, OVERLAYS, type OverlayDef, type OverlayId } from '../../render/overlays';
import { el } from '../dom';
import { icon } from '../icons';
import type { PanelSpec } from '../WindowManager';

/** Swatches across the ramp. Enough to read as a gradient, few enough that
 *  each one is a big-enough target to compare a tile against. */
const SWATCHES = 9;

/**
 * The overlay control: pick a data layer, read its legend, and see the exact
 * value under the cursor.
 *
 * All three parts are required, not optional polish. A heat map with no legend
 * is decoration; and because human color perception cannot reliably rank
 * adjacent intensities, the hover number is what actually makes the map
 * readable — the color only says "look here".
 */
export function makeOverlayPanel(): PanelSpec {
  const content = el('div');
  const choices = el('div', 'ov-choices');
  const legend = el('div');
  const readout = el('div', 'ov-readout bevel-sunken');
  content.append(choices, legend, readout);

  let active: OverlayId = 'none';

  const buttons: { id: OverlayId; btn: HTMLButtonElement }[] = [];
  const addChoice = (id: OverlayId, label: string) => {
    const btn = el('button', 'p-tool', label);
    btn.addEventListener('click', () => {
      active = id;
      eventBus.emit('overlayChanged', { id });
      render();
    });
    choices.appendChild(btn);
    buttons.push({ id, btn });
  };
  addChoice('none', 'Off');
  for (const def of Object.values(OVERLAYS)) addChoice(def.id, def.label);

  const renderLegend = (def: OverlayDef) => {
    legend.textContent = '';
    if (def.isEmpty()) {
      legend.appendChild(el('div', 'p-note', def.emptyNote));
      return;
    }

    const ramp = el('div', 'ov-ramp');
    for (let i = 0; i < SWATCHES; i++) {
      const t = i / (SWATCHES - 1);
      const sw = el('div', 'ov-swatch');
      sw.style.background = `#${colorFor(def.stops, t).toString(16).padStart(6, '0')}`;
      sw.title = def.format(def.min + (def.max - def.min) * t);
      ramp.appendChild(sw);
    }
    legend.appendChild(ramp);

    // Label the named stops rather than every swatch: the ends and the middle
    // are what the player needs to anchor the ramp.
    const labels = el('div', 'ov-labels');
    for (const stop of def.stops) labels.appendChild(el('span', '', stop.label));
    legend.appendChild(labels);

    legend.appendChild(
      el(
        'div',
        'p-note',
        'Tiles with too little data stay clear — an empty corner is not a bad one.',
      ),
    );
  };

  const render = () => {
    for (const { id, btn } of buttons) btn.classList.toggle('pressed', id === active);
    legend.textContent = '';
    readout.textContent = '';
    if (active === 'none') {
      legend.appendChild(el('div', 'p-note', 'Pick a layer to read the floor as data.'));
      readout.hidden = true;
      return;
    }
    readout.hidden = false;
    const def = OVERLAYS[active as Exclude<OverlayId, 'none'>];
    if (!def) return;
    renderLegend(def);
    setReadout(null);
  };

  const setReadout = (text: string | null) => {
    readout.replaceChildren();
    readout.appendChild(icon('rating', 'ov-readout-icon'));
    readout.appendChild(el('span', '', text ?? 'Hover the floor for an exact value'));
  };

  const offHover = eventBus.on('overlayHover', ({ col, row, value }) => {
    if (active === 'none') return;
    setReadout(value === null ? `Tile ${col},${row} — no data` : `Tile ${col},${row} — ${value}`);
  });

  render();

  return {
    title: 'Overlays',
    width: 260,
    content,
    onClose: () => {
      offHover();
      // Leaving the overlay painted with no way to read or dismiss it would
      // strand the player in a recolored casino.
      if (active !== 'none') eventBus.emit('overlayChanged', { id: 'none' });
    },
  };
}
