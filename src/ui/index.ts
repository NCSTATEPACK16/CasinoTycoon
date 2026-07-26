import './theme.css';
import { eventBus } from '../EventBus';
import { audio } from '../services/AudioService';
import { el, formatCash } from './dom';
import { showScenarioSelect } from './ScenarioSelect';
import { Ticker } from './Ticker';
import { Toolbar } from './Toolbar';
import { WindowManager, type PanelSpec } from './WindowManager';
import { makeFoodStallPanel } from './panels/FoodStallPanel';
import { makeMachineInspector } from './panels/MachineInspector';
import { makeConflictDialog } from './panels/ConflictDialog';
import {
  onAuthChange,
  reconcileForCurrentUser,
  resolveConflictsForCurrentUser,
} from '../services/auth';

// Mounts the DOM UI overlay (toolbar, ticker, window layer) into #ui-root.
// The root stays pointer-events:none; widgets opt back in, so the Phaser
// canvas keeps receiving all other input.
export function initUI(): void {
  const uiRoot = document.getElementById('ui-root');
  if (!uiRoot) throw new Error('#ui-root missing from index.html');
  const windows = new WindowManager(uiRoot);
  new Ticker(uiRoot);
  new Toolbar(uiRoot, windows);
  // Every DOM button click gets a soft tick (capture phase so stopPropagation
  // in a panel handler can't swallow it).
  uiRoot.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement).closest('button')) audio.play('ui-click', { volume: 0.45 });
    },
    true,
  );
  // Closing the Build window drops any active build tool.
  windows.onChange((id, open) => {
    if (id === 'build' && !open) eventBus.emit('buildModeChanged', { mode: 'off' });
  });
  // Clicking a machine in the world opens its inspector.
  eventBus.on('machineClicked', ({ machineId }) => {
    windows.open(`machine-${machineId}`, makeMachineInspector(machineId));
  });
  // Clicking a food stall in the world opens its menu.
  eventBus.on('foodStallClicked', ({ standId }) => {
    windows.open(`food-stall-${standId}`, makeFoodStallPanel(standId));
  });
  // A world reset invalidates any in-flight build tool.
  eventBus.on('worldReset', () => eventBus.emit('buildModeChanged', { mode: 'off' }));

  // Signing in reconciles this device's three manual slots against the
  // account's. Unambiguous slots sync silently; a slot that differs on both
  // sides is the player's call, so it goes to one dialog covering all of them.
  onAuthChange((auth) => {
    if (auth.status !== 'signed-in') return;
    void reconcileForCurrentUser().then((plan) => {
      if (!plan || plan.conflicts.length === 0) return;
      windows.open(
        'save-conflict',
        makeConflictDialog(plan.conflicts, (choices) => {
          windows.close('save-conflict');
          void resolveConflictsForCurrentUser(choices);
        }),
      );
    });
  });

  // Scenario end cards.
  const endCard = (spec: PanelSpec) => {
    windows.close('scenario-end');
    windows.open('scenario-end', spec);
  };
  eventBus.on('goalReached', ({ day, profit }) => {
    endCard(
      makeEndCard(
        uiRoot,
        windows,
        '🎉 Scenario complete!',
        `The books closed day ${day} at ${formatCash(profit)} profit — goal smashed.`,
      ),
    );
  });
  eventBus.on('scenarioFailed', ({ day }) => {
    endCard(
      makeEndCard(
        uiRoot,
        windows,
        '💸 The backers walk',
        `Day ${day} ended without hitting the goal. The keys go back to the bank.`,
      ),
    );
  });

  // Boot straight into the scenario picker.
  showScenarioSelect(uiRoot);

  // The UI is mounted and the picker covers the canvas, so the boot cover has
  // nothing left to hide. It fades via a CSS transition, then stops taking
  // input; it is never removed, so a reload path could show it again.
  document.getElementById('loading')?.classList.add('hidden');
}

function makeEndCard(
  uiRoot: HTMLElement,
  windows: WindowManager,
  heading: string,
  message: string,
): PanelSpec {
  const content = el('div');
  content.appendChild(el('div', 'p-heading', heading));
  content.appendChild(el('div', 'p-note', message));
  const buttons = el('div', 'p-row');
  const keep = el('button', 'p-tool', 'Keep playing');
  keep.addEventListener('click', () => windows.close('scenario-end'));
  const pick = el('button', 'p-tool', 'Scenarios');
  pick.addEventListener('click', () => {
    windows.close('scenario-end');
    showScenarioSelect(uiRoot);
  });
  buttons.append(keep, pick);
  content.appendChild(buttons);
  return { title: 'Scenario', width: 300, content };
}
