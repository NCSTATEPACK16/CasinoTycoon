import { eventBus } from '../../EventBus';
import { JACKPOT_PAYOUT_MULT } from '../../config';
import { world } from '../../gameContext';
import { audio } from '../../services/AudioService';

const CHIP_KEYS = [
  'sfx-chips-1',
  'sfx-chips-2',
  'sfx-chips-3',
  'sfx-chips-4',
  'sfx-chips-5',
  'sfx-chips-6',
];
const CARD_KEYS = ['sfx-card-1', 'sfx-card-2', 'sfx-card-3', 'sfx-card-4', 'sfx-card-5'];
const DICE_KEYS = ['sfx-dice-1', 'sfx-dice-2', 'sfx-dice-3', 'sfx-dice-4'];
const COIN_KEYS = ['sfx-coin-1', 'sfx-coin-2'];

// With dozens of guests playing, machinePlayed fires many times a second —
// gate the per-play foley to at most one sound per window.
const PLAY_SFX_GAP_MS = 110;

/** Wires sim events to sounds. UI-side sounds live in src/ui. */
export function attachAudioFx(): void {
  let lastPlaySfx = 0;

  eventBus.on('machinePlayed', ({ machineId, wager, payout }) => {
    const now = performance.now();
    if (now - lastPlaySfx >= PLAY_SFX_GAP_MS) {
      lastPlaySfx = now;
      const defId = world.machines.get(machineId)?.defId;
      const pool =
        defId === 'blackjack-table' ? CARD_KEYS : defId === 'craps-table' ? DICE_KEYS : CHIP_KEYS;
      audio.playRandom(pool, { volume: 0.55, detuneJitter: 120 });
      if (payout > 0) audio.playRandom(COIN_KEYS, { volume: 0.7, detuneJitter: 80 });
    }
    // The jackpot fanfare rides the celebration cooldown in floaters.ts via
    // this same event; here we only guarantee the stinger itself.
    if (payout >= wager * JACKPOT_PAYOUT_MULT) {
      audio.play('sfx-jackpot', { volume: 0.9 });
    }
  });

  eventBus.on('machineBroke', () => audio.play('sfx-break', { volume: 0.8 }));
  eventBus.on('machineFixed', () => audio.play('sfx-fixed', { volume: 0.7 }));
  eventBus.on('objectPlaced', () => audio.play('ui-place', { detuneJitter: 60 }));
  eventBus.on('objectSold', () => audio.play('ui-sell', { detuneJitter: 60 }));
  eventBus.on('staffHired', () => audio.play('ui-hire'));
  eventBus.on('staffFired', () => audio.play('ui-close'));
  eventBus.on('goalReached', () => audio.play('sfx-victory', { volume: 0.9 }));
  eventBus.on('scenarioFailed', () => audio.play('sfx-failure', { volume: 0.9 }));

  eventBus.on('guestThought', ({ thoughtId }) => {
    if (thoughtId === 'raging') audio.play('ui-error', { volume: 0.5 });
  });
}
