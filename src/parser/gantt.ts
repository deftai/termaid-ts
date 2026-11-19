// Ported from src/termaid/parser/gantt.py.

import {
  Duration,
  makeGantt,
  makeGanttSection,
  makeGanttTask,
  startTaskAt,
  type Gantt,
  type GanttSection,
  type GanttTask,
} from "../model/gantt.ts";
import { PY_WORD, pyFloat, pySplit, pyStrip, splitLines } from "../pycompat.ts";
import {
  EPOCH_INSTANT,
  US_PER_MS,
  US_PER_SECOND,
  addTimedeltaFloat,
  fromDateTime,
  strptime,
  type Instant,
} from "../pydate.ts";

const COMMENT = "%%";
const TITLE = "title ";
const DATE_FORMAT = "dateformat ";
const AXIS_FORMAT = "axisformat ";
const TICK_INTERVAL = "tickinterval ";
const EXCLUDES = "excludes ";
const WEEKEND = "weekend ";
const TODAY_MARKER = "todaymarker ";
const OFF = "off";
const VERTICAL = "vert ";
const SECTION = "section ";
const AFTER = "after ";
const FIELD = ":";
const SEPARATOR = ",";

const DONE = "done";
const ACTIVE = "active";
const CRIT = "crit";
const MILESTONE = "milestone";

/** Mermaid (dayjs) date format tokens -> strptime directives, longest first. */
const FORMAT_TOKENS: Readonly<Record<string, string>> = {
  YYYY: "%Y",
  YY: "%y",
  MM: "%m",
  M: "%m",
  DD: "%d",
  D: "%d",
  HH: "%H",
  H: "%H",
  hh: "%I",
  h: "%I",
  mm: "%M",
  m: "%M",
  ss: "%S",
  s: "%S",
  SSS: "%f",
  A: "%p",
  a: "%p",
};
const FORMAT_TOKEN_RE = /YYYY|SSS|YY|MM|DD|HH|hh|mm|ss|M|D|H|h|m|s|A|a/g;

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|[Mdhmswy]|days?|weeks?|months?)$/;
const DURATION_UNITS: Readonly<Record<string, string>> = {
  ms: "millisecond",
  s: "second",
  m: "minute",
  h: "hour",
  d: "day",
  w: "week",
  M: "month",
  y: "year",
  day: "day",
  days: "day",
  week: "week",
  weeks: "week",
  month: "month",
  months: "month",
};
const TICK_INTERVAL_RE = /^([1-9][0-9]*)(millisecond|second|minute|hour|day|week|month)$/;

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ID_RE = new RegExp(String.raw`^[a-zA-Z_]${PY_WORD}*$`, "u");
const NOT_ID_CHAR_RE = /[^a-zA-Z0-9]/g;
const GENERATED_ID_LENGTH = 20;

/** Parse a mermaid gantt diagram definition. */
export function parseGantt(text: string): Gantt {
  const lines = splitLines(pyStrip(text));
  const gantt = makeGantt();
  if (lines.length === 0) return gantt;

  let currentSection: GanttSection | null = null;
  const tasksById = new Map<string, GanttTask>();

  for (let line of lines.slice(1)) {
    const commentIdx = line.indexOf(COMMENT);
    if (commentIdx >= 0) line = line.slice(0, commentIdx);

    const stripped = pyStrip(line);
    if (stripped === "") continue;
    const lower = stripped.toLowerCase();

    if (lower.startsWith(TITLE)) {
      gantt.title = pyStrip(stripped.slice(TITLE.length));
      continue;
    }

    if (lower.startsWith(DATE_FORMAT)) {
      gantt.dateFormat = pyStrip(stripped.slice(DATE_FORMAT.length));
      continue;
    }

    if (lower.startsWith(AXIS_FORMAT)) {
      gantt.axisFormat = pyStrip(stripped.slice(AXIS_FORMAT.length));
      continue;
    }

    if (lower.startsWith(TICK_INTERVAL)) {
      const m = TICK_INTERVAL_RE.exec(pyStrip(stripped.slice(TICK_INTERVAL.length)));
      if (m !== null) {
        gantt.tickInterval = {
          count: Number.parseInt(m[1] as string, 10),
          unit: m[2] as string,
        };
      }
      continue;
    }

    if (lower.startsWith(EXCLUDES) || lower.startsWith(WEEKEND)) {
      continue;
    }

    if (lower.startsWith(TODAY_MARKER)) {
      if (lower.includes(OFF)) gantt.todayMarker = false;
      continue;
    }

    if (lower.startsWith(VERTICAL)) {
      const d = parseDate(pyStrip(stripped.slice(VERTICAL.length)), gantt.dateFormat);
      if (d !== null) gantt.verticalMarkers.push(d);
      continue;
    }

    if (lower.startsWith(SECTION)) {
      currentSection = makeGanttSection(pyStrip(stripped.slice(SECTION.length)));
      gantt.sections.push(currentSection);
      continue;
    }

    if (stripped.includes(FIELD)) {
      const task = parseTask(stripped, gantt.dateFormat);
      if (task !== null) {
        if (currentSection === null) {
          currentSection = makeGanttSection("");
          gantt.sections.push(currentSection);
        }

        const prev = currentSection.tasks[currentSection.tasks.length - 1];
        if (task.start === null && task.after === "" && prev !== undefined && prev.end !== null) {
          startTaskAt(task, prev.end);
        }

        currentSection.tasks.push(task);
        if (task.id !== "") tasksById.set(task.id, task);
      }
    }
  }

  for (let pass = 0; pass < tasksById.size + 1; pass++) {
    let changed = false;
    for (const section of gantt.sections) {
      for (const task of section.tasks) {
        if (task.after === "" || task.start !== null) continue;
        const ids = pySplit(task.after);
        const ends: Instant[] = [];
        for (const aid of ids) {
          const dep = tasksById.get(aid);
          if (dep !== undefined && dep.end !== null) ends.push(dep.end);
        }
        if (ends.length > 0 && ends.length === ids.length) {
          let latest = ends[0] as Instant;
          for (const e of ends.slice(1)) if (e > latest) latest = e;
          startTaskAt(task, latest);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return gantt;
}

function parseTask(line: string, dateFormat: string): GanttTask | null {
  const colonIdx = line.indexOf(FIELD);
  if (colonIdx < 0) return null;

  const title = pyStrip(line.slice(0, colonIdx));
  const rest = pyStrip(line.slice(colonIdx + 1));
  const task = makeGanttTask(title);
  const parts = rest.split(SEPARATOR).map((p) => pyStrip(p));

  const remaining: string[] = [];
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === DONE) task.isDone = true;
    else if (low === ACTIVE) task.isActive = true;
    else if (low === CRIT) task.isCrit = true;
    else if (low === MILESTONE) task.isMilestone = true;
    else remaining.push(part);
  }

  for (const part of remaining) {
    if (part.toLowerCase().startsWith(AFTER)) {
      task.after = pyStrip(part.slice(AFTER.length));
      continue;
    }

    const d = parseDate(part, dateFormat);
    if (d !== null) {
      if (task.start === null && task.after === "") {
        task.start = d;
      } else {
        task.end = d;
      }
      continue;
    }

    const dur = parseDuration(part);
    if (dur !== null) {
      task.duration = dur;
      if (task.start !== null) {
        task.end = dur.endFrom(task.start);
      }
      continue;
    }

    if (task.id === "" && ID_RE.test(part)) {
      task.id = part;
    }
  }

  if (task.id === "") {
    task.id = [...title.toLowerCase().replace(NOT_ID_CHAR_RE, "_")].slice(0, GENERATED_ID_LENGTH).join("");
  }

  return task;
}

function parseDate(text: string, dateFormat: string): Instant | null {
  const stripped = pyStrip(text);
  const fmt = pyStrip(dateFormat);
  if (fmt === "x" || fmt === "X") {
    const value = pyFloat(stripped);
    if (value === null || !Number.isFinite(value)) return null;
    return addTimedeltaFloat(EPOCH_INSTANT, fmt === "x" ? US_PER_MS : US_PER_SECOND, value);
  }

  if (fmt !== "") {
    const strptimeFmt = fmt.replace(FORMAT_TOKEN_RE, (m) => FORMAT_TOKENS[m] ?? m);
    const declared = strptime(stripped, strptimeFmt);
    if (declared !== null) return declared;
  }

  const iso = ISO_RE.exec(stripped);
  if (iso !== null) {
    return fromDateTime(
      Number.parseInt(iso[1] as string, 10),
      Number.parseInt(iso[2] as string, 10),
      Number.parseInt(iso[3] as string, 10)
    );
  }

  const american = US_RE.exec(stripped);
  if (american !== null) {
    return fromDateTime(
      Number.parseInt(american[3] as string, 10),
      Number.parseInt(american[1] as string, 10),
      Number.parseInt(american[2] as string, 10)
    );
  }

  return null;
}

function parseDuration(text: string): Duration | null {
  const m = DURATION_RE.exec(pyStrip(text));
  if (m === null) return null;
  const amount = Number.parseFloat(m[1] as string);
  const unit = DURATION_UNITS[m[2] as string];
  if (unit === undefined || !Number.isFinite(amount)) return null;
  return new Duration(amount, unit);
}
