import Phaser from 'phaser';
import { AUDIO_KEYS } from '../services/AudioService';
import { generatePlaceholders } from './placeholders';
import { preloadFileAssets } from './atlas';
import { generateNeonGlows } from './neon';

// Generates the runtime placeholder textures (and later preloads real atlases),
// then hands off to the world.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    for (const key of AUDIO_KEYS) this.load.audio(key, `audio/${key}.ogg`);
    preloadFileAssets(this);
  }

  create() {
    generatePlaceholders(this);
    generateNeonGlows(this);
    this.scene.start('world');
  }
}
