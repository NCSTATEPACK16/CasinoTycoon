// Tiny DOM builder helpers for the UI layer. No framework — the UI is small,
// event-driven, and must stay trivially portable (Capacitor later).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function row(label: string, value: string): HTMLElement {
  const r = el('div', 'p-row');
  r.appendChild(el('span', '', label));
  r.appendChild(el('span', 'val', value));
  return r;
}

export function formatCash(cash: number): string {
  return `$${Math.round(cash).toLocaleString('en-US')}`;
}
