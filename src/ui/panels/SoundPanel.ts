import { audio, type AudioBus } from '../../services/AudioService';
import { el } from '../dom';
import type { PanelSpec } from '../WindowManager';
import { iconLabel, type IconName } from '../icons';

// Volume settings: music (generative ambiance) and sfx sliders + master mute.
// Values persist via AudioService (localStorage).
export function makeSoundPanel(): PanelSpec {
  const content = el('div');

  const slider = (label: string, bus: AudioBus, glyph: IconName): HTMLElement => {
    const row = el('div', 'p-row');
    row.appendChild(iconLabel(glyph, label));
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(Math.round(audio.getVolume(bus) * 100));
    input.className = 'p-slider';
    input.setAttribute('aria-label', `${label} volume`);
    input.addEventListener('input', () => {
      audio.setVolume(bus, Number(input.value) / 100);
      if (bus === 'sfx') audio.play('ui-click', { volume: 0.6 });
    });
    row.appendChild(input);
    return row;
  };

  content.appendChild(slider('Music', 'music', 'music'));
  content.appendChild(slider('Effects', 'sfx', 'effects'));

  const muteRow = el('label', 'p-row p-mute');
  const mute = document.createElement('input');
  mute.type = 'checkbox';
  mute.checked = audio.isMuted();
  mute.addEventListener('change', () => audio.setMuted(mute.checked));
  muteRow.append(iconLabel('mute', 'Mute all'), mute);
  content.appendChild(muteRow);

  content.appendChild(el('div', 'p-note', 'Sounds: Kenney.nl packs (CC0).'));
  return { title: 'Sound', width: 230, content };
}
