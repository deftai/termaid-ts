// Ported from src/termaid/model/gantt.py.

import {
  US_PER_DAY,
  US_PER_HOUR,
  US_PER_MINUTE,
  US_PER_MS,
  US_PER_SECOND,
  US_PER_WEEK,
  addTimedeltaFloat,
  daysInMonth,
  fromDateTime,
  toDateTimeParts,
  type Instant,
} from "../pydate.ts";

export const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";

const FIXED_UNITS: Readonly<Record<string, bigint>> = {
  millisecond: US_PER_MS,
  second: US_PER_SECOND,
  minute: US_PER_MINUTE,
  hour: US_PER_HOUR,
  day: US_PER_DAY,
  week: US_PER_WEEK,
};

/**
 * Move `dt` by `amount` units the way dayjs `add` does.
 * Months and years step the calendar (truncating a fractional amount and clamping the day to the target month's
 * length), days and weeks round to whole days, and smaller units are exact.
 */
export function shift(dt: Instant, amount: number, unit: string): Instant {
  if (unit === "month" || unit === "year") {
    const p = toDateTimeParts(dt);
    const months = Math.trunc(amount) * (unit === "year" ? 12 : 1);
    const totalMonths = p.year * 12 + (p.month - 1) + months;
    const year = Math.floor(totalMonths / 12);
    const month0 = ((totalMonths % 12) + 12) % 12;
    const day = Math.min(p.day, daysInMonth(year, month0 + 1));
    const shifted = fromDateTime(year, month0 + 1, day, p.hour, p.minute, p.second, p.microsecond);
    if (shifted === null) throw new RangeError("date value out of range");
    return shifted;
  }
  if (unit === "day" || unit === "week") {
    const days = amount * (unit === "week" ? 7 : 1);
    return dt + BigInt(Math.floor(days + 0.5)) * US_PER_DAY;
  }
  const unitUs = FIXED_UNITS[unit];
  if (unitUs === undefined) throw new Error(`Unknown gantt unit: ${unit}`);
  return addTimedeltaFloat(dt, unitUs, amount);
}

export class Duration {
  public readonly amount: number;
  public readonly unit: string;

  constructor(amount: number, unit: string) {
    this.amount = amount;
    this.unit = unit;
  }

  endFrom(start: Instant): Instant {
    return shift(start, this.amount, this.unit);
  }
}

export interface TickInterval {
  readonly count: number;
  readonly unit: string;
}

export interface GanttTask {
  id: string;
  title: string;
  start: Instant | null;
  end: Instant | null;
  duration: Duration | null;
  isDone: boolean;
  isActive: boolean;
  isCrit: boolean;
  isMilestone: boolean;
  after: string;
}

export function startTaskAt(task: GanttTask, start: Instant): void {
  task.start = start;
  if (task.end === null && task.duration !== null) {
    task.end = task.duration.endFrom(start);
  }
}

export interface GanttSection {
  title: string;
  tasks: GanttTask[];
}

export interface Gantt {
  title: string;
  dateFormat: string;
  axisFormat: string | null;
  tickInterval: TickInterval | null;
  sections: GanttSection[];
  verticalMarkers: Instant[];
  todayMarker: boolean;
  warnings: string[];
}

export function ganttTimeRange(gantt: Gantt): readonly [Instant, Instant] | null {
  let minStart: Instant | null = null;
  let maxEnd: Instant | null = null;
  for (const section of gantt.sections) {
    for (const task of section.tasks) {
      if (task.start !== null && (minStart === null || task.start < minStart)) {
        minStart = task.start;
      }
      if (task.end !== null && (maxEnd === null || task.end > maxEnd)) {
        maxEnd = task.end;
      }
    }
  }
  if (minStart === null || maxEnd === null) return null;
  return [minStart, maxEnd];
}

export const makeGantt = (): Gantt => ({
  title: "",
  dateFormat: DEFAULT_DATE_FORMAT,
  axisFormat: null,
  tickInterval: null,
  sections: [],
  verticalMarkers: [],
  todayMarker: true,
  warnings: [],
});

export const makeGanttSection = (title: string): GanttSection => ({ title, tasks: [] });

export const makeGanttTask = (title: string): GanttTask => ({
  id: "",
  title,
  start: null,
  end: null,
  duration: null,
  isDone: false,
  isActive: false,
  isCrit: false,
  isMilestone: false,
  after: "",
});
