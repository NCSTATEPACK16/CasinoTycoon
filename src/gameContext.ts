import { GRID_COLS, GRID_ROWS } from './config';
import { GameState } from './sim/GameState';
import { IsoGrid } from './sim/grid/IsoGrid';

// Composition root for the running game's sim state. Render and UI import these
// singletons; sim modules stay pure and receive them as arguments. Save/load
// (P9) rehydrates by replacing the contents, not the bindings.

export const gameState = new GameState();
export const worldGrid = new IsoGrid(GRID_COLS, GRID_ROWS);
