import Phaser from 'phaser';
import { eventBus } from './EventBus';
import { world } from './gameContext';
import BootScene from './render/BootScene';
import WorldScene from './render/WorldScene';
import { initUI } from './ui';
import { AUTOSAVE_SLOT, saveService } from './services/SaveService';
import { leaderboard } from './services/LeaderboardService';

// Dev-only test affordance: Playwright drivers reach the sim through this.
// Stripped from production builds by Vite's dead-code elimination.
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#14101c',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, WorldScene],
});

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__casino = { world, eventBus, game };
}

initUI();

// Dawn autosave: midnight rollup fires dayEnded; snapshot the new day's opening state.
eventBus.on('dayEnded', () => {
  void saveService.save(AUTOSAVE_SLOT, world.toJSON());
  eventBus.emit('tickerMessage', { text: 'Autosaved.' });
});

// Campaign wins land on the local leaderboard (score stays null until P11).
eventBus.on('goalReached', ({ campaignId, day, profit }) => {
  void leaderboard.record({ campaignId, dailyProfit: profit, day });
});
