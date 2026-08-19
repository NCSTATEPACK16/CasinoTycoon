import { TABLE_MINIMUMS } from '../../data/balance';
import { getObjectDef } from '../../data/objects';
import { world } from '../../gameContext';
import { Rng } from '../../sim/rng';
import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { iconLabel } from '../icons';

const REFRESH_MS = 500;
const MIN_COST = 1;
const MAX_COST = 50;

// Per-machine window: reliability, lifetime P&L, cost-to-play tuning, Free Play.
export function makeMachineInspector(machineId: string): PanelSpec {
  const content = el('div');
  const freePlayRng = new Rng(Date.now() >>> 0);
  const po = world.state.getObject(machineId);
  const defName = po ? (getObjectDef(po.defId)?.name ?? po.defId) : 'Machine';

  const status = el('div', 'p-heading', 'Condition');
  const relRow = el('div', 'p-row');
  relRow.appendChild(el('span', '', 'Reliability'));
  const relBar = el('div', 'p-bar');
  const relFill = el('i');
  relBar.appendChild(relFill);
  relRow.appendChild(relBar);

  const profitRow = el('div', 'p-row');
  profitRow.appendChild(el('span', '', 'Lifetime profit'));
  const profitVal = el('span', 'val', '$0');
  profitRow.appendChild(profitVal);

  const costRow = el('div', 'p-row');
  costRow.appendChild(el('span', '', 'Cost to play'));
  const costControls = el('span', 'cost-controls');
  const minus = el('button', 'win-btn', '−');
  const costVal = el('span', 'val', '');
  const plus = el('button', 'win-btn', '+');
  costControls.append(minus, costVal, plus);
  costRow.appendChild(costControls);

  // A2: a table's wager is derived from its minimum, so the raw cost stepper
  // would immediately desync the two. Tables get the tier dial instead, and
  // the consequences of moving it are spelled out rather than left to be
  // discovered — the trade is the decision.
  const minRow = el('div', 'p-row');
  minRow.appendChild(el('span', '', 'Table minimum'));
  const minControls = el('span', 'cost-controls');
  const minDown = el('button', 'win-btn', '−');
  const minVal = el('span', 'val', '');
  const minUp = el('button', 'win-btn', '+');
  minControls.append(minDown, minVal, minUp);
  minRow.appendChild(minControls);
  const minNote = el('div', 'p-note');

  const freePlay = el('button', 'p-tool');
  freePlay.appendChild(iconLabel('freePlay', 'Free Play (test spin)'));
  const freeResult = el('div', 'p-note', 'Spin the RNG without spending a dime.');

  content.append(status, relRow, profitRow, costRow, minRow, minNote, freePlay, freeResult);

  const machine = () => world.machines.get(machineId);

  const render = () => {
    const m = machine();
    if (!m) {
      relFill.style.width = '0%';
      freeResult.textContent = 'This machine has been sold.';
      return;
    }
    relFill.style.width = `${Math.round(m.reliability)}%`;
    relBar.className = `p-bar${m.reliability < 25 ? ' low' : ''}`;
    if (m.broken) status.textContent = 'Condition — BROKEN DOWN';
    else status.textContent = 'Condition';
    profitVal.textContent = formatCash(m.lifetimeProfit);
    costVal.textContent = formatCash(m.costToPlay);

    const min = m.tableMinimum;
    const isTable = m.supportsMinimum && min !== null;
    // A fixed-denomination game keeps the raw cost stepper; a table hides it,
    // because there the wager is an output of the dial, not an input.
    costRow.hidden = isTable;
    minRow.hidden = !isTable;
    minNote.hidden = !isTable;
    if (!isTable) return;

    const tiers = TABLE_MINIMUMS.tiers;
    const idx = tiers.indexOf(min);
    minVal.textContent = formatCash(min);
    minDown.disabled = idx <= 0;
    minUp.disabled = idx >= tiers.length - 1;
    const gate = Math.round(m.minWallet);
    minNote.textContent =
      gate > 0
        ? `Bets ${formatCash(m.costToPlay)} a hand. Guests need ${formatCash(gate)} on them to sit — fewer players, more per seat.`
        : `Bets ${formatCash(m.costToPlay)} a hand. Anyone who can cover a hand may sit.`;
  };

  const stepMinimum = (delta: number) => {
    const m = machine();
    if (!m || m.tableMinimum === null) return;
    const tiers = TABLE_MINIMUMS.tiers;
    const next = tiers[tiers.indexOf(m.tableMinimum) + delta];
    if (next !== undefined) m.setTableMinimum(next);
    render();
  };
  minDown.addEventListener('click', () => stepMinimum(-1));
  minUp.addEventListener('click', () => stepMinimum(1));

  minus.addEventListener('click', () => {
    const m = machine();
    if (m) m.costToPlay = Math.max(MIN_COST, m.costToPlay - 1);
    render();
  });
  plus.addEventListener('click', () => {
    const m = machine();
    if (m) m.costToPlay = Math.min(MAX_COST, m.costToPlay + 1);
    render();
  });
  freePlay.addEventListener('click', () => {
    const m = machine();
    if (!m) return;
    const payout = m.testSpin(freePlayRng);
    if (payout > 0) {
      freeResult.replaceChildren(iconLabel('celebrate', `WIN — would pay ${formatCash(payout)}!`));
    } else {
      freeResult.textContent = 'No win. The house smiles.';
    }
  });

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return {
    title: `${defName} ${machineId.replace('obj-', '#')}`,
    width: 280,
    content,
    onClose: () => window.clearInterval(timer),
  };
}
