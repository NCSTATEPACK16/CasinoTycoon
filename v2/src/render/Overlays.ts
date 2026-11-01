// Build and inspect feedback: the hologram placement ghost (the real asset in
// green/red), the zone tint, the selection outline, and the floating
// "+$1,250" payout labels (one instanced draw, PayoutLabels.ts).

import * as THREE from 'three';
import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import { ZONES, type Rotation } from '../shared/contracts';
import type { AssetLibrary } from './assets/AssetLibrary';
import type { ChunkGrid } from './core/ChunkGrid';
import { PayoutLabels } from './PayoutLabels';

const ZONE_COLORS: Record<(typeof ZONES)[number], number> = {
  none: 0x000000,
  gaming: 0x2ecc71,
  highLimit: 0xb06bff,
  foodCourt: 0xf5a623,
  restrooms: 0x3fa9f5,
  backOfHouse: 0x95a5a6,
};

function hologram(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x2ecc71) }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vView; varying float vY;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime;
      varying vec3 vN; varying vec3 vView; varying float vY;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), vView)), 2.0);
        float scan = 0.6 + 0.4 * step(0.5, fract(vY * 14.0 - uTime * 2.0));
        float a = (0.18 + rim * 0.75) * scan;
        gl_FragColor = vec4(uColor * (1.4 + rim * 2.0), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export class Overlays {
  readonly group = new THREE.Group();
  private ghost: THREE.Mesh;
  private ghostPad: THREE.Mesh;
  private ghostMat = hologram();
  private ghostKey = '';
  private zones: THREE.Mesh | null = null;
  private zonesVisible = false;
  private outline: THREE.Mesh;
  readonly labels = new PayoutLabels();
  private now = 0;

  constructor(private lib: AssetLibrary) {
    this.group.name = 'overlays';
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.visible = false;
    this.ghost.renderOrder = 10;
    this.ghostPad = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0.02, 0.5),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false, color: 0x2ecc71 }),
    );
    this.ghostPad.visible = false;
    this.outline = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0xffd34d) } },
        vertexShader: /* glsl */ `
          void main() {
            vec3 p = position + normal * 0.035;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor * 2.0, 1.0); }',
        side: THREE.BackSide,
      }),
    );
    this.outline.visible = false;
    this.group.add(this.ghost, this.ghostPad, this.outline, this.labels.mesh);
  }

  /** Show the real asset as a hologram at a cell, or hide with defId = null. */
  showGhost(defId: string | null, col = 0, row = 0, rot: Rotation = 0, valid = true): void {
    if (!defId) {
      this.ghost.visible = this.ghostPad.visible = false;
      return;
    }
    const asset = this.lib.get(get3D(defId).asset);
    const key = `${asset.key}@${asset.version}`;
    if (key !== this.ghostKey) {
      this.ghost.geometry = asset.lods[1];
      this.ghostKey = key;
    }
    const def = getObjectDef(defId);
    const w = def?.footprint.w ?? asset.w;
    const h = def?.footprint.h ?? asset.h;
    const odd = rot % 2 === 1;
    const fw = odd ? h : w;
    const fh = odd ? w : h;
    // Hover lift: the ghost floats a little until it's placed (RCT-style).
    const lift = 0.08 + Math.sin(this.now * 5) * 0.03;
    this.ghost.matrixAutoUpdate = false;
    this.ghost.matrix
      .makeTranslation(col + fw / 2, lift, row + fh / 2)
      .multiply(new THREE.Matrix4().makeRotationY((-rot * Math.PI) / 2))
      .multiply(new THREE.Matrix4().makeTranslation(-w / 2, 0, -h / 2));
    this.ghost.matrixWorldNeedsUpdate = true;
    const color = valid ? 0x2ecc71 : 0xe74c3c;
    this.ghostMat.uniforms.uColor!.value.setHex(color);
    (this.ghostPad.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.ghostPad.position.set(col, 0, row);
    this.ghostPad.scale.set(fw, 1, fh);
    this.ghost.visible = this.ghostPad.visible = true;
  }

  setSelected(sel: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 } | null): void {
    if (!sel) {
      this.outline.visible = false;
      return;
    }
    this.outline.geometry = sel.geometry;
    this.outline.matrixAutoUpdate = false;
    this.outline.matrix.copy(sel.matrix);
    this.outline.matrixWorldNeedsUpdate = true;
    this.outline.visible = true;
  }

  /** Rebuild the zone tint from the plan: a translucent fill plus an outline
   *  wherever the zone changes. */
  rebuildZones(grid: ChunkGrid): void {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    const quad = (x0: number, z0: number, x1: number, z1: number, y: number, hex: number, a: number) => {
      c.setHex(hex);
      pos.push(x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0);
      for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b, a);
    };
    const t = 0.07;
    for (let r = 0; r < grid.rows; r++)
      for (let cc = 0; cc < grid.cols; cc++) {
        const z = grid.zoneAt(cc, r);
        if (!z) continue;
        const hex = ZONE_COLORS[ZONES[z] ?? 'none'];
        quad(cc, r, cc + 1, r + 1, 0.03, hex, 0.28);
        if (grid.zoneAt(cc - 1, r) !== z) quad(cc, r, cc + t, r + 1, 0.035, hex, 0.95);
        if (grid.zoneAt(cc + 1, r) !== z) quad(cc + 1 - t, r, cc + 1, r + 1, 0.035, hex, 0.95);
        if (grid.zoneAt(cc, r - 1) !== z) quad(cc, r, cc + 1, r + t, 0.035, hex, 0.95);
        if (grid.zoneAt(cc, r + 1) !== z) quad(cc, r + 1 - t, cc + 1, r + 1, 0.035, hex, 0.95);
      }
    if (this.zones) {
      this.zones.removeFromParent();
      this.zones.geometry.dispose();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    this.zones = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    this.zones.renderOrder = 5;
    this.zones.visible = this.zonesVisible;
    this.group.add(this.zones);
  }

  showZones(on: boolean): void {
    this.zonesVisible = on;
    if (this.zones) this.zones.visible = on;
  }

  spawnPayout(x: number, z: number, amount: number): void {
    this.labels.spawn(x, z, amount, this.now);
  }

  update(now: number, camera: THREE.Camera): void {
    void camera;
    this.now = now;
    this.ghostMat.uniforms.uTime!.value = now;
    this.labels.update(now);
  }
}
