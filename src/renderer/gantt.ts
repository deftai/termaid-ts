// Ported from src/termaid/renderer/gantt.py.

import { ganttTimeRange, shift, type Gantt, type TickInterval } from "../model/gantt.ts";
import {
  US_PER_DAY,
  US_PER_HOUR,
  US_PER_MINUTE,
  US_PER_MS,
  US_PER_SECOND,
  US_PER_WEEK,
  floorDivBigInt,
  formatStrftimeDirective,
  fromDateTime,
  midnight,
  nowInstant,
  pyWeekday,
  toDateTimeParts,
  type Instant,
} from "../pydate.ts";
import { displayWidth, truncateToWidth } from "../utils.ts";
import { Canvas } from "./canvas.ts";

const DEFAULT_WIDTH = 80;
const EMPTY_SIZE = 1;
const MIN_CHART_W = 10;
const LABEL_MARGIN = 4;
const LABEL_COLUMN = 3;
const AXIS_ROWS = 2;
const DEFAULT_AXIS_FORMAT = "%b %d";
const MAX_TICK_CANDIDATES = 10_000;

const DIRECTIVE_RE = /%[-_0]?[A-Za-z%]/g;

const SUB_DAY_UNITS: readonly bigint[] = [
  US_PER_HOUR,
  US_PER_MINUTE,
  US_PER_SECOND,
  100n * US_PER_MS,
  10n * US_PER_MS,
  US_PER_MS,
];

const FIRST_SUNDAY: Instant = fromDateTime(1970, 1, 4) as Instant;

const TICK_FIELDS: Readonly<Record<string, (t: Instant) => number>> = {
  millisecond: (t) => Math.floor(toDateTimeParts(t).microsecond / 1000),
  second: (t) => toDateTimeParts(t).second,
  minute: (t) => toDateTimeParts(t).minute,
  hour: (t) => toDateTimeParts(t).hour,
  day: (t) => toDateTimeParts(t).day - 1,
  week: (t) => Number(floorDivBigInt(floorDivBigInt(t - FIRST_SUNDAY, US_PER_DAY), 7n)) + 1,
  month: (t) => toDateTimeParts(t).month - 1,
};

const TICK_FLOORS: Readonly<Record<string, (t: Instant) => Instant>> = {
  millisecond: (t) => {
    const p = toDateTimeParts(t);
    return fromDateTime(p.year, p.month, p.day, p.hour, p.minute, p.second, Math.floor(p.microsecond / 1000) * 1000) as Instant;
  },
  second: (t) => {
    const p = toDateTimeParts(t);
    return fromDateTime(p.year, p.month, p.day, p.hour, p.minute, p.second, 0) as Instant;
  },
  minute: (t) => {
    const p = toDateTimeParts(t);
    return fromDateTime(p.year, p.month, p.day, p.hour, p.minute, 0, 0) as Instant;
  },
  hour: (t) => {
    const p = toDateTimeParts(t);
    return fromDateTime(p.year, p.month, p.day, p.hour, 0, 0, 0) as Instant;
  },
  day: (t) => midnight(t),
  week: (t) => midnight(t) - BigInt((pyWeekday(t) + 1) % 7) * US_PER_DAY,
  month: (t) => {
    const p = toDateTimeParts(t);
    return fromDateTime(p.year, p.month, 1, 0, 0, 0, 0) as Instant;
  },
};

const TICK_UNIT_MIN_LENGTH: Readonly<Record<string, bigint>> = {
  millisecond: US_PER_MS,
  second: US_PER_SECOND,
  minute: US_PER_MINUTE,
  hour: US_PER_HOUR,
  day: US_PER_DAY,
  week: US_PER_WEEK,
  month: 28n * US_PER_DAY,
};

const STYLE_LABEL = "label";
const STYLE_TASK_LABEL = "edge_label";
const STYLE_EDGE = "edge";
const STYLE_MARKER = "edge_label";
const STYLE_TODAY = "arrow";
const sectionStyle = (index: number): string => `section:${index}`;
const sectionLabelStyle = (index: number): string => `sectionfg:${index}`;

type BarStyle = "milestone" | "done" | "active" | "crit" | "normal";
type Bar = readonly [string, Instant | null, Instant | null, BarStyle];

/** Format `t` with a d3 time-format string such as `%H:%M` or `%S.%L`. */
export function formatTime(t: Instant, fmt: string): string {
  return fmt.replace(DIRECTIVE_RE, (token) => {
    if (token === "%L") {
      return String(Math.floor(toDateTimeParts(t).microsecond / 1000)).padStart(3, "0");
    }
    if (token === "%Q") {
      return (t / US_PER_MS).toString();
    }
    if (token === "%s") {
      return (t / US_PER_SECOND).toString();
    }
    if (token === "%q") {
      return String(Math.floor((toDateTimeParts(t).month - 1) / 3) + 1);
    }
    return formatStrftimeDirective(t, token);
  });
}

interface Scale {
  readonly start: Instant;
  readonly end: Instant;
  readonly x0: number;
  readonly cells: number;
}

const scaleSpan = (s: Scale): bigint => s.end - s.start;
const scaleCovers = (s: Scale, t: Instant): boolean => t >= s.start && t <= s.end;
const scaleCol = (s: Scale, t: Instant): number => {
  const numSeconds = Number(t - s.start) / 1_000_000;
  const denSeconds = Number(scaleSpan(s)) / 1_000_000;
  return s.x0 + Math.trunc((numSeconds / denSeconds) * s.cells);
};

function defaultTicks(scale: Scale, chartW: number, fmt: string): Array<readonly [number, string]> {
  const span = scaleSpan(scale);
  let unit = US_PER_DAY;
  if (span < unit) {
    unit = SUB_DAY_UNITS.find((u) => span >= 2n * u) ?? (SUB_DAY_UNITS[SUB_DAY_UNITS.length - 1] as bigint);
  }
  const totalUnits = Number(span) / Number(unit);
  const nTicks = Math.max(2, Math.min(6, Math.trunc(totalUnits)));
  const out: Array<readonly [number, string]> = [];
  for (let i = 0; i <= nTicks; i++) {
    const col = scale.x0 + Math.trunc((i / nTicks) * (chartW - 2));
    const stepUnits = BigInt(Math.trunc((i / nTicks) * totalUnits));
    const label = formatTime(scale.start + unit * stepUnits, fmt);
    out.push([col, label]);
  }
  return out;
}

function intervalTicks(
  scale: Scale,
  interval: TickInterval,
  fmt: string
): Array<readonly [number, string]> | null {
  const minLen = TICK_UNIT_MIN_LENGTH[interval.unit];
  const fieldFn = TICK_FIELDS[interval.unit];
  const floorFn = TICK_FLOORS[interval.unit];
  if (minLen === undefined || fieldFn === undefined || floorFn === undefined) return null;
  if (Number(scaleSpan(scale)) / Number(minLen) > MAX_TICK_CANDIDATES) return null;

  const lastCol = scale.x0 + scale.cells - 1;
  const ticks: Array<readonly [number, string]> = [];
  let t = floorFn(scale.start);
  while (t <= scale.end) {
    if (t >= scale.start && (((fieldFn(t) % interval.count) + interval.count) % interval.count) === 0) {
      ticks.push([Math.min(scaleCol(scale, t), lastCol), formatTime(t, fmt)]);
    }
    t = shift(t, 1, interval.unit);
  }
  return ticks.length <= scale.cells ? ticks : null;
}

export function renderGantt(diagram: Gantt, useAscii = false, width: number = DEFAULT_WIDTH): Canvas {
  if (diagram.sections.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const barChar = useAscii ? "#" : "█";
  const activeChar = useAscii ? "=" : "▓";
  const doneChar = useAscii ? "." : "░";
  const critChar = useAscii ? "!" : "█";
  const milestoneChar = useAscii ? "*" : "◆";
  const hz = useAscii ? "-" : "─";
  const vt = useAscii ? "|" : "│";
  const axisFmt = diagram.axisFormat ?? DEFAULT_AXIS_FORMAT;

  const allTasks: Array<readonly [string, Bar[]]> = [];
  let maxLabelWidth = 0;

  for (const section of diagram.sections) {
    const sectionTasks: Bar[] = [];
    for (const task of section.tasks) {
      const style: BarStyle = task.isMilestone
        ? "milestone"
        : task.isDone
          ? "done"
          : task.isActive
            ? "active"
            : task.isCrit
              ? "crit"
              : "normal";
      sectionTasks.push([task.title, task.start, task.end, style]);
      maxLabelWidth = Math.max(maxLabelWidth, displayWidth(task.title));
    }
    allTasks.push([section.title, sectionTasks]);
    maxLabelWidth = Math.max(maxLabelWidth, displayWidth(section.title) + 2);
  }

  const timeRange = ganttTimeRange(diagram);
  if (timeRange === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const minDate = timeRange[0];
  let maxDate = timeRange[1];
  if (maxDate <= minDate) {
    maxDate = minDate + US_PER_DAY;
  }

  const marginL = maxLabelWidth + LABEL_MARGIN;
  const chartW = Math.max(MIN_CHART_W, width - marginL - 1);
  const scale: Scale = { start: minDate, end: maxDate, x0: marginL + 1, cells: chartW - 1 };

  const titleRows = diagram.title !== "" ? 2 : 0;
  let taskRows = 0;
  for (const [sectionTitle, tasks] of allTasks) {
    if (sectionTitle !== "") taskRows += 1;
    taskRows += tasks.length;
  }

  const totalH = titleRows + taskRows + AXIS_ROWS + 1;
  const totalW = marginL + chartW + 1;
  const canvas = new Canvas(totalW + 1, totalH + 1);

  if (diagram.title !== "") {
    const tx = marginL + Math.floor((chartW - displayWidth(diagram.title)) / 2);
    canvas.putText(0, Math.max(0, tx), diagram.title, STYLE_LABEL);
  }

  let row = titleRows;
  let sectionIdx = 0;
  for (const [sectionTitle, tasks] of allTasks) {
    if (sectionTitle !== "") {
      canvas.putText(row, 1, sectionTitle, sectionLabelStyle(sectionIdx));
      row += 1;
    }

    for (const [title, start, end, style] of tasks) {
      const disp = truncateToWidth(title, marginL - LABEL_MARGIN);
      canvas.putText(row, LABEL_COLUMN, disp, STYLE_TASK_LABEL);

      if (start !== null && end !== null) {
        const barStart = scaleCol(scale, start);
        const barEnd = Math.max(scaleCol(scale, end), barStart + 1);

        if (style === "milestone") {
          const mid = Math.floor((barStart + barEnd) / 2);
          canvas.put(row, mid, milestoneChar, false, sectionStyle(sectionIdx));
        } else {
          const ch =
            style === "done"
              ? doneChar
              : style === "active"
                ? activeChar
                : style === "crit"
                  ? critChar
                  : barChar;
          const taskStyle = sectionStyle(sectionIdx);
          for (let c = barStart; c < barEnd; c++) {
            if (c < totalW) canvas.put(row, c, ch, false, taskStyle);
          }
        }
      }
      row += 1;
    }
    sectionIdx += 1;
  }

  const axisRow = row;
  for (let r = titleRows; r < axisRow; r++) {
    canvas.put(r, marginL, vt, false, STYLE_EDGE);
  }

  canvas.put(axisRow, marginL, useAscii ? "+" : "└", false, STYLE_EDGE);
  for (let c = marginL + 1; c < marginL + chartW; c++) {
    canvas.put(axisRow, c, hz, false, STYLE_EDGE);
  }

  const markerVt = useAscii ? "|" : "┊";
  for (const markerDate of diagram.verticalMarkers) {
    if (scaleCovers(scale, markerDate)) {
      const col = scaleCol(scale, markerDate);
      const label = formatTime(markerDate, axisFmt);
      const labelX = col - Math.floor(displayWidth(label) / 2);
      const labelRow = titleRows > 0 ? titleRows - 1 : 0;
      canvas.putText(labelRow, Math.max(marginL + 1, labelX), label, STYLE_MARKER);
      for (let r = titleRows; r < axisRow; r++) {
        const existing = canvas.get(r, col);
        if (existing === " " || existing === hz) {
          canvas.put(r, col, markerVt, false, STYLE_MARKER);
        }
      }
    }
  }

  if (diagram.todayMarker) {
    const now = nowInstant();
    if (scaleCovers(scale, now)) {
      const todayVt = useAscii ? "|" : "▎";
      const col = scaleCol(scale, now);
      for (let r = titleRows; r < axisRow; r++) {
        if (canvas.get(r, col) === " ") {
          canvas.put(r, col, todayVt, false, STYLE_TODAY);
        }
      }
    }
  }

  let ticks = diagram.tickInterval !== null ? intervalTicks(scale, diagram.tickInterval, axisFmt) : null;
  if (ticks === null) {
    ticks = defaultTicks(scale, chartW, axisFmt);
  }
  let labelEnd = -1;
  for (const [col, label] of ticks) {
    canvas.put(axisRow, col, useAscii ? "+" : "┬", false, STYLE_EDGE);
    const labelW = displayWidth(label);
    const labelX = Math.min(Math.max(0, col - Math.floor(labelW / 2)), totalW + 1 - labelW);
    if (labelX > labelEnd) {
      canvas.putText(axisRow + 1, labelX, label, STYLE_MARKER);
      labelEnd = labelX + labelW;
    }
  }

  return canvas;
}
