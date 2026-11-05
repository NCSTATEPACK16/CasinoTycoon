// B10: the marketing book on its own: when an event runs, what it lifts,
// cooldowns, and what it counts.

import { describe, expect, it } from 'vitest';
import { TICKS_PER_HOUR } from '../config';
import { getEventDef } from '../data/events';
import { hourIndex, Marketing, TICKS_PER_DAY, type Clock } from './marketing';

const at = (day: number, hour: number, tickInHour = 0): Clock => ({
  // Day 1 00:00 is tick 0 here; the book only ever compares ticks.
  tick: hourIndex(day, hour) * TICKS_PER_HOUR + tickInHour,
  day,
  hour,
  tickInHour,
});

describe('windows', () => {
  it('an ad runs from booking for its days', () => {
    const m = new Marketing();
    const now = at(2, 10, 5);
    const w = m.window(getEventDef('radio')!, now);
    expect(w).toEqual({ start: now.tick, end: now.tick + 3 * TICKS_PER_DAY });
  });

  it('an evening event waits for its hour, or starts now inside its window', () => {
    const m = new Marketing();
    const t = getEventDef('slot-tournament')!; // 19:00 for 4 hours
    expect(m.window(t, at(1, 15, 3))).toEqual({
      start: at(1, 19).tick,
      end: at(1, 23).tick,
    });
    expect(m.window(t, at(1, 21, 7))).toEqual({ start: at(1, 21, 7).tick, end: at(1, 23).tick });
    expect(m.window(t, at(1, 23, 1))).toEqual({ start: at(2, 19).tick, end: at(2, 23).tick });
    // A junket flies in at its hour: booked at 2 a.m., it comes that evening.
    expect(m.window(getEventDef('junket')!, at(2, 2))).toEqual({
      start: at(2, 20).tick,
      end: at(3, 4).tick,
    });
  });
});

describe('lift and cooldown', () => {
  it('lifts only its archetypes, only while it runs', () => {
    const m = new Marketing();
    const now = at(1, 12);
    const run = m.book(getEventDef('billboards')!, now);
    expect(m.lift('tourist', now.tick)).toBe(2.5);
    expect(m.lift('regular', now.tick)).toBe(1);
    expect(m.liftsArrivals(run.endTick - 1)).toBe(true);
    expect(m.liftsArrivals(run.endTick)).toBe(false);
    expect(m.lift('tourist', run.endTick)).toBe(1);
  });

  it('two lifts on one archetype multiply', () => {
    const m = new Marketing();
    m.book(getEventDef('radio')!, at(1, 19));
    m.book(getEventDef('slot-tournament')!, at(1, 19));
    expect(m.lift('regular', at(1, 20).tick)).toBeCloseTo(2.4);
    expect(m.lift('tourist', at(1, 20).tick)).toBe(2);
  });

  it('can run again only after its cooldown', () => {
    const m = new Marketing();
    const def = getEventDef('mailers')!;
    const run = m.book(def, at(1, 12));
    expect(m.current('mailers', run.endTick - 1)).toBe(run);
    expect(m.readyAt(def)).toBe(run.endTick + 4 * TICKS_PER_DAY);
  });

  it('a junket is due once, at its start', () => {
    const m = new Marketing();
    const run = m.book(getEventDef('junket')!, at(1, 12));
    expect(m.dueGroups(run.startTick - 1)).toEqual([]);
    expect(m.dueGroups(run.startTick)).toEqual([run]);
    run.groupDone = true;
    expect(m.dueGroups(run.startTick + 5)).toEqual([]);
  });
});

describe('counting a run', () => {
  it('counts arrivals against the runs open at that tick', () => {
    const m = new Marketing();
    const radio = m.book(getEventDef('radio')!, at(1, 12));
    const tourney = m.book(getEventDef('slot-tournament')!, at(1, 12));
    m.countArrival(at(1, 13).tick);
    m.countArrival(at(1, 20).tick);
    expect(radio.arrivals).toBe(2);
    expect(tourney.arrivals).toBe(1);
  });

  it('keeps its runs through a save', () => {
    const m = new Marketing();
    m.book(getEventDef('radio')!, at(2, 1)).arrivals = 7;
    const back = Marketing.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
    expect(back.toJSON()).toEqual(m.toJSON());
    expect(back.current('radio', at(2, 5).tick)?.arrivals).toBe(7);
  });
});
