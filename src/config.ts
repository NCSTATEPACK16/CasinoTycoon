// Global constants shared by sim and render. Keep all magic numbers here.

// Isometric sprite contract: 2:1 diamond tiles, anchor at tile center-bottom.
export const TILE_W = 128;
export const TILE_H = 64;

// Casino floor dimensions (grid cells).
export const GRID_COLS = 40;
export const GRID_ROWS = 30;

// Simulation runs on a fixed timestep; render interpolates between ticks.
export const SIM_TICKS_PER_SECOND = 10;
export const SIM_TICK_MS = 1000 / SIM_TICKS_PER_SECOND;

// Game time: how many sim ticks make one in-game hour.
export const TICKS_PER_HOUR = 50;
export const HOURS_PER_DAY = 24;
// The casino opens at noon on Day 1 (matches the toolbar's initial readout).
export const START_HOUR = 12;

// Sandbox starting bankroll; campaign scenarios override this (P7).
export const STARTING_CASH = 2000;

// Fraction of an object's cost returned when bulldozed.
export const SELL_REFUND_RATIO = 0.5;

// A payout at or above wager × this counts as a jackpot (fanfare + celebration).
// Slots' top payout tier is 15×, so only that tier qualifies.
export const JACKPOT_PAYOUT_MULT = 10;

// Where guests enter and exit: middle of the open east edge (walls line north/west only).
export const ENTRANCE_TILE = { col: GRID_COLS - 1, row: 15 } as const;
