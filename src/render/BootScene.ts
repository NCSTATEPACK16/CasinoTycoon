import Phaser from 'phaser';
import { AUDIO_KEYS } from '../services/AudioService';
import { generatePlaceholders } from './placeholders';

// Generates the runtime placeholder textures (and later preloads real atlases),
// then hands off to the world.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    for (const key of AUDIO_KEYS) this.load.audio(key, `audio/${key}.ogg`);
    this.load.image('img-slot-machine', 'sprites/slot-machine.png');
    this.load.image('img-blackjack-table', 'sprites/blackjack-table.png');
    this.load.image('img-craps-table', 'sprites/craps-table.png');
  }

  create() {
    generatePlaceholders(this);
    this.scene.start('world');
  }
}
