import { describe, expect, it } from 'vitest';
import { PHONE_WIDTH, wantsPhoneNotice } from './PhoneNotice';

describe('phone notice', () => {
  it('shows below the desktop width', () => {
    expect(wantsPhoneNotice(390, false)).toBe(true);
    expect(wantsPhoneNotice(PHONE_WIDTH - 1, false)).toBe(true);
  });

  it('stays away on a desktop-sized window with a mouse', () => {
    expect(wantsPhoneNotice(PHONE_WIDTH, false)).toBe(false);
    expect(wantsPhoneNotice(1280, false)).toBe(false);
  });

  it('shows on a touch-only device even when it is wide (a tablet)', () => {
    expect(wantsPhoneNotice(1366, true)).toBe(true);
  });
});
