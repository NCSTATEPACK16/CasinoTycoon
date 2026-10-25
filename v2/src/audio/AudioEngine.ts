// WebAudio engine: master → {sfx, ambience, ui} buses, unlocked on the first
// gesture, positional voices heard from the camera, a global voice cap and
// saved volumes. Pure maths lives in mix.ts and voices.ts.

import type { Camera } from 'three';
import { Vector3 } from 'three';
import {
  BUSES,
  ROLLOFF,
  busGain,
  distanceGain,
  listenerPoint,
  loadSettings,
  masterGain,
  saveSettings,
  type AudioSettings,
  type Bus,
  type Vec3,
} from './mix';
import { SOUNDS, type SoundDef, type SoundName } from './sounds';
import { VoiceLimiter } from './voices';

/** Simultaneous voices across the whole game. */
export const MAX_VOICES = 24;
/** Below this distance gain a positional sound isn't worth a voice. */
const AUDIBLE = 0.03;
/** A sound whose file is still loading plays late by at most this much, or not at all. */
const LATE_MS = 400;

export interface PlayOptions {
  /** World position (metres); omit for a flat, non-positional sound. */
  at?: { x: number; y?: number; z: number };
  volume?: number;
  /** Seconds from now. */
  delay?: number;
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  settings: AudioSettings;
  /** Started plays per sound name, plus voices skipped for distance, dropped or stolen. */
  readonly stats = { plays: {} as Record<string, number>, culled: 0, dropped: 0, stolen: 0 };
  private master: GainNode | null = null;
  private buses = {} as Record<Bus, GainNode>;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private ready = new Map<string, AudioBuffer | null>();
  private live = new Map<number, AudioBufferSourceNode>();
  private limiter = new VoiceLimiter(
    MAX_VOICES,
    (k) => (SOUNDS as Record<string, SoundDef>)[k]?.maxVoices ?? 4,
  );
  private ear: Vec3 = { x: 0, y: 0, z: 0 };
  private tmpPos = new Vector3();
  private tmpDir = new Vector3();

  constructor(
    private base = `${import.meta.env.BASE_URL}audio/`,
    private storage: Storage | null = browserStorage(),
  ) {
    this.settings = loadSettings(this.storage);
  }

  get state(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none';
  }

  /** Browsers keep audio locked until a gesture: start (or resume) on the first one. */
  unlockOn(target: EventTarget): void {
    const go = () => this.unlock();
    for (const type of ['pointerdown', 'keydown', 'touchstart'])
      target.addEventListener(type, go, { capture: true, passive: true });
  }

  unlock(): void {
    if (!this.ctx) {
      const Ctx =
        globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      for (const b of BUSES) {
        const g = ctx.createGain();
        g.connect(this.master);
        this.buses[b] = g;
      }
      this.applySettings(true);
      // Small files: fetch them all now so the first coin isn't silent.
      for (const def of Object.values(SOUNDS)) for (const f of def.files) void this.load(f);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.storage, this.settings);
    this.applySettings();
  }

  /** Current node gains, for the Settings panel and for tests in the browser. */
  gains(): Record<'master' | Bus, number> {
    const out = { master: this.master?.gain.value ?? 0 } as Record<'master' | Bus, number>;
    for (const b of BUSES) out[b] = this.buses[b]?.gain.value ?? 0;
    return out;
  }

  private applySettings(now = false): void {
    if (!this.ctx || !this.master) return;
    const set = (p: AudioParam, v: number) => {
      p.cancelScheduledValues(this.ctx!.currentTime);
      // Jump on creation; glide on slider moves so dragging doesn't click.
      if (now) p.value = v;
      else p.setTargetAtTime(v, this.ctx!.currentTime, 0.015);
    };
    set(this.master.gain, masterGain(this.settings));
    for (const b of BUSES) set(this.buses[b].gain, busGain(this.settings, b));
  }

  /** Once a frame: put the ears where the camera is looking. */
  update(camera: Camera): void {
    camera.getWorldPosition(this.tmpPos);
    camera.getWorldDirection(this.tmpDir);
    this.ear = listenerPoint(this.tmpPos, this.tmpDir);
    const l = this.ctx?.listener;
    if (!l) return;
    const d = this.tmpDir;
    if (l.positionX) {
      l.positionX.value = this.ear.x;
      l.positionY.value = this.ear.y;
      l.positionZ.value = this.ear.z;
      l.forwardX.value = d.x;
      l.forwardY.value = d.y;
      l.forwardZ.value = d.z;
      l.upX.value = camera.up.x;
      l.upY.value = camera.up.y;
      l.upZ.value = camera.up.z;
    } else {
      l.setPosition(this.ear.x, this.ear.y, this.ear.z);
      l.setOrientation(d.x, d.y, d.z, camera.up.x, camera.up.y, camera.up.z);
    }
  }

  /** Metres from the ears to a floor point, for callers that rank sounds by distance. */
  distanceTo(at: { x: number; y?: number; z: number }): number {
    return Math.hypot(at.x - this.ear.x, (at.y ?? 1) - this.ear.y, at.z - this.ear.z);
  }

  play(name: SoundName, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const def: SoundDef = SOUNDS[name];
    if (opts.at && distanceGain(this.distanceTo(opts.at)) < AUDIBLE) {
      this.stats.culled++;
      return;
    }
    const file = def.files[Math.floor(Math.random() * def.files.length)]!;
    const buf = this.ready.get(file);
    if (buf) return this.start(name, def, buf, opts);
    if (buf === null) return; // failed to load once; don't retry every play
    const asked = performance.now();
    void this.load(file).then((b) => {
      if (b && performance.now() - asked < LATE_MS) this.start(name, def, b, opts);
    });
  }

  private start(name: string, def: SoundDef, buf: AudioBuffer, opts: PlayOptions): void {
    const ctx = this.ctx!;
    const grant = this.limiter.request(name, def.priority, ctx.currentTime);
    if (!grant.ok) {
      this.stats.dropped++;
      return;
    }
    if (grant.steal !== null) {
      this.live.get(grant.steal)?.stop();
      this.stats.stolen++;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (def.jitter) src.detune.value = (Math.random() * 2 - 1) * def.jitter;
    const gain = ctx.createGain();
    gain.gain.value = def.volume * (opts.volume ?? 1);
    src.connect(gain);
    let tail: AudioNode = gain;
    if (opts.at) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ROLLOFF.ref;
      p.rolloffFactor = ROLLOFF.rolloff;
      p.maxDistance = ROLLOFF.max;
      p.positionX.value = opts.at.x;
      p.positionY.value = opts.at.y ?? 1;
      p.positionZ.value = opts.at.z;
      gain.connect(p);
      tail = p;
    }
    tail.connect(this.buses[def.bus]);
    const id = grant.id;
    this.live.set(id, src);
    src.onended = () => {
      this.limiter.release(id);
      this.live.delete(id);
      src.disconnect();
      tail.disconnect();
    };
    src.start(ctx.currentTime + (opts.delay ?? 0));
    this.stats.plays[name] = (this.stats.plays[name] ?? 0) + 1;
  }

  private load(file: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(file);
    if (!p) {
      const ctx = this.ctx!;
      p = fetch(`${this.base}${file}.ogg`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => ctx.decodeAudioData(data))
        .catch((err: unknown) => {
          console.warn(`[audio] ${file}: ${(err as Error).message}`);
          return null;
        })
        .then((b) => {
          this.ready.set(file, b);
          return b;
        });
      this.buffers.set(file, p);
    }
    return p;
  }
}
