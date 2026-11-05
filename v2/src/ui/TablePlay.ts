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
import {
  fromSheet,
  rouletteSpotAt,
  rouletteSpotCentre,
  toSheet,
  trayChips,
  type Wheel,
} from './play/layouts';
import type { MachineInspect } from '../worker/inspect';
import { button, el, escapeHtml, money } from './dom';

interface RoundReply {
  options: string[] | null;
  view: unknown;
  result?: RoundResult & { theo: number };
  wallet: number;
  onTable: number;
}

/** Bets laid with buttons; roulette's are laid by clicking its layout on the felt. */
const BET_SPOTS: Partial<Record<GameKind, { value: string; label: string }[]>> = {
  blackjack: [{ value: 'main', label: 'Bet' }],
  uth: [
    { value: 'ante', label: 'Ante (Blind matches)' },
    { value: 'trips', label: 'Trips' },
  ],
  craps: [
    { value: 'pass', label: 'Pass line' },
    { value: 'dontPass', label: "Don't Pass" },
    { value: 'field', label: 'Field' },
    ...[4, 5, 6, 8, 9, 10].map((n) => ({ value: `place:${n}`, label: `Place ${n}` })),
    ...[4, 6, 8, 10].map((n) => ({ value: `hard:${n}`, label: `Hard ${n}` })),
    { value: 'any7', label: 'Any 7' },
  ],
};

/** A bet's name for the slip: "Split 1-2", "Red", "Place 6". */
function spotLabel(spot: string): string {
  const fixed = Object.values(BET_SPOTS)
    .flat()
    .find((b) => b?.value === spot);
  if (fixed) return fixed.label;
  const [k, a] = spot.split(':');
  const name = k === 'sixline' ? 'Six line' : cap(k!);
  return a ? `${name} ${a}` : name;
}

/** What the panel says while the table plays a round out. */
const WAITING: Partial<Record<GameKind, string>> = {
  roulette: 'No more bets. The ball is spinning…',
  craps: 'Dice are out…',
  slots: 'Spinning…',
  blackjack: 'The dealer plays…',
  uth: 'Showdown…',
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
  /** Chips laid before the round (table-local; no position = the seat's circle). */
  stakes(objectId: string, stakes: Stake[]): void;
  /** Where a screen point falls on the table's felt, table-local, or null. */
  feltPoint(objectId: string, clientX: number, clientY: number): { x: number; z: number } | null;
}

export interface Stake {
  x?: number;
  z?: number;
  amount: number;
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
  /** The bets being laid before a round, by spot, and the last round's for Rebet. */
  private bets = new Map<string, number>();
  private lastBets: [string, number][] = [];
  private chip = 0;
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

  private limits(): { min: number; max: number } {
    const rules = (this.info?.game?.rules ?? {}) as Record<string, number | string>;
    return { min: Number(rules.minBet ?? 1), max: Number(rules.maxBet ?? 1000) };
  }

  private renderBetting(note = ''): void {
    const rules = (this.info?.game?.rules ?? {}) as Record<string, number | string>;
    const kind = this.kind!;
    const body = el('div', 'tp-body');
    if (note) body.append(el('div', 'tp-result', note));
    if (kind === 'slots') {
      // One bet per spin: the machine's denomination × credits on every line.
      const bet = Math.round(Number(rules.denomination) * Number(rules.credits) * 100) / 100;
      const form = el('div', 'tp-bets');
      form.append(el('span', '', `Bet per spin <b>${money(bet, true)}</b>`));
      form.append(
        button('Spin', () => void this.begin([{ spot: 'spin', amount: bet }]), 'primary'),
      );
      body.append(form);
      this.root.replaceChildren(this.header(), body);
      return;
    }
    const { min, max } = this.limits();
    const chips = trayChips(min, max);
    if (!chips.includes(this.chip)) this.chip = chips[Math.min(1, chips.length - 1)]!;
    const tray = el('div', 'tp-chips');
    for (const v of chips) {
      const b = button(
        money(v),
        () => {
          this.chip = v;
          this.renderBetting(note);
        },
        `chip${v === this.chip ? ' active' : ''}`,
      );
      tray.append(b);
    }
    body.append(tray);
    // An engine without its own spots (a game Track B adds later) takes one main bet.
    const spots =
      kind === 'roulette' ? null : (BET_SPOTS[kind] ?? [{ value: 'main', label: 'Bet' }]);
    if (spots) {
      const row = el('div', 'tp-bets');
      for (const sp of spots) row.append(button(sp.label, () => this.addChip(sp.value), 'small'));
      body.append(row);
    } else if (kind === 'roulette') {
      body.append(
        el(
          'div',
          'dim small',
          'Click the layout to bet the chip: on a number, a line, a corner or an outside box.',
        ),
      );
    }
    const slip = el('div', 'small');
    const total = [...this.bets.values()].reduce((t, a) => t + a, 0);
    slip.innerHTML = this.bets.size
      ? [...this.bets].map(([sp, a]) => `${escapeHtml(spotLabel(sp))} ${money(a)}`).join(' · ') +
        ` <b>= ${money(total)}</b>`
      : `<span class="dim">No bets · limits ${money(min)}–${money(max)} a spot</span>`;
    body.append(slip);
    const acts = el('div', 'tp-actions');
    acts.append(
      button('Clear', () => this.setBets([]), 'small'),
      button('Rebet', () => this.setBets(this.lastBets), 'small'),
      button('Double', () => this.setBets([...this.bets].map(([sp, a]) => [sp, a * 2])), 'small'),
    );
    const go = button(
      kind === 'roulette' || kind === 'craps' ? 'Place bets' : 'Deal',
      () => {
        const bets = [...this.bets].map(([spot, amount]) => ({ spot, amount }));
        this.lastBets = [...this.bets];
        void this.begin(bets);
      },
      'primary',
    );
    go.disabled = this.bets.size === 0;
    acts.append(go);
    body.append(acts);
    this.root.replaceChildren(this.header(), body);
    this.showStakes();
  }

  /** The selected chip onto a spot, up to the table maximum. */
  private addChip(spot: string): void {
    if (this.inRound) return;
    const { max } = this.limits();
    const next = Math.min(max, (this.bets.get(spot) ?? 0) + this.chip);
    this.bets.set(spot, next);
    audio.play('chips');
    this.renderBetting();
  }

  private setBets(bets: [string, number][]): void {
    if (this.inRound) return;
    const { min, max } = this.limits();
    this.bets = new Map(
      bets.map(([sp, a]) => [sp, Math.min(max, Math.max(min, a))] as [string, number]),
    );
    this.renderBetting();
  }

  /** A click on the canvas while seated: a roulette bet where the layout was hit. */
  clickAt(clientX: number, clientY: number): void {
    if (this.root.hidden || this.inRound || this.kind !== 'roulette' || !this.objectId) return;
    const p = this.view?.feltPoint(this.objectId, clientX, clientY);
    if (!p) return;
    const { u, v } = toSheet(p.x, p.z);
    const wheel = (this.info?.game?.rules as { wheel?: Wheel } | undefined)?.wheel ?? 'double';
    const spot = rouletteSpotAt(u, v, wheel);
    if (spot) this.addChip(spot);
  }

  /** The bets being laid, as chips on the felt (roulette spots, the seat's circle). */
  private showStakes(): void {
    if (!this.objectId || !this.view) return;
    const stakes: Stake[] = [];
    for (const [spot, amount] of this.bets) {
      if (this.kind === 'roulette') {
        const c = rouletteSpotCentre(spot);
        if (c) stakes.push({ ...fromSheet(c.u, c.v), amount });
      } else if (this.kind === 'blackjack' || this.kind === 'uth') stakes.push({ amount });
    }
    this.view.stakes(this.objectId, stakes);
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
      this.bets = new Map();
      // A dealt hand puts its own chips down; laid roulette chips stay for the spin.
      if (this.kind !== 'roulette') this.view?.stakes(this.objectId!, []);
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
      // Only a status line until the table shows it: the view already holds the result.
      const body = el('div', 'tp-body');
      body.append(el('div', 'dim', WAITING[this.kind!] ?? 'Dealing…'));
      this.root.replaceChildren(this.header(), body);
      await new Promise((res) => setTimeout(res, wait * 1000));
      if (this.root.hidden) return;
    }
    if (!r.options) this.view?.stakes(this.objectId!, []);
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
