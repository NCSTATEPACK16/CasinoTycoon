// Named surfaces shared by the Blender scripts (assets/blender/palette.py uses
// the same names and values) and the procedural builders. Every static asset
// is collapsed into ONE material at load: base colour goes to the vertex
// colour, roughness/metalness/emissive to a per-vertex `aPbr`, and printed
// art (felt layouts, reel windows, toppers) to a shared decal atlas. That is
// what keeps a floor of 2,000 objects at one draw per (asset, LOD).

export interface Surface {
  color: number;
  rough: number;
  metal: number;
  /** Emissive strength in HDR units; > ~1 crosses the bloom threshold. */
  emit?: number;
  /** Decal atlas key; the vertex colour then multiplies the decal texel. */
  decal?: string;
  /** Bit flags, see SurfaceFlag. */
  flags?: number;
  /** Linear-space colour override (GLB materials arrive already linear). */
  rgb?: [number, number, number];
}

export const SurfaceFlag = {
  /** Brightens when the instance's win-flash fires (slot toppers, marquee bulbs). */
  Flash: 1,
  /** Picks a decal row by the instance variant (neon words, topper themes). */
  Variant: 2,
  /** Chases: emissive pulses along x to fake marquee bulb chasers. */
  Chase: 4,
} as const;

export const PALETTE = {
  white: { color: 0xffffff, rough: 0.6, metal: 0 },
  brass: { color: 0xd9a441, rough: 0.28, metal: 1 },
  gold: { color: 0xf2c14e, rough: 0.22, metal: 1 },
  chrome: { color: 0xd8dde3, rough: 0.12, metal: 1 },
  gunmetal: { color: 0x3a3f4b, rough: 0.35, metal: 0.8 },
  blackGloss: { color: 0x14141a, rough: 0.18, metal: 0.1 },
  blackMatte: { color: 0x1c1b22, rough: 0.7, metal: 0 },
  leatherRed: { color: 0x7a1424, rough: 0.55, metal: 0 },
  leatherBlack: { color: 0x221c22, rough: 0.5, metal: 0 },
  mahogany: { color: 0x5a2414, rough: 0.38, metal: 0 },
  walnut: { color: 0x3e2414, rough: 0.42, metal: 0 },
  oak: { color: 0x9a6a3c, rough: 0.5, metal: 0 },
  feltGreen: { color: 0x1a7a42, rough: 0.95, metal: 0 },
  feltDeep: { color: 0x0f4f3a, rough: 0.95, metal: 0 },
  feltBlue: { color: 0x174e8a, rough: 0.95, metal: 0 },
  feltPurple: { color: 0x5a2a7a, rough: 0.95, metal: 0 },
  feltRed: { color: 0x8a1a2a, rough: 0.95, metal: 0 },
  cabinetRed: { color: 0xb3172f, rough: 0.3, metal: 0.4 },
  cabinetBlue: { color: 0x1d4fb8, rough: 0.3, metal: 0.4 },
  cabinetPurple: { color: 0x6a2bb0, rough: 0.3, metal: 0.4 },
  cabinetTeal: { color: 0x0f8a8a, rough: 0.3, metal: 0.4 },
  cabinetOrange: { color: 0xe0661a, rough: 0.3, metal: 0.4 },
  glassDark: { color: 0x0b0d14, rough: 0.05, metal: 0.2 },
  marbleWhite: { color: 0xece6dc, rough: 0.2, metal: 0 },
  marbleBlack: { color: 0x26232a, rough: 0.2, metal: 0 },
  tileWhite: { color: 0xe8eef2, rough: 0.3, metal: 0 },
  plaster: { color: 0xe9dcc6, rough: 0.85, metal: 0 },
  wallpaper: { color: 0x5b1a2c, rough: 0.8, metal: 0 },
  stainless: { color: 0xb8bec6, rough: 0.3, metal: 1 },
  ceramic: { color: 0xf4f4f4, rough: 0.15, metal: 0 },
  plantLeaf: { color: 0x2f8a3a, rough: 0.6, metal: 0 },
  plantLeafDark: { color: 0x1d5e2a, rough: 0.65, metal: 0 },
  soil: { color: 0x2a1c12, rough: 1, metal: 0 },
  velvet: { color: 0x9c0f2a, rough: 0.9, metal: 0 },
  // Emissive surfaces.
  bulbWarm: { color: 0xffd27a, rough: 0.4, metal: 0, emit: 3.2, flags: SurfaceFlag.Flash },
  bulbChase: {
    color: 0xffd27a,
    rough: 0.4,
    metal: 0,
    emit: 3.5,
    flags: SurfaceFlag.Flash | SurfaceFlag.Chase,
  },
  lampWarm: { color: 0xffe2b0, rough: 0.5, metal: 0, emit: 2.2 },
  screenBlue: { color: 0xffffff, rough: 0.1, metal: 0, emit: 1.2, decal: 'vpScreen' },
  neonPink: { color: 0xff2e88, rough: 0.4, metal: 0, emit: 4 },
  neonCyan: { color: 0x33e6ff, rough: 0.4, metal: 0, emit: 4 },
  neonGold: { color: 0xffc94d, rough: 0.4, metal: 0, emit: 4 },
  neonPurple: { color: 0xa64dff, rough: 0.4, metal: 0, emit: 4 },
} satisfies Record<string, Surface>;

export type PaletteName = keyof typeof PALETTE;

export function surf(name: PaletteName, over: Partial<Surface> = {}): Surface {
  return { ...PALETTE[name], ...over };
}
