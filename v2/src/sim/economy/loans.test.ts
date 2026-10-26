import { describe, expect, it } from 'vitest';
import { LOANS } from '../../data/balance';
import { installmentFor, LoanBook } from './loans';

describe('installmentFor', () => {
  it('is the standard amortising payment', () => {
    // $10,000 over 10 days at 2% a day: P·r / (1 − (1+r)^−n) = 1113.27
    expect(installmentFor(10_000, 0.02, 10)).toBeCloseTo(1113.27, 2);
  });

  it('is principal / n at a zero rate', () => {
    expect(installmentFor(7_000, 0, 7)).toBe(1000);
  });
});

describe('LoanBook', () => {
  it('takes a loan at the term rate, within the limit', () => {
    const book = new LoanBook();
    const loan = book.take(5000, 7, 1, 8000)!;
    expect(loan).toMatchObject({ principal: 5000, balance: 5000, termDays: 7, daysLeft: 7 });
    expect(loan.rate).toBe(LOANS.terms.find((t) => t.days === 7)!.rate);
    expect(book.outstanding).toBe(5000);
    expect(book.take(4000, 7, 1, 8000)).toBeNull(); // 9000 > 8000
    expect(book.take(3000, 7, 1, 8000)).not.toBeNull();
    expect(book.take(100, 5, 1, 8000)).toBeNull(); // no such term
    expect(book.take(0, 7, 1, 8000)).toBeNull();
  });

  it('pays itself off in exactly its term, interest first, total = n × installment', () => {
    const book = new LoanBook();
    const loan = book.take(10_000, 14, 1, 50_000)!;
    let interest = 0;
    let principal = 0;
    for (let day = 1; day <= 14; day++) {
      const s = book.settleDay();
      interest += s.interest;
      principal += s.principal;
      expect(s.interest + s.principal).toBeCloseTo(loan.installment, 4);
    }
    expect(book.loans).toHaveLength(0);
    expect(principal).toBeCloseTo(10_000, 6);
    expect(interest + principal).toBeCloseTo(loan.installment * 14, 4);
    expect(book.settleDay()).toEqual({ interest: 0, principal: 0, paidOff: [] });
  });

  it('charges the first day interest on the full balance', () => {
    const book = new LoanBook();
    book.take(10_000, 7, 1, 50_000);
    const rate = LOANS.terms.find((t) => t.days === 7)!.rate;
    expect(book.settleDay().interest).toBeCloseTo(10_000 * rate, 6);
  });

  it('repays early without penalty and re-spreads what is left over the remaining days', () => {
    const book = new LoanBook();
    const loan = book.take(10_000, 7, 1, 50_000)!;
    book.settleDay();
    const before = loan.balance;
    expect(book.repay(loan.id, 3000)).toBe(3000);
    expect(loan.balance).toBeCloseTo(before - 3000, 6);
    expect(loan.installment).toBeCloseTo(installmentFor(loan.balance, loan.rate, loan.daysLeft), 6);
    // Paying more than is owed pays it off and returns what was owed.
    expect(book.repay(loan.id, 1e9)).toBeCloseTo(before - 3000, 6);
    expect(book.loans).toHaveLength(0);
    expect(book.repay('loan-404', 10)).toBe(0);
  });

  it('round-trips through JSON, and an old save has no loans', () => {
    const book = new LoanBook();
    book.take(4000, 14, 3, 50_000);
    book.settleDay();
    const back = LoanBook.fromJSON(book.toJSON());
    expect(back.loans).toEqual(book.loans);
    expect(back.take(100, 7, 4, 50_000)!.id).not.toBe(book.loans[0]!.id);
    expect(LoanBook.fromJSON(undefined).loans).toEqual([]);
  });
});
