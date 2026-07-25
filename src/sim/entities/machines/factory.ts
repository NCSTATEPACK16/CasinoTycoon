// Single construction point for every CasinoGame subclass. Placement and
// deserialize both route through here so a new game type can never be added
// to one path and forgotten in the other — the failure mode that would
// otherwise deserialize an unknown defId as a SlotMachine.
import { BlackjackTable } from './BlackjackTable';
import type { CasinoGame } from './CasinoGame';
import { CrapsTable } from './CrapsTable';
import { SlotMachine } from './SlotMachine';

type MachineCtor = (id: string, costToPlay?: number) => CasinoGame;

const MACHINE_CTORS: Record<string, MachineCtor> = {
  'slot-machine': (id, cost) => new SlotMachine(id, cost),
  'blackjack-table': (id, cost) => new BlackjackTable(id, cost),
  'craps-table': (id, cost) => new CrapsTable(id, cost),
};

/** Build a machine for a catalog defId, or null if that object isn't a game. */
export function createMachine(
  defId: string,
  id: string,
  costToPlay?: number,
): CasinoGame | null {
  const ctor = MACHINE_CTORS[defId];
  return ctor ? ctor(id, costToPlay) : null;
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
