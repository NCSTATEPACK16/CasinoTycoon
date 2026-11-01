// The Guests tab: what guests are thinking, then everyone on the floor.
//
// The summary ranks the thoughts held in the last few hours by how many
// guests had them, with a trend arrow and what to do about it; clicking one
// filters the list to the guests who had it. The list sorts by any column and
// finds or follows a guest. Rows are keyed by id and patched in place, never
// rebuilt by the poll, so a Find or Follow press always lands.

import type { GuestRow, ThoughtLine, ThoughtSummary } from '../../worker/feedback';
import { button, el, escapeHtml, money } from '../dom';

type SortKey = 'name' | 'happiness' | 'wallet' | 'net' | 'hours';

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: 'Guest', numeric: false },
  { key: 'happiness', label: 'Mood', numeric: true },
  { key: 'wallet', label: 'Wallet', numeric: true },
  { key: 'net', label: 'Won', numeric: true },
  { key: 'hours', label: 'Here', numeric: true },
];

/** Rows shown at once; the rest are a filter or a sort away. */
const MAX_ROWS = 120;

const STATE_LABEL: Record<string, string> = {
  wander: 'browsing',
  seekGame: 'to a game',
  queue: 'queueing',
  play: 'playing',
  service: 'eating/using',
  leaving: 'leaving',
};

function sortValue(r: GuestRow, k: SortKey): number | string {
  switch (k) {
    case 'name':
      return r.name;
    case 'happiness':
      return r.happiness;
    case 'wallet':
      return r.wallet;
    case 'net':
      return r.net;
    case 'hours':
      return r.hoursOnFloor;
  }
}

export class GuestsPanel {
  readonly root = el('div', 'guests-panel');
  onLocate: (agentId: number) => void = () => {};
  onFollow: (agentId: number, name: string) => void = () => {};
  private head = el('p', 'small dim');
  private thoughtList = el('div', 'thought-list');
  private thoughtRows = new Map<string, HTMLElement>();
  private filterBar = el('div', 'guest-filter');
  private search = el('input', 'guest-search');
  private table = el('table', 'fin guest-table');
  private tbody = el('tbody');
  private rows = new Map<string, HTMLTableRowElement>();
  private more = el('p', 'small dim');
  private sort: { key: SortKey; desc: boolean } = { key: 'happiness', desc: false };
  private thoughtFilter: ThoughtLine | null = null;
  private last: GuestRow[] = [];
  /** The latest summary's lines by id, for the thought filter. */
  private lines = new Map<string, ThoughtLine>();

  constructor() {
    this.search.type = 'search';
    this.search.placeholder = 'Find a guest by name';
    this.search.addEventListener('input', () => this.renderList());
    const thead = el('thead');
    const tr = el('tr');
    for (const c of COLUMNS) {
      const th = el('th', c.numeric ? 'num' : '');
      th.append(button(c.label, () => this.setSort(c.key), 'sort'));
      th.dataset.key = c.key;
      tr.append(th);
    }
    tr.append(el('th'));
    thead.append(tr);
    this.table.append(thead, this.tbody);
    const wrap = el('div', 'scroll-x');
    wrap.append(this.table);
    this.root.append(
      el('h3', '', 'What guests are thinking'),
      this.head,
      this.thoughtList,
      el('h3', '', 'On the floor'),
      this.filterBar,
      this.search,
      wrap,
      this.more,
    );
    this.renderSortMarks();
  }

  update(summary: ThoughtSummary, list: GuestRow[]): void {
    this.head.textContent = summary.lines.length
      ? `Thoughts held in the last ${summary.windowHours} hours by the ${summary.guests} guests on the floor. Click one to see who.`
      : summary.guests
        ? 'Nobody has said anything worth noting lately.'
        : 'No guests yet.';
    this.lines = new Map(summary.lines.map((l) => [l.id, l]));
    this.renderThoughts(summary.lines);
    // A filter on a thought nobody holds any more falls away by itself.
    if (this.thoughtFilter) {
      const still = summary.lines.find((l) => l.id === this.thoughtFilter!.id);
      this.thoughtFilter = still ?? null;
    }
    this.last = list;
    this.renderList();
  }

  private renderThoughts(lines: ThoughtLine[]): void {
    const keep = new Set(lines.map((l) => l.id));
    for (const [id, row] of this.thoughtRows)
      if (!keep.has(id)) {
        row.remove();
        this.thoughtRows.delete(id);
      }
    const max = Math.max(1, ...lines.map((l) => l.count));
    for (const l of lines) {
      let row = this.thoughtRows.get(l.id);
      if (!row) {
        const b = el('button', `thought-row ${l.sentiment}`);
        b.type = 'button';
        row = b;
        row.onclick = () => this.toggleThought(l.id);
        this.thoughtRows.set(l.id, row);
      }
      // Green when the trend is good news: more of a good thought, or less of
      // a bad one. A neutral thought's trend is just a count.
      const tone = (up: boolean) =>
        l.sentiment === 'neutral' ? 'dim' : up === (l.sentiment === 'good') ? 'good' : 'bad';
      const trend =
        l.trend > 0
          ? `<span class="${tone(true)}" title="More guests lately">▲${l.trend}</span>`
          : l.trend < 0
            ? `<span class="${tone(false)}" title="Fewer guests lately">▼${-l.trend}</span>`
            : '<span class="dim" title="Steady">–</span>';
      row.innerHTML = `<span class="glyph">${l.glyph}</span><span class="t-text">“${escapeHtml(l.text)}”${
        l.advice ? `<small>${escapeHtml(l.advice)}</small>` : ''
      }</span><b class="t-count">${l.count}</b>${trend}<i class="t-bar" style="--v:${(l.count / max) * 100}%"></i>`;
      row.classList.toggle('active', this.thoughtFilter?.id === l.id);
      this.thoughtList.append(row); // re-append keeps the ranked order
    }
  }

  private toggleThought(id: string): void {
    this.thoughtFilter = this.thoughtFilter?.id === id ? null : (this.lines.get(id) ?? null);
    for (const [k, row] of this.thoughtRows)
      row.classList.toggle('active', this.thoughtFilter?.id === k);
    this.renderList();
  }

  private setSort(key: SortKey): void {
    this.sort =
      this.sort.key === key
        ? { key, desc: !this.sort.desc }
        : { key, desc: COLUMNS.find((c) => c.key === key)!.numeric };
    this.renderSortMarks();
    this.renderList();
  }

  private renderSortMarks(): void {
    for (const th of this.table.querySelectorAll<HTMLElement>('th[data-key]')) {
      const on = th.dataset.key === this.sort.key;
      th.classList.toggle('sorted', on);
      th.querySelector('button')!.dataset.dir = on ? (this.sort.desc ? '▼' : '▲') : '';
    }
  }

  private renderList(): void {
    const f = this.thoughtFilter;
    this.filterBar.replaceChildren();
    if (f) {
      this.filterBar.append(
        el('span', 'small', `Showing guests who thought ${escapeHtml(f.text)}`),
        button('Show everyone', () => this.toggleThought(f.id), 'small'),
      );
    }
    const q = this.search.value.trim().toLowerCase();
    const shown = this.last.filter(
      (r) => (!f || r.thoughtIds.includes(f.id)) && (!q || r.name.toLowerCase().includes(q)),
    );
    const { key, desc } = this.sort;
    shown.sort((a, b) => {
      const x = sortValue(a, key);
      const y = sortValue(b, key);
      const c = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y));
      return (desc ? -c : c) || a.name.localeCompare(b.name);
    });
    const page = shown.slice(0, MAX_ROWS);
    const keep = new Set(page.map((r) => r.id));
    for (const [id, tr] of this.rows)
      if (!keep.has(id)) {
        tr.remove();
        this.rows.delete(id);
      }
    for (const r of page) {
      let tr = this.rows.get(r.id);
      if (!tr) {
        tr = this.makeRow(r);
        this.rows.set(r.id, tr);
      }
      this.patchRow(tr, r);
      this.tbody.append(tr); // moves the node; its buttons survive
    }
    this.more.textContent =
      shown.length > MAX_ROWS
        ? `Showing ${MAX_ROWS} of ${shown.length}. Sort or search to see the rest.`
        : shown.length === 0 && this.last.length
          ? 'Nobody matches.'
          : '';
  }

  private makeRow(r: GuestRow): HTMLTableRowElement {
    const tr = el('tr');
    tr.innerHTML =
      '<td class="g-name"></td><td class="num g-mood"></td><td class="num g-wallet"></td><td class="num g-net"></td><td class="num g-hours"></td>';
    const acts = el('td', 'g-acts');
    acts.append(
      button('⌖', () => this.onLocate(r.agentId), 'small'),
      button('👁', () => this.onFollow(r.agentId, r.name), 'small'),
    );
    acts.firstElementChild!.setAttribute('title', 'Find: take the camera to them and inspect');
    acts.lastElementChild!.setAttribute('title', 'Follow: keep the camera on them');
    tr.append(acts);
    return tr;
  }

  private patchRow(tr: HTMLTableRowElement, r: GuestRow): void {
    const cell = (cls: string) => tr.querySelector<HTMLElement>(cls)!;
    const tier = r.tier ? ` <span class="tier-badge">${escapeHtml(r.tier)}</span>` : '';
    const doing = STATE_LABEL[r.state] ?? r.state;
    const need = r.need
      ? ` · <span class="warn">${r.need.kind} ${Math.round(r.need.value)}</span>`
      : '';
    const thought = r.thought
      ? `<small class="dim">${r.thought.glyph} ${escapeHtml(r.thought.text)}</small>`
      : '';
    cell('.g-name').innerHTML =
      `${escapeHtml(r.name)}${tier}<small class="dim">${escapeHtml(r.archetype)} · ${escapeHtml(doing)}${need}</small>${thought}`;
    const mood = Math.round(r.happiness);
    cell('.g-mood').innerHTML =
      `<span class="${mood >= 60 ? 'good' : mood >= 35 ? 'warn' : 'bad'}">${mood}</span>`;
    cell('.g-wallet').textContent = money(r.wallet);
    cell('.g-net').innerHTML = `<span class="${r.net > 0 ? 'bad' : r.net < 0 ? 'good' : 'dim'}">${
      r.net > 0 ? '+' : ''
    }${money(r.net)}</span>`;
    cell('.g-hours').textContent = `${r.hoursOnFloor.toFixed(1)}h`;
  }
}
