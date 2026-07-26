import { el } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { CLOUD_ENABLED } from '../../services/supabase';
import {
  claimDisplayName,
  getAuthState,
  onAuthChange,
  signInWithEmail,
  signOut,
} from '../../services/auth';
import { NAME_ERROR_TEXT, validateDisplayName } from '../../services/nameFilter';

// Three renderings, driven by AuthState.status:
//   signed-out -> email form (magic link)
//   needs-name -> one-time name step (gates leaderboard posting)
//   signed-in  -> who you are + sign out
export function makeLoginPanel(): PanelSpec {
  const content = el('div');

  const render = () => {
    content.textContent = '';

    if (!CLOUD_ENABLED) {
      content.appendChild(el('div', 'p-heading', 'Cloud is off'));
      content.appendChild(
        el('div', 'p-note', 'This build has no Supabase configuration. Saves stay on this device.'),
      );
      return;
    }

    const state = getAuthState();

    if (state.status === 'signed-out') {
      content.appendChild(el('div', 'p-heading', 'Sign in'));
      content.appendChild(
        el('div', 'p-note', 'We email you a one-time link. No password to remember.'),
      );
      const input = el('input', 'p-input');
      input.type = 'email';
      input.placeholder = 'you@example.com';
      content.appendChild(input);
      const status = el('div', 'p-note', '');
      const send = el('button', 'p-tool', 'Send link');
      send.addEventListener('click', () => {
        const email = input.value.trim();
        if (!email.includes('@')) {
          status.textContent = 'Enter a valid email address.';
          return;
        }
        send.setAttribute('disabled', 'true');
        status.textContent = 'Sending…';
        void signInWithEmail(email)
          .then(() => {
            status.textContent = 'Check your inbox for the sign-in link.';
          })
          .catch((e: Error) => {
            status.textContent = `Could not send: ${e.message}`;
            send.removeAttribute('disabled');
          });
      });
      content.appendChild(send);
      content.appendChild(status);
      return;
    }

    if (state.status === 'needs-name') {
      content.appendChild(el('div', 'p-heading', 'Choose your name'));
      content.appendChild(
        el('div', 'p-note', 'This is what the leaderboard shows. 3–16 characters.'),
      );
      const input = el('input', 'p-input');
      input.maxLength = 16;
      input.placeholder = 'Rita';
      content.appendChild(input);
      const status = el('div', 'p-note', '');
      const save = el('button', 'p-tool', 'Claim name');
      save.addEventListener('click', () => {
        const local = validateDisplayName(input.value, []);
        if (local) {
          status.textContent = NAME_ERROR_TEXT[local];
          return;
        }
        save.setAttribute('disabled', 'true');
        status.textContent = 'Checking…';
        void claimDisplayName(input.value).then((result) => {
          if (result === 'ok') return; // onAuthChange re-renders
          save.removeAttribute('disabled');
          status.textContent =
            result === 'taken'
              ? 'That name is taken.'
              : result === 'blocked'
                ? NAME_ERROR_TEXT.blocked
                : 'Something went wrong. Try again.';
        });
      });
      content.appendChild(save);
      content.appendChild(status);
      return;
    }

    content.appendChild(el('div', 'p-heading', `Signed in as ${state.displayName}`));
    content.appendChild(el('div', 'p-note', 'Your three manual save slots sync across devices.'));
    const out = el('button', 'p-tool', 'Sign out');
    out.addEventListener('click', () => void signOut());
    content.appendChild(out);
  };

  render();
  const unsubscribe = onAuthChange(render);
  return { title: 'Account', width: 320, content, onClose: unsubscribe };
}
