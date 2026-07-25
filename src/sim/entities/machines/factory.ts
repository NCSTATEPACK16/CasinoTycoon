// Single construction point for every CasinoGame subclass. Placement and
// deserialize both route through here so a new game type can never be added
// to one path and forgotten in the other — the failure mode that would
// otherwise deserialize an unknown defId as a SlotMachine.
import { BigSixWheel } from './BigSixWheel';
import { BlackjackTable } from './BlackjackTable';
import type { CasinoGame } from './CasinoGame';
import { CrapsTable } from './CrapsTable';
import { PokerTable } from './PokerTable';
import { RouletteTable } from './RouletteTable';
import { SlotMachine } from './SlotMachine';

type MachineCtor = (id: string, costToPlay?: number) => CasinoGame;

const MACHINE_CTORS: Record<string, MachineCtor> = {
  'slot-machine': (id, cost) => new SlotMachine(id, cost),
  'blackjack-table': (id, cost) => new BlackjackTable(id, cost),
  'craps-table': (id, cost) => new CrapsTable(id, cost),
  'roulette-table': (id, cost) => new RouletteTable(id, cost),
  'big-six-wheel': (id, cost) => new BigSixWheel(id, cost),
  'poker-table': (id, cost) => new PokerTable(id, cost),
};

/** True only for defIds this factory can actually build (not inherited keys). */
export function isMachineDefId(defId: string): boolean {
  return Object.hasOwn(MACHINE_CTORS, defId);
}

/** Build a machine for a catalog defId, or null if that object isn't a game. */
export function createMachine(
  defId: string,
  id: string,
  costToPlay?: number,
): CasinoGame | null {
  // hasOwn, not a truthy lookup: a plain object literal inherits 'constructor',
  // 'toString', 'valueOf'… off Object.prototype, and those would otherwise
  // resolve to a truthy non-ctor and slip past createMachineOrThrow's guard.
  if (!isMachineDefId(defId)) return null;
  return MACHINE_CTORS[defId]!(id, costToPlay);
}

/** Deserialize variant: a save naming an unknown game must fail loudly. */
export function createMachineOrThrow(
  defId: string,
  id: string,
  costToPlay?: number,
): CasinoGame {
  const machine = createMachine(defId, id, costToPlay);
  if (!machine) throw new Error(`Unknown machine defId in save data: ${defId}`);
  return machine;
}
