// Ported from src/termaid/renderer/xychart.py.
//
// Bars and lines on labelled axes, supporting vertical (default) and horizontal orientations.

import type { XYChart } from "../model/xychart.ts";
import { formatFixed } from "../pycompat.ts";
import { displayWidth } from "../utils.ts";
import { Canvas } from "./canvas.ts";

/** Rows of data in the vertical chart, and columns of it in the horizontal one. */
const CHART_H = 15;
const CHART_W = 50;
const BAR_WIDTH = 4;
const BAR_GAP = 2;
/** Columns left of the axis for the values written down it. */
const MARGIN_L = 8;
const EMPTY_SIZE = 1;
/** How many values are written along an axis, plus the one at the origin. */
const TICKS = 5;
/** Past this much of a row left over, the bar is topped with a half block. */
const HALF_BLOCK_SHARE = 0.3;
/** How many colours the sections cycle through. */
const SECTION_COLOURS = 8;
/** Decimals a value that is not whole is written with. */
const VALUE_DECIMALS = 1;

const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_AXIS_LABEL = "edge_label";
const sectionStyle = (index: number): string => `section:${index % SECTION_COLOURS}`;

export function renderXYChart(diagram: XYChart, useAscii = false, rounded = true): Canvas {
  if (diagram.datasets.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  if (diagram.horizontal) return renderHorizontal(diagram, useAscii);
  return renderVertical(diagram, useAscii, rounded);
}

/** Rows above the chart area: title, the label of the vertical axis, spacer. */
function headerRows(title: string, axisLabel: string): number {
  if (title !== "") return 2;
  return axisLabel !== "" ? 1 : 0;
}

/** Draw the vertical axis' label just above its tick labels. */
function drawAxisHeader(canvas: Canvas, row: number, marginL: number, label: string): void {
  const col = Math.max(1, marginL - displayWidth(label));
  canvas.putText(row, col, label, STYLE_AXIS_LABEL);
}

/** The value range the chart is drawn against, and how many points sit along it. */
function measured(diagram: XYChart): { low: number; span: number; points: number } | null {
  const values = diagram.datasets.flatMap((ds) => ds.values);
  if (values.length === 0) return null;

  let high = Math.max(...values);
  let low = Math.min(0, ...values);
  if (diagram.yRange !== null) [low, high] = diagram.yRange;
  const span = high - low === 0 ? 1 : high - low;

  return { low, span, points: Math.max(...diagram.datasets.map((ds) => ds.values.length)) };
}

/** The names under the points: the ones declared, then the range spread over them, then plain numbering. */
function categoriesOf(diagram: XYChart, points: number): string[] {
  const categories = diagram.xCategories.slice(0, points);
  if (diagram.xRange !== null && categories.length === 0) {
    const [low, high] = diagram.xRange;
    const step = (high - low) / Math.max(points - 1, 1);
    for (let i = 0; i < points; i++) categories.push(formatValue(low + i * step));
  }
  while (categories.length < points) categories.push(String(categories.length + 1));
  return categories;
}

function renderVertical(diagram: XYChart, useAscii: boolean, rounded: boolean): Canvas {
  const barChar = useAscii ? "#" : "█";
  const barHalf = useAscii ? "=" : "▄";
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const corner = useAscii ? "+" : "└";
  const tick = useAscii ? "+" : "┬";
  const leftTick = useAscii ? "+" : "┤";

  const scale = measured(diagram);
  if (scale === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const { low, span, points } = scale;

  const categories = categoriesOf(diagram, points);
  const categoryWidth = categories.length > 0 ? Math.max(...categories.map(displayWidth)) : 2;
  const columnWidth = Math.max(BAR_WIDTH, categoryWidth + 1);

  const chartWidth = points * (columnWidth + BAR_GAP) - BAR_GAP;
  const titleLines = headerRows(diagram.title, diagram.yLabel);
  const rowOffset = titleLines;
  const canvas = new Canvas(MARGIN_L + 1 + chartWidth + 2 + 1, CHART_H + 4 + titleLines + 1);

  if (diagram.title !== "") {
    const at = MARGIN_L + Math.floor((chartWidth - displayWidth(diagram.title)) / 2);
    canvas.putText(0, Math.max(0, at), diagram.title, STYLE_LABEL);
  }
  if (diagram.yLabel !== "") {
    drawAxisHeader(canvas, rowOffset - 1, MARGIN_L, diagram.yLabel);
  }

  for (let i = 0; i <= TICKS; i++) {
    const label = formatValue(low + (span * (TICKS - i)) / TICKS);
    const row = rowOffset + Math.floor((i * CHART_H) / TICKS);
    canvas.putText(row, Math.max(0, MARGIN_L - displayWidth(label) - 1), label, STYLE_AXIS_LABEL);
    canvas.put(row, MARGIN_L, leftTick, false, STYLE_EDGE);
  }

  for (let r = rowOffset; r <= rowOffset + CHART_H; r++) canvas.put(r, MARGIN_L, vertical, false, STYLE_EDGE);

  const axisRow = rowOffset + CHART_H;
  canvas.put(axisRow, MARGIN_L, corner, false, STYLE_EDGE);
  for (let c = MARGIN_L + 1; c < MARGIN_L + 1 + chartWidth; c++) canvas.put(axisRow, c, horizontal, false, STYLE_EDGE);

  const columnOf = (i: number): number => MARGIN_L + 1 + i * (columnWidth + BAR_GAP);
  const heightOf = (value: number): number => Math.trunc(((value - low) / span) * CHART_H);

  for (const ds of diagram.datasets) {
    ds.values.forEach((value, i) => {
      if (i >= points) return;
      const left = columnOf(i);
      const bars = heightOf(value);

      if (ds.chartType === "bar") {
        for (let r = 0; r < bars; r++) {
          for (let c = 0; c < columnWidth; c++) {
            canvas.put(rowOffset + CHART_H - 1 - r, left + c, barChar, false, sectionStyle(i));
          }
        }
        const leftover = ((value - low) / span) * CHART_H - bars;
        if (leftover > HALF_BLOCK_SHARE && bars < CHART_H) {
          for (let c = 0; c < columnWidth; c++) {
            canvas.put(rowOffset + CHART_H - 1 - bars, left + c, barHalf, false, sectionStyle(i));
          }
        }
        return;
      }

      const row = rowOffset + CHART_H - 1 - Math.max(0, bars - 1);
      const middle = left + Math.floor(columnWidth / 2);
      canvas.put(row, middle, horizontal, false, STYLE_EDGE);

      if (i > 0) {
        const previous = heightOf(ds.values[i - 1] as number);
        const previousRow = rowOffset + CHART_H - 1 - Math.max(0, previous - 1);
        const previousMiddle = columnOf(i - 1) + Math.floor(columnWidth / 2);
        drawLineV(canvas, previousMiddle, previousRow, middle, row, useAscii, rounded);
      }
    });
  }

  categories.forEach((category, i) => {
    const at = columnOf(i) + Math.floor(columnWidth / 2);
    canvas.put(axisRow, at, tick, false, STYLE_EDGE);
    canvas.putText(axisRow + 1, Math.max(0, at - Math.floor(displayWidth(category) / 2)), category, STYLE_AXIS_LABEL);
  });

  if (diagram.xLabel !== "") {
    const at = MARGIN_L + 1 + Math.floor((chartWidth - displayWidth(diagram.xLabel)) / 2);
    canvas.putText(axisRow + 2, Math.max(0, at), diagram.xLabel, STYLE_AXIS_LABEL);
  }

  return canvas;
}

function renderHorizontal(diagram: XYChart, useAscii: boolean): Canvas {
  const barChar = useAscii ? "#" : "█";
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const corner = useAscii ? "+" : "└";
  const bottomTick = useAscii ? "+" : "┬";

  const scale = measured(diagram);
  if (scale === null) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);
  const { low, span, points } = scale;

  const categories = categoriesOf(diagram, points);
  const categoryWidth = categories.length > 0 ? Math.max(...categories.map(displayWidth)) : 2;
  const marginLeft = categoryWidth + 2;

  // One row per bar, one blank row between them.
  const chartHeight = points * 2 - 1;
  const titleLines = headerRows(diagram.title, diagram.xLabel);
  const rowOffset = titleLines;
  const canvas = new Canvas(marginLeft + 1 + CHART_W + 2 + 1, titleLines + chartHeight + 3 + 1);

  if (diagram.title !== "") {
    const at = marginLeft + Math.floor((CHART_W - displayWidth(diagram.title)) / 2);
    canvas.putText(0, Math.max(0, at), diagram.title, STYLE_LABEL);
  }
  if (diagram.xLabel !== "") {
    drawAxisHeader(canvas, rowOffset - 1, marginLeft, diagram.xLabel);
  }

  for (let r = rowOffset; r <= rowOffset + chartHeight; r++) canvas.put(r, marginLeft, vertical, false, STYLE_EDGE);

  const axisRow = rowOffset + chartHeight;
  canvas.put(axisRow, marginLeft, corner, false, STYLE_EDGE);
  for (let c = marginLeft + 1; c < marginLeft + 1 + CHART_W; c++) canvas.put(axisRow, c, horizontal, false, STYLE_EDGE);

  for (let i = 0; i <= TICKS; i++) {
    const label = formatValue(low + (span * i) / TICKS);
    const col = marginLeft + 1 + Math.trunc((i / TICKS) * (CHART_W - 1));
    canvas.put(axisRow, col, bottomTick, false, STYLE_EDGE);
    canvas.putText(axisRow + 1, Math.max(0, col - Math.floor(displayWidth(label) / 2)), label, STYLE_AXIS_LABEL);
  }

  if (diagram.yLabel !== "") {
    const at = marginLeft + 1 + Math.floor((CHART_W - displayWidth(diagram.yLabel)) / 2);
    canvas.putText(axisRow + 2, Math.max(0, at), diagram.yLabel, STYLE_AXIS_LABEL);
  }

  for (const ds of diagram.datasets) {
    ds.values.forEach((value, i) => {
      if (i >= points) return;
      const row = rowOffset + i * 2;
      const bars = Math.trunc(((value - low) / span) * CHART_W);

      const category = categories[i] ?? "";
      canvas.putText(row, Math.max(0, marginLeft - displayWidth(category) - 1), category, STYLE_AXIS_LABEL);

      if (ds.chartType === "bar") {
        for (let c = 0; c < bars; c++) canvas.put(row, marginLeft + 1 + c, barChar, false, sectionStyle(i));
        return;
      }

      const pointX = marginLeft + Math.trunc(((value - low) / span) * (CHART_W - 1));
      canvas.put(row, pointX, vertical, false, STYLE_EDGE);
      if (i > 0) {
        const prevVal = ds.values[i - 1] as number;
        const prevX = marginLeft + Math.trunc(((prevVal - low) / span) * (CHART_W - 1));
        const prevRow = rowOffset + (i - 1) * 2;
        drawLineH(canvas, prevX, prevRow, pointX, row, useAscii);
      }
    });
  }

  return canvas;
}

/** The elbow between two points of a line (vertical chart). */
function drawLineV(
  canvas: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  useAscii: boolean,
  rounded: boolean
): void {
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const [topLeft, topRight, bottomLeft, bottomRight] = useAscii
    ? ["+", "+", "+", "+"]
    : rounded
      ? ["╭", "╮", "╰", "╯"]
      : ["┌", "┐", "└", "┘"];

  if (y1 === y2) {
    for (let x = x1 + 1; x < x2; x++) canvas.put(y1, x, horizontal, false, STYLE_EDGE);
    return;
  }

  const middle = Math.floor((x1 + x2) / 2);
  const up = y2 < y1;

  for (let x = x1 + 1; x < middle; x++) canvas.put(y1, x, horizontal, false, STYLE_EDGE);
  canvas.put(y1, middle, (up ? bottomRight : topRight) as string, false, STYLE_EDGE);
  for (let r = Math.min(y1, y2) + 1; r < Math.max(y1, y2); r++) canvas.put(r, middle, vertical, false, STYLE_EDGE);
  canvas.put(y2, middle, (up ? topLeft : bottomLeft) as string, false, STYLE_EDGE);
  for (let x = middle + 1; x < x2; x++) canvas.put(y2, x, horizontal, false, STYLE_EDGE);
}

/** The elbow between two points of a line (horizontal chart). */
function drawLineH(
  canvas: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  useAscii: boolean
): void {
  const horizontal = useAscii ? "-" : "─";
  const vertical = useAscii ? "|" : "│";
  const [topLeft, topRight, bottomLeft, bottomRight] = useAscii
    ? ["+", "+", "+", "+"]
    : ["╭", "╮", "╰", "╯"];

  if (x1 === x2) {
    for (let r = y1 + 1; r < y2; r++) canvas.put(r, x1, vertical, false, STYLE_EDGE);
    return;
  }

  const midY = Math.floor((y1 + y2) / 2);
  const goingRight = x2 > x1;

  for (let r = y1 + 1; r < midY; r++) canvas.put(r, x1, vertical, false, STYLE_EDGE);
  canvas.put(midY, x1, (goingRight ? bottomLeft : bottomRight) as string, false, STYLE_EDGE);
  for (let c = Math.min(x1, x2) + 1; c < Math.max(x1, x2); c++) canvas.put(midY, c, horizontal, false, STYLE_EDGE);
  canvas.put(midY, x2, (goingRight ? topRight : topLeft) as string, false, STYLE_EDGE);
  for (let r = midY + 1; r < y2; r++) canvas.put(r, x2, vertical, false, STYLE_EDGE);
}

/** A value as the axis writes it: whole numbers bare, everything else to one decimal. */
function formatValue(value: number): string {
  return value === Math.trunc(value) ? String(Math.trunc(value)) : formatFixed(value, VALUE_DECIMALS);
}
