// B15b: the layout shell. Every DOM surface mounts into one of these named
// regions and the shell's grid decides where the region sits, so no surface
// picks its own screen-corner offsets and two surfaces can only meet where
// two regions do.
//
//   ┌──────────────────────── top ────────────────────────┐
//   │ left │            windows (+ toast)           │ right │
//   ├──────────────────────── hint ───────────────────────┤
//   └──────────────────────── dock ───────────────────────┘
//   overlay (cursor tag, crosshair) and modal (menus, help, report) span it all.

import '../styles/tokens.css';
import '../styles/base.css';
import './shell.css';

export const REGIONS = [
  'top',
  'left',
  'windows',
  'toast',
  'right',
  'hint',
  'dock',
  'overlay',
  'modal',
] as const;
export type Region = (typeof REGIONS)[number];

export class Shell {
  private regions = new Map<Region, HTMLElement>();

  constructor(readonly root: HTMLElement) {
    root.classList.add('shell');
    for (const r of REGIONS) {
      const node = document.createElement('div');
      node.className = `region region-${r}`;
      node.dataset.region = r;
      this.regions.set(r, node);
      root.append(node);
    }
  }

  region(r: Region): HTMLElement {
    return this.regions.get(r)!;
  }

  mount(r: Region, ...nodes: HTMLElement[]): void {
    this.region(r).append(...nodes);
  }
}

/** The region inside `root` (the UI root a caller was handed), or `root`
 *  itself when no shell was built there — so a component handed the bare
 *  UI root by code outside Track B still lands in its region. */
export function regionIn(root: HTMLElement, r: Region): HTMLElement {
  return root.querySelector<HTMLElement>(`:scope > [data-region="${r}"]`) ?? root;
}
