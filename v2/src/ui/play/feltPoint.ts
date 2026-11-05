// A screen point on a table's felt: the ray from the camera through the
// pointer, met with the felt's plane, in the table's own frame. Used to lay
// bets by clicking the printed layout.

import * as THREE from 'three';
import { FELT_Y } from '../../render/fx/felt';

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FELT_Y);
const hit = new THREE.Vector3();
const inv = new THREE.Matrix4();

export function feltPoint(
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  table: THREE.Matrix4 | undefined,
  clientX: number,
  clientY: number,
): { x: number; z: number } | null {
  if (!table) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  hit.applyMatrix4(inv.copy(table).invert());
  return { x: hit.x, z: hit.z };
}
