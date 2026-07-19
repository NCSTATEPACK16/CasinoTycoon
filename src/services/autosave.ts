import type { TypedEventBus } from '../EventBus';
import type { CasinoWorld } from '../sim/world';
import { AUTOSAVE_SLOT, type SaveService } from './SaveService';

/**
 * Dawn autosave: midnight rollup fires dayEnded; snapshot the new day's opening
 * state. Armed only after the player has actually picked a scenario or loaded a
 * save this session (worldReset/worldLoaded) — otherwise the sim ticking behind
 * the boot scenario picker would clobber a real autosave with an idle sandbox.
 */
export function wireAutosave(bus: TypedEventBus, svc: SaveService, world: CasinoWorld): void {
  let armed = false;
  bus.on('worldReset', () => {
    armed = true;
  });
  bus.on('worldLoaded', () => {
    armed = true;
  });
  bus.on('dayEnded', () => {
    if (!armed) return;
    svc
      .save(AUTOSAVE_SLOT, world.toJSON())
      .then(() => {
        bus.emit('tickerMessage', { text: 'Autosaved.' });
      })
      .catch(() => {
        bus.emit('tickerMessage', { text: 'Autosave failed!' });
      });
  });
}
