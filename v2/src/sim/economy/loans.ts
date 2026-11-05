// B4 — structured loans: take, repay, and the daily installment. Pure data;
// the world moves the cash and books the interest.

import { LOANS } from '../../data/balance';

export interface Loan {
  id: string;
  /** What was borrowed. */
  principal: number;
  /** What is still owed. */
  balance: number;
  /** Interest per day on the balance. */
  rate: number;
  termDays: number;
  /** Installments still to pay. */
  daysLeft: number;
  /** Today's payment: interest on the balance plus a slice of principal. */
  installment: number;
  /** The day it was taken. */
  takenDay: number;
}

export interface LoanBookJSON {
  loans: Loan[];
  nextId: number;
}

/** What one midnight's installments came to, and which loans they cleared. */
export interface LoanSettlement {
  interest: number;
  principal: number;
  paidOff: string[];
}

/** The level payment that clears `principal` in `days` at `rate` a day. */
export function installmentFor(principal: number, rate: number, days: number): number {
  if (days <= 0) return principal;
  if (rate === 0) return principal / days;
  return (principal * rate) / (1 - Math.pow(1 + rate, -days));
}

export class LoanBook {
  loans: Loan[] = [];
  private nextId = 1;

  get outstanding(): number {
    return this.loans.reduce((a, l) => a + l.balance, 0);
  }

  /** Borrow `amount` over a term on offer, if it fits under `limit`. */
  take(amount: number, days: number, day: number, limit: number): Loan | null {
    const term = LOANS.terms.find((t) => t.days === days);
    if (!term || !(amount > 0) || this.outstanding + amount > limit) return null;
    const loan: Loan = {
      id: `loan-${this.nextId++}`,
      principal: amount,
      balance: amount,
      rate: term.rate,
      termDays: days,
      daysLeft: days,
      installment: installmentFor(amount, term.rate, days),
      takenDay: day,
    };
    this.loans.push(loan);
    return loan;
  }

  /** Midnight: every loan pays its installment, interest first. */
  settleDay(): LoanSettlement {
    const out: LoanSettlement = { interest: 0, principal: 0, paidOff: [] };
    for (const l of this.loans) {
      const interest = l.balance * l.rate;
      const principal = l.daysLeft <= 1 ? l.balance : Math.min(l.balance, l.installment - interest);
      l.balance -= principal;
      l.daysLeft--;
      out.interest += interest;
      out.principal += principal;
      if (l.balance <= 1e-6 || l.daysLeft <= 0) out.paidOff.push(l.id);
    }
    this.loans = this.loans.filter((l) => !out.paidOff.includes(l.id));
    return out;
  }

  /** Pay down a loan early, no penalty; the rest is re-spread over the days
   *  left. Returns what was actually paid (never more than is owed). */
  repay(loanId: string, amount: number): number {
    const l = this.loans.find((x) => x.id === loanId);
    if (!l || !(amount > 0)) return 0;
    const paid = Math.min(amount, l.balance);
    l.balance -= paid;
    if (l.balance <= 1e-6) this.loans = this.loans.filter((x) => x !== l);
    else l.installment = installmentFor(l.balance, l.rate, l.daysLeft);
    return paid;
  }

  toJSON(): LoanBookJSON {
    return { loans: this.loans.map((l) => ({ ...l })), nextId: this.nextId };
  }

  static fromJSON(data: LoanBookJSON | undefined): LoanBook {
    const book = new LoanBook();
    if (!data) return book;
    book.loans = (data.loans ?? []).map((l) => ({ ...l }));
    book.nextId = data.nextId ?? book.loans.length + 1;
    return book;
  }
}
