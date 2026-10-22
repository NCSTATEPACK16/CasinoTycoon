// Code-built assets: the catalog's 'proc:*' decor, the stand-in shown for a
// hero until its GLB finishes loading, and floor-layer decor (columns,
// chandeliers, stanchions). Same conventions as the Blender heroes: origin at
// the footprint's min corner, +z is the front, one metre per cell.

import * as THREE from 'three';
import { GeoBuilder, at, roundedRect } from './GeoBuilder';
import { PALETTE, SurfaceFlag, surf, type Surface } from './Palette';
import type { DecalAtlas } from './Atlas';

export type Lod = 0 | 1 | 2;

export interface ProcContext {
  atlas: DecalAtlas;
  w: number;
  h: number;
  height: number;
  color: number;
}

type Generator = (b: GeoBuilder, c: ProcContext, lod: Lod) => void;

const GENERATORS: Record<string, Generator> = {
  'proc:plant': plant,
  'proc:neon': neon,
  'proc:marquee': marquee,
  'proc:box': placeholder,
  'proc:column': column,
  'proc:chandelier': chandelier,
  'proc:stanchion': stanchion,
};

export function hasGenerator(key: string): boolean {
  return key in GENERATORS;
}

export function buildProcedural(key: string, c: ProcContext, lod: Lod): THREE.BufferGeometry {
  const b = new GeoBuilder(c.atlas);
  (GENERATORS[key] ?? placeholder)(b, c, lod);
  return b.build();
}

/** Stand-in for a hero GLB that hasn't loaded (or failed): a bevelled plinth
 *  in the catalog colour, so the floor reads correctly from frame one. */
function placeholder(b: GeoBuilder, c: ProcContext, lod: Lod): void {
  const s: Surface = { color: c.color, rough: 0.45, metal: 0.2 };
  const inset = 0.08;
  if (lod === 2) {
    b.box(c.w - inset * 2, c.height, c.h - inset * 2, c.w / 2, 0, c.h / 2, s);
    return;
  }
  b.rbox(c.w - inset * 2, c.height * 0.92, c.h - inset * 2, c.w / 2, 0, c.h / 2, s, 0.08);
  b.rbox(c.w - inset * 2.6, c.height * 0.08, c.h - inset * 2.6, c.w / 2, c.height * 0.92, c.h / 2, PALETTE.brass, 0.05);
}

function plant(b: GeoBuilder, c: ProcContext, lod: Lod): void {
  const cx = c.w / 2;
  const cz = c.h / 2;
  // Brass-banded urn.
  b.lathe(
    [
      [0.0, 0],
      [0.2, 0],
      [0.24, 0.05],
      [0.28, 0.32],
      [0.31, 0.42],
      [0.29, 0.46],
      [0.0, 0.46],
    ],
    cx,
    0,
    cz,
    surf('ceramic', { color: 0x1d1a24, rough: 0.2 }),
    lod === 0 ? 24 : 10,
  );
  b.cyl(0.305, 0.305, 0.04, cx, 0.38, cz, PALETTE.brass, lod === 0 ? 24 : 10);
  b.cyl(0.27, 0.27, 0.02, cx, 0.44, cz, PALETTE.soil, 12);
  if (lod === 2) {
    b.sphere(0.45, cx, 0.95, cz, PALETTE.plantLeaf, 6);
    return;
  }
  // Palm-ish fronds: flattened, drooping ellipsoids fanned around the stem.
  const fronds = lod === 0 ? 11 : 6;
  b.cyl(0.035, 0.05, 0.75, cx, 0.44, cz, surf('oak', { color: 0x5a3e22 }), 6);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.3;
    const tilt = 0.55 + (i % 3) * 0.22;
    const len = 0.42 + (i % 4) * 0.06;
    const g = new THREE.SphereGeometry(1, lod === 0 ? 8 : 5, 4);
    g.scale(0.09, 0.02, len);
    g.translate(0, 0, len * 0.9);
    const m = at(cx, 1.12 - (i % 3) * 0.06, cz, a, tilt);
    b.add(g, i % 2 ? PALETTE.plantLeaf : PALETTE.plantLeafDark, m);
  }
  if (lod === 0)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const g = new THREE.SphereGeometry(1, 6, 4).scale(0.07, 0.015, 0.22).translate(0, 0, 0.2);
      b.add(g, PALETTE.plantLeaf, at(cx, 1.18, cz, a, -0.5));
    }
}

function neon(b: GeoBuilder, c: ProcContext, lod: Lod): void {
  const cx = c.w / 2;
  const cz = c.h / 2;
  b.cyl(0.22, 0.26, 0.05, cx, 0, cz, PALETTE.blackGloss, lod === 0 ? 20 : 8);
  b.cyl(0.03, 0.03, 1.5, cx, 0.05, cz, PALETTE.brass, 8);
  const panel: Surface = {
    color: 0xffffff,
    rough: 0.3,
    metal: 0,
    emit: 2.6,
    decal: 'neonWords',
    flags: SurfaceFlag.Variant | SurfaceFlag.Flash,
  };
  b.rbox(0.96, 0.5, 0.08, cx, 1.5, cz, PALETTE.blackGloss, 0.04);
  const face = at(cx, 1.75, cz + 0.045, 0, Math.PI / 2);
  b.quad(0.9, 0.44, panel, face);
  const back = at(cx, 1.75, cz - 0.045, Math.PI, Math.PI / 2);
  b.quad(0.9, 0.44, panel, back);
  if (lod === 2) return;
  // Neon tube frame around the panel.
  const tube = PALETTE.neonPink;
  const t = 0.025;
  b.box(0.98, t, t, cx, 1.5 - t, cz, tube);
  b.box(0.98, t, t, cx, 2.0, cz, tube);
  b.box(t, 0.52, t, cx - 0.49, 1.49, cz, tube);
  b.box(t, 0.52, t, cx + 0.49, 1.49, cz, tube);
}

function marquee(b: GeoBuilder, c: ProcContext, lod: Lod): void {
  const cx = c.w / 2;
  const cz = c.h / 2;
  const W = c.w - 0.2;
  // Two fluted posts on plinths.
  for (const x of [cx - W / 2 + 0.08, cx + W / 2 - 0.08]) {
    b.rbox(0.24, 0.12, 0.24, x, 0, cz, PALETTE.marbleBlack, 0.03);
    b.cyl(0.06, 0.07, 1.6, x, 0.12, cz, PALETTE.gold, lod === 0 ? 12 : 6);
  }
  // Sign box with the lit face on both sides.
  b.rbox(W, 1.2, 0.3, cx, 1.65, cz, surf('cabinetPurple', { color: 0x2a0a3a }), 0.06);
  const face: Surface = {
    color: 0xffffff,
    rough: 0.3,
    metal: 0,
    emit: 1.8,
    decal: 'marquee',
    flags: SurfaceFlag.Variant | SurfaceFlag.Flash,
  };
  b.quad(W - 0.3, 0.8, face, at(cx, 2.25, cz + 0.155, 0, Math.PI / 2));
  b.quad(W - 0.3, 0.8, face, at(cx, 2.25, cz - 0.155, Math.PI, Math.PI / 2));
  b.rbox(W + 0.1, 0.1, 0.4, cx, 2.85, cz, PALETTE.gold, 0.04);
  if (lod === 2) return;
  // Chasing bulb border, both faces.
  const n = lod === 0 ? 16 : 8;
  const seg = lod === 0 ? 6 : 4;
  for (const side of [1, -1]) {
    const z = cz + side * 0.16;
    for (let i = 0; i <= n; i++) {
      const x = cx - (W - 0.12) / 2 + (i / n) * (W - 0.12);
      b.sphere(0.03, x, 2.77, z, PALETTE.bulbChase, seg);
      b.sphere(0.03, x, 1.73, z, PALETTE.bulbChase, seg);
    }
    for (let i = 1; i < 6; i++) {
      const y = 1.73 + (i / 6) * 1.04;
      b.sphere(0.03, cx - (W - 0.12) / 2, y, z, PALETTE.bulbChase, seg);
      b.sphere(0.03, cx + (W - 0.12) / 2, y, z, PALETTE.bulbChase, seg);
    }
  }
}

/** Square column with a marble shaft, brass capital and base; placed by the
 *  floor layer at wall corners. Footprint-less: origin at its centre. */
function column(b: GeoBuilder, _c: ProcContext, lod: Lod): void {
  b.rbox(0.5, 0.18, 0.5, 0, 0, 0, PALETTE.brass, 0.03);
  b.rbox(0.4, 2.6, 0.4, 0, 0.18, 0, PALETTE.marbleWhite, lod === 0 ? 0.05 : 0.01);
  b.rbox(0.5, 0.16, 0.5, 0, 2.78, 0, PALETTE.brass, 0.03);
  b.rbox(0.56, 0.08, 0.56, 0, 2.94, 0, PALETTE.gold, 0.02);
}

/** Tiered crystal chandelier, hung from y = 0 downward. */
function chandelier(b: GeoBuilder, _c: ProcContext, lod: Lod): void {
  b.cyl(0.015, 0.015, 0.6, 0, -0.6, 0, PALETTE.gold, 6);
  const seg = lod === 0 ? 20 : 10;
  for (const [r, y] of [
    [0.55, -1.0],
    [0.38, -0.85],
    [0.22, -0.72],
  ] as const) {
    b.add(new THREE.TorusGeometry(r, 0.025, 6, seg), PALETTE.gold, at(0, y, 0, 0, Math.PI / 2));
    const n = lod === 0 ? Math.round(r * 22) : Math.round(r * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const g = new THREE.OctahedronGeometry(0.035, 0).scale(1, 2.2, 1);
      b.add(g, PALETTE.lampWarm, at(Math.cos(a) * r, y - 0.09, Math.sin(a) * r));
    }
  }
  b.sphere(0.12, 0, -1.05, 0, PALETTE.lampWarm, lod === 0 ? 10 : 6);
}

function stanchion(b: GeoBuilder, _c: ProcContext, lod: Lod): void {
  b.cyl(0.13, 0.15, 0.04, 0, 0, 0, PALETTE.brass, lod === 0 ? 14 : 8);
  b.cyl(0.025, 0.025, 0.86, 0, 0.04, 0, PALETTE.brass, 8);
  b.sphere(0.045, 0, 0.94, 0, PALETTE.gold, 8);
}

export { roundedRect };
