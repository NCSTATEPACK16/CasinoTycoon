// The `?` overlay: every keyboard and mouse control on one card. The list is
// written out here rather than gathered from the handlers, which live in
// several modules; keep it in step when a binding changes.

import { button, el } from '../dom';

const SECTIONS: [string, [string, string][]][] = [
  [
    'Camera',
    [
      [
        '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows',
        'Pan (or push the screen edge, or middle-drag)',
      ],
      ['<kbd>Q</kbd> <kbd>E</kbd>', 'Tap to turn 90°, hold to spin'],
      ['Right-drag', 'Orbit and tilt'],
      ['Wheel', 'Zoom toward the cursor'],
      ['Double-click', 'Focus on a spot'],
      ['<kbd>V</kbd> / <kbd>Tab</kbd>', 'God view → third person → first person'],
      ['<kbd>Esc</kbd>', 'Back to the god view'],
    ],
  ],
  [
    'Building',
    [
      ['Click', 'Place the picked item, or inspect what you click'],
      ['<kbd>Shift</kbd> + click', 'Keep placing; Shift-drag lays a row'],
      ['<kbd>R</kbd>', 'Rotate (<kbd>Shift</kbd>+<kbd>R</kbd> the other way)'],
      ['<kbd>X</kbd>', 'Bulldoze'],
      ['<kbd>Esc</kbd> / right-click', 'Put the tool down'],
      ['<kbd>Z</kbd>', 'Show zones'],
    ],
  ],
  [
    'Running the casino',
    [
      ['<kbd>Space</kbd>', 'Pause and resume'],
      ['<kbd>P</kbd>', 'Finances'],
      ['<kbd>H</kbd>', 'Staff'],
      ['News', 'Click a line to see where it happened'],
      ['<kbd>?</kbd>', 'This help'],
    ],
  ],
  [
    'On foot',
    [
      ['<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>', 'Walk; hold <kbd>Shift</kbd> to run'],
      ['<kbd>E</kbd>', 'Inspect what you face'],
      ['<kbd>F</kbd>', 'Sit down to play, or stand up'],
    ],
  ],
];

export class HelpOverlay {
  readonly root = el('div', 'help-overlay');

  constructor() {
    const card = el('div', 'help-card');
    const head = el('div', 'help-head', '<h3>Controls</h3>');
    head.append(button('✕', () => this.close(), 'small'));
    card.append(head);
    const grid = el('div', 'help-grid');
    for (const [title, rows] of SECTIONS) {
      const sec = el('section', '', `<h4>${title}</h4>`);
      const dl = el('dl');
      for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
      sec.append(dl);
      grid.append(sec);
    }
    card.append(grid);
    this.root.append(card);
    this.root.hidden = true;
    // A click on the dimmed backdrop closes; one on the card doesn't.
    this.root.onclick = (e) => {
      if (e.target === this.root) this.close();
    };
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(open = !this.isOpen): void {
    this.root.hidden = !open;
  }

  close(): void {
    this.toggle(false);
  }
}
