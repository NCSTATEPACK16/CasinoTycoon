// Bank loans, in the Finances tab: what the bank will lend and on what terms,
// a form to borrow, and each outstanding loan with what is owed, what comes
// out at midnight, and a way to pay it down early. Built once and patched:
// the once-a-second poll must never swap a button out from under a press.

import type { LoansView } from '../../worker/finance';
import { button, el, money, pct } from '../dom';

export class LoansPanel {
  readonly root = el('div', 'loans-panel');
  onTake: (amount: number, days: number) => Promise<unknown> = () => Promise.resolve();
  onRepay: (loanId: string, amount: number) => Promise<unknown> = () => Promise.resolve();
  private summary = el('p', 'small');
  private amount = el('input', 'loan-amount');
  private term = el('select', 'loan-term');
  private preview = el('p', 'small dim');
  private note = el('p', 'small loan-note');
  private list = el('table', 'fin loan-list');
  private listKey = '';
  private view: LoansView | null = null;

  constructor() {
    this.amount.type = 'number';
    this.amount.min = '0';
    this.amount.addEventListener('input', () => this.renderPreview());
    this.term.addEventListener('change', () => this.renderPreview());
    const borrow = button('Borrow', () => void this.take(), 'primary small');
    // Its own horizontal scroller, like the P&L tables: never wider than the panel.
    const wrap = el('div', 'scroll-x');
    wrap.append(this.list);
    const form = el('div', 'loan-form');
    form.append(
      el('span', 'small', 'Borrow'),
      this.amount,
      el('span', 'small', 'over'),
      this.term,
      borrow,
    );
    this.root.append(el('h3', '', 'Bank loans'), this.summary, form, this.preview, this.note, wrap);
  }

  update(v: LoansView): void {
    const first = this.view === null;
    this.view = v;
    this.summary.innerHTML = `The bank lends up to <b>${money(v.limit)}</b>; you owe <b>${money(v.outstanding)}</b>${
      v.dueTonight > 0 ? `, with <b>${money(v.dueTonight, true)}</b> due at midnight` : ''
    }. Installments come out of cash each midnight, interest first. A loan costs ${pct(
      v.offers[0]?.rate ?? 0,
      1,
    )}–${pct(v.offers.at(-1)?.rate ?? 0, 1)} a day; the overdraft ${pct(v.overdraftRate, 0)}.`;
    this.amount.step = String(v.step);
    this.amount.max = String(v.available);
    if (first) {
      for (const o of v.offers) {
        const opt = el('option', '', `${o.days} days at ${pct(o.rate, 1)}/day`);
        opt.value = String(o.days);
        this.term.append(opt);
      }
      this.term.value = String(v.offers[1]?.days ?? v.offers[0]?.days ?? 14);
      this.amount.value = String(
        Math.min(v.available, 1000 * Math.floor(v.available / 2000)) || v.available,
      );
    }
    if (document.activeElement !== this.amount && Number(this.amount.value) > v.available)
      this.amount.value = String(v.available);
    this.renderPreview();
    this.renderList(v);
  }

  /** What the chosen amount and term would cost, from the offer's per-dollar
   *  installment (an amortised payment is linear in what is borrowed). */
  private renderPreview(): void {
    const v = this.view;
    if (!v) return;
    const offer = v.offers.find((o) => o.days === Number(this.term.value));
    const amount = Number(this.amount.value);
    if (v.available <= 0) {
      this.preview.textContent = 'At the limit: repay some to borrow more.';
      return;
    }
    if (!offer || !(amount > 0)) {
      this.preview.textContent = '';
      return;
    }
    const sample = v.available || v.step;
    const each = (offer.installment / sample) * amount;
    this.preview.textContent = `${money(each, true)} a day for ${offer.days} days: ${money(
      each * offer.days - amount,
    )} in interest on ${money(amount)}.`;
  }

  private async take(): Promise<void> {
    const amount = Number(this.amount.value);
    const days = Number(this.term.value);
    try {
      await this.onTake(amount, days);
      this.note.textContent = `Borrowed ${money(Math.floor(amount / (this.view?.step ?? 1)) * (this.view?.step ?? 1))} over ${days} days.`;
      this.note.className = 'small loan-note good';
    } catch (err) {
      this.note.textContent = (err as Error).message;
      this.note.className = 'small loan-note bad';
    }
  }

  private renderList(v: LoansView): void {
    const key = v.loans.map((l) => l.id).join(',');
    if (key !== this.listKey) {
      this.listKey = key;
      this.list.replaceChildren();
      if (v.loans.length) {
        this.list.innerHTML =
          '<tr><th>Loan</th><th>Owed</th><th>Daily</th><th>Left</th><th></th></tr>';
        for (const l of v.loans) {
          const tr = el('tr');
          tr.dataset.id = l.id;
          tr.title = `Borrowed on day ${l.takenDay} over ${l.termDays} days`;
          const pay = el('input', 'narrow');
          pay.type = 'number';
          pay.min = '0';
          const cell = el('td', 'loan-repay');
          cell.append(
            pay,
            button(
              'Repay',
              () =>
                void this.onRepay(l.id, Number(pay.value))
                  .then(() => {
                    this.note.textContent = 'Repaid.';
                    this.note.className = 'small loan-note good';
                  })
                  .catch((err: Error) => {
                    this.note.textContent = err.message;
                    this.note.className = 'small loan-note bad';
                  }),
              'small',
            ),
          );
          tr.append(
            el('td', '', `${money(l.principal)} <span class="dim">${pct(l.rate, 1)}</span>`),
            el('td', 'owed'),
            el('td', 'daily'),
            el('td', 'left'),
            cell,
          );
          this.list.append(tr);
        }
      }
    }
    for (const l of v.loans) {
      const tr = this.list.querySelector<HTMLElement>(`tr[data-id="${l.id}"]`);
      if (!tr) continue;
      tr.querySelector('.owed')!.textContent = money(l.balance, true);
      tr.querySelector('.daily')!.textContent = money(l.installment, true);
      tr.querySelector('.left')!.textContent = `${l.daysLeft}d`;
      const pay = tr.querySelector('input')!;
      if (document.activeElement !== pay) pay.value = String(Math.ceil(l.balance));
    }
  }
}
