// B3: when guests come, and how many the floor can hold.
//
// The tuned campaigns keep the traffic they were balanced on: a flat arrival
// rate and a fixed cap of GUEST_BALANCE.maxGuests. Open play (Sandbox, and any
// scenario that asks for it) follows the clock instead: a quiet morning, an
// evening peak, a 4 a.m. lull and a weekend lift, with a cap that grows with
// the seats and services on the floor and with the rating, up to 500.

import { GUEST_BALANCE } from './balance';

/** How a scenario's guests arrive. */
export interface TrafficProfile {
  /** 'flat': the same chance every tick. 'daily': shaped by hour and weekday. */
  curve: 'flat' | 'daily';
  /** A fixed guest cap, or one that scales with the floor and the rating. */
  cap: number | 'scaled';
}

/** What the three original campaigns were tuned on. A scenario with no
 *  `traffic` of its own gets this, so their goals stay valid. */
export const CAMPAIGN_TRAFFIC: TrafficProfile = { curve: 'flat', cap: GUEST_BALANCE.maxGuests };

/** Sandbox and new scenarios: the daily rhythm and a cap that grows. */
export const OPEN_TRAFFIC: TrafficProfile = { curve: 'daily', cap: 'scaled' };

/** Relative arrivals at the top of each hour, 0–23, before normalising to a
 *  mean of 1. Between hours the curve eases linearly. [design guess] */
const HOURLY = [
  1.35, 1.05, 0.7, 0.35, 0.12, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.9, 0.95, 1.0, 1.1,
  1.25, 1.45, 1.7, 1.9, 2.0, 1.9, 1.65,
];
const HOURLY_MEAN = HOURLY.reduce((a, b) => a + b, 0) / HOURLY.length;

export const TRAFFIC_BALANCE = {
  /** Arrivals by weekday, Monday first. Day 1 is a Monday. */
  weekday: [1, 1, 1, 1, 1.15, 1.3, 1.15],
  /** A restroom, food stall, bar or cage counts as this many seats of room. */
  serviceSeats: 4,
  /** Guests the floor holds per seat at a middling rating: some play, the
   *  rest walk, queue, eat and watch. Much past 1 and the unseated crowd
   *  gridlocks the aisles (measured at 1.6: 230 of 340 guests stuck walking). */
  guestsPerSeat: 1.1,
  /** The cap's rating factor runs from ratingFloor at ★0 to
   *  ratingFloor + ratingSpan at ★100. */
  ratingFloor: 0.6,
  ratingSpan: 0.8,
  /** Under daily traffic a visit is planned to last this many in-game hours
   *  (uniform) from arrival; then the guest heads home. Walking is real time
   *  on a compressed clock (about 10 cells an hour), so a big floor adds
   *  hours each way and the population lags the arrival curve by a few hours.
   *  Leaving early (broke, unhappy, stop-loss) still applies. */
  stayHours: { min: 4, max: 8 },
  minCap: GUEST_BALANCE.maxGuests,
  maxCap: 500,
  /** Open play's arrival rate is the campaign rate times cap / minCap times
   *  this, so a floor twice the size draws twice the people. Measured on a
   *  ~210-seat Sandbox floor at ★87 (cap 299), seeds 5/9/13: full by 22:00
   *  every day, down to 90–150 by late morning. 0.35–0.5 never filled it;
   *  0.7 sat at the cap from 20:00 to 04:00. */
  fill: 0.6,
} as const;

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function weekdayIndex(day: number): number {
  return (((day - 1) % 7) + 7) % 7;
}

export function weekdayName(day: number): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[weekdayIndex(day)]!;
}

/** Arrivals at this point in the day relative to the daily mean (1). */
export function hourFactor(hour: number, fractionOfHour = 0): number {
  const a = HOURLY[hour % 24]!;
  const b = HOURLY[(hour + 1) % 24]!;
  return (a + (b - a) * fractionOfHour) / HOURLY_MEAN;
}

/** The weekend lift for this day (1 on a weekday). */
export function dayFactor(day: number): number {
  return TRAFFIC_BALANCE.weekday[weekdayIndex(day)]!;
}

/** How many guests the floor holds, given its room (seats plus services) and
 *  its rating. */
export function guestCap(capacity: number, rating: number): number {
  const t = TRAFFIC_BALANCE;
  const r = Math.min(100, Math.max(0, rating)) / 100;
  const cap = Math.round(capacity * t.guestsPerSeat * (t.ratingFloor + t.ratingSpan * r));
  return Math.min(t.maxCap, Math.max(t.minCap, cap));
}
