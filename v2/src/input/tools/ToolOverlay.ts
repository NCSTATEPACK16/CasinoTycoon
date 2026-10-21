// Placeholder build overlays: tinted cell quads for paint previews, wall
// slabs for wall previews, and outline boxes for hover/selection. Session 1
// owns the final look (SPEC §5); these only need to read clearly until then.
// Everything is instanced, so a full-lot paint preview is one draw call.

import * as THREE from 'three';

const MAX_CELLS = 4096;
const MAX_EDGES = 512;
const WALL_PREVIEW_H = 1.2;

export class ToolOverlay {
  readonly group = new THREE.Group();
  private cells: THREE.InstancedMesh;
  private edges: THREE.InstancedMesh;
  private outlines = new Map<string, THREE.LineSegments>();
  private vertex: THREE.Mesh;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.group.name = 'tool-overlay';
    this.group.renderOrder = 10;
    this.cells = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2).translate(0.5, 0.025, 0.5),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }),
      MAX_CELLS,
    );
    this.edges = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, WALL_PREVIEW_H, 0.12).translate(0.5, WALL_PREVIEW_H / 2, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
      MAX_EDGES,
    );
    this.vertex = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.05, 16).translate(0, 0.03, 0),
      new THREE.MeshBasicMaterial({ color: 0xf6c453 }),
    );
    for (const o of [this.cells, this.edges]) {
      o.count = 0;
      o.frustumCulled = false;
    }
    this.vertex.visible = false;
    this.group.add(this.cells, this.edges, this.vertex);
    scene.add(this.group);
  }

  /** Tint a set of cells; pass an empty list to clear. */
  setCells(cells: Iterable<{ col: number; row: number }>, color: number): void {
    let n = 0;
    this.c.setHex(color);
    for (const { col, row } of cells) {
      if (n >= MAX_CELLS) break;
      this.m.makeTranslation(col, 0, row);
      this.cells.setMatrixAt(n, this.m);
      this.cells.setColorAt(n++, this.c);
    }
    this.cells.count = n;
    this.cells.instanceMatrix.needsUpdate = true;
    if (this.cells.instanceColor) this.cells.instanceColor.needsUpdate = true;
  }

  /** Wall-height slabs on cell edges ('n' runs along +x at z=row, 'w' along +z at x=col). */
  setEdges(edges: Iterable<{ col: number; row: number; edge: 'n' | 'w' }>, color: number): void {
    let n = 0;
    this.c.setHex(color);
    const rot = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
    for (const e of edges) {
      if (n >= MAX_EDGES) break;
      this.m.makeTranslation(e.col, 0, e.row);
      if (e.edge === 'w') this.m.multiply(rot);
      this.edges.setMatrixAt(n, this.m);
      this.edges.setColorAt(n++, this.c);
    }
    this.edges.count = n;
    this.edges.instanceMatrix.needsUpdate = true;
    if (this.edges.instanceColor) this.edges.instanceColor.needsUpdate = true;
  }

  setVertex(v: { x: number; z: number } | null): void {
    this.vertex.visible = !!v;
    if (v) this.vertex.position.set(v.x, 0, v.z);
  }

  /** A named wireframe box over a footprint (null hides it). */
  setOutline(
    name: string,
    box: { x: number; z: number; w: number; h: number; height: number } | null,
    color = 0xffffff,
  ): void {
    let o = this.outlines.get(name);
    if (!box) {
      if (o) o.visible = false;
      return;
    }
    if (!o) {
      o = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)),
        new THREE.LineBasicMaterial({ transparent: true, depthTest: false }),
      );
      o.renderOrder = 20;
      this.outlines.set(name, o);
      this.group.add(o);
    }
    o.visible = true;
    (o.material as THREE.LineBasicMaterial).color.setHex(color);
    o.position.set(box.x - 0.03, 0, box.z - 0.03);
    o.scale.set(box.w + 0.06, box.height + 0.05, box.h + 0.06);
  }

  clear(): void {
    this.setCells([], 0);
    this.setEdges([], 0);
    this.setVertex(null);
    for (const o of this.outlines.values()) o.visible = false;
  }
}
