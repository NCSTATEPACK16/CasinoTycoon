// The avatar's seat at a game: lay bets, then drive the round with the same
// engine the guests play (roundBegin / roundAct). The round plays out on the
// table itself — the real reels, wheel, dice, cards and chips (TableView, the
// FxDirector) — from the engine's public round view and its settled result,
// never re-simulated here. The DOM holds buttons and text only.

import { audio } from '../audio';
import type { SimClient } from '../client/SimClient';
import { seenCards, type SeenCard } from '../render/fx/felt';
import type { RoundFx } from '../shared/contracts';
import type { GameKind } from '../shared/games';
import type { RoundResult } from '../shared/games';
import { cardLabel } from '../sim/games/cards';
import { fxOf } from '../sim/fx/rounds';
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

/** Actions that push more chips onto the felt. */
const CHIP_ACTIONS = /^(bet|double|split|odds|place|press)/;

const ACTION_LABEL: Record<string, string> = {
  bet4x: 'Raise 4×',
  bet3x: 'Raise 3×',
  bet2x: 'Raise 2×',
  bet1x: 'Bet 1×',
};

/** Where the avatar's rounds play out on the table (main.ts wires the FxDirector). */
export interface TableView {
  /** The table the avatar plays at, or null once it leaves. */
  setOwn(objectId: string | null): void;
  /** Show a settled spin or roll; returns the seconds until its result shows. */
  play(objectId: string, fx: RoundFx): number;
  /** Show a card round so far; returns the seconds until the result shows once settled. */
  hand(objectId: string, seen: SeenCard[], wagered: number, settled: RoundFx | null): number;
}

export class TablePlay {
  readonly root = el('div', 'table-play');
  private objectId: string | null = null;
  private kind: GameKind | null = null;
  private info: MachineInspect | null = null;
  private wallet = 0;
  /** Chips committed to the round in progress, out of the wallet until it settles. */
  private onTable = 0;
  private inRound = false;
  /** What the last view showed, so each new card or roll makes its own sound. */
  private seenCards = 0;
  private seenRolls = 0;
  /** Chips staked at the start of the round in progress. */
  private staked = 0;
  view: TableView | null = null;
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
    this.view?.setOwn(objectId);
    try {
      this.info = await this.sim.command<MachineInspect>({ type: 'inspect', target: { objectId } });
      const f = await this.sim.command<{ wallet: number; onTable: number }>({
        type: 'financials',
      });
      this.wallet = f.wallet;
      this.onTable = f.onTable;
      if (this.kind === 'blackjack' || this.kind === 'uth') audio.play('shuffle');
    } catch (err) {
      this.root.innerHTML = `<p>${escapeHtml((err as Error).message)}</p>`;
      return;
    }
    this.renderBetting();
  }

  leave(): void {
    this.view?.setOwn(null);
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
      this.staked = bets.reduce((t, b) => t + b.amount, 0);
      this.seenCards = 0;
      this.seenRolls = 0;
      await this.show(r);
    } catch (err) {
      this.renderBetting(`<span class="bad">${escapeHtml((err as Error).message)}</span>`);
    }
  }

  private async act(action: string): Promise<void> {
    if (CHIP_ACTIONS.test(action)) audio.play('chips');
    const r = await this.sim.command<RoundReply>({
      type: 'roundAct',
      objectId: this.objectId!,
      action,
    });
    await this.show(r);
  }

  /** Play the reply on the table, then show its text once the table has shown it. */
  private async show(r: RoundReply): Promise<void> {
    const wait = this.playOnTable(r);
    if (wait > 0) {
      const body = el('div', 'tp-body');
      body.append(this.renderView(r.view), el('div', 'dim', r.options ? '' : 'Dealing…'));
      this.root.replaceChildren(this.header(), body);
      await new Promise((res) => setTimeout(res, wait * 1000));
      if (this.root.hidden) return;
    }
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

  /** Hand the reply to the table; the seconds until its result shows there. */
  private playOnTable(r: RoundReply): number {
    const id = this.objectId!;
    const kind = this.kind!;
    const rules = (this.info?.game?.rules ?? {}) as Record<string, unknown>;
    const fx = r.result ? fxOf(kind, rules, r.result) : null;
    const v = (r.view ?? {}) as Record<string, unknown>;
    const seen = seenCards(kind, v);
    if (seen) {
      this.seenCards = Math.max(this.seenCards, visibleCards(kind, v));
      return this.view?.hand(id, seen, r.result?.wagered ?? this.staked, fx) ?? 0;
    }
    if (fx) return this.view?.play(id, fx) ?? 0;
    // A craps roll that didn't settle the round still throws the dice.
    const rolls = (v.rolls as [number, number][] | undefined) ?? [];
    if (kind === 'craps' && rolls.length > this.seenRolls) {
      this.seenRolls = rolls.length;
      const [a, b] = rolls[rolls.length - 1]!;
      const roll: RoundFx = { kind, wagered: 0, returned: 0, summary: '', craps: { dice: [a, b] } };
      return this.view?.play(id, roll) ?? 0;
    }
    return 0;
  }

  /** The round in words; the cards, dice, wheel and reels are on the table. */
  private renderView(view: unknown): HTMLElement {
    const box = el('div', 'tp-view');
    const v = (view ?? {}) as Record<string, unknown>;
    const line = (t: string) => box.append(el('div', '', t));
    switch (this.kind) {
      case 'blackjack': {
        const dealer = (v.dealerCards as number[] | null) ?? [v.dealerUp as number];
        line(`Dealer <b>${cardsText(dealer)}</b>${v.dealerCards ? '' : ' + hole card'}`);
        const hands = (v.hands as { cards: number[]; bet: number; total: number }[]) ?? [];
        hands.forEach((h, i) =>
          line(
            `${hands.length > 1 ? `Hand ${i + 1}` : 'You'} <b>${cardsText(h.cards)}</b> · ${h.total} · ${money(h.bet)}${i === v.active && hands.length > 1 ? ' ◀' : ''}`,
          ),
        );
        break;
      }
      case 'uth': {
        const board = ((v.board as number[]) ?? []).filter((c) => c >= 0);
        line(
          `You <b>${cardsText((v.hole as number[]) ?? [])}</b> · ante ${money(v.ante as number)}${(v.play as number) ? ` · play ${money(v.play as number)}` : ''}`,
        );
        line(`Board <b>${board.length ? cardsText(board) : 'face down'}</b>`);
        if (v.dealer) line(`Dealer <b>${cardsText(v.dealer as number[])}</b>`);
        break;
      }
      case 'craps': {
        const rolls = (v.rolls as [number, number][]) ?? [];
        const last = rolls[rolls.length - 1];
        line(
          last ? `Rolled <b>${last[0] + last[1]}</b> (${last[0]}, ${last[1]})` : 'Come-out roll',
        );
        line(`Point <b>${v.point ?? 'off'}</b> · rolls ${rolls.length}`);
        const working =
          (v.working as { spot: string; amount: number; point: number | null; odds: number }[]) ??
          [];
        for (const w of working)
          line(
            `<span class="small">${w.spot} ${money(w.amount)}${w.point ? ` on ${w.point}` : ''}${w.odds ? ` + odds ${money(w.odds)}` : ''}</span>`,
          );
        break;
      }
      case 'roulette': {
        const pocket = v.pocket as number | null;
        line(
          pocket === null || pocket === undefined
            ? 'Place your bets…'
            : `Ball in <b>${pocket === 37 ? '00' : pocket}</b>`,
        );
        break;
      }
    }
    return box;
  }
}

/** Face-up cards in a round view (a hole card counts once it turns over). */
function visibleCards(kind: GameKind | null, v: Record<string, unknown>): number {
  const up = (cs: unknown) =>
    ((cs as number[] | null | undefined) ?? []).filter((c) => c >= 0).length;
  if (kind === 'blackjack') {
    const hands = (v.hands as { cards: number[] }[] | undefined) ?? [];
    return up(v.dealerCards ?? [v.dealerUp]) + hands.reduce((n, h) => n + up(h.cards), 0);
  }
  if (kind === 'uth') return up(v.dealer) + up(v.board) + up(v.hole);
  return 0;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function labelFor(action: string): string {
  if (action.startsWith('odds:')) return `Take odds (${action.slice(5)})`;
  return cap(action);
}

/** Cards as short text: "Q♣ 4♦". */
function cardsText(cards: number[]): string {
  return cards
    .filter((c) => c >= 0)
    .map((c) => {
      const lab = cardLabel(c);
      return `${lab[0] === 'T' ? '10' : lab[0]}${{ c: '♣', d: '♦', h: '♥', s: '♠' }[lab[1]!]}`;
    })
    .join(' ');
}
