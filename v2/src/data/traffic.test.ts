import { describe, expect, it } from 'vitest';
import { GUEST_BALANCE } from './balance';
import {
  CAMPAIGN_TRAFFIC,
  dayFactor,
  guestCap,
  hourFactor,
  OPEN_TRAFFIC,
  TRAFFIC_BALANCE,
  weekdayName,
} from './traffic';

describe('hour-of-day curve', () => {
  const samples: number[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 50; m++) samples.push(hourFactor(h, m / 50));

  it('averages exactly 1 over a day, so it moves arrivals around the clock without adding any', () => {
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(1, 6);
  });

  it('peaks in the evening, bottoms out around 4 a.m., and has a quiet morning', () => {
    const at = (h: number) => hourFactor(h, 0);
    const peakHour = [...Array(24).keys()].reduce((a, b) => (at(b) > at(a) ? b : a));
    const lullHour = [...Array(24).keys()].reduce((a, b) => (at(b) < at(a) ? b : a));
    expect(peakHour).toBeGreaterThanOrEqual(19);
    expect(peakHour).toBeLessThanOrEqual(22);
    expect(lullHour).toBe(4);
    expect(at(9)).toBeLessThan(0.75);
    expect(at(21)).toBeGreaterThan(1.6);
    expect(at(4)).toBeLessThan(0.25);
  });

  it('is continuous: it eases from one hour into the next', () => {
    for (let h = 0; h < 24; h++) {
      const end = hourFactor(h, 0.999);
      const next = hourFactor((h + 1) % 24, 0);
      expect(Math.abs(end - next)).toBeLessThan(0.01);
    }
  });
});

describe('weekend lift', () => {
  it('names the days from a Monday on day 1, and lifts Friday to Sunday', () => {
    expect([1, 2, 5, 6, 7, 8].map(weekdayName)).toEqual(['Mon', 'Tue', 'Fri', 'Sat', 'Sun', 'Mon']);
    for (const weekday of [1, 2, 3, 4]) expect(dayFactor(weekday)).toBe(1);
    expect(dayFactor(5)).toBeGreaterThan(1);
    expect(dayFactor(6)).toBeGreaterThan(dayFactor(5));
    expect(dayFactor(7)).toBeGreaterThan(1);
    expect(dayFactor(13)).toBe(dayFactor(6)); // the next Saturday
  });
});

describe('guest cap', () => {
  it('grows with what the floor can hold and with the rating', () => {
    expect(guestCap(100, 60)).toBeGreaterThan(guestCap(50, 60));
    expect(guestCap(100, 80)).toBeGreaterThan(guestCap(100, 40));
  });

  it('never drops below the old fixed cap or rises past 500', () => {
    expect(guestCap(0, 0)).toBe(GUEST_BALANCE.maxGuests);
    expect(guestCap(5, 100)).toBe(GUEST_BALANCE.maxGuests);
    expect(guestCap(10_000, 100)).toBe(TRAFFIC_BALANCE.maxCap);
    expect(TRAFFIC_BALANCE.maxCap).toBe(500);
  });

  it('fits a floor with room for about 230 to about 300 guests at a good rating', () => {
    const cap = guestCap(230, 75);
    expect(cap).toBeGreaterThan(260);
    expect(cap).toBeLessThan(340);
  });
});

describe('profiles', () => {
  it('keeps the tuned campaigns flat at the old cap; open play gets the rhythm and the scaling cap', () => {
    expect(CAMPAIGN_TRAFFIC).toEqual({ curve: 'flat', cap: GUEST_BALANCE.maxGuests });
    expect(OPEN_TRAFFIC).toEqual({ curve: 'daily', cap: 'scaled' });
  });
});
