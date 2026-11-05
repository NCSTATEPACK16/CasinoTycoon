// Where the avatar's bets go on a table's printed layout: a point clicked on
// the felt becomes a bet spot the engine understands, and a spot has a place
// on the felt for its chips. Pure, so the hit mapping can be tested.
//
// The roulette layout is the atlas's rouletteFelt sheet (Atlas.ts), 512 × 224
// px, laid on the roulette hero's felt (heroes.py roulette_table) from table-
// local x 0.11–1.33 and z 0.62–1.46: the zero at the low-x end, the even-money
// row nearest the players.

const FELT = { x0: 0.11, x1: 1.33, z0: 0.62, z1: 1.46 };
const W = 512;
const H = 224;
// The sheet's own grid (Atlas.ts rouletteFelt).
const X0 = 60;
const CW = (W - X0 - 50) / 12;
const Y0 = 10;
const CH = (H - 80) / 3;
const GRID_Y1 = Y0 + CH * 3;
/** How near a line (as a share of a cell) a click counts as on it. */
const EDGE = 0.22;

export type Wheel = 'single' | 'double';

/** A table-local felt point as sheet pixels. */
export function toSheet(x: number, z: number): { u: number; v: number } {
  return {
    u: ((x - FELT.x0) / (FELT.x1 - FELT.x0)) * W,
    v: ((z - FELT.z0) / (FELT.z1 - FELT.z0)) * H,
  };
}

/** Sheet pixels as a table-local felt point. */
export function fromSheet(u: number, v: number): { x: number; z: number } {
  return {
    x: FELT.x0 + (u / W) * (FELT.x1 - FELT.x0),
    z: FELT.z0 + (v / H) * (FELT.z1 - FELT.z0),
  };
}

/** The number printed in grid column c (0..11), row r (0..2: 3s on top). */
const numberAt = (c: number, r: number) => c * 3 + (3 - r);

/** The roulette bet under a sheet point, or null off the layout. */
export function rouletteSpotAt(u: number, v: number, wheel: Wheel): string | null {
  if (v < Y0 || v > H - 10) return null;
  if (v < GRID_Y1) {
    if (u >= 18 && u < X0) {
      if (wheel === 'double' && v < Y0 + CH * 1.5) return 'straight:00';
      return 'straight:0';
    }
    if (u >= X0 + CW * 12 && u < X0 + CW * 12 + 40) {
      const r = Math.floor((v - Y0) / CH);
      return `column:${3 - r}`;
    }
    if (u < X0 || u >= X0 + CW * 12) return null;
    const c = Math.floor((u - X0) / CW);
    const r = Math.min(2, Math.floor((v - Y0) / CH));
    const fx = (u - X0) / CW - c;
    const fy = (v - Y0) / CH - r;
    // Which neighbouring columns and rows the click touches.
    const cs = fx < EDGE && c > 0 ? [c - 1, c] : fx > 1 - EDGE && c < 11 ? [c, c + 1] : [c];
    const outer = r === 2 && fy > 1 - EDGE;
    if (outer) {
      // The players' edge of the bottom row: a street, or six-line on a line.
      if (fx < EDGE && c === 0) return 'basket';
      const first = numberAt(cs[0]!, 2);
      return cs.length === 2 ? `sixline:${first}` : `street:${first}`;
    }
    const rs = fy < EDGE && r > 0 ? [r - 1, r] : fy > 1 - EDGE && r < 2 ? [r, r + 1] : [r];
    const nums = cs.flatMap((cc) => rs.map((rr) => numberAt(cc, rr))).sort((a, b) => a - b);
    if (nums.length === 1) return `straight:${nums[0]}`;
    if (nums.length === 2) return `split:${nums[0]}-${nums[1]}`;
    return `corner:${nums[0]}`;
  }
  if (u < X0 || u >= X0 + CW * 12) return null;
  if (v < GRID_Y1 + 30) return `dozen:${Math.floor((u - X0) / (CW * 4)) + 1}`;
  return ['low', 'even', 'red', 'black', 'odd', 'high'][Math.floor((u - X0) / (CW * 2))] ?? null;
}

/** Where a roulette spot's chips sit, in sheet pixels. */
export function rouletteSpotCentre(spot: string): { u: number; v: number } | null {
  const [kind, arg = ''] = spot.split(':');
  const cell = (n: number) => {
    const c = Math.floor((n - 1) / 3);
    const r = 3 - (n - c * 3);
    return { u: X0 + (c + 0.5) * CW, v: Y0 + (r + 0.5) * CH };
  };
  const mid = (ns: number[]) => {
    const ps = ns.map(cell);
    return {
      u: ps.reduce((t, p) => t + p.u, 0) / ps.length,
      v: ps.reduce((t, p) => t + p.v, 0) / ps.length,
    };
  };
  const a = Number(arg);
  switch (kind) {
    case 'straight':
      if (arg === '00') return { u: 39, v: Y0 + CH * 0.75 };
      if (a === 0) return { u: 39, v: Y0 + CH * 1.5 };
      return cell(a);
    case 'split': {
      const [x, y] = arg.split('-').map(Number);
      return mid([x!, y!]);
    }
    case 'corner':
      return mid([a, a + 1, a + 3, a + 4]);
    case 'street':
      return { u: cell(a).u, v: GRID_Y1 - 3 };
    case 'sixline':
      return { u: (cell(a).u + cell(a + 3).u) / 2, v: GRID_Y1 - 3 };
    case 'basket':
      return { u: X0 + 2, v: GRID_Y1 - 3 };
    case 'column':
      return { u: X0 + CW * 12 + 20, v: Y0 + (3 - a + 0.5) * CH };
    case 'dozen':
      return { u: X0 + (a - 0.5) * CW * 4, v: GRID_Y1 + 15 };
    default: {
      const i = ['low', 'even', 'red', 'black', 'odd', 'high'].indexOf(spot);
      return i < 0 ? null : { u: X0 + (i + 0.5) * CW * 2, v: GRID_Y1 + 45 };
    }
  }
}

/** The chips a tray offers for a table's limits: standard values inside them. */
export function trayChips(min: number, max: number): number[] {
  const std = [1, 5, 25, 100, 500, 1000, 5000];
  const out = std.filter((v) => v >= min && v <= max);
  if (!out.includes(min) && min > 0) out.unshift(min);
  return out.slice(0, 6);
}
