// B11: what skill, morale, fatigue and shifts do. Pure functions over the
// numbers in STAFF_DEPTH / ADVANTAGE_BALANCE, so the curves are testable on
// their own and the world only wires them in.

import { ADVANTAGE_BALANCE, STAFF_DEPTH } from '../../../data/balance';

export type Shift = 'day' | 'swing' | 'graveyard';
export const SHIFTS: readonly Shift[] = ['day', 'swing', 'graveyard'];

const lerp = (r: { at0: number; at100: number }, skill: number) =>
  r.at0 + ((r.at100 - r.at0) * Math.min(100, Math.max(0, skill))) / 100;

/** Does this shift work this game hour (0–23)? */
export function onShiftAt(shift: Shift, hour: number): boolean {
  const [from, to] = STAFF_DEPTH.shifts[shift];
  const h = ((hour % 24) + 24) % 24;
  return h >= from && h < to;
}

/** Rounds-per-hour multiplier a dealer brings, before morale. */
export function dealerSkillSpeed(skill: number): number {
  return lerp(STAFF_DEPTH.dealerSpeed, skill);
}

/** Per-round chance a dealer pays a losing bet. */
export function misPayChance(skill: number): number {
  return lerp(STAFF_DEPTH.misPay, skill);
}

/** Repair-time multiplier for a mechanic, before morale. */
export function repairTimeFactor(skill: number): number {
  return lerp(STAFF_DEPTH.repairTime, skill);
}

/** Tiles around a cleaned mess a janitor also sweeps. */
export function cleanRadius(skill: number): number {
  return Math.floor(lerp(STAFF_DEPTH.cleanRadius, skill));
}

/** Work-speed multiplier from morale: ×0.8 below the low-morale line. */
export function moraleSpeed(morale: number): number {
  return morale < STAFF_DEPTH.lowMorale ? STAFF_DEPTH.lowMoraleSlowdown : 1;
}

/** Where morale is heading this hour. */
export function moraleTarget(wageRatio: number, fatigue: number, understaffed: boolean): number {
  const d = STAFF_DEPTH;
  return Math.min(
    100,
    Math.max(
      0,
      d.moraleBase +
        d.moraleWageSlope * (wageRatio - 1) -
        (understaffed ? d.moraleUnderstaffed : 0) -
        Math.max(0, fatigue - d.fatigueComfort),
    ),
  );
}

/** One on-shift hour: fatigue builds, morale drifts toward its target. */
export function workHour(
  m: { morale: number; fatigue: number },
  wageRatio: number,
  understaffed: boolean,
): void {
  const d = STAFF_DEPTH;
  m.fatigue = Math.min(
    100,
    m.fatigue + d.fatiguePerHour + (understaffed ? d.fatigueUnderstaffed : 0),
  );
  m.morale += d.moraleDrift * (moraleTarget(wageRatio, m.fatigue, understaffed) - m.morale);
}

/** Chance a member quits at midnight. */
export function quitChance(morale: number): number {
  const d = STAFF_DEPTH;
  if (morale >= d.lowMorale) return 0;
  return (d.quitAtZero * (d.lowMorale - Math.max(0, morale))) / d.lowMorale;
}

/** Chance per game hour a pit boss of this skill spots an advantage player
 *  in range. */
export function detectChance(skill: number): number {
  return lerp(ADVANTAGE_BALANCE.detect, skill);
}
