import { CasinoWorld } from './sim/world';

// Composition root for the running game. Render and UI import these singletons;
// sim modules stay pure. Save/load (P9) will rehydrate via CasinoWorld.fromJSON
// and must refresh these bindings.

export const world = new CasinoWorld();
export const gameState = world.state;
export const worldGrid = world.grid;
