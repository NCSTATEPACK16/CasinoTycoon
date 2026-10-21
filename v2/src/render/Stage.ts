// Walking-skeleton renderer: placeholder boxes per object def, capsules per
// agent, a floor and a sun. Session 1 (Graphics) replaces the internals; the
// public surface (constructor, setObjects, updateAgents, render, ghost) is
// what main.ts depends on.

import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS } from '../config';
import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import { AGENT_STRIDE, AgentKind, Anim, type ObjectView, type Snapshot } from '../shared/contracts';

const MAX_AGENTS = 2048;
const AGENT_COLORS: Record<number, number> = {
  [AgentKind.Guest]: 0xf5cba7,
  [AgentKind.Dealer]: 0x1c2833,
  [AgentKind.Janitor]: 0x5dade2,
  [AgentKind.Security]: 0x34495e,
  [AgentKind.Staff]: 0xaab7b8,
};
const OUTFIT = [0x3498db, 0x8e44ad, 0x2c3e50, 0xf39c12];

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly ground: THREE.Mesh;
  private objectGroup = new THREE.Group();
  private agents: THREE.InstancedMesh;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();
  readonly ghost: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(0x14101f);
    this.scene.fog = new THREE.Fog(0x14101f, 60, 140);

    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a1d3d, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(GRID_COLS * 0.3, 40, GRID_ROWS * -0.2);
    sun.target.position.set(GRID_COLS / 2, 0, GRID_ROWS / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 120 });
    this.scene.add(sun, sun.target);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(GRID_COLS, GRID_ROWS)
        .rotateX(-Math.PI / 2)
        .translate(GRID_COLS / 2, 0, GRID_ROWS / 2),
      new THREE.MeshStandardMaterial({ color: 0x6b1e2e, roughness: 0.9 }),
    );
    floor.receiveShadow = true;
    this.ground = floor;
    const grid = new THREE.GridHelper(GRID_COLS, GRID_COLS, 0x000000, 0x000000);
    grid.scale.set(1, 1, GRID_ROWS / GRID_COLS);
    grid.position.set(GRID_COLS / 2, 0.005, GRID_ROWS / 2);
    (grid.material as THREE.Material).opacity = 0.15;
    (grid.material as THREE.Material).transparent = true;
    this.scene.add(floor, grid, this.objectGroup);

    const capsule = new THREE.CapsuleGeometry(0.18, 0.9, 4, 8).translate(0, 0.63, 0);
    this.agents = new THREE.InstancedMesh(
      capsule,
      new THREE.MeshStandardMaterial({ roughness: 0.6 }),
      MAX_AGENTS,
    );
    this.agents.castShadow = true;
    this.agents.count = 0;
    this.agents.frustumCulled = false;
    this.scene.add(this.agents);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({
        color: 0x2ecc71,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.ghost.visible = false;
    this.scene.add(this.ghost);
  }

  setObjects(objects: ObjectView[]): void {
    for (const c of [...this.objectGroup.children]) {
      this.objectGroup.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    for (const o of objects) {
      const def = getObjectDef(o.defId);
      const d3 = get3D(o.defId);
      const w = def?.footprint.w ?? 1;
      const h = def?.footprint.h ?? 1;
      const mat = new THREE.MeshStandardMaterial({
        color: o.broken ? 0x555555 : d3.color,
        roughness: 0.5,
        emissive: d3.glow ?? 0x000000,
        emissiveIntensity: d3.glow ? 0.25 : 0,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, d3.height, h * 0.9), mat);
      mesh.position.set(o.col + w / 2, d3.height / 2, o.row + h / 2);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.objectId = o.id;
      this.objectGroup.add(mesh);
    }
  }

  /** Interpolate agents between two snapshots matched by numeric id. */
  updateAgents(prev: Snapshot | null, curr: Snapshot, alpha: number): void {
    const prevPos = new Map<number, number>();
    if (prev)
      for (let i = 0; i < prev.agentCount; i++)
        prevPos.set(prev.agents[i * AGENT_STRIDE + 7]! * 8 + prev.agents[i * AGENT_STRIDE + 4]!, i);
    const a = curr.agents;
    const n = Math.min(MAX_AGENTS, curr.agentCount);
    for (let i = 0; i < n; i++) {
      const o = i * AGENT_STRIDE;
      let x = a[o]!;
      let z = a[o + 1]!;
      const kind = a[o + 4]!;
      const pi = prev ? prevPos.get(a[o + 7]! * 8 + kind) : undefined;
      if (prev && pi !== undefined) {
        const po = pi * AGENT_STRIDE;
        x = prev.agents[po]! + (x - prev.agents[po]!) * alpha;
        z = prev.agents[po + 1]! + (z - prev.agents[po + 1]!) * alpha;
      }
      const walking = a[o + 3] === Anim.Walk;
      this.tmp.position.set(
        x,
        walking ? Math.abs(Math.sin(performance.now() / 120 + i)) * 0.05 : 0,
        z,
      );
      this.tmp.rotation.set(0, a[o + 2]!, 0);
      this.tmp.updateMatrix();
      this.agents.setMatrixAt(i, this.tmp.matrix);
      const c =
        kind === AgentKind.Guest
          ? (OUTFIT[a[o + 5]! | 0] ?? 0xffffff)
          : (AGENT_COLORS[kind] ?? 0xffffff);
      this.agents.setColorAt(i, this.color.setHex(c));
    }
    this.agents.count = n;
    this.agents.instanceMatrix.needsUpdate = true;
    if (this.agents.instanceColor) this.agents.instanceColor.needsUpdate = true;
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
