import { HOURS_PER_DAY, START_HOUR, TICKS_PER_HOUR } from '../config';

// Pure tick→clock conversion. The world reads the boundary flags and does the
// bookkeeping (wages, upkeep, rollup) and event emission itself.

export interface TimeSystemJSON {
  tickInHour: number;
  hour: number;
  day: number;
}

export interface TimeTickResult {
  hourPassed: boolean;
  midnight: boolean;
}

export class TimeSystem {
  tickInHour = 0;
  hour = START_HOUR;
  day = 1;

  tick(): TimeTickResult {
    this.tickInHour++;
    if (this.tickInHour < TICKS_PER_HOUR) return { hourPassed: false, midnight: false };
    this.tickInHour = 0;
    this.hour++;
    if (this.hour < HOURS_PER_DAY) return { hourPassed: true, midnight: false };
    this.hour = 0;
    this.day++;
    return { hourPassed: true, midnight: true };
  }

  toJSON(): TimeSystemJSON {
    return { tickInHour: this.tickInHour, hour: this.hour, day: this.day };
  }

  static fromJSON(data: TimeSystemJSON): TimeSystem {
    const time = new TimeSystem();
    time.tickInHour = data.tickInHour;
    time.hour = data.hour;
    time.day = data.day;
    return time;
  }
}
