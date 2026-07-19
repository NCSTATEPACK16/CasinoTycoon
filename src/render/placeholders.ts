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

// Characters: small capsule-ish boxes, distinct colors per role.
const CHARACTERS: BoxSpec[] = [
  { key: 'char-guest', top: 0xf2c94c, left: 0xb08f2e, right: 0xd1ab3a, height: 44 },
  { key: 'char-mechanic', top: 0xe07840, left: 0xa4552c, right: 0xc26636, height: 46 },
  { key: 'char-janitor', top: 0x8f7ae0, left: 0x6355a4, right: 0x7967c2, height: 46 },
];

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

/** Generate every placeholder texture into the scene's texture manager (global cache). */
export function generatePlaceholders(scene: Phaser.Scene): void {
  for (const f of FLOORS) if (!scene.textures.exists(f.key)) makeFloor(scene, f);
  for (const o of [...OBJECTS, ...CHARACTERS]) if (!scene.textures.exists(o.key)) makeBox(scene, o);
}
