import Phaser from 'phaser';
import { TILE_W, TILE_H } from '../config';

// Runtime-generated placeholder textures honoring the sprite contract in assets/ASSETS.md.
// Every game object gets a texture key here; real art later replaces keys via the atlas
// manifest without touching game code.

interface DiamondSpec {
  key: string;
  top: number;
  left: number;
  right: number;
}

interface BoxSpec {
  key: string;
  top: number;
  left: number;
  right: number;
  height: number; // vertical extent above the tile, in px
  cols?: number; // footprint (default 1×1)
  rows?: number;
}

// Floor tiles: flat diamonds.
const FLOORS: DiamondSpec[] = [
  { key: 'floor-carpet-red', top: 0x8e2437, left: 0x6f1c2b, right: 0x7d2031 },
  { key: 'floor-carpet-green', top: 0x1f6e43, left: 0x175434, right: 0x1b613b },
  { key: 'floor-marble', top: 0xd8d3c8, left: 0xb4afa4, right: 0xc6c1b6 },
  { key: 'floor-wood', top: 0x9a6b3f, left: 0x7b5431, right: 0x8b5f38 },
  { key: 'tile-highlight', top: 0xfff59d, left: 0xf5e076, right: 0xfaea87 },
  { key: 'tile-valid', top: 0x7ce67c, left: 0x58c058, right: 0x6ad46a },
  { key: 'tile-invalid', top: 0xe67c7c, left: 0xc05858, right: 0xd46a6a },
];

// Objects: iso boxes (diamond top face + two side faces).
const OBJECTS: BoxSpec[] = [
  { key: 'obj-slot-machine', top: 0xd94f6b, left: 0x8f2f44, right: 0xb03d55, height: 72 },
  {
    key: 'obj-blackjack-table',
    top: 0x2c7a4b,
    left: 0x1c5232,
    right: 0x24663e,
    height: 40,
    cols: 2,
    rows: 2,
  },
  { key: 'obj-toilet', top: 0x7fb2d9, left: 0x53809f, right: 0x6899bc, height: 56 },
  { key: 'obj-food-stall', top: 0xe0a33e, left: 0xa87728, right: 0xc48d32, height: 64 },
  { key: 'obj-plant', top: 0x3f9b4f, left: 0x2b6f37, right: 0x358543, height: 48 },
  { key: 'obj-wall', top: 0x5a5468, left: 0x3d3849, right: 0x4b4658, height: 96 },
];

// Characters are little RCT-style pixel people, generated per outfit variant
// with a 2-frame walk (see makePixelPeople). Guests get GUEST_VARIANTS looks.
export const GUEST_VARIANTS = 6;

interface PersonPalette {
  hair: number;
  skin: number;
  shirt: number;
  shirtShade: number;
  pants: number;
  shoes: number;
  accessory?: 'hardhat' | 'bucket';
}

const GUEST_SHIRTS = [0xc94f4f, 0x4f6fc9, 0x4fa15f, 0xd9b13b, 0x9a5fc9, 0x3fa9a9];
const SKINS = [0xe8b88a, 0xc98d5a, 0x8a5a3a];
const HAIRS = [0x3a2a1e, 0x1e1a16, 0xc9a94f];

function shade(color: number, f: number): number {
  const r = Math.floor(((color >> 16) & 0xff) * f);
  const g = Math.floor(((color >> 8) & 0xff) * f);
  const b = Math.floor((color & 0xff) * f);
  return (r << 16) | (g << 8) | b;
}

function guestPalette(variant: number): PersonPalette {
  const shirt = GUEST_SHIRTS[variant % GUEST_SHIRTS.length]!;
  return {
    hair: HAIRS[(variant + 1) % HAIRS.length]!,
    skin: SKINS[variant % SKINS.length]!,
    shirt,
    shirtShade: shade(shirt, 0.62),
    pants: 0x2e3450,
    shoes: 0x241f1a,
  };
}

const MECHANIC_PALETTE: PersonPalette = {
  hair: 0x3a2a1e,
  skin: 0xe8b88a,
  shirt: 0xd9772f,
  shirtShade: 0xa8571f,
  pants: 0x3a4a66,
  shoes: 0x241f1a,
  accessory: 'hardhat',
};

const JANITOR_PALETTE: PersonPalette = {
  hair: 0x1e1a16,
  skin: 0xc98d5a,
  shirt: 0x7a5fc9,
  shirtShade: 0x5a4499,
  pants: 0x4a4a52,
  shoes: 0x241f1a,
  accessory: 'bucket',
};

function diamondPoints(w: number, h: number): Phaser.Types.Math.Vector2Like[] {
  return [
    { x: w / 2, y: 0 },
    { x: w, y: h / 2 },
    { x: w / 2, y: h },
    { x: 0, y: h / 2 },
  ];
}

function makeFloor(scene: Phaser.Scene, spec: DiamondSpec): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const pts = diamondPoints(TILE_W, TILE_H);
  g.fillStyle(spec.top, 1);
  g.fillPoints(pts, true);
  g.lineStyle(1, spec.left, 1);
  g.strokePoints(pts, true, true);
  g.generateTexture(spec.key, TILE_W, TILE_H);
  g.destroy();
}

function makeBox(scene: Phaser.Scene, spec: BoxSpec): void {
  const cols = spec.cols ?? 1;
  const rows = spec.rows ?? 1;
  // Footprint diamond spans (cols+rows)/2 tiles wide in screen space.
  const w = ((cols + rows) / 2) * TILE_W * 0.72; // slightly inset from the full cell
  const h = ((cols + rows) / 2) * TILE_H * 0.72;
  const texW = Math.ceil(w);
  const texH = Math.ceil(h + spec.height);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  const topFace = diamondPoints(w, h).map((p) => ({ x: p.x, y: p.y }));
  // Side faces drop from the left/bottom/right diamond corners.
  const [n, e, s, wPt] = topFace as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];

  g.fillStyle(spec.left, 1);
  g.fillPoints(
    [wPt, s, { x: s.x, y: s.y + spec.height }, { x: wPt.x, y: wPt.y + spec.height }],
    true,
  );
  g.fillStyle(spec.right, 1);
  g.fillPoints([s, e, { x: e.x, y: e.y + spec.height }, { x: s.x, y: s.y + spec.height }], true);
  g.fillStyle(spec.top, 1);
  g.fillPoints([n, e, s, wPt], true);
  g.lineStyle(1, 0x14101c, 0.6);
  g.strokePoints([n, e, s, wPt], true, true);

  g.generateTexture(spec.key, texW, texH);
  g.destroy();
}

function makeSmoke(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0xb9b3a8, 1);
  g.fillCircle(8, 8, 8);
  g.fillStyle(0xd8d3c8, 1);
  g.fillCircle(6, 6, 4);
  g.generateTexture('fx-smoke', 16, 16);
  g.destroy();
}

// A little pixel person on a 12×18 logical-pixel grid, drawn at PIXEL_SCALE.
// Two frames: 'a' stands / plants the legs apart, 'b' brings them under —
// alternating per sim tick while walking reads as a stride.
const PIXEL_SCALE = 2;

function makePerson(scene: Phaser.Scene, key: string, pal: PersonPalette, frame: 'a' | 'b'): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const px = (x: number, y: number, w: number, h: number, color: number) => {
    g.fillStyle(color, 1);
    g.fillRect(x * PIXEL_SCALE, y * PIXEL_SCALE, w * PIXEL_SCALE, h * PIXEL_SCALE);
  };

  if (pal.accessory === 'hardhat') {
    px(2, 0, 8, 2, 0xe8c832); // helmet
    px(1, 2, 10, 1, 0xcaa92a); // brim
    px(3, 3, 6, 2, pal.skin); // face
  } else {
    px(3, 0, 6, 1, pal.hair);
    px(2, 1, 1, 2, pal.hair); // fringe
    px(3, 1, 6, 4, pal.skin);
  }
  px(2, 5, 8, 7, pal.shirt); // torso
  px(2, 5, 1, 7, pal.shirtShade); // iso shade on the left
  px(1, 9, 1, 2, pal.skin); // hands
  px(10, 9, 1, 2, pal.skin);
  if (pal.accessory === 'bucket') {
    px(10, 12, 2, 1, 0x6e747c);
    px(10, 13, 2, 3, 0x9aa0a8);
  }
  if (frame === 'a') {
    px(3, 12, 2, 5, pal.pants);
    px(7, 12, 2, 5, pal.pants);
    px(3, 17, 3, 1, pal.shoes);
    px(7, 17, 3, 1, pal.shoes);
  } else {
    px(4, 12, 2, 5, pal.pants);
    px(6, 12, 2, 5, pal.pants);
    px(3, 17, 3, 1, pal.shoes);
    px(6, 17, 3, 1, pal.shoes);
  }

  g.generateTexture(key, 12 * PIXEL_SCALE, 18 * PIXEL_SCALE);
  g.destroy();
}

function makePixelPeople(scene: Phaser.Scene): void {
  for (let v = 0; v < GUEST_VARIANTS; v++) {
    const pal = guestPalette(v);
    makePerson(scene, `char-guest-${v}-a`, pal, 'a');
    makePerson(scene, `char-guest-${v}-b`, pal, 'b');
  }
  makePerson(scene, 'char-mechanic-a', MECHANIC_PALETTE, 'a');
  makePerson(scene, 'char-mechanic-b', MECHANIC_PALETTE, 'b');
  makePerson(scene, 'char-janitor-a', JANITOR_PALETTE, 'a');
  makePerson(scene, 'char-janitor-b', JANITOR_PALETTE, 'b');
}

// P8 fx: a gold coin for jackpot bursts and a speech-bubble back for thoughts.
function makeCoin(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x9c7a1c, 1);
  g.fillCircle(6, 6, 6);
  g.fillStyle(0xe8b93c, 1);
  g.fillCircle(5.5, 5.5, 5);
  g.fillStyle(0xf7df8a, 1);
  g.fillCircle(4.5, 4.5, 2);
  g.generateTexture('fx-coin', 12, 12);
  g.destroy();
}

function makeThoughtBubble(scene: Phaser.Scene): void {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  g.fillStyle(0x2b2619, 0.9);
  g.fillRoundedRect(0, 0, 30, 24, 7); // border coat
  g.fillStyle(0xf6f1e2, 1);
  g.fillRoundedRect(1, 1, 28, 22, 6);
  g.fillStyle(0xf6f1e2, 1); // tail
  g.fillTriangle(12, 23, 18, 23, 15, 29);
  g.generateTexture('fx-bubble', 30, 30);
  g.destroy();
}

// Floor decals for messes: a dark spill puddle and scattered trash bits.
function makeMessTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('fx-mess-spill')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x53381f, 0.85);
    g.fillEllipse(24, 13, 38, 16);
    g.fillEllipse(11, 17, 14, 8);
    g.fillStyle(0x6e4a2a, 0.9);
    g.fillEllipse(27, 11, 18, 8);
    g.generateTexture('fx-mess-spill', 48, 24);
    g.destroy();
  }
  if (!scene.textures.exists('fx-mess-trash')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xb8b2a6, 1);
    g.fillRect(10, 10, 7, 5);
    g.fillRect(30, 14, 6, 6);
    g.fillStyle(0x8a8478, 1);
    g.fillRect(20, 6, 6, 5);
    g.fillCircle(38, 8, 3);
    g.fillStyle(0xc9563e, 1); // a stray cup
    g.fillRect(15, 16, 4, 6);
    g.generateTexture('fx-mess-trash', 48, 24);
    g.destroy();
  }
}

/** Generate every placeholder texture into the scene's texture manager (global cache). */
export function generatePlaceholders(scene: Phaser.Scene): void {
  for (const f of FLOORS) if (!scene.textures.exists(f.key)) makeFloor(scene, f);
  for (const o of OBJECTS) if (!scene.textures.exists(o.key)) makeBox(scene, o);
  makePixelPeople(scene);
  if (!scene.textures.exists('fx-smoke')) makeSmoke(scene);
  if (!scene.textures.exists('fx-coin')) makeCoin(scene);
  if (!scene.textures.exists('fx-bubble')) makeThoughtBubble(scene);
  makeMessTextures(scene);
}
