// B15f: "best on a computer". Below ~900 px wide, or on a device with only a
// touch screen, the game says it is built for a mouse and a wide screen. The
// player can still look around: the notice closes for the session and does
// not come back on a resize.

import './PhoneNotice.css';
import { button, el } from './dom';

/** Narrower than this, the dock and the windows can't fit. */
export const PHONE_WIDTH = 900;
const DISMISSED_KEY = 'v2-phone-notice-dismissed';

/** Whether to show the notice for a viewport this wide, on a device whose
 *  only pointer is coarse (a touch screen with no mouse or trackpad). */
export function wantsPhoneNotice(width: number, touchOnly: boolean): boolean {
  return width < PHONE_WIDTH || touchOnly;
}

function touchOnly(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  } catch {
    return false;
  }
}

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export class PhoneNotice {
  readonly root = el('div', 'phone-notice');
  private dismissed: boolean;

  constructor() {
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'phone-notice-title');
    const panel = el('div', 'phone-panel');
    panel.append(
      el('h3', '', 'Best on a computer'),
      el(
        'p',
        '',
        'Casino Tycoon is built for a mouse and a screen at least 1280 pixels wide. You can look around here, but building and managing need a desktop browser.',
      ),
      button('Look around anyway', () => this.dismiss(), 'primary'),
    );
    panel.querySelector('h3')!.id = 'phone-notice-title';
    this.root.append(panel);
    try {
      this.dismissed = session()?.getItem(DISMISSED_KEY) === '1';
    } catch {
      this.dismissed = false;
    }
    window.addEventListener('resize', () => this.check());
    this.check();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  check(): void {
    this.root.hidden = this.dismissed || !wantsPhoneNotice(window.innerWidth, touchOnly());
  }

  dismiss(): void {
    this.dismissed = true;
    try {
      session()?.setItem(DISMISSED_KEY, '1');
    } catch {
      // Closed for this page only.
    }
    this.root.hidden = true;
  }
}
