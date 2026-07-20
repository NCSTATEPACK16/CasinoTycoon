import type Phaser from 'phaser';

export interface FileAsset {
  key: string;
  url: string; // relative to Vite's public/ root, matching BootScene's existing convention
}

// Every texture key backed by real, committed art instead of a runtime
// generator. Swapping or adding art (a commissioned cabinet, delivered
// character sheets) is one entry here plus the file under public/ —
// game code (ObjectDef.spriteKey, char-* keys) never changes. Anything
// not listed here falls through to generatePlaceholders() in BootScene,
// which already no-ops for any key that already exists.
export const FILE_ASSETS: readonly FileAsset[] = [
  { key: 'img-slot-machine', url: 'sprites/slot-machine.png' },
  { key: 'img-blackjack-table', url: 'sprites/blackjack-table.png' },
  { key: 'img-craps-table', url: 'sprites/craps-table.png' },
];

export function preloadFileAssets(scene: Pick<Phaser.Scene, 'load'>): void {
  for (const asset of FILE_ASSETS) scene.load.image(asset.key, asset.url);
}
