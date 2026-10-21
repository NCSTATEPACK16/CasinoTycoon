// Accumulates three.js primitives into one single-material geometry carrying
// the surface attributes the object shader reads (see Palette.ts):
//   color (base × baked AO), uv (decal atlas), aPbr (rough, metal, emit, flags).
// Used by the procedural assets and by the GLB loader after it flattens a
// glTF scene into the same layout.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Surface } from './Palette';
import type { DecalAtlas } from './Atlas';

const tmpColor = new THREE.Color();

export class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];

  constructor(private atlas: DecalAtlas) {}

  /** Add a geometry under a transform with a surface. Consumes `geo`. */
  add(geo: THREE.BufferGeometry, s: Surface, m?: THREE.Matrix4, ao = 1): this {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (m) g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position!.count;
    const color = new Float32Array(n * 3);
    const pbr = new Float32Array(n * 4);
    const uv = new Float32Array(n * 2);
    if (s.rgb) tmpColor.setRGB(s.rgb[0], s.rgb[1], s.rgb[2]);
    else tmpColor.setHex(s.color, THREE.SRGBColorSpace);
    const srcUv = g.attributes.uv as THREE.BufferAttribute | undefined;
    const rect = s.decal ? this.atlas.rect(s.decal) : this.atlas.white;
    const aoAttr = g.attributes.ao as THREE.BufferAttribute | undefined;
    for (let i = 0; i < n; i++) {
      const a = ao * (aoAttr ? aoAttr.getX(i) : 1);
      color[i * 3] = tmpColor.r * a;
      color[i * 3 + 1] = tmpColor.g * a;
      color[i * 3 + 2] = tmpColor.b * a;
      pbr[i * 4] = s.rough;
      pbr[i * 4 + 1] = s.metal;
      pbr[i * 4 + 2] = s.emit ?? 0;
      pbr[i * 4 + 3] = s.flags ?? 0;
      const u = s.decal && srcUv ? srcUv.getX(i) : 0.5;
      const v = s.decal && srcUv ? srcUv.getY(i) : 0.5;
      uv[i * 2] = rect.u0 + u * (rect.u1 - rect.u0);
      uv[i * 2 + 1] = rect.v0 + v * (rect.v1 - rect.v0);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', g.attributes.position!);
    out.setAttribute('normal', g.attributes.normal!);
    out.setAttribute('color', new THREE.BufferAttribute(color, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 4));
    this.parts.push(out);
    if (g !== geo) geo.dispose();
    return this;
  }

  /** Add an already-built GeoBuilder geometry (keeps its surface attributes). */
  addBuilt(geo: THREE.BufferGeometry, m: THREE.Matrix4): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m);
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, s: Surface): this {
    return this.add(new THREE.BoxGeometry(w, h, d), s, at(x + 0, y + h / 2, z));
  }

  /** Box with rounded vertical edges and a bevelled top, the "chunky" look. */
  rbox(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    s: Surface,
    r = 0.04,
  ): this {
    const shape = roundedRect(w, d, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
    const bevel = Math.min(r * 0.6, h / 4);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.001, h - bevel * 2),
      bevelEnabled: bevel > 0.002,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 2,
      curveSegments: 4,
    });
    g.rotateX(-Math.PI / 2).translate(0, bevel, 0);
    return this.add(g, s, at(x, y, z));
  }

  cyl(
    rTop: number,
    rBot: number,
    h: number,
    x: number,
    y: number,
    z: number,
    s: Surface,
    seg = 16,
  ): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg), s, at(x, y + h / 2, z));
  }

  /** Revolve a (radius, y) profile around the y axis. */
  lathe(profile: [number, number][], x: number, y: number, z: number, s: Surface, seg = 20): this {
    const pts = profile.map(([r, py]) => new THREE.Vector2(Math.max(0.0001, r), py));
    return this.add(new THREE.LatheGeometry(pts, seg), s, at(x, y, z));
  }

  sphere(r: number, x: number, y: number, z: number, s: Surface, seg = 12): this {
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), s, at(x, y, z));
  }

  /** A flat decal quad facing +y (or rotated by `m`), uv 0..1 across it. */
  quad(w: number, d: number, s: Surface, m: THREE.Matrix4): this {
    return this.add(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), s, m);
  }

  /** Extrude a 2D outline (x, z-plane) upward by h. */
  slab(shape: THREE.Shape, h: number, y: number, s: Surface, bevel = 0.02, m?: THREE.Matrix4): this {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.001, h - bevel * 2),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 2,
      curveSegments: 24,
    });
    // Shape lives in (x, y) → (x, -z) after rotateX(-90°); flip back so the
    // shape's y maps to +z like every other builder coordinate.
    g.rotateX(Math.PI / 2).translate(0, y + h - bevel, 0);
    return this.add(g, s, m);
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts = [];
    const g = mergeVertices(merged, 1e-4);
    merged.dispose();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

export function at(x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return m.setPosition(x, y, z);
}

export function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -d / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + d - r);
  s.quadraticCurveTo(x0 + w, y0 + d, x0 + w - r, y0 + d);
  s.lineTo(x0 + r, y0 + d);
  s.quadraticCurveTo(x0, y0 + d, x0, y0 + d - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
