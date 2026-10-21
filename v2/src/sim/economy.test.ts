import { describe, expect, it } from 'vitest';
import { Ledger, type LedgerJSON } from './economy';

describe('Ledger — extended DailyRecord', () => {
  it('tracks paidOut/takenIn/guestCount/jackpotCount/rageQuitCount and rolls them into closeDay', () => {
    const ledger = new Ledger();
    ledger.recordPlay(10, 0);
    ledger.recordPlay(10, 150);
    ledger.recordJackpot();
    ledger.recordRageQuit();
    ledger.recordGuestSession({ name: 'Rita B.', netResult: 140, favoriteGame: 'slot-machine' });
    ledger.recordGuestSession({ name: 'Marcus C.', netResult: -80, favoriteGame: 'blackjack-table' });
    const record = ledger.closeDay(1);
    expect(record.takenIn).toBe(20);
    expect(record.paidOut).toBe(150);
    expect(record.guestCount).toBe(2);
    expect(record.jackpotCount).toBe(1);
    expect(record.rageQuitCount).toBe(1);
  });

  it('ranks top-5 winners (highest net) and top-5 losers (lowest net) by favoriteGame', () => {
    const ledger = new Ledger();
    const sessions = [
      { name: 'A', netResult: 500, favoriteGame: 'slot-machine' },
      { name: 'B', netResult: -300, favoriteGame: 'craps-table' },
      { name: 'C', netResult: 10, favoriteGame: 'slot-machine' },
      { name: 'D', netResult: -900, favoriteGame: 'blackjack-table' },
      { name: 'E', netResult: 200, favoriteGame: 'slot-machine' },
      { name: 'F', netResult: -10, favoriteGame: 'slot-machine' },
      { name: 'G', netResult: 800, favoriteGame: 'craps-table' },
    ];
    for (const s of sessions) ledger.recordGuestSession(s);
    const record = ledger.closeDay(1);
    expect(record.winners.map((w) => w.name)).toEqual(['G', 'A', 'E', 'C', 'F']);
    expect(record.losers.map((l) => l.name)).toEqual(['D', 'B']);
    expect(record.winners[0]).toEqual({ name: 'G', net: 800, favoriteGame: 'craps-table' });
  });

  it('resets counters/sessions after closeDay so the next day starts clean', () => {
    const ledger = new Ledger();
    ledger.recordPlay(10, 0);
    ledger.recordJackpot();
    ledger.recordGuestSession({ name: 'A', netResult: 5, favoriteGame: 'slot-machine' });
    ledger.closeDay(1);
    const record2 = ledger.closeDay(2);
    expect(record2.takenIn).toBe(0);
    expect(record2.paidOut).toBe(0);
    expect(record2.guestCount).toBe(0);
    expect(record2.jackpotCount).toBe(0);
    expect(record2.winners).toEqual([]);
    expect(record2.losers).toEqual([]);
  });

  it('a guest session with no favoriteGame records "—" so the report never shows undefined', () => {
    const ledger = new Ledger();
    ledger.recordGuestSession({ name: 'A', netResult: 5, favoriteGame: null });
    const record = ledger.closeDay(1);
    expect(record.winners[0]!.favoriteGame).toBe('—');
  });

  it('fromJSON defaults every new field when loading a pre-P11 save', () => {
    const ledger = new Ledger();
    ledger.recordPlay(10, 50);
    ledger.recordGuestSession({ name: 'A', netResult: 5, favoriteGame: 'slot-machine' });
    ledger.closeDay(1);
    const json = ledger.toJSON() as unknown as Record<string, unknown>;
    // Simulate a save written before P11: strip every field this phase adds.
    delete json['dayPaidOut'];
    delete json['dayTakenIn'];
    delete json['dayGuestCount'];
    delete json['dayJackpotCount'];
    delete json['dayRageQuitCount'];
    delete json['daySessions'];
    for (const r of json['history'] as Record<string, unknown>[]) {
      delete r['winners'];
      delete r['losers'];
      delete r['paidOut'];
      delete r['takenIn'];
      delete r['guestCount'];
      delete r['jackpotCount'];
      delete r['rageQuitCount'];
    }
    const restored = Ledger.fromJSON(json as unknown as LedgerJSON);
    expect(restored.history[0]!.winners).toEqual([]);
    expect(restored.history[0]!.losers).toEqual([]);
    expect(restored.history[0]!.paidOut).toBe(0);
    expect(restored.history[0]!.takenIn).toBe(0);
    expect(restored.history[0]!.guestCount).toBe(0);
    expect(restored.history[0]!.jackpotCount).toBe(0);
    expect(restored.history[0]!.rageQuitCount).toBe(0);
    // In-progress-day counters also default cleanly.
    ledger.recordPlay(1, 0); // restored ledger still usable afterward
    expect(() => restored.closeDay(2)).not.toThrow();
  });
});
