// Pure mixing maths for the audio engine: bus gains from the player's
// settings, settings persistence, distance attenuation and where the
// listener sits relative to the camera. No WebAudio here, so it all tests in node.

export type Bus = 'sfx' | 'ambience' | 'ui';
export const BUSES: readonly Bus[] = ['sfx', 'ambience', 'ui'];

/** Slider positions, 0..1, as the Settings panel shows them. */
export interface AudioSettings {
  master: number;
  sfx: number;
  ambience: number;
  ui: number;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Readonly<AudioSettings> = {
  master: 0.8,
  sfx: 0.8,
  ambience: 0.6,
  ui: 0.6,
  muted: false,
};

export const SETTINGS_KEY = 'v2-audio-settings';

/** Slider → linear gain. Squared, so the slider's travel feels even to the ear. */
export function sliderGain(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c * c;
}

/** Gain on the master node: zero when muted. */
export function masterGain(s: AudioSettings): number {
  return s.muted ? 0 : sliderGain(s.master);
}

/** Gain on one bus node, which feeds master. */
export function busGain(s: AudioSettings, bus: Bus): number {
  return sliderGain(s[bus]);
}

/** What actually reaches the speakers from a bus: bus × master. */
export function effectiveGain(s: AudioSettings, bus: Bus): number {
  return masterGain(s) * busGain(s, bus);
}

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

/** Reads saved settings; anything missing, malformed or unreadable falls back to the defaults. */
export function loadSettings(storage: Reader | null | undefined): AudioSettings {
  const out: AudioSettings = { ...DEFAULT_SETTINGS };
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return out;
    const p = JSON.parse(raw) as Partial<Record<keyof AudioSettings, unknown>>;
    for (const k of ['master', ...BUSES] as const) {
      const v = p[k];
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1, Math.max(0, v));
    }
    if (typeof p.muted === 'boolean') out.muted = p.muted;
  } catch {
    // Private mode, blocked storage or a corrupt entry: play with the defaults.
  }
  return out;
}

/** Returns false when the browser refuses storage; the settings still apply for this session. */
export function saveSettings(storage: Writer | null | undefined, s: AudioSettings): boolean {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export interface Rolloff {
  /** Full volume inside this distance, in metres. */
  ref: number;
  rolloff: number;
  /** Silent beyond this distance. */
  max: number;
}

/** Positional sounds: full volume within 5 m, half by about 9 m, gone past 90 m. */
export const ROLLOFF: Readonly<Rolloff> = { ref: 5, rolloff: 1.2, max: 90 };

/** WebAudio's 'inverse' distance model, with a hard cut at `max` so far sounds cost no voice. */
export function distanceGain(d: number, r: Rolloff = ROLLOFF): number {
  if (d >= r.max) return 0;
  const dd = Math.max(d, r.ref);
  return r.ref / (r.ref + r.rolloff * (dd - r.ref));
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Where the ears go. At eye level they sit on the camera. From the god view
 * they slide down the view ray, so you hear the patch of floor you are
 * looking at instead of a quiet room 60 m below. A camera 60 m up listens
 * from 18 m.
 */
export function listenerPoint(cam: Vec3, forward: Vec3): Vec3 {
  const eye = 4;
  if (cam.y <= eye || forward.y >= -1e-3) return { ...cam };
  const want = eye + (cam.y - eye) * 0.25;
  const t = (cam.y - want) / -forward.y;
  return { x: cam.x + forward.x * t, y: want, z: cam.z + forward.z * t };
}
