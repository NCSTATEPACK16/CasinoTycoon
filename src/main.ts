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

// P2 demo feed — replaced by real sim events from P4 onward.
const demoNews = [
  'Welcome to Casino Tycoon! The floor is yours.',
  'Tip: drag windows by their title bar; click brings to front.',
  'Construction crews arrive in P3 — get ready to build.',
];
demoNews.forEach((text, i) => {
  window.setTimeout(() => eventBus.emit('tickerMessage', { text }), 1000 + i * 6500);
});
