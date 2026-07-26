import { describe, expect, it } from 'vitest';
import { reduceAuthState } from './auth';

describe('reduceAuthState', () => {
  it('is signed-out with no session', () => {
    expect(reduceAuthState(null, null)).toEqual({
      status: 'signed-out',
      userId: null,
      displayName: null,
    });
  });

  it('needs a name when a session exists but no profile does', () => {
    expect(reduceAuthState('user-1', null)).toEqual({
      status: 'needs-name',
      userId: 'user-1',
      displayName: null,
    });
  });

  it('is signed-in once both exist', () => {
    expect(reduceAuthState('user-1', 'Rita')).toEqual({
      status: 'signed-in',
      userId: 'user-1',
      displayName: 'Rita',
    });
  });
});
