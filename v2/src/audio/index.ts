// The one audio engine the whole client shares. Silent until the first
// gesture unlocks it (main.ts calls unlockOn).

import { AudioEngine } from './AudioEngine';

export const audio = new AudioEngine();
export { AudioEngine } from './AudioEngine';
export { GameAudio } from './GameAudio';
export type { SoundName } from './sounds';
