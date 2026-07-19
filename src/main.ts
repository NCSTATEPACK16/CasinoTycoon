import Phaser from 'phaser';
import { eventBus } from './EventBus';
import { world } from './gameContext';
import BootScene from './render/BootScene';
import WorldScene from './render/WorldScene';
import { initUI } from './ui';

// Dev-only test affordance: Playwright drivers reach the sim through this.
// Stripped from production builds by Vite's dead-code elimination.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__casino = { world, eventBus };
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14101c',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
});

initUI();
