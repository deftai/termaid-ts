// Naive datetime helpers matching CPython's `datetime.datetime` and `timedelta` (1 microsecond resolution, no timezone).

const DAYS_PER_ERA = 146097;
const YEARS_PER_ERA = 400;
const EPOCH_SHIFT = 719468;
const MARCH = 3;
const MONTHS_PER_YEAR = 12;

export const US_PER_MS = 1_000n;
export const US_PER_SECOND = 1_000_000n;
export const US_PER_MINUTE = 60_000_000n;
export const US_PER_HOUR = 3_600_000_000n;
export const US_PER_DAY = 86_400_000_000n;
export const US_PER_WEEK = 7n * US_PER_DAY;

/** Microseconds since `1970-01-01T00:00:00` (naive, matching CPython's `datetime(1970, 1, 1)`). */
export type Instant = bigint;

export interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  microsecond: number;
}

export const EPOCH_INSTANT: Instant = 0n;

export function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / YEARS_PER_ERA);
  const yoe = y - era * YEARS_PER_ERA;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * DAYS_PER_ERA + doe - EPOCH_SHIFT;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
  const z = days + EPOCH_SHIFT;
  const era = Math.floor(z / DAYS_PER_ERA);
  const doe = z - era * DAYS_PER_ERA;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * YEARS_PER_ERA;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? MARCH : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** Construct a naive `Instant`, or `null` if any field is out of CPython `datetime` range (`1 <= year <= 9999`). */
export function fromDateTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  microsecond = 0
): Instant | null {
  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > MONTHS_PER_YEAR ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    microsecond < 0 ||
    microsecond > 999_999
  ) {
    return null;
  }
  const days = BigInt(daysFromCivil(year, month, day));
  const subDay =
    BigInt(hour) * US_PER_HOUR +
    BigInt(minute) * US_PER_MINUTE +
    BigInt(second) * US_PER_SECOND +
    BigInt(microsecond);
  return days * US_PER_DAY + subDay;
}

/** Floor division `a // b` for `b > 0n` (matching Python's `divmod` / `//`). */
export function floorDivBigInt(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  return r < 0n ? q - 1n : q;
}

export function floorModBigInt(a: bigint, b: bigint): bigint {
  const r = a % b;
  return r < 0n ? r + b : r;
}

export function toDateTimeParts(instant: Instant): DateTimeParts {
  const days = Number(floorDivBigInt(instant, US_PER_DAY));
  let rem = Number(floorModBigInt(instant, US_PER_DAY));
  const { year, month, day } = civilFromDays(days);
  const hour = Math.floor(rem / 3_600_000_000);
  rem -= hour * 3_600_000_000;
  const minute = Math.floor(rem / 60_000_000);
  rem -= minute * 60_000_000;
  const second = Math.floor(rem / 1_000_000);
  const microsecond = rem - second * 1_000_000;
  return { year, month, day, hour, minute, second, microsecond };
}

export function midnight(instant: Instant): Instant {
  return floorDivBigInt(instant, US_PER_DAY) * US_PER_DAY;
}

/** Python's `dt.weekday()`: Monday is 0 and Sunday is 6. */
export function pyWeekday(instant: Instant): number {
  // 1970-01-01 (day 0) was a Thursday (weekday 3).
  const days = Number(floorDivBigInt(instant, US_PER_DAY));
  return (((days + 3) % 7) + 7) % 7;
}

/** Python's `datetime.now()` on the local wall clock. */
export function nowInstant(): Instant {
  const now = new Date();
  return (
    fromDateTime(
      now.getFullYear(),
      now.getMonth() + 1,
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds() * 1000
    ) ?? EPOCH_INSTANT
  );
}

/** Add `timedelta` of `unitUs * amount` (float) using Python's `timedelta * float` banker's rounding to microseconds. */
export function addTimedeltaFloat(instant: Instant, unitUs: bigint, amount: number): Instant {
  const us = Math.round(Number(unitUs) * amount);
  return instant + BigInt(us);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_FULL = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function dayOfYear(year: number, month: number, day: number): number {
  let doy = day;
  for (let m = 1; m < month; m++) doy += daysInMonth(year, m);
  return doy;
}

function padNum(val: number, width: number, flag: string): string {
  const raw = String(val);
  if (flag === "-") return raw;
  if (flag === "_") return raw.padStart(width, " ");
  return raw.padStart(width, "0");
}

/** Format a single `strftime` directive like `%b`, `%-d`, `%02H`, `%Y`. */
export function formatStrftimeDirective(instant: Instant, token: string): string {
  if (token === "%%") return "%";
  const flag = token.length === 3 ? (token[1] as string) : "";
  const code = token[token.length - 1] as string;
  const p = toDateTimeParts(instant);
  const wd = pyWeekday(instant); // 0=Mon..6=Sun
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;

  switch (code) {
    case "Y":
      return padNum(p.year, 4, flag);
    case "y":
      return padNum(p.year % 100, 2, flag);
    case "m":
      return padNum(p.month, 2, flag);
    case "d":
      return padNum(p.day, 2, flag);
    case "e":
      return padNum(p.day, 2, flag === "" ? "_" : flag);
    case "H":
      return padNum(p.hour, 2, flag);
    case "I":
      return padNum(hour12, 2, flag);
    case "M":
      return padNum(p.minute, 2, flag);
    case "S":
      return padNum(p.second, 2, flag);
    case "f":
      return padNum(p.microsecond, 6, flag);
    case "j":
      return padNum(dayOfYear(p.year, p.month, p.day), 3, flag);
    case "b":
    case "h":
      return MONTH_ABBR[p.month - 1] as string;
    case "B":
      return MONTH_FULL[p.month - 1] as string;
    case "a":
      return WEEKDAY_ABBR[wd] as string;
    case "A":
      return WEEKDAY_FULL[wd] as string;
    case "p":
      return p.hour < 12 ? "AM" : "PM";
    case "w":
      return String((wd + 1) % 7); // 0=Sun..6=Sat
    case "u":
      return String(wd + 1); // 1=Mon..7=Sun
    case "F":
      return `${padNum(p.year, 4, "")}-${padNum(p.month, 2, "")}-${padNum(p.day, 2, "")}`;
    case "T":
      return `${padNum(p.hour, 2, "")}:${padNum(p.minute, 2, "")}:${padNum(p.second, 2, "")}`;
    case "R":
      return `${padNum(p.hour, 2, "")}:${padNum(p.minute, 2, "")}`;
    case "D":
      return `${padNum(p.month, 2, "")}/${padNum(p.day, 2, "")}/${padNum(p.year % 100, 2, "")}`;
    default:
      return token;
  }
}

const CENTURY_PIVOT = 69;

const STRPTIME_DIRECTIVES: Readonly<Record<string, readonly [string, string]>> = {
  Y: ["year", "\\d{4}"],
  y: ["year2", "\\d{1,2}"],
  m: ["month", "\\d{1,2}"],
  d: ["day", "\\d{1,2}"],
  H: ["hour", "\\d{1,2}"],
  I: ["hour12", "\\d{1,2}"],
  M: ["minute", "\\d{1,2}"],
  S: ["second", "\\d{1,2}"],
  f: ["microsecond", "\\d{1,6}"],
  p: ["ampm", "(?:AM|PM|am|pm)"],
};

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * CPython's `datetime.strptime(text, format)` for all directives produced by gantt `dateFormat`.
 * Duplicate directives throw (matching CPython's `re.error` on duplicate named groups).
 */
export function strptime(text: string, format: string): Instant | null {
  const order: string[] = [];
  const seen = new Set<string>();
  let pattern = "^";
  for (let i = 0; i < format.length; i++) {
    const ch = format[i] as string;
    if (ch !== "%") {
      pattern += /\s/.test(ch) ? "\\s+" : ch.replace(ESCAPE_RE, "\\$&");
      continue;
    }
    const directive = format[i + 1];
    if (directive === undefined) return null;
    i++;
    if (directive === "%") {
      pattern += "%";
      continue;
    }
    const known = STRPTIME_DIRECTIVES[directive];
    if (known === undefined) return null;
    if (seen.has(directive)) throw new Error(`redefinition of group name '${directive}'`);
    seen.add(directive);
    const [name, subPattern] = known;
    order.push(name);
    pattern += `(${subPattern})`;
  }

  const match = new RegExp(pattern + "$").exec(text);
  if (match === null) return null;

  let year = 1900;
  let month = 1;
  let day = 1;
  let hour = 0;
  let hour12: number | null = null;
  let ampm: string | null = null;
  let minute = 0;
  let second = 0;
  let microsecond = 0;

  for (let i = 0; i < order.length; i++) {
    const name = order[i] as string;
    const raw = match[i + 1] as string;
    if (name === "ampm") {
      ampm = raw.toUpperCase();
      continue;
    }
    if (name === "microsecond") {
      microsecond = Number.parseInt(raw.padEnd(6, "0"), 10);
      continue;
    }
    const value = Number.parseInt(raw, 10);
    if (name === "year") year = value;
    else if (name === "year2") year = value < CENTURY_PIVOT ? 2000 + value : 1900 + value;
    else if (name === "month") month = value;
    else if (name === "day") day = value;
    else if (name === "hour") hour = value;
    else if (name === "hour12") hour12 = value;
    else if (name === "minute") minute = value;
    else if (name === "second") second = value;
  }

  if (hour12 !== null) {
    if (hour12 < 1 || hour12 > 12) return null;
    if (ampm === "PM") hour = hour12 === 12 ? 12 : hour12 + 12;
    else hour = hour12 === 12 ? 0 : hour12;
  }

  return fromDateTime(year, month, day, hour, minute, second, microsecond);
}
