// Trash/spills on the floor. Pure data — the world owns lifecycle, janitors clean.

export type MessKind = 'trash' | 'spill';

export interface Mess {
  id: string;
  kind: MessKind;
  col: number;
  row: number;
  /** Janitor id that has claimed this mess, so two janitors never race to it. */
  claimedBy: string | null;
}
