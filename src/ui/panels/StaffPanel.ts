import { STAFF_BALANCE } from '../../data/balance';
import { world } from '../../gameContext';
import type { StaffState } from '../../sim/entities/staff/Staff';
import { el } from '../dom';
import type { PanelSpec } from '../WindowManager';

const REFRESH_MS = 500;

const KIND_META = {
  mechanic: { icon: '🔧', label: 'Mechanic', wage: STAFF_BALANCE.mechanic.wagePerHour },
  janitor: { icon: '🧹', label: 'Janitor', wage: STAFF_BALANCE.janitor.wagePerHour },
} as const;

const STATE_LABEL: Record<StaffState, string> = {
  idle: 'Standing by',
  patrol: 'Patrolling',
  toJob: 'Heading to work',
  working: 'Working',
  carried: 'In your grip',
};

// Live hiring office: hire/fire, payroll totals, and what everyone is up to.
export function makeStaffPanel(): PanelSpec {
  const content = el('div');
  const payroll = el('div', 'p-heading', 'Payroll');
  const summary = el('div');
  const hireRow = el('div', 'p-row');
  const roster = el('div');
  const note = el('div', 'p-note', 'Drag a staffer on the floor to move them (RCT pincer).');

  const hireButtons: HTMLButtonElement[] = [];
  for (const kind of ['mechanic', 'janitor'] as const) {
    const meta = KIND_META[kind];
    const btn = el('button', 'p-tool', `${meta.icon} Hire ($${meta.wage}/hr)`);
    btn.addEventListener('click', () => {
      world.hireStaff(kind);
      render();
    });
    hireButtons.push(btn);
    hireRow.appendChild(btn);
  }

  content.append(payroll, summary, hireRow, roster, note);

  const render = () => {
    const members = [...world.staff.values()];
    const counts = { mechanic: 0, janitor: 0 };
    let hourly = 0;
    for (const m of members) {
      counts[m.kind]++;
      hourly += m.wagePerHour;
    }

    summary.textContent = '';
    for (const kind of ['mechanic', 'janitor'] as const) {
      const meta = KIND_META[kind];
      const r = el('div', 'p-row');
      r.appendChild(el('span', '', `${meta.icon} ${meta.label}s`));
      r.appendChild(el('span', 'val', `${counts[kind]} hired`));
      summary.appendChild(r);
    }
    const wages = el('div', 'p-row');
    wages.appendChild(el('span', '', 'Wages'));
    wages.appendChild(el('span', 'val', `$${hourly}/hr`));
    summary.appendChild(wages);

    roster.textContent = '';
    if (members.length === 0) {
      roster.appendChild(el('div', 'p-note', 'Nobody on staff — machines stay broken!'));
      return;
    }
    for (const m of members) {
      const meta = KIND_META[m.kind];
      const r = el('div', 'p-row g-row');
      r.appendChild(el('span', '', `${meta.icon} ${meta.label} #${m.id.slice(2)}`));
      const right = el('span', 'val');
      right.appendChild(el('span', '', STATE_LABEL[m.state]));
      const fire = el('button', 'win-btn fire-btn', 'Fire');
      fire.title = 'Fire this staffer';
      fire.addEventListener('click', () => {
        world.fireStaff(m.id);
        render();
      });
      right.appendChild(fire);
      r.appendChild(right);
      roster.appendChild(r);
    }
  };

  render();
  const timer = window.setInterval(render, REFRESH_MS);
  return { title: 'Staff', width: 292, content, onClose: () => window.clearInterval(timer) };
}
