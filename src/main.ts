import Phaser from 'phaser';
import { eventBus } from './EventBus';
import { world } from './gameContext';
import BootScene from './render/BootScene';
import WorldScene from './render/WorldScene';
import { initUI } from './ui';
import { saveService } from './services/SaveService';
import { wireAutosave } from './services/autosave';
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

// Dawn autosave — armed only after a scenario is picked or a save is loaded
// this session, so the sim ticking behind the boot picker can't clobber the
// real autosave. See src/services/autosave.ts.
wireAutosave(eventBus, saveService, world);

// Campaign wins land on the local leaderboard (score stays null until P11).
eventBus.on('goalReached', ({ campaignId, day, profit }) => {
  void leaderboard.record({ campaignId, dailyProfit: profit, day });
});
