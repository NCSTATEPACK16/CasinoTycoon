import { REPUTATION } from '../data/balance';
import type { GuestArchetype } from './entities/Guest';

export interface ReputationJSON {
  value: number;
  pendingDelta: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A12 — reputation memory. One persistent scalar, no registry.
 *
 * Events accrue into `pendingDelta` through the day; midnight caps that delta,
 * applies it, then drifts toward the mean. The cap and the drift are both
 * load-bearing: without them a bad night is an absorbing state and the player
 * has no way back, which is the documented failure mode for this feature.
 */
export class Reputation {
  value: number = REPUTATION.start;
  /** Today's accrued, uncapped movement. Applied and cleared at midnight. */
  private pendingDelta = 0;

  onRageQuit(): void {
    this.pendingDelta += REPUTATION.deltaPerRageQuit;
  }

  onJackpotPayout(): void {
    this.pendingDelta += REPUTATION.deltaPerJackpotPayout;
  }

  onContentLeaver(): void {
    this.pendingDelta += REPUTATION.deltaPerContentLeaver;
  }

  /** What today's events would move the scalar by, after the cap. Exposed so
   *  the daily report can show the number the player actually earned. */
  get cappedDelta(): number {
    return clamp(this.pendingDelta, -REPUTATION.maxDailyDelta, REPUTATION.maxDailyDelta);
  }

  /**
   * Roll the day over. Returns the applied delta (post-cap, pre-drift) so the
   * report can attribute the movement to the day's play rather than to drift.
   */
  closeDay(): number {
    const applied = this.cappedDelta;
    this.pendingDelta = 0;
    const afterEvents = clamp(this.value + applied, REPUTATION.min, REPUTATION.max);
    // Drift last, so a day that earned nothing still relaxes toward neutral.
    this.value = afterEvents + (REPUTATION.start - afterEvents) * REPUTATION.dailyDriftToMean;
    return applied;
  }

  /**
   * Arrival-mix multiplier for one archetype.
   *
   * At `start` every multiplier is 1. Above it the bias interpolates toward
   * `archetypeBiasAtMax`; below it the *reciprocal* applies, so a ruined
   * reputation inverts the mix (high rollers stop coming, bikers show up)
   * rather than merely flattening it toward the default weights.
   */
  archetypeMultiplier(archetype: GuestArchetype): number {
    const bias = (REPUTATION.archetypeBiasAtMax as Partial<Record<GuestArchetype, number>>)[
      archetype
    ];
    if (bias === undefined || bias <= 0) return 1;
    if (this.value >= REPUTATION.start) {
      const t = (this.value - REPUTATION.start) / (REPUTATION.max - REPUTATION.start);
      return 1 + (bias - 1) * t;
    }
    const t = (REPUTATION.start - this.value) / (REPUTATION.start - REPUTATION.min);
    return 1 + (1 / bias - 1) * t;
  }

  /**
   * Player-facing band for the readout — the scalar alone means nothing.
   *
   * P16 — the middle rung was 'Known', the only label on the ladder with no
   * valence in it. Renowned, Well regarded, Shaky and Notorious all tell a
   * player where they stand; 'Known' reads as mild praise while actually
   * meaning "nobody has an opinion", which is the one thing a five-rung
   * standing readout must not be vague about.
   */
  get label(): string {
    if (this.value >= 80) return 'Renowned';
    if (this.value >= 62) return 'Well regarded';
    if (this.value >= 38) return 'Unremarkable';
    if (this.value >= 20) return 'Shaky';
    return 'Notorious';
  }

  toJSON(): ReputationJSON {
    return { value: this.value, pendingDelta: this.pendingDelta };
  }

  static fromJSON(data: ReputationJSON | null | undefined): Reputation {
    const rep = new Reputation();
    if (!data) return rep;
    rep.value = clamp(data.value ?? REPUTATION.start, REPUTATION.min, REPUTATION.max);
    rep.pendingDelta = data.pendingDelta ?? 0;
    return rep;
  }
}
