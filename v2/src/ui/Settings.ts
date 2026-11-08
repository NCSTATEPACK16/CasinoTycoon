// Settings: volumes per bus, mute, the graphics tier and (B15b) the UI scale.
// The gear lives in the HUD's #hud-slot-a, or in the top region when there is
// no slot. B15f: the settings are a window (Sound, Graphics, Interface tabs)
// that the window manager places, drags and pins like the others. Volumes
// persist through the audio engine; the tier and the UI scale persist here.
// The graphics row is a placeholder for Track A's A8 (Auto/High/Low, Auto
// starting at stage.suggestedQuality()), which lands through origin/v2.1.

import './Settings.css';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Bus } from '../audio/mix';
import type { Quality } from '../render/Post';
import type { Stage } from '../render/Stage';
import { button, el } from './dom';
import { regionIn } from './shell/Shell';
import type { WindowManager } from './windows/WindowManager';
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  UI_SCALE_STEP,
  applyUiScale,
  loadUiScale,
  saveUiScale,
} from './shell/uiScale';

export type QualityChoice = 'auto' | Quality;
export const QUALITY_KEY = 'v2-graphics-quality';
const CHOICES: { value: QualityChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export function loadQualityChoice(storage: Pick<Storage, 'getItem'> | null): QualityChoice {
  try {
    const v = storage?.getItem(QUALITY_KEY);
    if (CHOICES.some((c) => c.value === v)) return v as QualityChoice;
  } catch {
    // Storage blocked: fall through to Auto.
  }
  return 'auto';
}

export function saveQualityChoice(
  storage: Pick<Storage, 'setItem'> | null,
  q: QualityChoice,
): void {
  try {
    storage?.setItem(QUALITY_KEY, q);
  } catch {
    // Applies for this session only.
  }
}

/** Auto starts at High and sheds tiers when frames run long; a fixed tier stays put. */
export function applyQuality(
  stage: Pick<Stage, 'setQuality' | 'dynamicResolution'>,
  q: QualityChoice,
): void {
  stage.dynamicResolution = q === 'auto';
  stage.setQuality(q === 'auto' ? 'high' : q);
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const VOLUMES: { key: 'master' | Bus; label: string }[] = [
  { key: 'master', label: 'Master' },
  { key: 'sfx', label: 'Effects' },
  { key: 'ambience', label: 'Ambience' },
  { key: 'ui', label: 'Interface' },
];

export class Settings {
  /** The window's content. */
  readonly root = el('div', 'settings-panel');
  private wm: WindowManager | null = null;
  private panes = new Map<string, HTMLElement>();
  readonly gear = button('⚙', () => this.toggle(), 'settings-gear');
  private quality: QualityChoice;
  private uiScale: number;
  private tierNote = el('span', 'dim small');
  private timer = 0;

  constructor(
    private audio: AudioEngine,
    private stage: Stage,
  ) {
    this.gear.title = 'Settings';
    this.quality = loadQualityChoice(storage());
    applyQuality(this.stage, this.quality);
    this.uiScale = loadUiScale(storage());
    applyUiScale(document.documentElement, this.uiScale);
    this.build();
  }

  /** The gear into the HUD's slot (or the top region); the window through `wm`. */
  mount(ui: HTMLElement, wm: WindowManager): void {
    const slot = ui.querySelector<HTMLElement>('#hud-slot-a');
    (slot ?? regionIn(ui, 'top')).append(this.gear);
    this.wm = wm;
  }

  get isOpen(): boolean {
    return !!this.wm?.get('settings')?.isOpen;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.wm?.show({
      key: 'settings',
      title: 'Settings',
      width: '20rem',
      tabs: [
        { id: 'sound', label: 'Sound' },
        { id: 'graphics', label: 'Graphics' },
        { id: 'interface', label: 'Interface' },
      ],
      onTab: (id) => {
        for (const [k, p] of this.panes) p.hidden = k !== id;
      },
      content: this.root,
      onOpen: () => {
        this.refreshTier();
        window.clearInterval(this.timer);
        this.timer = window.setInterval(() => this.refreshTier(), 1000);
      },
      onClose: () => window.clearInterval(this.timer),
    });
  }

  close(): void {
    this.wm?.get('settings')?.close();
  }

  private build(): void {
    const sound = el('div', 'st-group');
    sound.append(el('h4', '', 'Volume'));
    for (const v of VOLUMES) {
      const row = el('label', 'st-row');
      const range = el('input');
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = String(Math.round(this.audio.settings[v.key] * 100));
      range.dataset.bus = v.key;
      range.setAttribute('aria-label', `${v.label} volume`);
      const val = el('span', 'st-val', `${range.value}%`);
      range.oninput = () => {
        val.textContent = `${range.value}%`;
        this.audio.setSettings({ [v.key]: Number(range.value) / 100 });
      };
      row.append(el('span', '', v.label), range, val);
      sound.append(row);
    }
    const mute = el('input');
    mute.type = 'checkbox';
    mute.checked = this.audio.settings.muted;
    mute.onchange = () => this.audio.setSettings({ muted: mute.checked });
    const muteRow = el('label', 'st-row st-mute');
    muteRow.append(mute, el('span', '', 'Mute all sound'));
    sound.append(muteRow);
    const music = el('input');
    music.type = 'checkbox';
    music.checked = this.audio.settings.music;
    music.onchange = () => this.audio.setSettings({ music: music.checked });
    const musicRow = el('label', 'st-row st-mute');
    musicRow.append(music, el('span', '', 'Lounge music'));
    sound.append(musicRow);

    const gfx = el('div', 'st-group');
    gfx.append(el('h4', '', 'Quality'));
    const sel = el('select');
    sel.setAttribute('aria-label', 'Graphics quality');
    for (const c of CHOICES) {
      const o = el('option', '', c.label);
      o.value = c.value;
      sel.append(o);
    }
    sel.value = this.quality;
    sel.onchange = () => {
      this.quality = sel.value as QualityChoice;
      saveQualityChoice(storage(), this.quality);
      applyQuality(this.stage, this.quality);
      this.refreshTier();
    };
    const qRow = el('label', 'st-row');
    qRow.append(el('span', '', 'Quality'), sel, this.tierNote);
    gfx.append(qRow);

    const display = el('div', 'st-group');
    display.append(el('h4', '', 'Size'));
    const scale = el('input');
    scale.type = 'range';
    scale.min = String(UI_SCALE_MIN * 100);
    scale.max = String(UI_SCALE_MAX * 100);
    scale.step = String(UI_SCALE_STEP * 100);
    scale.value = String(Math.round(this.uiScale * 100));
    scale.setAttribute('aria-label', 'UI scale');
    const scaleVal = el('span', 'st-val', `${scale.value}%`);
    // Live while dragging; saved when the drag ends.
    scale.oninput = () => {
      this.uiScale = Number(scale.value) / 100;
      scaleVal.textContent = `${scale.value}%`;
      applyUiScale(document.documentElement, this.uiScale);
    };
    scale.onchange = () => saveUiScale(storage(), this.uiScale);
    const sRow = el('label', 'st-row');
    sRow.append(el('span', '', 'UI scale'), scale, scaleVal);
    display.append(
      sRow,
      el('p', 'dim small', 'Scales every panel, window and the dock. 100% suits a 1440 px screen.'),
    );
    this.panes.set('sound', sound);
    this.panes.set('graphics', gfx);
    this.panes.set('interface', display);
    gfx.hidden = display.hidden = true;
    this.root.append(sound, gfx, display);
  }

  private refreshTier(): void {
    const t = this.stage.getQuality();
    this.tierNote.textContent = this.quality === 'auto' ? `now ${t}` : '';
  }
}
