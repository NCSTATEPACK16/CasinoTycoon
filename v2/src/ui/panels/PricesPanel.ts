// Food and drink prices. Each bar and food stall gets a card: what it took
// today, how strongly its prices draw custom, and an input per item with its
// cost, margin and the line past which guests feel ripped off. Dearer sells
// fewer: the sim scales how hard hunger and thirst pull a guest to the counter
// by the price, so the best price is a margin-versus-volume call, not "max".

import type { PricedObject, PriceItem } from '../../worker/inspect';
import { el, escapeHtml, money } from '../dom';

export class PricesPanel {
  readonly root = el('div', 'prices-panel');
  private key = '';
  onSetPrice: (objectId: string, itemId: string, price: number) => Promise<number> = () =>
    Promise.reject(new Error('not wired'));

  /** Only these objects (the inspector shows one); all when null. */
  constructor(private only: string | null = null) {}

  update(all: PricedObject[]): void {
    const list = this.only ? all.filter((o) => o.objectId === this.only) : all;
    const key = list.map((o) => `${o.objectId}:${o.items.map((i) => i.id).join(',')}`).join('|');
    if (key !== this.key) {
      this.key = key;
      this.root.replaceChildren();
      if (!this.only)
        this.root.append(
          el('h3', '', 'Food & drink prices'),
          el(
            'p',
            'dim small',
            list.length
              ? 'Dearer prices earn more per sale but sell fewer, and past the rip-off line guests resent paying. Guests go to the cheapest counter.'
              : 'No food stalls or bars yet. Place one from the palette, then set its prices here.',
          ),
        );
      for (const o of list) this.root.append(this.card(o));
    }
    for (const o of list) this.patch(o);
  }

  private card(o: PricedObject): HTMLElement {
    const c = el('div', 'price-card');
    c.dataset.id = o.objectId;
    if (!this.only)
      c.append(el('h4', '', `${escapeHtml(o.name)} <span class="dim">${o.objectId}</span>`));
    c.append(el('div', 'small price-summary'));
    const table = el('table', 'fin prices');
    table.innerHTML =
      '<tr><th>Item</th><th>Price</th><th>Default</th><th>Cost</th><th>Margin</th></tr>';
    for (const item of o.items) {
      const tr = el('tr');
      tr.dataset.item = item.id;
      const input = el('input', 'narrow');
      input.type = 'number';
      input.min = String(item.min);
      input.max = String(item.max);
      input.step = o.defId === 'bar' ? '1' : '0.25';
      input.value = String(item.price);
      input.disabled = !item.onSale;
      input.addEventListener('change', () => {
        const note = c.querySelector('.price-note')!;
        const asked = Number(input.value);
        this.onSetPrice(o.objectId, item.id, asked)
          .then((applied) => {
            input.value = String(applied);
            note.textContent =
              applied === asked
                ? `${item.name}: ${money(applied, true)}.`
                : `${item.name}: held to ${money(applied, true)} (allowed ${money(item.min, true)}–${money(item.max, true)}).`;
          })
          .catch((err: Error) => (note.textContent = err.message));
      });
      const name = el(
        'td',
        '',
        `${escapeHtml(item.name)}${item.onSale ? '' : ' <span class="dim">(off)</span>'}`,
      );
      const price = el('td');
      price.append(input);
      tr.append(
        name,
        price,
        el('td', 'dim', money(item.defaultPrice, true)),
        el('td', 'dim', money(item.cost, true)),
        el('td', 'margin'),
      );
      table.append(tr);
    }
    c.append(table, el('p', 'small price-note dim'));
    return c;
  }

  private patch(o: PricedObject): void {
    const c = this.root.querySelector<HTMLElement>(`.price-card[data-id="${o.objectId}"]`);
    if (!c) return;
    const pull = Math.round(o.appeal * 100);
    c.querySelector('.price-summary')!.innerHTML = `Today ${money(o.today.revenue)} taken · ${money(
      o.today.cost,
    )} in stock costs · draws <b class="${pull >= 100 ? 'good' : pull >= 60 ? 'warn' : 'bad'}">${pull}%</b> of the custom it would at default prices`;
    for (const item of o.items) {
      const tr = c.querySelector<HTMLElement>(`tr[data-item="${item.id}"]`);
      if (!tr) continue;
      const input = tr.querySelector('input')!;
      // Never overwrite what the player is typing.
      if (document.activeElement !== input) input.value = String(item.price);
      tr.querySelector('.margin')!.innerHTML = marginHtml(item);
    }
  }
}

function marginHtml(i: PriceItem): string {
  const m = i.price - i.cost;
  const rip = i.price > i.ripoffAbove;
  return `${money(m, true)}${rip ? ` <b class="bad" title="Above ${money(i.ripoffAbove, true)} guests feel ripped off">rip-off</b>` : ''}`;
}
