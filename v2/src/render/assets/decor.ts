// The six pre-agreed decor items (NEXT-SESSION.md, "Pre-agreed new decor").
// Their gameplay defs (data/objects.ts) are Track B's, in B6; until they land,
// the renderer and the ambience use these footprints so the A10 art sits right.

export const DECOR_FOOTPRINTS: Record<string, { w: number; h: number }> = {
  statue: { w: 1, h: 1 },
  fountain: { w: 3, h: 3 },
  'lamp-post': { w: 1, h: 1 },
  'lounge-seating': { w: 2, h: 1 },
  atm: { w: 1, h: 1 },
  stage: { w: 4, h: 3 },
};
