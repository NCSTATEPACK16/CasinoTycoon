import { ICON_SPRITE, type IconName } from './icons.generated';

// SVG icons for UI chrome, replacing emoji.
//
// Emoji renders differently on every OS, so its look was never ours to control,
// and its cartoon register fought the painterly world art. It stays in guest
// thought bubbles (see src/data/thoughts.ts), where the casual register is the
// point — a bubble is speech, a toolbar is a control surface.
//
// Every icon strokes with currentColor, so an icon inherits the color of
// whatever it sits in: hover, disabled, and semantic states need no
// icon-specific CSS at all.

export type { IconName };

let injected = false;

/** Injects the sprite once. Idempotent — safe to call from any entry point. */
export function injectIconSprite(): void {
  if (injected) return;
  injected = true;
  const host = document.createElement('div');
  host.style.display = 'none';
  host.innerHTML = ICON_SPRITE;
  document.body.prepend(host);
}

/**
 * An icon element sized in `em`, so it tracks the type scale of its context
 * instead of needing a size per call site.
 */
export function icon(name: IconName, className = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className ? `icon ${className}` : 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/** An icon followed by a text label — the common case in buttons and rows. */
export function iconLabel(name: IconName, text: string, className = ''): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className ? `icon-label ${className}` : 'icon-label';
  span.appendChild(icon(name));
  const label = document.createElement('span');
  label.textContent = text;
  span.appendChild(label);
  return span;
}
