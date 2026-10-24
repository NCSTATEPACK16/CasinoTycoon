// The avatar's seat at a game: lay bets, then drive the round with the same
// engine the guests play (roundBegin / roundAct). The view is drawn from the
// engine's public round view — cards, dice, reels — never re-simulated here.

import type { SimClient } from '../client/SimClient';
import type { GameKind } from '../shared/games';
import type { RoundResult } from '../shared/games';
import { cardLabel } from '../sim/games/cards';
import type { MachineInspect } from '../worker/inspect';
import { button, el, escapeHtml, money } from './dom';

interface RoundReply {
  options: string[] | null;
  view: unknown;
  result?: RoundResult & { theo: number };
  wallet: number;
  onTable: number;
}

const BET_SPOTS: Partial<Record<GameKind, { value: string; label: string }[]>> = {
  roulette: [
    ...['red', 'black', 'odd', 'even', 'low', 'high'].map((s) => ({ value: s, label: cap(s) })),
    ...[1, 2, 3].map((d) => ({ value: `dozen:${d}`, label: `Dozen ${d}` })),
    ...[1, 2, 3].map((c) => ({ value: `column:${c}`, label: `Column ${c}` })),
    { value: 'straight', label: 'Straight up (pick a number)' },
  ],
  craps: [
    { value: 'pass', label: 'Pass line' },
    { value: 'dontPass', label: "Don't Pass (bar 12)" },
    { value: 'field', label: 'Field' },
    ...[4, 5, 6, 8, 9, 10].map((n) => ({ value: `place:${n}`, label: `Place ${n}` })),
    ...[4, 6, 8, 10].map((n) => ({ value: `hard:${n}`, label: `Hard ${n}` })),
    { value: 'any7', label: 'Any 7' },
  ],
};

const ACTION_LABEL: Record<string, string> = {
  bet4x: 'Raise 4×',
  bet3x: 'Raise 3×',
  bet2x: 'Raise 2×',
  bet1x: 'Bet 1×',
};

export class TablePlay {
  readonly root = el('div', 'table-play');
  private objectId: string | null = null;
  private kind: GameKind | null = null;
  private info: MachineInspect | null = null;
  private wallet = 0;
  /** Chips committed to the round in progress, out of the wallet until it settles. */
  private onTable = 0;
  private inRound = false;
  onLeave: () => void = () => {};

  constructor(private sim: SimClient) {
    this.root.hidden = true;
    window.addEventListener('keydown', (e) => {
      if (!this.root.hidden && e.code === 'Escape' && !this.inRound) this.leave();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  async open(objectId: string, game: string | null): Promise<void> {
    if (!game) return;
    this.objectId = objectId;
    this.kind = game as GameKind;
    this.root.hidden = false;
    try {
      this.info = await this.sim.command<MachineInspect>({ type: 'inspect', target: { objectId } });
      const f = await this.sim.command<{ wallet: number; onTable: number }>({
        type: 'financials',
      });
      this.wallet = f.wallet;
      this.onTable = f.onTable;
    } catch (err) {
      this.root.innerHTML = `<p>${escapeHtml((err as Error).message)}</p>`;
      return;
    }
    this.renderBetting();
  }

  leave(): void {
    this.root.hidden = true;
    this.objectId = null;
    this.inRound = false;
    this.onLeave();
  }

  private header(): HTMLElement {
    const h = el('div', 'tp-head');
    const edge = this.info?.game ? ` · house edge ${(this.info.game.edge * 100).toFixed(2)}%` : '';
    const inPlay =
      this.onTable > 0 ? ` <span class="dim">· ${money(this.onTable, true)} in play</span>` : '';
    h.innerHTML = `<b>${escapeHtml(this.info?.name ?? '')}</b><span class="dim">${edge}</span><span class="tp-wallet">Wallet ${money(this.wallet - this.onTable, true)}${inPlay}</span>`;
    if (!this.inRound) h.append(button('Stand up', () => this.leave(), 'small'));
    return h;
  }

  private renderBetting(note = ''): void {
    const rules = (this.info?.game?.rules ?? {}) as Record<string, number | string>;
    const kind = this.kind!;
    const min = Number(rules.minBet ?? 1);
    const max = Number(rules.maxBet ?? 1000);
    const body = el('div', 'tp-body');
    if (note) body.append(el('div', 'tp-result', note));
    const form = el('div', 'tp-bets');
    let spotSel: HTMLSelectElement | null = null;
    let numberIn: HTMLInputElement | null = null;
    const amount = el('input');
    amount.type = 'number';
    amount.min = String(min);
    amount.max = String(max);
    amount.step = String(Math.max(1, min));
    amount.value = String(
      Math.min(
        max,
        Math.max(min, Math.round((this.wallet - this.onTable) / 20 / min) * min || min),
      ),
    );
    const spots = BET_SPOTS[kind];
    if (spots) {
      spotSel = el('select');
      for (const s of spots) {
        const o = el('option', '', s.label);
        o.value = s.value;
        spotSel.append(o);
      }
      form.append(spotSel);
      if (kind === 'roulette') {
        numberIn = el('input');
        numberIn.type = 'number';
        numberIn.min = '0';
        numberIn.max = '36';
        numberIn.value = '17';
        numberIn.className = 'narrow';
        numberIn.hidden = true;
        spotSel.onchange = () => (numberIn!.hidden = spotSel!.value !== 'straight');
        form.append(numberIn);
      }
    }
    let trips: HTMLInputElement | null = null;
    if (kind === 'slots') {
      const bet = Math.round(Number(rules.denomination) * Number(rules.credits) * 100) / 100;
      form.append(el('span', '', `Bet per spin: <b>${money(bet, true)}</b>`));
      amount.value = String(bet);
    } else {
      const label = el('label', '', kind === 'uth' ? 'Ante (Blind matches) ' : 'Bet ');
      label.append(amount);
      form.append(label);
      if (kind === 'uth') {
        trips = el('input');
        trips.type = 'checkbox';
        const tl = el('label', '', ' Trips side bet');
        tl.prepend(trips);
        form.append(tl);
      }
      form.append(el('span', 'dim small', `limits ${money(min)}–${money(max)}`));
    }
    const deal = button(
      kind === 'slots' || kind === 'roulette' ? 'Place bet' : 'Deal',
      () => {
        const amt = Number(amount.value);
        const bets: { spot: string; amount: number }[] = [];
        switch (kind) {
          case 'slots':
            bets.push({ spot: 'spin', amount: amt });
            break;
          case 'blackjack':
            bets.push({ spot: 'main', amount: amt });
            break;
          case 'uth':
            bets.push({ spot: 'ante', amount: amt });
            if (trips?.checked)
              bets.push({ spot: 'trips', amount: Math.max(1, Math.round(amt / 2)) });
            break;
          default: {
            const spot =
              spotSel!.value === 'straight' ? `straight:${numberIn!.value}` : spotSel!.value;
            bets.push({ spot, amount: amt });
          }
        }
        void this.begin(bets);
      },
      'primary',
    );
    form.append(deal);
    body.append(form);
    this.root.replaceChildren(this.header(), body);
  }

  private async begin(bets: { spot: string; amount: number }[]): Promise<void> {
    try {
      const r = await this.sim.command<RoundReply>({
        type: 'roundBegin',
        objectId: this.objectId!,
        bets,
      });
      this.inRound = true;
      this.show(r);
    } catch (err) {
      this.renderBetting(`<span class="bad">${escapeHtml((err as Error).message)}</span>`);
    }
  }

  private async act(action: string): Promise<void> {
    const r = await this.sim.command<RoundReply>({
      type: 'roundAct',
      objectId: this.objectId!,
      action,
    });
    this.show(r);
  }

  private show(r: RoundReply): void {
    this.wallet = r.wallet;
    this.onTable = r.onTable;
    if (!r.options) {
      this.inRound = false;
      const res = r.result;
      const net = res ? res.returned - res.wagered : 0;
      const line = res
        ? `${escapeHtml(res.summary)} — <b class="${net >= 0 ? 'good' : 'bad'}">${net >= 0 ? '+' : ''}${money(net, true)}</b>`
        : 'Round over';
      // Keep the final table state on screen above the next bet.
      const view = this.renderView(r.view);
      this.renderBetting(line);
      this.root.querySelector('.tp-body')?.prepend(view);
      return;
    }
    const body = el('div', 'tp-body');
    body.append(this.renderView(r.view));
    const acts = el('div', 'tp-actions');
    for (const o of r.options)
      acts.append(
        button(
          ACTION_LABEL[o] ?? labelFor(o),
          () => void this.act(o),
          o === r.options[0] ? '' : '',
        ),
      );
    body.append(acts);
    this.root.replaceChildren(this.header(), body);
  }

  private renderView(view: unknown): HTMLElement {
    const box = el('div', 'tp-view');
    const v = view as Record<string, unknown>;
    switch (this.kind) {
      case 'blackjack': {
        const dealer = (v.dealerCards as number[] | null) ?? [v.dealerUp as number, -1];
        box.append(cardsRow('Dealer', dealer));
        const hands = v.hands as { cards: number[]; bet: number; total: number }[];
        hands.forEach((h, i) =>
          box.append(
            cardsRow(
              `${hands.length > 1 ? `Hand ${i + 1}` : 'You'} · ${h.total} · ${money(h.bet)}`,
              h.cards,
              i === v.active && hands.length > 1,
            ),
          ),
        );
        break;
      }
      case 'uth': {
        box.append(cardsRow('Dealer', (v.dealer as number[] | null) ?? [-1, -1]));
        box.append(cardsRow('Board', padCards(v.board as number[], 5)));
        box.append(
          cardsRow(
            `You · ante ${money(v.ante as number)}${(v.play as number) ? ` · play ${money(v.play as number)}` : ''}`,
            v.hole as number[],
          ),
        );
        break;
      }
      case 'craps': {
        const rolls = (v.rolls as [number, number][]) ?? [];
        const last = rolls[rolls.length - 1];
        box.append(
          el(
            'div',
            'dice',
            last
              ? `${die(last[0])} ${die(last[1])} <b>${last[0] + last[1]}</b>`
              : '<span class="dim">Come-out roll</span>',
          ),
        );
        box.append(el('p', '', `Point: <b>${v.point ?? 'off'}</b> · rolls ${rolls.length}`));
        const working =
          (v.working as { spot: string; amount: number; point: number | null; odds: number }[]) ??
          [];
        if (working.length)
          box.append(
            el(
              'p',
              'small',
              working
                .map(
                  (w) =>
                    `${w.spot} ${money(w.amount)}${w.point ? ` on ${w.point}` : ''}${w.odds ? ` + odds ${money(w.odds)}` : ''}`,
                )
                .join(' · '),
            ),
          );
        break;
      }
      case 'roulette': {
        const pocket = v.pocket as number | null;
        box.append(
          el(
            'div',
            'wheel',
            pocket === null
              ? '<span class="dim">Place your bets…</span>'
              : `Ball lands on <b class="pocket">${pocket === 37 ? '00' : pocket}</b>`,
          ),
        );
        break;
      }
      case 'slots': {
        const out = v.outcome as { window: string[][]; multiplier: number } | null;
        if (out) {
          const rows = out.window[0]?.length ?? 1;
          const grid = el('div', 'reels');
          grid.style.setProperty('--cols', String(out.window.length));
          for (let r = 0; r < rows; r++)
            for (const reel of out.window) grid.append(el('span', '', escapeHtml(reel[r] ?? '')));
          box.append(grid);
        } else box.append(el('div', 'dim', 'Pull the handle…'));
        break;
      }
    }
    return box;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelFor(action: string): string {
  if (action.startsWith('odds:')) return `Take odds (${action.slice(5)})`;
  return cap(action);
}

function padCards(cards: number[], n: number): number[] {
  return [...cards, ...Array<number>(Math.max(0, n - cards.length)).fill(-1)];
}

function cardsRow(label: string, cards: number[], active = false): HTMLElement {
  const row = el('div', `cards-row${active ? ' active' : ''}`);
  row.append(el('span', 'dim', escapeHtml(label)));
  const hand = el('div', 'cards');
  for (const c of cards) {
    if (c < 0) hand.append(el('span', 'card back', ''));
    else {
      const lab = cardLabel(c);
      const suit = { c: '♣', d: '♦', h: '♥', s: '♠' }[lab[1]!]!;
      const rank = lab[0] === 'T' ? '10' : lab[0]!;
      hand.append(el('span', `card ${'dh'.includes(lab[1]!) ? 'red' : ''}`, `${rank}${suit}`));
    }
  }
  row.append(hand);
  return row;
}

function die(n: number): string {
  return `<span class="die">${'⚀⚁⚂⚃⚄⚅'[n - 1] ?? n}</span>`;
}
