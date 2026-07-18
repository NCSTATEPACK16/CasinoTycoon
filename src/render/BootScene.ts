import Phaser from 'phaser';
import { generatePlaceholders } from './placeholders';

// Generates the runtime placeholder textures (and later preloads real atlases),
// then hands off to the world.
export default class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    generatePlaceholders(this);
    this.scene.start('world');
  }
}
