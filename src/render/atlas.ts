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
  // Self-generated (Kenney has no casino/chip pack — see assets/ASSETS.md).
  // Not consumed by any render code yet; P11 swaps fx-coin for these.
  { key: 'img-chip-white', url: 'sprites/chips/chip_white.png' },
  { key: 'img-chip-blue', url: 'sprites/chips/chip_blue.png' },
  { key: 'img-chip-red', url: 'sprites/chips/chip_red.png' },
  { key: 'img-chip-green', url: 'sprites/chips/chip_green.png' },
  { key: 'img-chip-black', url: 'sprites/chips/chip_black.png' },
  { key: 'img-wall-panel', url: 'sprites/wall-panel.png' },
  { key: 'img-neon-sign', url: 'sprites/neon-sign.png' },
  { key: 'img-marquee', url: 'sprites/marquee.png' },
  { key: 'img-restroom', url: 'sprites/restroom.png' },
  { key: 'img-plant', url: 'sprites/plant.png' },
  { key: 'img-food-stall', url: 'sprites/food-stall.png' },
  { key: 'img-cage', url: 'sprites/cage.png' },
  // Characters load directly into the same keys GuestViews/StaffViews already
  // reference (char-guest-N-a/b, char-mechanic-a/b, char-janitor-a/b) —
  // unlike objects there's no spriteKey indirection, so real art has to use
  // the exact final key. generatePlaceholders() already skips any key that's
  // preloaded, so any variant without real art keeps the procedural fallback.
  { key: 'char-guest-0-a', url: 'sprites/characters/guest-0-a.png' },
  { key: 'char-guest-0-b', url: 'sprites/characters/guest-0-b.png' },
  { key: 'char-guest-1-a', url: 'sprites/characters/guest-1-a.png' },
  { key: 'char-guest-1-b', url: 'sprites/characters/guest-1-b.png' },
  { key: 'char-guest-2-a', url: 'sprites/characters/guest-2-a.png' },
  { key: 'char-guest-2-b', url: 'sprites/characters/guest-2-b.png' },
  { key: 'char-guest-3-a', url: 'sprites/characters/guest-3-a.png' },
  { key: 'char-guest-3-b', url: 'sprites/characters/guest-3-b.png' },
  { key: 'char-guest-4-a', url: 'sprites/characters/guest-4-a.png' },
  { key: 'char-guest-4-b', url: 'sprites/characters/guest-4-b.png' },
  { key: 'char-guest-5-a', url: 'sprites/characters/guest-5-a.png' },
  { key: 'char-guest-5-b', url: 'sprites/characters/guest-5-b.png' },
  { key: 'char-guest-highRoller-a', url: 'sprites/characters/guest-highRoller-a.png' },
  { key: 'char-guest-highRoller-b', url: 'sprites/characters/guest-highRoller-b.png' },
  { key: 'char-guest-biker-a', url: 'sprites/characters/guest-biker-a.png' },
  { key: 'char-guest-biker-b', url: 'sprites/characters/guest-biker-b.png' },
  { key: 'char-guest-tourist-a', url: 'sprites/characters/guest-tourist-a.png' },
  { key: 'char-guest-tourist-b', url: 'sprites/characters/guest-tourist-b.png' },
  { key: 'char-mechanic-a', url: 'sprites/characters/mechanic-a.png' },
  { key: 'char-mechanic-b', url: 'sprites/characters/mechanic-b.png' },
  { key: 'char-janitor-a', url: 'sprites/characters/janitor-a.png' },
  { key: 'char-janitor-b', url: 'sprites/characters/janitor-b.png' },
  { key: 'char-bartender-a', url: 'sprites/characters/bartender-a.png' },
  { key: 'char-bartender-b', url: 'sprites/characters/bartender-b.png' },
  { key: 'char-waitress-a', url: 'sprites/characters/waitress-a.png' },
  { key: 'char-waitress-b', url: 'sprites/characters/waitress-b.png' },
  { key: 'char-pitBoss-a', url: 'sprites/characters/pitBoss-a.png' },
  { key: 'char-pitBoss-b', url: 'sprites/characters/pitBoss-b.png' },
  { key: 'char-security-a', url: 'sprites/characters/security-a.png' },
  { key: 'char-security-b', url: 'sprites/characters/security-b.png' },
  { key: 'char-dealer-a', url: 'sprites/characters/dealer-a.png' },
  { key: 'char-dealer-b', url: 'sprites/characters/dealer-b.png' },
  { key: 'char-cashier-a', url: 'sprites/characters/cashier-a.png' },
  { key: 'char-cashier-b', url: 'sprites/characters/cashier-b.png' },
];

export function preloadFileAssets(scene: Pick<Phaser.Scene, 'load'>): void {
  for (const asset of FILE_ASSETS) scene.load.image(asset.key, asset.url);
}
