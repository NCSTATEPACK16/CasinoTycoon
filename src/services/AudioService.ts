import type Phaser from 'phaser';

// Music/SFX buses over Phaser sound. Volumes persist to localStorage; the
// "music" bus drives a generative casino ambiance (quiet chips/cards/dice
// played on a randomized timer) rather than a looped track — every sound in
// the game comes from the CC0 Kenney packs in public/audio (see ASSETS.md).

export type AudioBus = 'music' | 'sfx';

interface PlayOpts {
  bus?: AudioBus;
  volume?: number;
  /** Random detune range in cents, ± — cheap variation for repeated sfx. */
  detuneJitter?: number;
}

const STORE_KEY = 'casino-audio-v1';

const AMBIANCE_KEYS = [
  'sfx-chips-1',
  'sfx-chips-2',
  'sfx-chips-3',
  'sfx-card-1',
  'sfx-card-2',
  'sfx-shuffle',
  'sfx-dice-1',
  'sfx-dice-2',
  'sfx-coin-2',
];

/** Every audio file preloaded by BootScene, keyed as `audio/<key>.ogg`. */
export const AUDIO_KEYS = [
  ...AMBIANCE_KEYS,
  'sfx-coin-1',
  'sfx-jackpot',
  'sfx-victory',
  'sfx-failure',
  'sfx-break',
  'sfx-fixed',
  'ui-click',
  'ui-open',
  'ui-close',
  'ui-error',
  'ui-place',
  'ui-sell',
  'ui-pluck',
  'ui-drop',
  'ui-hire',
];

class AudioService {
  private scene: Phaser.Scene | null = null;
  private volumes: Record<AudioBus, number> = { music: 0.4, sfx: 0.7 };
  private muted = false;
  private ambianceEvent: Phaser.Time.TimerEvent | null = null;

  /** Called once from WorldScene.create after BootScene loaded the files. */
  init(scene: Phaser.Scene): void {
    this.scene = scene;
    this.restore();
    // Browsers keep WebAudio locked until the first gesture; Phaser emits
    // 'unlocked' then. Start the ambiance either way.
    if (scene.sound.locked) {
      scene.sound.once('unlocked', () => this.startAmbiance());
    } else {
      this.startAmbiance();
    }
  }

  play(key: string, opts: PlayOpts = {}): void {
    const { bus = 'sfx', volume = 1, detuneJitter = 0 } = opts;
    if (!this.scene || this.muted) return;
    const level = volume * this.volumes[bus];
    if (level <= 0.001) return;
    this.scene.sound.play(key, {
      volume: level,
      detune: detuneJitter > 0 ? (Math.random() * 2 - 1) * detuneJitter : 0,
    });
  }

  playRandom(keys: readonly string[], opts: PlayOpts = {}): void {
    const key = keys[Math.floor(Math.random() * keys.length)];
    if (key) this.play(key, opts);
  }

  getVolume(bus: AudioBus): number {
    return this.volumes[bus];
  }

  setVolume(bus: AudioBus, v: number): void {
    this.volumes[bus] = Math.min(1, Math.max(0, v));
    this.persist();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.persist();
  }

  /**
   * Generative ambiance on the music bus: a quiet chip/card/dice sound every
   * 0.9–2.8 s with pitch jitter. Each play reads the live music volume, so
   * the slider takes effect immediately.
   */
  private startAmbiance(): void {
    if (!this.scene || this.ambianceEvent) return;
    const scheduleNext = () => {
      if (!this.scene) return;
      this.ambianceEvent = this.scene.time.delayedCall(900 + Math.random() * 1900, () => {
        this.ambianceEvent = null;
        if (!this.muted) this.playRandom(AMBIANCE_KEYS, { bus: 'music', detuneJitter: 150 });
        scheduleNext();
      });
    };
    scheduleNext();
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { music?: number; sfx?: number; muted?: boolean };
      if (typeof data.music === 'number') this.volumes.music = data.music;
      if (typeof data.sfx === 'number') this.volumes.sfx = data.sfx;
      if (typeof data.muted === 'boolean') this.muted = data.muted;
    } catch {
      // Corrupt store — keep defaults.
    }
  }

  private persist(): void {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ music: this.volumes.music, sfx: this.volumes.sfx, muted: this.muted }),
    );
  }
}

export const audio = new AudioService();
