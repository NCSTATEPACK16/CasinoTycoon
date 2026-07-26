import { el, formatCash } from '../dom';
import type { PanelSpec } from '../WindowManager';
import type { SlotConflict } from '../../services/reconcile';

// ONE dialog for all conflicting slots, not a modal per slot. Defaults to
// keeping local, because that is the save the player was most recently
// touching on this device.
export function makeConflictDialog(
  conflicts: SlotConflict[],
  resolve: (choices: Record<string, 'local' | 'cloud'>) => void,
): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', 'Which save do you want to keep?'));
  content.appendChild(
    el('div', 'p-note', 'These slots differ between this device and your account.'),
  );

  const choices: Record<string, 'local' | 'cloud'> = {};

  for (const c of conflicts) {
    choices[c.slot] = 'local';
    const block = el('div', 'p-save-row');
    const label = `Slot ${c.slot.slice(-1)}`;
    block.appendChild(el('div', 'p-save-label', label));

    const mk = (side: 'local' | 'cloud') => {
      const snap = side === 'local' ? c.local : c.cloud;
      // `selected`, not `pressed`: .p-tool.pressed is not a style in theme.css.
      const btn = el(
        'button',
        side === 'local' ? 'p-tool selected' : 'p-tool',
        `${side === 'local' ? 'This device' : 'Your account'} — Day ${snap.day} · ${formatCash(snap.cash)}`,
      );
      btn.addEventListener('click', () => {
        choices[c.slot] = side;
        for (const other of block.querySelectorAll('button')) other.classList.remove('selected');
        btn.classList.add('selected');
      });
      return btn;
    };

    const btns = el('div', 'p-save-btns');
    btns.append(mk('local'), mk('cloud'));
    block.appendChild(btns);
    content.appendChild(block);
  }

  const confirm = el('button', 'p-tool', 'Keep these');
  confirm.addEventListener('click', () => resolve(choices));
  content.appendChild(confirm);

  return { title: 'Save conflict', width: 380, content };
}
