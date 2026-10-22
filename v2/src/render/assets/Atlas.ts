// One 2048-wide canvas holding every printed surface: felt layouts, reel windows,
// slot toppers, neon words, the big-six face. Painting them in code keeps the
// text crisp at any zoom and lets every static asset share a single material
// (see Palette.ts). Variant decals stack `rows` copies vertically; the object
// shader offsets v by the instance's variant (ObjectLayer sets it).

import * as THREE from 'three';

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** For variant decals: rows stacked downward, and the v step between them. */
  rows: number;
  stepV: number;
}

type Painter = (g: CanvasRenderingContext2D, w: number, h: number, row: number) => void;

const SIZE = 2048;
const PAD = 6;

const FELT_FONT = '"Georgia", "Times New Roman", serif';
const SIGN_FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

interface DecalSpec {
  w: number;
  h: number;
  rows?: number;
  paint: Painter;
}

const DECALS: Record<string, DecalSpec> = {
  bjFelt: { w: 512, h: 288, paint: (g, w, h) => blackjackFelt(g, w, h, '#1b7a44', '#f4e7c1') },
  bjFeltHL: { w: 512, h: 288, paint: (g, w, h) => blackjackFelt(g, w, h, '#20193d', '#e8c06a') },
  crapsFelt: { w: 640, h: 352, paint: crapsFelt },
  rouletteFelt: { w: 512, h: 224, paint: rouletteFelt },
  rouletteWheel: { w: 256, h: 256, paint: rouletteWheel },
  uthFelt: { w: 512, h: 288, paint: uthFelt },
  carnivalFelt: { w: 512, h: 288, paint: carnivalFelt },
  slotReels: { w: 192, h: 128, paint: slotReels },
  slotTopper: { w: 256, h: 96, rows: 4, paint: slotTopper },
  pennyScreen: { w: 192, h: 160, rows: 3, paint: pennyScreen },
  pennyTopper: { w: 256, h: 96, rows: 3, paint: pennyTopper },
  vpScreen: { w: 192, h: 144, paint: vpScreen },
  pachinkoFace: { w: 192, h: 256, paint: pachinkoFace },
  bigSixFace: { w: 384, h: 384, paint: bigSixFace },
  neonWords: { w: 384, h: 128, rows: 6, paint: neonWords },
  marquee: { w: 512, h: 160, rows: 3, paint: marqueeSign },
  menuBoard: { w: 384, h: 160, paint: menuBoard },
  barShelf: { w: 512, h: 192, paint: barShelf },
  cageSign: { w: 384, h: 96, paint: (g, w, h) => plaque(g, w, h, 'CASHIER') },
  restroomSign: { w: 256, h: 96, paint: restroomSign },
  kenoBoard: { w: 384, h: 192, paint: kenoBoard },
  bingoBoard: { w: 512, h: 192, paint: bingoBoard },
  wallpaper: { w: 256, h: 256, paint: wallpaper },
  carpetRed: { w: 256, h: 256, paint: (g, w, h) => carpet(g, w, h, CARPETS.red) },
  carpetBlue: { w: 256, h: 256, paint: (g, w, h) => carpet(g, w, h, CARPETS.blue) },
  marble: { w: 256, h: 256, paint: marble },
  wood: { w: 256, h: 256, paint: woodFloor },
  tile: { w: 256, h: 256, paint: tileFloor },
  cardFace: { w: 64, h: 96, paint: cardFace },
};

export class DecalAtlas {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly texture: THREE.Texture;
  readonly white: UvRect;
  readonly height: number;
  private rects = new Map<string, UvRect>();

  constructor() {
    // Shelf-pack tallest first; the canvas is as tall as the packing needs.
    const order = Object.entries(DECALS).sort((a, b) => b[1].h * (b[1].rows ?? 1) - a[1].h * (a[1].rows ?? 1));
    const slots: { key: string; d: DecalSpec; x: number; y: number }[] = [];
    let x = 64;
    let y = 0;
    let shelf = 64;
    for (const [key, d] of order) {
      const h = d.h * (d.rows ?? 1);
      if (x + d.w + PAD * 2 > SIZE) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      slots.push({ key, d, x: x + PAD, y: y + PAD });
      x += d.w + PAD * 2;
      shelf = Math.max(shelf, h + PAD * 2);
    }
    this.height = Math.ceil((y + shelf) / 256) * 256;
    const canvas =
      typeof document !== 'undefined'
        ? Object.assign(document.createElement('canvas'), { width: SIZE, height: this.height })
        : new OffscreenCanvas(SIZE, this.height);
    this.canvas = canvas;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, SIZE, this.height);
    this.white = this.toUv(8, 8, 48, 48, 1);
    for (const { key, d, x: sx, y: sy } of slots) {
      const rows = d.rows ?? 1;
      for (let r = 0; r < rows; r++) {
        g.save();
        g.translate(sx, sy + r * d.h);
        g.beginPath();
        g.rect(0, 0, d.w, d.h);
        g.clip();
        d.paint(g, d.w, d.h, r);
        g.restore();
      }
      bleed(g, sx, sy, d.w, d.h * rows);
      this.rects.set(key, this.toUv(sx, sy, d.w, d.h, rows));
    }
    const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture = tex;
  }

  rect(key: string): UvRect {
    const r = this.rects.get(key);
    if (!r) {
      console.warn(`DecalAtlas: unknown decal '${key}'`);
      return this.white;
    }
    return r;
  }

  has(key: string): boolean {
    return this.rects.has(key);
  }

  private toUv(x: number, y: number, w: number, h: number, rows: number): UvRect {
    // CanvasTexture flips Y, so canvas top is v = 1. Inset half a texel.
    const i = 0.5;
    const H = this.height;
    return {
      u0: (x + i) / SIZE,
      u1: (x + w - i) / SIZE,
      v1: 1 - (y + i) / H,
      v0: 1 - (y + h - i) / H,
      rows,
      stepV: h / H,
    };
  }
}

/** Smear each decal's edge pixels into its padding so mipmaps don't pull in
 *  the neighbour's colours. */
function bleed(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const c = g.canvas as HTMLCanvasElement;
  for (let k = 1; k <= PAD; k++) {
    g.drawImage(c, x, y, w, 1, x, y - k, w, 1);
    g.drawImage(c, x, y + h - 1, w, 1, x, y + h - 1 + k, w, 1);
  }
  for (let k = 1; k <= PAD; k++) {
    g.drawImage(c, x, y - PAD, 1, h + PAD * 2, x - k, y - PAD, 1, h + PAD * 2);
    g.drawImage(c, x + w - 1, y - PAD, 1, h + PAD * 2, x + w - 1 + k, y - PAD, 1, h + PAD * 2);
  }
}

// ---------- shared drawing helpers ----------

function feltBase(g: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  // Felt nap: faint noise and a soft centre lift so it reads as cloth.
  const grad = g.createRadialGradient(w / 2, h * 0.45, 10, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, 'rgba(0,0,0,0.22)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  noise(g, w, h, 0.05);
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, amt: number, seed = 1): void {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < (w * h) / 6; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${amt * rnd()})`;
    g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5);
  }
}

function arcText(
  g: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  r: number,
  mid: number,
  font: string,
): void {
  g.save();
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const total = g.measureText(text).width / r;
  let a = mid - total / 2;
  for (const ch of text) {
    const cw = g.measureText(ch).width / r;
    g.save();
    g.translate(cx + Math.cos(a + cw / 2) * r, cy + Math.sin(a + cw / 2) * r);
    g.rotate(a + cw / 2 - Math.PI / 2 + Math.PI);
    g.fillText(ch, 0, 0);
    g.restore();
    a += cw;
  }
  g.restore();
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, lw = 2) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.stroke();
}

function text(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  size: number,
  color: string,
  font = FELT_FONT,
  weight = 'bold',
): void {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

function chipStack(g: CanvasRenderingContext2D, x: number, y: number, color: string, r = 9): void {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.setLineDash([3, 3]);
  g.lineWidth = 2.5;
  ring(g, x, y, r - 2, 'rgba(255,255,255,0.85)', 2.5);
  g.setLineDash([]);
}

// ---------- felt layouts ----------

function blackjackFelt(g: CanvasRenderingContext2D, w: number, h: number, felt: string, ink: string) {
  feltBase(g, w, h, felt);
  // The table is a kidney: dealer at the top (v = 1, back), players around the arc.
  const cx = w / 2;
  const cy = -h * 0.55;
  g.strokeStyle = ink;
  g.fillStyle = ink;
  arcText(g, 'BLACKJACK PAYS 3 TO 2', cx, cy, h * 1.02, Math.PI / 2, `bold 22px ${FELT_FONT}`);
  arcText(g, 'Dealer must draw to 16 and stand on all 17s', cx, cy, h * 1.18, Math.PI / 2, `italic 14px ${FELT_FONT}`);
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, cy, h * 1.27, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
  arcText(g, 'INSURANCE PAYS 2 TO 1', cx, cy, h * 1.34, Math.PI / 2, `bold 13px ${FELT_FONT}`);
  g.beginPath();
  g.arc(cx, cy, h * 1.41, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();
  // Five betting spots around the arc.
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.27 + i * 0.115);
    const r = h * 1.53;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    ring(g, x, y, 17, ink, 2.5);
    g.save();
    g.translate(x, y);
    g.rotate(a - Math.PI / 2);
    g.strokeRect(-14, -50, 28, 24);
    g.restore();
  }
  // Chip tray recess and shoe outline at the dealer edge.
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(cx - 90, 4, 180, 30);
  const chips = ['#c0392b', '#2e86de', '#27ae60', '#111', '#8e44ad', '#f1c40f'];
  chips.forEach((c, i) => chipStack(g, cx - 75 + i * 30, 19, c, 11));
  g.strokeStyle = ink;
  g.lineWidth = 1.5;
  g.strokeRect(w * 0.78, 10, 46, 28);
  g.strokeRect(w * 0.12, 10, 40, 28);
}

function crapsFelt(g: CanvasRenderingContext2D, w: number, h: number) {
  feltBase(g, w, h, '#17723f');
  const ink = '#f7efd8';
  const yel = '#f5d142';
  const red = '#e23b3b';
  g.strokeStyle = ink;
  g.lineWidth = 2.5;
  // Two mirrored player sides around a centre proposition box.
  const mid = w / 2;
  const propW = w * 0.22;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(mid, 0);
    g.scale(side, 1);
    const x0 = propW / 2 + 6;
    const x1 = w / 2 - 12;
    // Place numbers row.
    const nums = ['4', '5', 'SIX', '8', 'NINE', '10'];
    const bw = (x1 - x0) / 6;
    for (let i = 0; i < 6; i++) {
      const bx = x0 + i * bw;
      g.strokeRect(bx, 18, bw, h * 0.26);
      g.save();
      g.translate(bx + bw / 2, 18 + h * 0.13);
      g.scale(side, 1);
      text(g, nums[i]!, 0, 0, i === 2 || i === 4 ? 18 : 26, ink, SIGN_FONT, '900');
      g.restore();
    }
    // Come box.
    g.strokeRect(x0, 18 + h * 0.26, x1 - x0, h * 0.2);
    g.save();
    g.translate((x0 + x1) / 2, 18 + h * 0.36);
    g.scale(side, 1);
    text(g, 'COME', 0, 0, 34, red, SIGN_FONT, '900');
    g.restore();
    // Field.
    g.strokeRect(x0, 18 + h * 0.46, x1 - x0, h * 0.2);
    g.save();
    g.translate((x0 + x1) / 2, 18 + h * 0.56);
    g.scale(side, 1);
    text(g, '2 · 3 · 4 · 9 · 10 · 11 · 12', 0, -8, 15, ink, SIGN_FONT, '900');
    text(g, 'FIELD', 0, 12, 18, yel, SIGN_FONT, '900');
    g.restore();
    // Don't pass bar and the pass line wrapping the bottom.
    g.strokeRect(x0, 18 + h * 0.66, x1 - x0, h * 0.09);
    g.save();
    g.translate((x0 + x1) / 2, 18 + h * 0.705);
    g.scale(side, 1);
    text(g, "DON'T PASS BAR ⚀⚀", 0, 0, 13, ink, SIGN_FONT, '700');
    g.restore();
    g.strokeRect(x0, 18 + h * 0.75, x1 - x0, h * 0.14);
    g.save();
    g.translate((x0 + x1) / 2, 18 + h * 0.82);
    g.scale(side, 1);
    text(g, 'PASS LINE', 0, 0, 24, ink, SIGN_FONT, '900');
    g.restore();
    g.restore();
  }
  // Proposition box.
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(mid - propW / 2, 18, propW, h * 0.86);
  g.strokeRect(mid - propW / 2, 18, propW, h * 0.86);
  text(g, 'SEVEN', mid, 36, 15, red, SIGN_FONT, '900');
  const hw = ['⚂⚂', '⚃⚃', '⚁⚁', '⚄⚄'];
  for (let i = 0; i < 4; i++) {
    const bx = mid - propW / 2 + (i % 2) * (propW / 2);
    const by = 52 + Math.floor(i / 2) * 50;
    g.strokeRect(bx, by, propW / 2, 50);
    text(g, hw[i]!, bx + propW / 4, by + 25, 22, ink, 'sans-serif', '400');
  }
  text(g, 'ANY CRAPS', mid, 175, 13, red, SIGN_FONT, '900');
  g.strokeRect(mid - propW / 2, 160, propW, 30);
  text(g, 'C · E', mid, 215, 18, yel, SIGN_FONT, '900');
}

const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function rouletteFelt(g: CanvasRenderingContext2D, w: number, h: number) {
  feltBase(g, w, h, '#17723f');
  const ink = '#f7efd8';
  g.strokeStyle = ink;
  g.lineWidth = 2;
  const x0 = 60;
  const cw = (w - x0 - 50) / 12;
  const ch = (h - 80) / 3;
  // Zero (single-zero wheel layout; the American variant shares the felt art).
  g.beginPath();
  g.moveTo(x0, 10);
  g.lineTo(x0, 10 + ch * 3);
  g.lineTo(18, 10 + ch * 1.5);
  g.closePath();
  g.fillStyle = '#1e9b4f';
  g.fill();
  g.stroke();
  text(g, '0', 42, 10 + ch * 1.5, 22, ink, SIGN_FONT, '900');
  for (let c = 0; c < 12; c++)
    for (let r = 0; r < 3; r++) {
      const n = c * 3 + (3 - r);
      const x = x0 + c * cw;
      const y = 10 + r * ch;
      g.strokeRect(x, y, cw, ch);
      g.fillStyle = RED_NUMS.has(n) ? '#c8202e' : '#15151a';
      g.beginPath();
      g.ellipse(x + cw / 2, y + ch / 2, cw * 0.36, ch * 0.36, 0, 0, Math.PI * 2);
      g.fill();
      text(g, String(n), x + cw / 2, y + ch / 2 + 1, 17, '#fff', SIGN_FONT, '900');
    }
  for (let r = 0; r < 3; r++) {
    g.strokeRect(x0 + cw * 12, 10 + r * ch, 40, ch);
    text(g, '2:1', x0 + cw * 12 + 20, 10 + r * ch + ch / 2, 13, ink, SIGN_FONT, '700');
  }
  const dz = ['1st 12', '2nd 12', '3rd 12'];
  for (let i = 0; i < 3; i++) {
    g.strokeRect(x0 + i * cw * 4, 10 + ch * 3, cw * 4, 30);
    text(g, dz[i]!, x0 + i * cw * 4 + cw * 2, 25 + ch * 3, 15, ink, FELT_FONT);
  }
  const ev = ['1-18', 'EVEN', '◆', '◆', 'ODD', '19-36'];
  for (let i = 0; i < 6; i++) {
    const x = x0 + i * cw * 2;
    g.strokeRect(x, 40 + ch * 3, cw * 2, 30);
    if (i === 2 || i === 3) {
      g.fillStyle = i === 2 ? '#c8202e' : '#15151a';
      g.beginPath();
      g.moveTo(x + cw, 44 + ch * 3);
      g.lineTo(x + cw * 1.6, 55 + ch * 3);
      g.lineTo(x + cw, 66 + ch * 3);
      g.lineTo(x + cw * 0.4, 55 + ch * 3);
      g.fill();
    } else text(g, ev[i]!, x + cw, 55 + ch * 3, 14, ink, FELT_FONT);
  }
}

const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

function rouletteWheel(g: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const R = w / 2;
  g.fillStyle = '#4a2412';
  g.fillRect(0, 0, w, h);
  const n = WHEEL_ORDER.length;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const num = WHEEL_ORDER[i]!;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R * 0.92, a0, a1);
    g.closePath();
    g.fillStyle = num === 0 ? '#1e9b4f' : RED_NUMS.has(num) ? '#c8202e' : '#121216';
    g.fill();
    g.save();
    g.translate(cx, cy);
    g.rotate((a0 + a1) / 2 + Math.PI / 2);
    text(g, String(num), 0, -R * 0.82, 11, '#fff', SIGN_FONT, '700');
    g.restore();
  }
  // Ball track and the brass turret in the middle.
  ring(g, cx, cy, R * 0.92, '#d9a441', 4);
  ring(g, cx, cy, R * 0.74, '#d9a441', 3);
  const turret = g.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, R * 0.6);
  turret.addColorStop(0, '#5c2c14');
  turret.addColorStop(0.6, '#3a1a0c');
  turret.addColorStop(1, '#25110a');
  g.fillStyle = turret;
  g.beginPath();
  g.arc(cx, cy, R * 0.6, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 4; i++) {
    g.save();
    g.translate(cx, cy);
    g.rotate((i * Math.PI) / 2);
    g.fillStyle = '#e8b85a';
    g.fillRect(-4, -R * 0.5, 8, R * 0.5);
    g.restore();
  }
  g.fillStyle = '#f2c14e';
  g.beginPath();
  g.arc(cx, cy, 14, 0, Math.PI * 2);
  g.fill();
}

function uthFelt(g: CanvasRenderingContext2D, w: number, h: number) {
  feltBase(g, w, h, '#16567a');
  const ink = '#f4ead0';
  const cx = w / 2;
  const cy = -h * 0.55;
  g.fillStyle = ink;
  arcText(g, "ULTIMATE TEXAS HOLD'EM", cx, cy, h * 1.04, Math.PI / 2, `bold 22px ${FELT_FONT}`);
  arcText(g, 'Dealer needs a pair or better to open', cx, cy, h * 1.16, Math.PI / 2, `italic 13px ${FELT_FONT}`);
  // Community card line.
  for (let i = 0; i < 5; i++) {
    g.strokeStyle = 'rgba(244,234,208,0.7)';
    g.lineWidth = 1.5;
    g.strokeRect(cx - 100 + i * 40, 30, 32, 44);
  }
  for (let i = 0; i < 4; i++) {
    const a = Math.PI * (0.3 + i * 0.133);
    const r = h * 1.48;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    g.save();
    g.translate(x, y);
    g.rotate(a - Math.PI / 2);
    g.strokeStyle = ink;
    g.lineWidth = 2;
    for (const [dx, dy, lab] of [
      [-18, -16, 'ANTE'],
      [18, -16, 'BLIND'],
      [0, 14, 'PLAY'],
      [0, -46, 'TRIPS'],
    ] as const) {
      ring(g, dx, dy, 14, ink, 2);
      text(g, lab, dx, dy, 7, ink, SIGN_FONT, '700');
    }
    g.restore();
  }
}

function carnivalFelt(g: CanvasRenderingContext2D, w: number, h: number) {
  feltBase(g, w, h, '#6a2a8a');
  const ink = '#f7e6a4';
  const cx = w / 2;
  const cy = -h * 0.55;
  g.fillStyle = ink;
  arcText(g, 'THREE CARD POKER', cx, cy, h * 1.04, Math.PI / 2, `bold 24px ${FELT_FONT}`);
  arcText(g, 'PAIR PLUS · ANTE BONUS · 6 CARD BONUS', cx, cy, h * 1.17, Math.PI / 2, `bold 12px ${FELT_FONT}`);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.27 + i * 0.115);
    const r = h * 1.5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    g.save();
    g.translate(x, y);
    g.rotate(a - Math.PI / 2);
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -36);
    g.lineTo(12, -24);
    g.lineTo(0, -12);
    g.lineTo(-12, -24);
    g.closePath();
    g.stroke();
    ring(g, 0, 4, 12, ink, 2);
    ring(g, 0, 30, 10, ink, 2);
    g.restore();
  }
}

// ---------- machines ----------

const SYMBOLS = ['7', 'BAR', '🍒', '◆', '🔔', '7', 'BAR'];

function slotReels(g: CanvasRenderingContext2D, w: number, h: number) {
  const rw = w / 3;
  for (let r = 0; r < 3; r++) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#8a8a8a');
    grad.addColorStop(0.5, '#ffffff');
    grad.addColorStop(1, '#8a8a8a');
    g.fillStyle = grad;
    g.fillRect(r * rw + 2, 0, rw - 4, h);
    for (let s = 0; s < 3; s++) {
      const sym = SYMBOLS[(r * 2 + s) % SYMBOLS.length]!;
      const y = h * (0.18 + s * 0.32);
      const col = sym === '7' ? '#d01818' : sym === 'BAR' ? '#111' : '#1a4fd0';
      text(g, sym, r * rw + rw / 2, y, sym === 'BAR' ? 20 : 34, col, SIGN_FONT, '900');
    }
  }
  // Payline.
  g.fillStyle = 'rgba(220,30,30,0.85)';
  g.fillRect(0, h / 2 - 1.5, w, 3);
}

const TOPPERS = [
  ['#7a0d1a', '#ffcf3f', '777', 'JACKPOT'],
  ['#0d2a7a', '#9fe8ff', 'DOUBLE', 'DIAMOND'],
  ['#3d1a00', '#ffb347', 'BUFFALO', 'GOLD'],
  ['#3a0d6a', '#ff7af2', 'LUCKY', 'STARS'],
] as const;

function slotTopper(g: CanvasRenderingContext2D, w: number, h: number, row: number) {
  const [bg, fg, a, b] = TOPPERS[row % TOPPERS.length]!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // Sunburst behind the title.
  g.save();
  g.translate(w / 2, h * 0.55);
  for (let i = 0; i < 24; i++) {
    g.rotate((Math.PI * 2) / 24);
    g.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(255,220,120,0.14)';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(w, -12);
    g.lineTo(w, 12);
    g.fill();
  }
  g.restore();
  g.shadowColor = fg;
  g.shadowBlur = 10;
  text(g, a, w / 2, h * 0.36, 34, fg, SIGN_FONT, '900');
  text(g, b, w / 2, h * 0.75, 24, '#fff', SIGN_FONT, '900');
  g.shadowBlur = 0;
  // Bulb border.
  for (let i = 0; i < 16; i++) {
    g.fillStyle = '#ffe9a8';
    g.beginPath();
    g.arc(8 + (i * (w - 16)) / 15, 5, 3, 0, Math.PI * 2);
    g.arc(8 + (i * (w - 16)) / 15, h - 5, 3, 0, Math.PI * 2);
    g.fill();
  }
}

function pennyScreen(g: CanvasRenderingContext2D, w: number, h: number, row: number) {
  const themes = [
    ['#062a4a', '#5ad1ff'],
    ['#3a0631', '#ff6ad5'],
    ['#063a1c', '#7dff8a'],
  ] as const;
  const [bg, fg] = themes[row % 3]!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  const cols = 5;
  const rows = 3;
  const cw = w / cols;
  const ch = (h - 26) / rows;
  const syms = ['A', 'K', 'Q', 'J', '10', '★', '♦', '♥'];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(c * cw + 2, 24 + r * ch + 2, cw - 4, ch - 4);
      const s = syms[(c * 3 + r * 5 + row) % syms.length]!;
      text(g, s, c * cw + cw / 2, 24 + r * ch + ch / 2, 22, fg, SIGN_FONT, '900');
    }
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, 22);
  text(g, 'CREDITS 1,250   BET 40', w / 2, 11, 11, '#ffd34d', 'monospace', '700');
}

function pennyTopper(g: CanvasRenderingContext2D, w: number, h: number, row: number) {
  const names = [
    ['#09223f', '#5ad1ff', 'OCEAN', 'TREASURE'],
    ['#2a0626', '#ff6ad5', 'DRAGON', 'FORTUNE'],
    ['#06301a', '#7dff8a', 'LUCKY', 'CLOVER'],
  ] as const;
  const [bg, fg, a, b] = names[row % 3]!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.shadowColor = fg;
  g.shadowBlur = 14;
  text(g, a, w / 2, h * 0.36, 30, fg, SIGN_FONT, '900');
  text(g, b, w / 2, h * 0.74, 22, '#fff', SIGN_FONT, '900');
  g.shadowBlur = 0;
}

function vpScreen(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#0a1f8a';
  g.fillRect(0, 0, w, h);
  const pays = ['ROYAL FLUSH 800', 'STR FLUSH 50', '4 OF A KIND 25', 'FULL HOUSE 9', 'FLUSH 6'];
  pays.forEach((p, i) => text(g, p, w / 2, 12 + i * 13, 10, '#ffe34d', 'monospace', '700'));
  for (let i = 0; i < 5; i++) {
    const x = 10 + i * 35;
    g.fillStyle = '#fff';
    g.fillRect(x, 80, 30, 44);
    const s = ['A♠', 'K♥', 'Q♦', 'J♣', '10♠'][i]!;
    text(g, s, x + 15, 102, 13, s.includes('♥') || s.includes('♦') ? '#d0141e' : '#111', SIGN_FONT, '900');
  }
  text(g, 'DEAL', w - 26, h - 9, 10, '#fff', SIGN_FONT, '900');
}

function pachinkoFace(g: CanvasRenderingContext2D, w: number, h: number) {
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#ff5fa2');
  grad.addColorStop(1, '#5a2dd6');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let y = 20; y < h - 40; y += 12)
    for (let x = 10 + ((y / 12) % 2) * 6; x < w - 10; x += 12) g.fillRect(x, y, 2, 2);
  g.fillStyle = '#ffe14d';
  g.beginPath();
  g.arc(w / 2, h * 0.5, 34, 0, Math.PI * 2);
  g.fill();
  text(g, '大当り', w / 2, h * 0.5, 18, '#c0122a', 'sans-serif', '900');
  text(g, 'PACHINKO', w / 2, h - 18, 22, '#fff', SIGN_FONT, '900');
}

function bigSixFace(g: CanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const R = w / 2;
  g.fillStyle = '#5a2414';
  g.fillRect(0, 0, w, h);
  const vals = [1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 20, 1, 2, 1, 5, 1, 2, 1, 10, 1, 2, 1, 5, 1, 2, 1, 40];
  const colors: Record<number, string> = {
    1: '#f2e6c4',
    2: '#7fc8ff',
    5: '#9be37a',
    10: '#ffb35a',
    20: '#ff6a6a',
    40: '#c97aff',
  };
  const n = vals.length;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R * 0.94, a0, a1);
    g.closePath();
    g.fillStyle = colors[vals[i]!]!;
    g.fill();
    g.strokeStyle = '#d9a441';
    g.lineWidth = 2;
    g.stroke();
    g.save();
    g.translate(cx, cy);
    g.rotate((a0 + a1) / 2 + Math.PI / 2);
    text(g, `$${vals[i]}`, 0, -R * 0.78, 15, '#1a1a1a', SIGN_FONT, '900');
    g.restore();
  }
  ring(g, cx, cy, R * 0.95, '#f2c14e', 6);
  g.fillStyle = '#d9a441';
  g.beginPath();
  g.arc(cx, cy, R * 0.3, 0, Math.PI * 2);
  g.fill();
  text(g, 'BIG SIX', cx, cy, 30, '#5a2414', SIGN_FONT, '900');
}

const NEON = [
  ['CASINO', '#ff2e88'],
  ['JACKPOT', '#ffc94d'],
  ['777', '#33e6ff'],
  ['HIGH ROLLER', '#a64dff'],
  ['OPEN 24H', '#5dff9a'],
  ['♠ ♥ ♣ ♦', '#ff4040'],
] as const;

function neonWords(g: CanvasRenderingContext2D, w: number, h: number, row: number) {
  const [word, color] = NEON[row % NEON.length]!;
  g.fillStyle = '#05040a';
  g.fillRect(0, 0, w, h);
  g.shadowColor = color;
  for (const blur of [24, 12, 4]) {
    g.shadowBlur = blur;
    text(g, word, w / 2, h / 2, word.length > 8 ? 46 : 64, color, '"Brush Script MT", cursive', '700');
  }
  g.shadowBlur = 0;
  text(g, word, w / 2, h / 2, word.length > 8 ? 46 : 64, '#fff8fb', '"Brush Script MT", cursive', '700');
}

function marqueeSign(g: CanvasRenderingContext2D, w: number, h: number, row: number) {
  const words = ['HIGH ROLLER', 'GRAND CASINO', 'LUCKY STAR'];
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2a0a3a');
  grad.addColorStop(1, '#0a0212');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.shadowColor = '#ffcf5a';
  g.shadowBlur = 16;
  text(g, words[row % 3]!, w / 2, h * 0.47, 54, '#ffe08a', SIGN_FONT, '900');
  g.shadowBlur = 0;
  text(g, '★ SLOTS · TABLES · SHOWS ★', w / 2, h * 0.82, 18, '#ffffff', SIGN_FONT, '700');
}

function menuBoard(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#16120e';
  g.fillRect(0, 0, w, h);
  text(g, 'BUFFET', w / 2, 28, 34, '#ffd27a', SIGN_FONT, '900');
  const items = ['BURGER  $12', 'PIZZA  $9', 'TACOS  $8', 'SHRIMP  $16'];
  items.forEach((t, i) =>
    text(g, t, i % 2 ? w * 0.72 : w * 0.28, 76 + Math.floor(i / 2) * 40, 20, '#fff', 'monospace', '700'),
  );
}

function barShelf(g: CanvasRenderingContext2D, w: number, h: number) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#2a1610');
  grad.addColorStop(1, '#120a08');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const colors = ['#7a3b10', '#c7a03a', '#2f6b2a', '#9cc8e8', '#7a0f20', '#d0d0d0', '#b5651d'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 12 + shelf * 60;
    for (let i = 0; i < 18; i++) {
      const x = 10 + i * 28;
      const bh = 34 + ((i * 7 + shelf * 3) % 12);
      g.fillStyle = colors[(i + shelf * 2) % colors.length]!;
      g.fillRect(x, y + 48 - bh, 14, bh);
      g.fillRect(x + 4, y + 48 - bh - 10, 6, 10);
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + 2, y + 48 - bh + 4, 3, bh - 8);
    }
    g.fillStyle = '#d9a441';
    g.fillRect(0, y + 48, w, 4);
  }
}

function plaque(g: CanvasRenderingContext2D, w: number, h: number, s: string) {
  g.fillStyle = '#120c06';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#d9a441';
  g.lineWidth = 4;
  g.strokeRect(6, 6, w - 12, h - 12);
  text(g, s, w / 2, h / 2 + 2, 46, '#f2c14e', FELT_FONT, '700');
}

function restroomSign(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#1b3a5a';
  g.fillRect(0, 0, w, h);
  text(g, '🚹  RESTROOMS  🚺', w / 2, h / 2, 22, '#fff', SIGN_FONT, '900');
}

function kenoBoard(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#0b0b16';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 80; i++) {
    const x = 12 + (i % 16) * 23;
    const y = 30 + Math.floor(i / 16) * 30;
    const hit = (i * 37) % 7 === 0;
    g.fillStyle = hit ? '#ffd34d' : '#2a2a40';
    g.fillRect(x, y, 20, 24);
    text(g, String(i + 1), x + 10, y + 12, 11, hit ? '#000' : '#9a9ac0', 'monospace', '700');
  }
  text(g, 'KENO', w / 2, 14, 18, '#ff4fa0', SIGN_FONT, '900');
}

function bingoBoard(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#0a1a2a';
  g.fillRect(0, 0, w, h);
  'BINGO'.split('').forEach((c, r) => {
    text(g, c, 20, 22 + r * 36, 26, '#ff5a5a', SIGN_FONT, '900');
    for (let i = 0; i < 15; i++) {
      const on = (i * 13 + r * 7) % 5 === 0;
      g.fillStyle = on ? '#ffe14d' : '#203a55';
      g.beginPath();
      g.arc(54 + i * 30, 22 + r * 36, 12, 0, Math.PI * 2);
      g.fill();
      text(g, String(r * 15 + i + 1), 54 + i * 30, 22 + r * 36, 10, on ? '#000' : '#8ab', 'monospace', '700');
    }
  });
}

// ---------- surfaces (floors, walls) ----------

const CARPETS = {
  red: { base: '#7c1426', a: '#a8243a', b: '#d9a441', c: '#3a0a14' },
  blue: { base: '#13285e', a: '#1f4a9a', b: '#e0b04a', c: '#0a1634' },
};

/** A 1 m repeating casino-carpet motif: a medallion lattice with scrolls, the
 *  loud-on-purpose pattern every Vegas floor has. */
function carpet(g: CanvasRenderingContext2D, w: number, h: number, p: (typeof CARPETS)['red']) {
  g.fillStyle = p.base;
  g.fillRect(0, 0, w, h);
  const draw = (cx: number, cy: number, s: number) => {
    g.save();
    g.translate(cx, cy);
    g.fillStyle = p.a;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.lineTo(Math.cos(a) * s, Math.sin(a) * s);
      g.lineTo(Math.cos(a + Math.PI / 8) * s * 0.55, Math.sin(a + Math.PI / 8) * s * 0.55);
    }
    g.closePath();
    g.fill();
    g.strokeStyle = p.b;
    g.lineWidth = 3;
    g.stroke();
    g.fillStyle = p.c;
    g.beginPath();
    g.arc(0, 0, s * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = p.b;
    g.beginPath();
    g.arc(0, 0, s * 0.13, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  // Lattice lines between medallions.
  g.strokeStyle = p.c;
  g.lineWidth = 10;
  for (const [x0, y0, x1, y1] of [
    [0, 0, w, h],
    [w, 0, 0, h],
  ]) {
    g.beginPath();
    g.moveTo(x0!, y0!);
    g.lineTo(x1!, y1!);
    g.stroke();
  }
  g.strokeStyle = p.b;
  g.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [
    [0, 0, w, h],
    [w, 0, 0, h],
  ]) {
    g.beginPath();
    g.moveTo(x0!, y0!);
    g.lineTo(x1!, y1!);
    g.stroke();
  }
  for (const [x, y] of [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ])
    draw(x!, y!, w * 0.2);
  draw(w / 2, h / 2, w * 0.28);
  // Small scrolls at the edge midpoints.
  g.fillStyle = p.b;
  for (const [x, y] of [
    [w / 2, 0],
    [w / 2, h],
    [0, h / 2],
    [w, h / 2],
  ]) {
    g.beginPath();
    g.arc(x!, y!, 7, 0, Math.PI * 2);
    g.fill();
  }
  noise(g, w, h, 0.08, 3);
}

function marble(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#ece6dc';
  g.fillRect(0, 0, w, h);
  let s = 11;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let v = 0; v < 9; v++) {
    g.strokeStyle = `rgba(120,110,105,${0.08 + rnd() * 0.18})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    let x = rnd() * w;
    let y = 0;
    g.moveTo(x, y);
    while (y < h) {
      x += (rnd() - 0.5) * 30;
      y += 6 + rnd() * 14;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Tile seams every half metre with a darker inlay at the corner.
  g.strokeStyle = 'rgba(80,70,60,0.35)';
  g.lineWidth = 1.5;
  g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  g.fillStyle = '#2a2530';
  g.save();
  g.translate(0, 0);
  g.rotate(Math.PI / 4);
  g.fillRect(-14, -14, 28, 28);
  g.restore();
  for (const [x, y] of [
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    g.save();
    g.translate(x!, y!);
    g.rotate(Math.PI / 4);
    g.fillRect(-14, -14, 28, 28);
    g.restore();
  }
}

function woodFloor(g: CanvasRenderingContext2D, w: number, h: number) {
  const planks = 6;
  const ph = h / planks;
  let s = 5;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < planks; i++) {
    const offset = (i % 2) * w * 0.5;
    for (let k = -1; k < 2; k++) {
      const shade = 0.85 + rnd() * 0.3;
      g.fillStyle = `rgb(${Math.round(150 * shade)},${Math.round(98 * shade)},${Math.round(56 * shade)})`;
      g.fillRect(offset + k * w, i * ph, w, ph);
      for (let gl = 0; gl < 6; gl++) {
        g.strokeStyle = `rgba(60,30,10,${0.08 + rnd() * 0.12})`;
        g.lineWidth = 1;
        g.beginPath();
        const yy = i * ph + rnd() * ph;
        g.moveTo(offset + k * w, yy);
        g.bezierCurveTo(offset + k * w + w * 0.3, yy + 3, offset + k * w + w * 0.6, yy - 3, offset + k * w + w, yy);
        g.stroke();
      }
      g.fillStyle = 'rgba(30,15,5,0.7)';
      g.fillRect(offset + k * w, i * ph, 1.5, ph);
    }
    g.fillStyle = 'rgba(30,15,5,0.7)';
    g.fillRect(0, i * ph, w, 1.5);
  }
}

function tileFloor(g: CanvasRenderingContext2D, w: number, h: number) {
  const n = 4;
  const t = w / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      g.fillStyle = (x + y) % 2 ? '#e9eef2' : '#d4dce3';
      g.fillRect(x * t, y * t, t, t);
    }
  g.strokeStyle = 'rgba(120,130,140,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i <= n; i++) {
    g.beginPath();
    g.moveTo(i * t, 0);
    g.lineTo(i * t, h);
    g.moveTo(0, i * t);
    g.lineTo(w, i * t);
    g.stroke();
  }
}

function wallpaper(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#5b1a2c';
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(217,164,65,0.28)';
  for (const [x, y] of [
    [w / 2, h / 2],
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]) {
    g.save();
    g.translate(x!, y!);
    for (let i = 0; i < 4; i++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      g.ellipse(0, -22, 9, 22, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
}

function cardFace(g: CanvasRenderingContext2D, w: number, h: number) {
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  text(g, 'A♠', w / 2, h / 2, 26, '#111', SIGN_FONT, '900');
}
