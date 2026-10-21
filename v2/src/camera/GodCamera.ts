// Skeleton god camera: orbit around a ground focus point. WASD/arrows pan,
// Q/E or right-drag rotate, wheel zooms. Session 2 owns the full rig and the
// snap into avatar view.

import * as THREE from 'three';

export class GodCamera {
  readonly camera: THREE.PerspectiveCamera;
  focus = new THREE.Vector3(20, 0, 15);
  yaw = Math.PI / 4;
  pitch = 0.9;
  distance = 32;
  private keys = new Set<string>();
  private dragging = false;

  constructor(dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => {
      if (e.button === 2) this.dragging = true;
    });
    window.addEventListener('pointerup', () => (this.dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.004, 0.25, 1.45);
    });
    dom.addEventListener(
      'wheel',
      (e) => {
        this.distance = THREE.MathUtils.clamp(this.distance * (1 + e.deltaY * 0.001), 6, 90);
        e.preventDefault();
      },
      { passive: false },
    );
  }

  update(dt: number): void {
    const k = this.keys;
    const speed = this.distance * 0.9 * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (k.has('w') || k.has('arrowup')) this.focus.addScaledVector(fwd, speed);
    if (k.has('s') || k.has('arrowdown')) this.focus.addScaledVector(fwd, -speed);
    if (k.has('d') || k.has('arrowright')) this.focus.addScaledVector(right, speed);
    if (k.has('a') || k.has('arrowleft')) this.focus.addScaledVector(right, -speed);
    if (k.has('q')) this.yaw += dt * 1.5;
    if (k.has('e')) this.yaw -= dt * 1.5;
    const c = Math.cos(this.pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * c * this.distance,
      Math.sin(this.pitch) * this.distance,
      this.focus.z + Math.cos(this.yaw) * c * this.distance,
    );
    this.camera.lookAt(this.focus);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
