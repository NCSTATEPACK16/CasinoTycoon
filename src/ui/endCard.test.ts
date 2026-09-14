import { describe, expect, it } from 'vitest';
import { endCardCopy } from './endCard';

// P16 — the fail state is the thing the campaign layer is built to deliver, so
// the card that announces it has to say which one fired. Both failures used to
// print "Day N ended without hitting the goal", which is simply untrue of an
// insolvency: the bank took the floor, and the goal had nothing to do with it.
describe('endCardCopy', () => {
  it('names the day and the takings on a win', () => {
    const { heading, message } = endCardCopy({ kind: 'won', day: 7, profit: 1250 });
    expect(heading).toBe('Scenario complete!');
    expect(message).toMatch(/day 7/i);
    expect(message).toContain('$1,250');
  });

  it('blames the clock when time runs out', () => {
    const { message } = endCardCopy({ kind: 'failed', reason: 'timeUp', day: 12 });
    expect(message).toMatch(/day 12/i);
    expect(message).toMatch(/goal/i);
    expect(message).not.toMatch(/bank|debt|insolven/i);
  });

  it('blames the bank on an insolvency, and never claims the goal was missed', () => {
    const { message } = endCardCopy({ kind: 'failed', reason: 'insolvent', day: 4 });
    expect(message).toMatch(/day 4/i);
    expect(message).toMatch(/bank|debt/i);
    // The specific regression: an insolvency is not a missed goal, and saying
    // so misreports the one system the campaign is pitched on.
    expect(message).not.toMatch(/without hitting the goal/i);
  });

  it('gives the two failures different headings', () => {
    const timeUp = endCardCopy({ kind: 'failed', reason: 'timeUp', day: 12 });
    const insolvent = endCardCopy({ kind: 'failed', reason: 'insolvent', day: 4 });
    expect(timeUp.heading).not.toBe(insolvent.heading);
  });

  it("tells the player what continuing changes, on a win", () => {
    const { message } = endCardCopy({ kind: 'won', day: 7, profit: 1250 });
    expect(message).toMatch(/keep playing/i);
    expect(message).toMatch(/no day limit|no time limit/i);
  });
});
