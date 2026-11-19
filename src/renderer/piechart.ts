// Ported from src/termaid/renderer/piechart.py.
//
// A pie has no honest form in a terminal, so the reference draws bars: one stacked band showing the parts of the whole,
// then one bar per slice.

import type { PieChart } from "../model/piechart.ts";
import { formatFixed, formatG, pyRound, rjust } from "../pycompat.ts";
import { displayWidth } from "../utils.ts";
import { Canvas } from "./canvas.ts";

const FILL_CHARS = ["█", "░", "▒", "▚", "▞", "▄", "▀", "▌"];
const FILL_CHARS_ASCII = ["#", "*", "+", "~", ":", ".", "o", "="];

const BAR_WIDTH = 40;
const MARGIN = 2;
const EMPTY_SIZE = 1;
const PERCENT = 100;
const PERCENT_COLUMNS = 5;
const PERCENT_DECIMALS = 1;
const STACKED_ROWS = 4;
const MIN_LABELLED_SEGMENT = 4;

const STYLE_LABEL = "label";
const STYLE_NODE = "node";
const STYLE_EDGE = "edge";

type Segment = readonly [number, number, string, string];

export function renderPieChart(diagram: PieChart, useAscii = false): Canvas {
  if (diagram.slices.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const total = diagram.slices.reduce((sum, s) => sum + s.value, 0);
  const fills = useAscii ? FILL_CHARS_ASCII : FILL_CHARS;
  const share = (value: number): number => (value / total) * PERCENT;

  const maxLabelLen = Math.max(...diagram.slices.map((s) => displayWidth(s.label)));
  const labelColumns = maxLabelLen + MARGIN;

  const suffixes = diagram.slices.map((s) => {
    const percent = ` ${rjust(formatFixed(share(s.value), PERCENT_DECIMALS), PERCENT_COLUMNS)}%`;
    return diagram.showData ? `${percent}  [${formatG(s.value)}]` : percent;
  });
  const maxSuffixLen = Math.max(...suffixes.map((s) => [...s].length));

  const barLeft = labelColumns;
  const stackedW = Math.max(BAR_WIDTH, diagram.slices.length);
  let canvasWidth = barLeft + BAR_WIDTH + maxSuffixLen + MARGIN;
  canvasWidth = Math.max(canvasWidth, barLeft + 1 + stackedW + MARGIN);
  if (diagram.title !== "") {
    canvasWidth = Math.max(canvasWidth, displayWidth(diagram.title) + 2 * MARGIN);
  }
  const titleRows = diagram.title !== "" ? 2 : 0;
  const stackedTop = MARGIN + titleRows;
  const barsTop = stackedTop + STACKED_ROWS;
  const canvas = new Canvas(canvasWidth, barsTop + diagram.slices.length + MARGIN);

  if (diagram.title !== "") {
    const column = Math.max(0, Math.floor((canvasWidth - displayWidth(diagram.title)) / 2));
    canvas.putText(MARGIN, column, diagram.title, STYLE_LABEL);
  }

  const stackedLeft = barLeft + 1;
  const widths = diagram.slices.map((s) => Math.max(1, pyRound((s.value / total) * stackedW)));
  const rest = stackedW - widths.slice(0, -1).reduce((a, b) => a + b, 0);
  if (rest > 0) {
    widths[widths.length - 1] = rest;
  }
  while (widths.reduce((a, b) => a + b, 0) > stackedW && Math.max(...widths) > 1) {
    const maxW = Math.max(...widths);
    widths[widths.indexOf(maxW)] = maxW - 1;
  }

  let column = 0;
  const labelParts: Segment[] = [];
  diagram.slices.forEach((s, i) => {
    const segW = widths[i] as number;
    const fill = fills[i % fills.length] as string;
    for (let c = 0; c < segW; c++) {
      canvas.put(stackedTop, stackedLeft + column + c, fill, false, STYLE_NODE);
    }
    const pctLabel = `${formatFixed(share(s.value), 0)}%`;
    labelParts.push([column, segW, `${s.label} ${pctLabel}`, pctLabel]);
    column += segW;
  });

  const showNames = labelParts.every(([, segW, named]) => displayWidth(named) <= segW);
  const labelRow = stackedTop + 1;
  for (const [start, segW, named, pctLabel] of labelParts) {
    const text = showNames ? named : pctLabel;
    const tw = displayWidth(text);
    if (showNames || (segW >= MIN_LABELLED_SEGMENT && tw <= segW)) {
      const lx = stackedLeft + start + Math.floor((segW - tw) / 2);
      canvas.putText(labelRow, lx, text, STYLE_LABEL);
    }
  }

  diagram.slices.forEach((s, i) => {
    const row = barsTop + i;
    const fill = fills[i % fills.length] as string;
    const barLength = Math.max(1, pyRound((s.value / total) * BAR_WIDTH));

    const labelText = " ".repeat(maxLabelLen - displayWidth(s.label)) + s.label;
    canvas.putText(row, MARGIN, labelText, STYLE_LABEL);
    canvas.put(row, barLeft, useAscii ? "|" : "┃", false, STYLE_EDGE);
    for (let c = 0; c < barLength; c++) canvas.put(row, barLeft + 1 + c, fill, false, STYLE_NODE);
    canvas.putText(row, barLeft + 1 + barLength, suffixes[i] as string, STYLE_LABEL);
  });

  return canvas;
}
