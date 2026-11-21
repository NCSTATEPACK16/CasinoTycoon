// Which game is at a spot on the floor (A9), so a seated agent gets the right
// play clip: a button press at a machine, chips at a table, the wheel spin for
// a roulette croupier. Built from the object list whenever it changes; a
// lookup checks the agent's cell and its neighbours and takes the nearest
// gaming object's centre (seats sit just outside footprints).

import { getObjectDef } from '../data/objects';
import { get3D } from '../shared/catalog';
import type { ObjectView } from '../shared/contracts';

interface Spot {
  cx: number;
  cz: number;
  game: string;
}

export class GameSpots {
  private cells = new Map<number, Spot[]>();

  set(objects: readonly ObjectView[]): void {
    this.cells.clear();
    for (const o of objects) {
      const d3 = get3D(o.defId);
      if (!d3.seats?.length && !d3.game) continue;
      const fp = getObjectDef(o.defId)?.footprint ?? { w: 1, h: 1 };
      const odd = o.rot % 2 === 1;
      const w = odd ? fp.h : fp.w;
      const h = odd ? fp.w : fp.h;
      const spot = { cx: o.col + w / 2, cz: o.row + h / 2, game: d3.game ?? '' };
      for (let r = o.row - 1; r <= o.row + h; r++)
        for (let c = o.col - 1; c <= o.col + w; c++) {
          const k = key(c, r);
          const list = this.cells.get(k);
          if (list) list.push(spot);
          else this.cells.set(k, [spot]);
        }
    }
  }

  /** The game at (x, z): the nearest gaming object around that cell, or undefined. */
  at(x: number, z: number): string | undefined {
    const list = this.cells.get(key(Math.floor(x), Math.floor(z)));
    if (!list) return undefined;
    let best: Spot | undefined;
    let bestD = Infinity;
    for (const s of list) {
      const d = (s.cx - x) ** 2 + (s.cz - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best?.game;
  }
}

function key(c: number, r: number): number {
  return (r + 1024) * 4096 + (c + 1024);
}
