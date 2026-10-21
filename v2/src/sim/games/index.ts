// Registry: which engine resolves each game, and which catalog objects are
// which game. Machines look their engine up here so a defId can never be
// wired to the wrong math.

import type { GameKind } from '../../shared/games';
import { blackjackEngine } from './blackjack/blackjack';
import { crapsEngine } from './craps/craps';
import { rouletteEngine } from './roulette/roulette';
import { slotsEngine } from './slots/slots';
import { uthEngine } from './uth/uth';

export const ENGINES = {
  slots: slotsEngine,
  roulette: rouletteEngine,
  blackjack: blackjackEngine,
  craps: crapsEngine,
  uth: uthEngine,
} as const;

// Every GameKind has an engine; checked here so a new kind fails to compile.
const _complete: Record<GameKind, unknown> = ENGINES;
void _complete;

/** The catalog objects that play a real engine. Other v1 games keep their
 *  payout tables until they get math of their own. */
export const ENGINE_FOR_DEF: Readonly<Record<string, GameKind>> = {
  'slot-machine': 'slots',
  'penny-slots': 'slots',
  'roulette-table': 'roulette',
  'blackjack-table': 'blackjack',
  'high-limit-table': 'blackjack',
  'craps-table': 'craps',
  'poker-table': 'uth',
};

export function engineKindFor(defId: string): GameKind | null {
  return Object.hasOwn(ENGINE_FOR_DEF, defId) ? ENGINE_FOR_DEF[defId]! : null;
}
