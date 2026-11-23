// B11: the Staff tab's roster. Who works which shift, who is on the floor
// now, how good and how happy they are; training, shift and wage levers; and
// the day's traffic curve with the number on shift each hour beside it, so a
// thin evening shows before the guests feel it. Built once and patched, like
// the rest of the panel, so a press never lands on a rebuilt button.

import './StaffRoster.css';
import { STAFF_BALANCE, STAFF_DEPTH } from '../../data/balance';
import { hourFactor } from '../../data/traffic';
import type { StaffInspect } from '../../worker/inspect';
import { button, el, escapeHtml, money } from '../dom';

type Shift = 'day' | 'swing' | 'graveyard';
const SHIFT_LABEL: Record<Shift, string> = {
  day: 'Day 8–16',
  swing: 'Swing 16–24',
  graveyard: 'Night 0–8',
};

function covers(shift: Shift, hour: number): boolean {
  const [from, to] = STAFF_DEPTH.shifts[shift];
  return hour >= from && hour < to;
}

function tone(v: number, goodHigh = true): string {
  const x = goodHigh ? v : 100 - v;
  return x >= 60 ? 'good' : x >= STAFF_DEPTH.lowMorale ? 'warn' : 'bad';
}

export class StaffRoster {
  readonly root = el('div', 'staff-roster');
  onTrain: (staffId: string) => void = () => {};
  onShift: (staffId: string, shift: Shift) => void = () => {};
  onWage: (kind: string, wagePerHour: number) => void = () => {};
  onFire: (staffId: string) => void = () => {};
  private curve = el('div', 'shift-curve');
  private wages = el('div', 'wage-levers');
  private title = el('h3');
  private table = el('table', 'fin roster');
  private rows = new Map<string, HTMLTableRowElement>();
  private wageInputs = new Map<string, HTMLInputElement>();

  constructor() {
    this.table.innerHTML =
      '<thead><tr><th>Who</th><th>Shift</th><th>Now</th><th class="num" title="Skill">Sk</th><th class="num" title="Morale">Mor</th><th class="num" title="Fatigue">Tired</th><th></th></tr></thead><tbody></tbody>';
    for (let h = 0; h < 24; h++) {
      const col = el('div', 'sc-hour');
      col.title = `${h}:00`;
      col.innerHTML = `<i style="--v:${Math.min(100, hourFactor(h) * 45)}%"></i><b></b><small>${h % 6 === 0 ? h : ''}</small>`;
      this.curve.append(col);
    }
    const wrap = el('div', 'scroll-x');
    wrap.append(this.table);
    this.root.append(
      el('h3', '', 'Shifts against the day'),
      el(
        'p',
        'small dim',
        'Bars: guests arriving by hour. Numbers: staff on shift. Off-shift staff are not paid.',
      ),
      this.curve,
      el('h3', '', 'Wages'),
      this.wages,
      this.title,
      wrap,
    );
  }

  update(list: StaffInspect[]): void {
    this.renderCurve(list);
    this.renderWages(list);
    this.title.textContent = `Roster (${list.length})`;
    const tbody = this.table.tBodies[0]!;
    const keep = new Set(list.map((s) => s.id));
    for (const [id, tr] of this.rows)
      if (!keep.has(id)) {
        tr.remove();
        this.rows.delete(id);
      }
    for (const s of list) {
      let tr = this.rows.get(s.id);
      if (!tr) {
        tr = this.makeRow(s);
        this.rows.set(s.id, tr);
      }
      this.patchRow(tr, s);
      tbody.append(tr);
    }
  }

  private renderCurve(list: StaffInspect[]): void {
    const cols = this.curve.children;
    for (let h = 0; h < 24; h++) {
      const n = list.filter((s) => s.shift && covers(s.shift, h)).length;
      const col = cols[h] as HTMLElement;
      col.querySelector('b')!.textContent = String(n);
      // An hour busier than the mean with nobody on is the thing to see.
      col.classList.toggle('thin', n === 0 && hourFactor(h) > 1 && list.length > 0);
    }
  }

  private renderWages(list: StaffInspect[]): void {
    const kinds = [...new Set(list.map((s) => s.role))];
    for (const [k, input] of this.wageInputs)
      if (!kinds.includes(k)) {
        input.closest('label')!.remove();
        this.wageInputs.delete(k);
      }
    for (const kind of kinds) {
      const market = STAFF_BALANCE[kind as keyof typeof STAFF_BALANCE] as { wagePerHour: number };
      const wage = list.find((s) => s.role === kind)!.wagePerHour;
      let input = this.wageInputs.get(kind);
      if (!input) {
        input = el('input');
        input.type = 'number';
        input.step = '0.5';
        input.min = String(market.wagePerHour * STAFF_DEPTH.wageRange[0]);
        input.max = String(market.wagePerHour * STAFF_DEPTH.wageRange[1]);
        const field = input;
        field.addEventListener('change', () => this.onWage(kind, Number(field.value)));
        const label = el(
          'label',
          'wage-lever',
          `<span>${escapeHtml(cap(kind))}</span><small class="dim">market ${money(market.wagePerHour, true)}/h</small>`,
        );
        label.append(input);
        this.wages.append(label);
        this.wageInputs.set(kind, input);
      }
      if (document.activeElement !== input) input.value = String(wage);
    }
  }

  private makeRow(s: StaffInspect): HTMLTableRowElement {
    const tr = el('tr');
    tr.innerHTML =
      '<td class="r-who"></td><td class="r-shift"></td><td class="r-now"></td><td class="num r-skill"></td><td class="num r-morale"></td><td class="num r-fatigue"></td>';
    const select = el('select');
    for (const sh of Object.keys(SHIFT_LABEL) as Shift[])
      select.append(new Option(SHIFT_LABEL[sh], sh));
    select.addEventListener('change', () => this.onShift(s.id, select.value as Shift));
    tr.querySelector('.r-shift')!.append(select);
    const acts = el('td', 'r-acts');
    const train = button('Train', () => this.onTrain(s.id), 'small');
    train.title = `+${STAFF_DEPTH.train.skill} skill for ${money(STAFF_DEPTH.train.cost)}; away ${STAFF_DEPTH.train.hours} hours`;
    acts.append(
      train,
      button('Fire', () => this.onFire(s.id), 'danger small'),
    );
    tr.append(acts);
    return tr;
  }

  private patchRow(tr: HTMLTableRowElement, s: StaffInspect): void {
    const cell = (c: string) => tr.querySelector<HTMLElement>(c)!;
    const mis = s.misPays ? ` · ${s.misPays} mis-pays (${money(s.misPaid ?? 0)})` : '';
    cell('.r-who').innerHTML =
      `${escapeHtml(s.id)}<small class="dim">${escapeHtml(cap(s.role))} · ${money(s.wagePerHour, true)}/h${mis}</small>`;
    const select = cell('.r-shift').querySelector('select')!;
    if (document.activeElement !== select && s.shift) select.value = s.shift;
    cell('.r-now').innerHTML = s.away
      ? `<span class="warn">${s.away === 'training' ? 'training' : 'on break'} ${s.awayHours}h</span>`
      : s.onShift
        ? `<span class="good">on</span> <small class="dim">${escapeHtml(s.state)}</small>`
        : '<span class="dim">off</span>';
    cell('.r-skill').textContent = String(s.skill ?? '–');
    cell('.r-morale').innerHTML = `<span class="${tone(s.morale ?? 70)}">${s.morale ?? '–'}</span>`;
    cell('.r-fatigue').innerHTML =
      `<span class="${tone(s.fatigue ?? 0, false)}">${s.fatigue ?? '–'}</span>`;
    const train = tr.querySelector<HTMLButtonElement>('.r-acts button')!;
    train.disabled = !!s.away || (s.skill ?? 0) >= 100;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
