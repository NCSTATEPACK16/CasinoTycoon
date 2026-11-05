// Interior lighting. The casino is always lit (SPEC §5): a low-intensity
// Poly Haven HDRI (dancing_hall, CC0) for image-based light and reflections
// on brass and glass, a warm key "sun" whose orthographic shadow camera is
// re-fitted each frame to the ground footprint of the view, and a hemisphere
// fill. Warm practical light comes from emissive surfaces plus bloom.

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import hdrUrl from '../../assets/hdri/dancing_hall_1k.hdr?url';

const corners = [
  new THREE.Vector3(-1, -1, 1),
  new THREE.Vector3(1, -1, 1),
  new THREE.Vector3(1, 1, 1),
  new THREE.Vector3(-1, 1, 1),
];
const ray = new THREE.Ray();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Vector3();
const lightSpace = new THREE.Matrix4();

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private sunDir = new THREE.Vector3(-0.45, 1, 0.3).normalize();
  /** Furthest ground distance the shadow map has to cover, from overhead. */
  shadowReach = 70;
  /** The reach from eye level. Looking along the floor, every frustum corner
   *  above the horizon used to clamp ~50 m out, rendering casters for a wedge
   *  of the floor whose shadows are invisible at that range; at 500 guests on
   *  a full Sandbox that was ~70 draw calls and 200k triangles. */
  eyeShadowReach = 24;

  constructor(
    private scene: THREE.Scene,
    renderer: THREE.WebGLRenderer,
  ) {
    scene.background = new THREE.Color(0x0c0912);
    scene.fog = new THREE.Fog(0x0c0912, 90, 220);
    this.hemi = new THREE.HemisphereLight(0xffe9cc, 0x40263a, 0.55);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.environmentIntensity = 0.45;
    const pmrem = new THREE.PMREMGenerator(renderer);
    new HDRLoader().load(hdrUrl, (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = pmrem.fromEquirectangular(tex).texture;
      // Keep the env lighting but rotate its warm windows behind the key light.
      scene.environmentRotation.set(0, Math.PI * 0.6, 0);
      tex.dispose();
      pmrem.dispose();
    });
  }

  setShadowSize(size: number, enabled: boolean): void {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Fit the shadow frustum to where the camera's view meets the floor. */
  update(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const pts: THREE.Vector3[] = [];
    const camPos = camera.position;
    // Overhead the view needs the full reach; it shrinks toward eye level.
    const reach = THREE.MathUtils.clamp(camPos.y * 4, this.eyeShadowReach, this.shadowReach);
    for (const c of corners) {
      tmp.copy(c).unproject(camera);
      ray.set(camPos, tmp.sub(camPos).normalize());
      const hit = new THREE.Vector3();
      if (!ray.intersectPlane(plane, hit) || hit.distanceTo(camPos) > reach) {
        // Corner looks above the horizon (or too far): clamp along the ray's ground projection.
        const flat = new THREE.Vector3(ray.direction.x, 0, ray.direction.z).normalize();
        hit.set(camPos.x, 0, camPos.z).addScaledVector(flat, reach * 0.7);
      }
      pts.push(hit);
    }
    // Objects stand up to ~3 m; pad the footprint and include the area under the camera.
    pts.push(new THREE.Vector3(camPos.x, 0, camPos.z));
    const center = new THREE.Vector3();
    for (const p of pts) center.add(p);
    center.divideScalar(pts.length);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 60);
    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    lightSpace.lookAt(this.sun.position, center, THREE.Object3D.DEFAULT_UP).invert();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts)
      for (const y of [0, 3.5]) {
        tmp.set(p.x, y, p.z).sub(this.sun.position).applyMatrix4(lightSpace);
        minX = Math.min(minX, tmp.x);
        maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y);
        maxY = Math.max(maxY, tmp.y);
      }
    const pad = 3;
    const cam = this.sun.shadow.camera;
    // Snap the extent to whole texels so the shadow doesn't shimmer while panning.
    const size = Math.max(maxX - minX, maxY - minY) + pad * 2;
    const texel = size / this.sun.shadow.mapSize.x;
    const cx = Math.round((minX + maxX) / 2 / texel) * texel;
    const cy = Math.round((minY + maxY) / 2 / texel) * texel;
    const half = Math.ceil(size / 2 / texel) * texel;
    cam.left = cx - half;
    cam.right = cx + half;
    cam.bottom = cy - half;
    cam.top = cy + half;
    cam.near = 1;
    cam.far = 140;
    cam.updateProjectionMatrix();
    void this.scene;
  }
}
