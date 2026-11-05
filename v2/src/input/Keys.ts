// Held-key tracking by physical key (KeyboardEvent.code), so WASD works on
// any layout. Keystrokes aimed at a text field never count as game input.

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

export class Keys {
  private down = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!isTyping(e)) this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    // A key released while the tab is hidden never fires keyup; don't leave it stuck.
    window.addEventListener('blur', () => this.down.clear());
  }

  has(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** -1, 0 or 1 from a pair of opposing key sets. */
  axis(neg: string[], pos: string[]): number {
    return (this.has(...pos) ? 1 : 0) - (this.has(...neg) ? 1 : 0);
  }

  get shift(): boolean {
    return this.has('ShiftLeft', 'ShiftRight');
  }
}

export const KEYS_FORWARD = ['KeyW', 'ArrowUp'];
export const KEYS_BACK = ['KeyS', 'ArrowDown'];
export const KEYS_LEFT = ['KeyA', 'ArrowLeft'];
export const KEYS_RIGHT = ['KeyD', 'ArrowRight'];
