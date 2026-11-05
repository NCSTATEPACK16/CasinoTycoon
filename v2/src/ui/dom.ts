// Tiny DOM helpers shared by the panels. No framework: panels build their
// markup once and patch text on refresh.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  html = '',
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html) n.innerHTML = html;
  return n;
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.onclick = (e) => {
    e.stopPropagation();
    onClick();
  };
  return b;
}

export const money = (n: number, cents = false): string => {
  const abs = Math.abs(n);
  const s = cents && abs < 1000 ? abs.toFixed(2) : Math.round(abs).toLocaleString();
  return `${n < 0 ? '-' : ''}$${s}`;
};

export const pct = (f: number | null | undefined, digits = 2): string =>
  f === null || f === undefined || !Number.isFinite(f) ? '—' : `${(f * 100).toFixed(digits)}%`;

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
