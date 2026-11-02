// Registry: which engine resolves each game, and which catalog objects are
// which game. Machines look their engine up here so a defId can never be
// wired to the wrong math.

import type { GameKind } from '../../shared/games';
import { bigSixEngine } from './bigsix/bigsix';
import { bingoEngine } from './bingo/bingo';
import { blackjackEngine } from './blackjack/blackjack';
import { crapsEngine } from './craps/craps';
import { kenoEngine } from './keno/keno';
import { pachinkoEngine } from './pachinko/pachinko';
import { paiGowEngine } from './paigow/paigow';
import { rouletteEngine } from './roulette/roulette';
import { sicBoEngine } from './sicbo/sicbo';
import { slotsEngine } from './slots/slots';
import { tcpEngine } from './tcp/tcp';
import { uthEngine } from './uth/uth';
import { videoPokerEngine } from './videopoker/videopoker';

export const ENGINES = {
  slots: slotsEngine,
  roulette: rouletteEngine,
  blackjack: blackjackEngine,
  craps: crapsEngine,
  uth: uthEngine,
  sicbo: sicBoEngine,
  tcp: tcpEngine,
  paigow: paiGowEngine,
  keno: kenoEngine,
  videopoker: videoPokerEngine,
  pachinko: pachinkoEngine,
  bingo: bingoEngine,
  bigsix: bigSixEngine,
} as const;

// Every GameKind has an engine; checked here so a new kind fails to compile.
const _complete: Record<GameKind, unknown> = ENGINES;
void _complete;

/** The catalog objects that play a real engine: every game on the floor. */
export const ENGINE_FOR_DEF: Readonly<Record<string, GameKind>> = {
  'slot-machine': 'slots',
  'penny-slots': 'slots',
  'roulette-table': 'roulette',
  'blackjack-table': 'blackjack',
  'high-limit-table': 'blackjack',
  'craps-table': 'craps',
  'poker-table': 'uth',
  'sic-bo': 'sicbo',
  'three-card-poker': 'tcp',
  'pai-gow': 'paigow',
  'keno-lounge': 'keno',
  'video-poker': 'videopoker',
  pachinko: 'pachinko',
  'bingo-hall': 'bingo',
  'big-six-wheel': 'bigsix',
};

export function engineKindFor(defId: string): GameKind | null {
  return Object.hasOwn(ENGINE_FOR_DEF, defId) ? ENGINE_FOR_DEF[defId]! : null;
}
