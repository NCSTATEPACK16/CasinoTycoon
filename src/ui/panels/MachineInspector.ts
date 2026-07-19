import { getObjectDef } from '../../data/objects';
import { world } from '../../gameContext';
import { Rng } from '../../sim/rng';
import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';

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

  const freePlay = el('button', 'p-tool', '🎲 Free Play (test spin)');
  const freeResult = el('div', 'p-note', 'Spin the RNG without spending a dime.');

  content.append(status, relRow, profitRow, costRow, freePlay, freeResult);

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
  };

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
    freeResult.textContent =
      payout > 0 ? `🎉 WIN — would pay ${formatCash(payout)}!` : 'No win. The house smiles.';
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
