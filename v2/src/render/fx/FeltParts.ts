// The dealt cards and chips on watched card tables: one instanced pool each,
// one draw call apiece while anything is on a felt and none otherwise.
//
// A card is two back-to-back quads: the top shows its face from the cardFaces
// sheet (picked per instance), the bottom the back, so a card lying face down
// is simply a card turned over. Chips are short cylinders tinted per instance
// by denomination.

import * as THREE from 'three';
import type { AssetLibrary } from '../assets/AssetLibrary';
import { BACK, CARD_L, CARD_W, CHIP_H, CHIP_R } from './felt';

const CARDS = 192;
const CHIPS = 768;

/** Two quads, face up (+y) and back down (−y). The face's top edge is at −z,
 *  away from a player the card is turned toward. */
function cardGeometry(): THREE.BufferGeometry {
  const w = CARD_W / 2;
  const l = CARD_L / 2;
  const e = 0.0003;
  const pos = [-w, e, -l, w, e, -l, w, e, l, -w, e, l, -w, -e, -l, w, -e, -l, w, -e, l, -w, -e, l];
  const nrm = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0];
  const uv = [0, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0];
  const side = [0, 0, 0, 0, 1, 1, 1, 1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7]);
  return g;
}

export class FeltParts {
  readonly group = new THREE.Group();
  readonly cards: THREE.InstancedMesh;
  readonly chips: THREE.InstancedMesh;
  private cell: THREE.InstancedBufferAttribute;
  private nCards = 0;
  private nChips = 0;
  private color = new THREE.Color();

  constructor(lib: AssetLibrary) {
    this.group.name = 'felt-parts';
    const r = lib.atlas.rect('cardFaces');
    const uRect = { value: new THREE.Vector4(r.u0, r.v0, r.u1, r.v1) };
    const geo = cardGeometry();
    this.cell = new THREE.InstancedBufferAttribute(new Float32Array(CARDS), 1);
    this.cell.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aCell', this.cell);
    const cardMat = new THREE.MeshStandardMaterial({
      map: lib.atlas.texture,
      roughness: 0.55,
      metalness: 0,
    });
    cardMat.onBeforeCompile = (s) => {
      s.uniforms.uCardRect = uRect;
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aCell;\nattribute float side;\nuniform vec4 uCardRect;',
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          // Faces sit at (rank, suit) in a 13 × 5 grid; the back at (0, 4).
          float cell = side > 0.5 ? ${BACK.toFixed(1)} : aCell;
          vec2 cr = cell >= ${BACK.toFixed(1)} ? vec2(0.0, 4.0) : vec2(floor(cell / 4.0), mod(cell, 4.0));
          vMapUv = vec2(
            mix(uCardRect.x, uCardRect.z, (cr.x + uv.x) / 13.0),
            mix(uCardRect.w, uCardRect.y, (cr.y + 1.0 - uv.y) / 5.0));`,
        );
    };
    this.cards = new THREE.InstancedMesh(geo, cardMat, CARDS);
    const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 18).translate(
      0,
      CHIP_H / 2,
      0,
    );
    this.chips = new THREE.InstancedMesh(
      chipGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0 }),
      CHIPS,
    );
    this.chips.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CHIPS * 3), 3);
    for (const m of [this.cards, this.chips]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.visible = false;
      m.frustumCulled = false;
      m.receiveShadow = true;
      this.group.add(m);
    }
    this.cards.name = 'felt-cards';
    this.chips.name = 'felt-chips';
  }

  begin(): void {
    this.nCards = 0;
    this.nChips = 0;
  }

  /** A card at a world transform; `cell` is 0..51 (cards.ts). Its top shows the face. */
  card(m: THREE.Matrix4, cell: number): void {
    if (this.nCards >= CARDS) return;
    this.cards.setMatrixAt(this.nCards, m);
    this.cell.setX(this.nCards++, cell);
  }

  /** One chip, its base at the transform's origin. */
  chip(m: THREE.Matrix4, color: number): void {
    if (this.nChips >= CHIPS) return;
    this.chips.setMatrixAt(this.nChips, m);
    this.chips.setColorAt(this.nChips++, this.color.setHex(color));
  }

  end(): void {
    this.cards.count = this.nCards;
    this.chips.count = this.nChips;
    this.cards.visible = this.nCards > 0;
    this.chips.visible = this.nChips > 0;
    if (this.nCards) {
      this.cards.instanceMatrix.needsUpdate = true;
      this.cell.needsUpdate = true;
    }
    if (this.nChips) {
      this.chips.instanceMatrix.needsUpdate = true;
      this.chips.instanceColor!.needsUpdate = true;
    }
  }
}
