import type { PanelSpec } from '../WindowManager';
import { el, row } from '../dom';

// P2 stub — hiring, wages and staff AI arrive in P6.
export function makeStaffPanel(): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Payroll'));
  content.appendChild(row('🔧 Mechanics', '0 hired'));
  content.appendChild(row('🧹 Janitors', '0 hired'));
  content.appendChild(row('Daily wages', '$0'));
  content.appendChild(
    el(
      'div',
      'p-note',
      'The hiring office opens in P6 — mechanics fix machines, janitors fight mess.',
    ),
  );
  return { title: 'Staff', width: 264, content };
}
