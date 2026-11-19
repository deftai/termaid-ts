// Ported from src/termaid/renderer/sequence.py.
//
// Renders a SequenceDiagram directly to a Canvas.

import type {
  Block,
  BlockSection,
  Event,
  Message,
  Note,
  Participant,
  SequenceDiagram,
} from "../model/sequence.ts";
import { displayWidth, wrapDisplayText } from "../utils.ts";
import { Canvas } from "./canvas.ts";
import { defaultCharset, type CharSet } from "./charset.ts";
import { drawCylinder, drawRectangle } from "./shapes.ts";

const BOX_PAD = 4;
const MIN_GAP = 16;
const EVENT_ROW_H = 2;
const BLOCK_START_H = 3;
const BLOCK_SECTION_H = 2;
const BLOCK_END_H = 2;
const TOP_MARGIN = 0;
const BOTTOM_MARGIN = 1;
const EMPTY_SIZE = 1;

const KIND_HEIGHT: Readonly<Record<string, number>> = {
  participant: 3,
  actor: 5,
  database: 5,
  queue: 5,
  boundary: 5,
  control: 5,
  entity: 5,
  collections: 5,
};

const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
const STYLE_ARROW = "arrow";

interface BlockStart {
  type: "blockStart";
  block: Block;
  depth: number;
}

interface BlockSectionBreak {
  type: "blockSection";
  section: BlockSection;
  block: Block;
  depth: number;
}

interface BlockEnd {
  type: "blockEnd";
  block: Block;
  depth: number;
}

type FlatEvent = Event | BlockStart | BlockSectionBreak | BlockEnd;

interface Labels {
  participants: string[][];
  events: string[][];
  blockTitles: Map<Block, string[]>;
  sections: Map<BlockSection, string[]>;
}

function flattenEvents(events: readonly Event[], depth = 0): FlatEvent[] {
  const result: FlatEvent[] = [];
  for (const ev of events) {
    if (ev.type === "block") {
      result.push({ type: "blockStart", block: ev, depth });
      result.push(...flattenEvents(ev.events, depth + 1));
      for (const section of ev.sections) {
        result.push({ type: "blockSection", section, block: ev, depth });
        result.push(...flattenEvents(section.events, depth + 1));
      }
      result.push({ type: "blockEnd", block: ev, depth });
    } else {
      result.push(ev);
    }
  }
  return result;
}

function linesWidth(lines: readonly string[]): number {
  return lines.length > 0 ? Math.max(...lines.map(displayWidth)) : 0;
}

function extraRows(lines: readonly string[]): number {
  return Math.max(lines.length, 1) - 1;
}

function selfLoopWidth(lines: readonly string[]): number {
  return Math.max(linesWidth(lines) + 4, 8);
}

function participantHeight(participant: Participant, lines: readonly string[]): number {
  return (KIND_HEIGHT[participant.kind] ?? 3) + lines.length - 1;
}

function participantIndex(diagram: SequenceDiagram, pid: string): number {
  for (let i = 0; i < diagram.participants.length; i++) {
    if ((diagram.participants[i] as Participant).id === pid) return i;
  }
  return -1;
}

function effectiveLabel(msg: Message, msgNumber: number | null): string {
  if (msgNumber !== null) {
    const prefix = `${msgNumber}: `;
    return msg.label !== "" ? prefix + msg.label : prefix.trimEnd();
  }
  return msg.label;
}

function collectLabels(
  diagram: SequenceDiagram,
  flatEvents: readonly FlatEvent[],
  maxLabelWidth: number | null
): Labels {
  const wrap = (text: string): string[] =>
    maxLabelWidth === null ? text.split("\n") : wrapDisplayText(text, maxLabelWidth);

  const events: string[][] = [];
  let msgCounter = 0;
  for (const ev of flatEvents) {
    if (ev.type === "message") {
      msgCounter += 1;
      const eff = effectiveLabel(ev, diagram.autonumber ? msgCounter : null);
      events.push(eff !== "" ? wrap(eff) : []);
    } else if (ev.type === "note") {
      events.push(maxLabelWidth === null ? ev.text.split("\n") : wrap(ev.text));
    } else {
      events.push([]);
    }
  }

  return {
    participants: diagram.participants.map((p) => wrap(p.label)),
    events,
    blockTitles: new Map(),
    sections: new Map(),
  };
}

function noteBounds(
  note: Note,
  lines: readonly string[],
  colCenters: readonly number[],
  diagram: SequenceDiagram
): [number, number] | null {
  if (note.participants.length === 0) return null;
  let noteWidth = linesWidth(lines) + 4;
  let noteX: number;

  if (note.position === "rightof") {
    const pi = participantIndex(diagram, note.participants[0] as string);
    if (pi < 0) return null;
    noteX = (colCenters[pi] as number) + 2;
  } else if (note.position === "leftof") {
    const pi = participantIndex(diagram, note.participants[0] as string);
    if (pi < 0) return null;
    noteX = (colCenters[pi] as number) - 2 - noteWidth;
  } else if (note.position === "over") {
    let center: number;
    if (note.participants.length === 2) {
      const p1i = participantIndex(diagram, note.participants[0] as string);
      const p2i = participantIndex(diagram, note.participants[1] as string);
      if (p1i < 0 || p2i < 0) return null;
      const c1 = colCenters[p1i] as number;
      const c2 = colCenters[p2i] as number;
      center = Math.floor((c1 + c2) / 2);
      const spanWidth = Math.abs(c1 - c2) + 4;
      noteWidth = Math.max(noteWidth, spanWidth);
    } else {
      const pi = participantIndex(diagram, note.participants[0] as string);
      if (pi < 0) return null;
      center = colCenters[pi] as number;
    }
    noteX = center - Math.floor(noteWidth / 2);
  } else {
    return null;
  }

  return [noteX, noteX + noteWidth - 1];
}

function computeBlockBounds(
  diagram: SequenceDiagram,
  flatEvents: readonly FlatEvent[],
  colCenters: readonly number[],
  labels: Labels,
  wrapScopeLabels = false
): Map<Block, [number, number]> {
  const blockBounds = new Map<Block, [number, number]>();
  const contentStack: Array<Array<[number, number]>> = [];

  flatEvents.forEach((event, eventIndex) => {
    if (event.type === "blockStart") {
      contentStack.push([]);
      return;
    }
    if (event.type === "blockEnd") {
      const contents = contentStack.pop() ?? [];
      const contentLeft =
        contents.length > 0 ? Math.min(...contents.map(([l]) => l)) : (colCenters[0] as number);
      const contentRight =
        contents.length > 0 ? Math.max(...contents.map(([, r]) => r)) : contentLeft;
      const frameLeft = contentLeft - 2;
      const block = event.block;
      const prefix = `[${block.kind}]`;
      const title = `${prefix} ${block.label}`.trimEnd();

      if (wrapScopeLabels) {
        const titleBudget = Math.max(contentRight - contentLeft + 2, displayWidth(prefix) + 3);
        labels.blockTitles.set(block, wrapDisplayText(title, titleBudget));
        for (const section of block.sections) {
          labels.sections.set(
            section,
            section.label !== "" ? wrapDisplayText(`[${section.label}]`, Math.max(titleBudget - 2, 3)) : []
          );
        }
      } else {
        labels.blockTitles.set(block, [title]);
        for (const section of block.sections) {
          labels.sections.set(section, section.label !== "" ? [`[${section.label}]`] : []);
        }
      }

      const titleWidth = linesWidth(labels.blockTitles.get(block) ?? []);
      let sectionWidth = 0;
      for (const section of block.sections) {
        if (section.label !== "") {
          sectionWidth = Math.max(sectionWidth, linesWidth(labels.sections.get(section) ?? []) + 2);
        }
      }
      const frameRight = Math.max(contentRight + 2, frameLeft + Math.max(titleWidth, sectionWidth) + 2);
      const bounds: [number, number] = [frameLeft, frameRight];
      blockBounds.set(block, bounds);
      if (contentStack.length > 0) {
        (contentStack[contentStack.length - 1] as Array<[number, number]>).push(bounds);
      }
      return;
    }
    if (contentStack.length === 0) return;

    const top = contentStack[contentStack.length - 1] as Array<[number, number]>;
    if (event.type === "message") {
      const sourceIndex = participantIndex(diagram, event.source);
      const targetIndex = participantIndex(diagram, event.target);
      if (sourceIndex < 0 || targetIndex < 0) return;
      const sc = colCenters[sourceIndex] as number;
      const tc = colCenters[targetIndex] as number;
      const messageLeft = Math.min(sc, tc);
      const lines = labels.events[eventIndex] ?? [];
      let messageRight = Math.max(sc, tc);
      if (sourceIndex === targetIndex) {
        messageRight = messageLeft + selfLoopWidth(lines) - 1;
      } else {
        messageRight = Math.max(messageRight, messageLeft + 1 + linesWidth(lines));
      }
      top.push([messageLeft, messageRight]);
    } else if (event.type === "note") {
      const nb = noteBounds(event, labels.events[eventIndex] ?? [], colCenters, diagram);
      if (nb !== null) top.push(nb);
    } else if (event.type === "activate" || event.type === "destroy") {
      const pi = participantIndex(diagram, event.participant);
      if (pi >= 0) {
        const col = colCenters[pi] as number;
        top.push([col, col]);
      }
    }
  });

  return blockBounds;
}

interface SequenceLayout {
  colCenters: number[];
  boxWidths: number[];
  width: number;
  height: number;
  headerHeight: number;
  rowOffsets: number[];
  blockBounds: Map<Block, [number, number]>;
}

function computeLayout(
  diagram: SequenceDiagram,
  flatEvents: readonly FlatEvent[],
  labels: Labels,
  paddingX = BOX_PAD,
  minGap = MIN_GAP,
  wrapScopeLabels = false
): SequenceLayout {
  const n = diagram.participants.length;
  if (n === 0) {
    return {
      colCenters: [],
      boxWidths: [],
      width: 0,
      height: 0,
      headerHeight: 0,
      rowOffsets: [],
      blockBounds: new Map(),
    };
  }

  const boxWidths = labels.participants.map((lines) => linesWidth(lines) + paddingX + 2);
  const headerHeight = Math.max(
    ...diagram.participants.map((p, i) => participantHeight(p, labels.participants[i] ?? []))
  );

  const gapMins = n > 1 ? Array.from({ length: n - 1 }, () => minGap) : [];
  for (let i = 0; i < n - 1; i++) {
    const boxGapNeed = Math.floor(((boxWidths[i] as number) + (boxWidths[i + 1] as number)) / 2) + 2;
    gapMins[i] = Math.max(gapMins[i] as number, boxGapNeed);
  }

  flatEvents.forEach((ev, evIdx) => {
    if (ev.type === "note") {
      const noteWidth = linesWidth(labels.events[evIdx] ?? []) + 4;
      for (const pid of ev.participants) {
        const pi = participantIndex(diagram, pid);
        if (pi < 0) continue;
        if (ev.position === "rightof" && pi < n - 1) {
          gapMins[pi] = Math.max(gapMins[pi] as number, noteWidth + 4);
        } else if (ev.position === "leftof" && pi > 0) {
          gapMins[pi - 1] = Math.max(gapMins[pi - 1] as number, noteWidth + 4);
        }
      }
      if (ev.position === "over" && ev.participants.length === 2) {
        const p1i = participantIndex(diagram, ev.participants[0] as string);
        const p2i = participantIndex(diagram, ev.participants[1] as string);
        if (p1i >= 0 && p2i >= 0 && p1i !== p2i) {
          const lo = Math.min(p1i, p2i);
          const hi = Math.max(p1i, p2i);
          const spans = hi - lo;
          const perGap = Math.floor((noteWidth + spans - 1) / spans);
          for (let g = lo; g < hi; g++) gapMins[g] = Math.max(gapMins[g] as number, perGap);
        }
      }
      return;
    }

    if (ev.type !== "message") return;
    const si = participantIndex(diagram, ev.source);
    const ti = participantIndex(diagram, ev.target);
    if (si < 0 || ti < 0 || si === ti) return;
    const lo = Math.min(si, ti);
    const hi = Math.max(si, ti);
    const labelNeed = linesWidth(labels.events[evIdx] ?? []) + 6;
    const spans = hi - lo;
    const perGap = Math.floor((labelNeed + spans - 1) / spans);
    for (let g = lo; g < hi; g++) gapMins[g] = Math.max(gapMins[g] as number, perGap);
  });

  const colCenters = Array.from({ length: n }, () => 0);
  colCenters[0] = Math.floor((boxWidths[0] as number) / 2) + 1;
  for (let i = 1; i < n; i++) {
    colCenters[i] = (colCenters[i - 1] as number) + (gapMins[i - 1] as number);
  }

  let maxRight = (colCenters[n - 1] as number) + Math.floor((boxWidths[n - 1] as number) / 2) + 2;
  flatEvents.forEach((event, eventIndex) => {
    if (event.type === "message" && event.source === event.target) {
      const si = participantIndex(diagram, event.source);
      if (si >= 0) {
        const loopWidth = selfLoopWidth(labels.events[eventIndex] ?? []);
        maxRight = Math.max(maxRight, (colCenters[si] as number) + loopWidth + 1);
      }
    } else if (event.type === "note") {
      const nb = noteBounds(event, labels.events[eventIndex] ?? [], colCenters, diagram);
      if (nb !== null) {
        const [noteLeft, noteRight] = nb;
        const noteWidth = noteRight - noteLeft + 1;
        maxRight = Math.max(maxRight, Math.max(0, noteLeft) + noteWidth + 1);
      }
    }
  });

  const rawBlockBounds = computeBlockBounds(diagram, flatEvents, colCenters, labels, wrapScopeLabels);
  let minRawLeft = 0;
  for (const [left] of rawBlockBounds.values()) {
    minRawLeft = Math.min(minRawLeft, left);
  }
  const leftShift = Math.max(0, -minRawLeft);
  const shiftedCenters = colCenters.map((c) => c + leftShift);
  const blockBounds = new Map<Block, [number, number]>();
  let framedRight = 0;
  for (const [block, [left, right]] of rawBlockBounds) {
    const shifted: [number, number] = [left + leftShift, right + leftShift];
    blockBounds.set(block, shifted);
    framedRight = Math.max(framedRight, shifted[1] + 1);
  }

  const lifelineStart = TOP_MARGIN + headerHeight;
  const rowOffsets: number[] = [];
  let cumulative = lifelineStart + 1;
  flatEvents.forEach((ev, idx) => {
    rowOffsets.push(cumulative);
    const lines = labels.events[idx] ?? [];
    if (ev.type === "activate") return;
    if (ev.type === "destroy") {
      cumulative += EVENT_ROW_H;
    } else if (ev.type === "note") {
      cumulative += lines.length + 2 + 1;
    } else if (ev.type === "blockStart") {
      cumulative += BLOCK_START_H + extraRows(labels.blockTitles.get(ev.block) ?? []);
    } else if (ev.type === "blockSection") {
      cumulative += BLOCK_SECTION_H + extraRows(labels.sections.get(ev.section) ?? []);
    } else if (ev.type === "blockEnd") {
      cumulative += BLOCK_END_H;
    } else if (ev.type === "message") {
      const loopRows = ev.source === ev.target ? 1 : 0;
      cumulative += EVENT_ROW_H + loopRows + extraRows(lines);
    }
  });

  const canvasWidth = Math.max(maxRight + leftShift, framedRight);
  const canvasHeight = cumulative + BOTTOM_MARGIN;

  return {
    colCenters: shiftedCenters,
    boxWidths,
    width: canvasWidth,
    height: canvasHeight,
    headerHeight,
    rowOffsets,
    blockBounds,
  };
}

function putCenteredLines(canvas: Canvas, startRow: number, cx: number, lines: readonly string[]): void {
  lines.forEach((line, offset) => {
    canvas.putText(startRow + offset, cx - Math.floor(displayWidth(line) / 2), line, STYLE_LABEL);
  });
}

function drawActor(canvas: Canvas, cx: number, y: number, lines: readonly string[]): void {
  canvas.put(y, cx, "O", false, STYLE_NODE);
  canvas.put(y + 1, cx - 1, "/", false, STYLE_NODE);
  canvas.put(y + 1, cx, "|", false, STYLE_NODE);
  canvas.put(y + 1, cx + 1, "\\", false, STYLE_NODE);
  canvas.put(y + 2, cx - 1, "/", false, STYLE_NODE);
  canvas.put(y + 2, cx + 1, "\\", false, STYLE_NODE);
  putCenteredLines(canvas, y + 4, cx, lines);
}

function drawDatabase(
  canvas: Canvas,
  cx: number,
  y: number,
  width: number,
  h: number,
  lines: readonly string[],
  cs: CharSet
): void {
  const bx = cx - Math.floor(width / 2);
  drawCylinder(canvas, bx, y, width, h, lines.join("\n"), cs, STYLE_NODE);
}

function drawQueue(
  canvas: Canvas,
  cx: number,
  y: number,
  width: number,
  h: number,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const bx = cx - Math.floor(width / 2);
  canvas.put(y, bx, cs.topLeft, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) canvas.put(y, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, bx + width - 1, !useAscii ? cs.roundTopRight : cs.topRight, true, STYLE_NODE);

  canvas.put(y + h - 1, bx, cs.bottomLeft, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) canvas.put(y + h - 1, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + h - 1, bx + width - 1, !useAscii ? cs.roundBottomRight : cs.bottomRight, true, STYLE_NODE);

  for (let r = y + 1; r < y + h - 1; r++) {
    canvas.put(r, bx, cs.vertical, true, STYLE_NODE);
    if (!useAscii) canvas.put(r, bx + width - 1, "║", false, STYLE_NODE);
    else canvas.put(r, bx + width - 1, cs.vertical, true, STYLE_NODE);
  }

  putCenteredLines(canvas, y + Math.floor((h - lines.length) / 2), cx, lines);
}

function drawBoundary(
  canvas: Canvas,
  cx: number,
  y: number,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const boxLeft = cx - 1;
  const boxRight = cx + 1;

  canvas.put(y, boxLeft, cs.topLeft, true, STYLE_NODE);
  canvas.put(y, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, boxRight, cs.topRight, true, STYLE_NODE);

  const barStart = cx - 3;
  canvas.put(y + 1, barStart, cs.horizontal, false, STYLE_NODE);
  canvas.put(y + 1, barStart + 1, cs.horizontal, false, STYLE_NODE);
  canvas.put(y + 1, boxLeft, !useAscii ? cs.teeLeft : cs.vertical, true, STYLE_NODE);
  canvas.put(y + 1, boxRight, cs.vertical, true, STYLE_NODE);

  canvas.put(y + 2, boxLeft, cs.bottomLeft, true, STYLE_NODE);
  canvas.put(y + 2, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 2, boxRight, cs.bottomRight, true, STYLE_NODE);

  putCenteredLines(canvas, y + 4, cx, lines);
}

function drawControl(
  canvas: Canvas,
  cx: number,
  y: number,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  canvas.put(y, cx, useAscii ? "<" : "◁", false, STYLE_NODE);

  canvas.put(y + 1, cx - 1, !useAscii ? cs.roundTopLeft : cs.topLeft, true, STYLE_NODE);
  canvas.put(y + 1, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 1, cx + 1, !useAscii ? cs.roundTopRight : cs.topRight, true, STYLE_NODE);
  canvas.put(y + 2, cx - 1, !useAscii ? cs.roundBottomLeft : cs.bottomLeft, true, STYLE_NODE);
  canvas.put(y + 2, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 2, cx + 1, !useAscii ? cs.roundBottomRight : cs.bottomRight, true, STYLE_NODE);

  putCenteredLines(canvas, y + 4, cx, lines);
}

function drawEntity(
  canvas: Canvas,
  cx: number,
  y: number,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  canvas.put(y, cx - 1, !useAscii ? cs.roundTopLeft : cs.topLeft, true, STYLE_NODE);
  canvas.put(y, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, cx + 1, !useAscii ? cs.roundTopRight : cs.topRight, true, STYLE_NODE);
  canvas.put(y + 1, cx - 1, !useAscii ? cs.roundBottomLeft : cs.bottomLeft, true, STYLE_NODE);
  canvas.put(y + 1, cx, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 1, cx + 1, !useAscii ? cs.roundBottomRight : cs.bottomRight, true, STYLE_NODE);

  canvas.put(y + 2, cx - 1, cs.horizontal, false, STYLE_NODE);
  canvas.put(y + 2, cx, cs.horizontal, false, STYLE_NODE);
  canvas.put(y + 2, cx + 1, cs.horizontal, false, STYLE_NODE);

  putCenteredLines(canvas, y + 4, cx, lines);
}

function drawCollections(
  canvas: Canvas,
  cx: number,
  y: number,
  width: number,
  h: number,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const bx = cx - Math.floor(width / 2);

  for (let c = bx + 2; c <= bx + width; c++) canvas.put(y, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, bx + 1, cs.topLeft, true, STYLE_NODE);
  canvas.put(y, bx + width, cs.topRight, true, STYLE_NODE);
  canvas.put(y + 1, bx + width, cs.vertical, true, STYLE_NODE);

  canvas.put(y + 1, bx, cs.topLeft, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) canvas.put(y + 1, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + 1, bx + width - 1, cs.topRight, true, STYLE_NODE);

  canvas.put(y + 2, bx + width, cs.bottomRight, true, STYLE_NODE);

  for (let r = y + 2; r < y + h - 1; r++) {
    canvas.put(r, bx, cs.vertical, true, STYLE_NODE);
    canvas.put(r, bx + width - 1, cs.vertical, true, STYLE_NODE);
  }

  canvas.put(y + 2, bx + width - 1, !useAscii ? cs.teeLeft : cs.vertical, true, STYLE_NODE);
  canvas.put(y + 2, bx + width, cs.bottomRight, true, STYLE_NODE);

  canvas.put(y + h - 1, bx, cs.bottomLeft, true, STYLE_NODE);
  for (let c = bx + 1; c < bx + width - 1; c++) canvas.put(y + h - 1, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + h - 1, bx + width - 1, cs.bottomRight, true, STYLE_NODE);

  putCenteredLines(canvas, y + 2 + Math.floor((h - 2 - lines.length) / 2), cx, lines);
}

function drawParticipantHeader(
  canvas: Canvas,
  cx: number,
  bw: number,
  headerHeight: number,
  participant: Participant,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const h = participantHeight(participant, lines);
  const y = TOP_MARGIN + (headerHeight - h);
  switch (participant.kind) {
    case "actor":
      drawActor(canvas, cx, y, lines);
      break;
    case "database":
      drawDatabase(canvas, cx, y, bw, h, lines, cs);
      break;
    case "queue":
      drawQueue(canvas, cx, y, bw, h, lines, cs, useAscii);
      break;
    case "boundary":
      drawBoundary(canvas, cx, y, lines, cs, useAscii);
      break;
    case "control":
      drawControl(canvas, cx, y, lines, cs, useAscii);
      break;
    case "entity":
      drawEntity(canvas, cx, y, lines, cs, useAscii);
      break;
    case "collections":
      drawCollections(canvas, cx, y, bw, h, lines, cs, useAscii);
      break;
    default: {
      const bx = cx - Math.floor(bw / 2);
      drawRectangle(canvas, bx, y, bw, h, lines.join("\n"), cs, STYLE_NODE);
      break;
    }
  }
}

function computeActivationRanges(
  flatEvents: readonly FlatEvent[],
  rowOffsets: readonly number[]
): Map<string, Array<[number, number]>> {
  const openActivations = new Map<string, number[]>();
  const ranges = new Map<string, Array<[number, number]>>();

  flatEvents.forEach((ev, idx) => {
    if (ev.type !== "activate") return;
    const row = rowOffsets[idx] as number;
    const pid = ev.participant;
    if (ev.active) {
      let stack = openActivations.get(pid);
      if (stack === undefined) {
        stack = [];
        openActivations.set(pid, stack);
      }
      stack.push(row);
    } else {
      const stack = openActivations.get(pid);
      if (stack !== undefined && stack.length > 0) {
        const start = stack.pop() as number;
        let list = ranges.get(pid);
        if (list === undefined) {
          list = [];
          ranges.set(pid, list);
        }
        list.push([start, row]);
      }
    }
  });

  const maxRow = rowOffsets.length > 0 ? Math.max(...rowOffsets) + 1 : 0;
  for (const [pid, starts] of openActivations) {
    for (const start of starts) {
      let list = ranges.get(pid);
      if (list === undefined) {
        list = [];
        ranges.set(pid, list);
      }
      list.push([start, maxRow]);
    }
  }

  return ranges;
}

function isActivated(ranges: ReadonlyMap<string, ReadonlyArray<readonly [number, number]>>, pid: string, row: number): boolean {
  for (const [start, end] of ranges.get(pid) ?? []) {
    if (start <= row && row <= end) return true;
  }
  return false;
}

function clearFrameRow(canvas: Canvas, row: number, frameBounds: readonly [number, number], cs: CharSet): void {
  const [left, right] = frameBounds;
  canvas.put(row, left, cs.vertical, false, STYLE_NODE);
  const stop = Math.min(right, canvas.width);
  for (let c = left + 1; c < stop; c++) canvas.blank(row, c);
  if (right < canvas.width) canvas.put(row, right, cs.vertical, false, STYLE_NODE);
}

function drawBlockStart(
  canvas: Canvas,
  row: number,
  frameBounds: readonly [number, number],
  titleLines: readonly string[],
  cs: CharSet
): void {
  const [left, right] = frameBounds;
  canvas.put(row, left, cs.topLeft, false, STYLE_NODE);
  const stop = Math.min(right, canvas.width);
  for (let c = left + 1; c < stop; c++) canvas.put(row, c, cs.horizontal, false, STYLE_NODE);
  if (right < canvas.width) canvas.put(row, right, cs.topRight, false, STYLE_NODE);

  for (let i = 0; i < titleLines.length; i++) {
    const offset = i + 1;
    if (row + offset >= canvas.height) break;
    clearFrameRow(canvas, row + offset, frameBounds, cs);
    canvas.putText(row + offset, left + 1, titleLines[i] as string, STYLE_EDGE_LABEL);
  }
}

function drawBlockSection(
  canvas: Canvas,
  row: number,
  frameBounds: readonly [number, number],
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const [left, right] = frameBounds;
  const dash = useAscii ? "." : "┄";
  canvas.put(row, left, cs.vertical, false, STYLE_NODE);
  const stop = Math.min(right, canvas.width);
  for (let c = left + 1; c < stop; c++) canvas.put(row, c, dash, false, STYLE_NODE);
  if (right < canvas.width) canvas.put(row, right, cs.vertical, false, STYLE_NODE);

  lines.forEach((line, offset) => {
    if (offset > 0) clearFrameRow(canvas, row + offset, frameBounds, cs);
    canvas.putText(row + offset, left + 2, line, STYLE_EDGE_LABEL, true);
  });
}

function drawBlockEnd(
  canvas: Canvas,
  row: number,
  frameBounds: readonly [number, number],
  cs: CharSet
): void {
  const [left, right] = frameBounds;
  canvas.put(row, left, cs.bottomLeft, false, STYLE_NODE);
  const stop = Math.min(right, canvas.width);
  for (let c = left + 1; c < stop; c++) canvas.put(row, c, cs.horizontal, false, STYLE_NODE);
  if (right < canvas.width) canvas.put(row, right, cs.bottomRight, false, STYLE_NODE);
}

function drawNote(
  canvas: Canvas,
  note: Note,
  lines: readonly string[],
  row: number,
  colCenters: readonly number[],
  diagram: SequenceDiagram,
  cs: CharSet
): void {
  const noteHeight = lines.length + 2;
  const nb = noteBounds(note, lines, colCenters, diagram);
  if (nb === null) return;
  const [rawLeft, rawRight] = nb;
  const noteX = Math.max(0, rawLeft);
  const noteWidth = rawRight - rawLeft + 1;

  for (let r = row; r < row + noteHeight; r++) {
    for (let c = noteX; c < noteX + noteWidth; c++) {
      canvas.clearChar(r, c);
    }
  }

  drawRectangle(canvas, noteX, row, noteWidth, noteHeight, lines.join("\n"), cs, STYLE_NODE);
}

function putLabelAbove(canvas: Canvas, row: number, col: number, lines: readonly string[]): void {
  lines.forEach((line, offset) => {
    canvas.putText(row - lines.length + offset, col, line, STYLE_EDGE_LABEL, true);
  });
}

function drawMessage(
  canvas: Canvas,
  srcCol: number,
  tgtCol: number,
  row: number,
  msg: Message,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const left = Math.min(srcCol, tgtCol);
  const right = Math.max(srcCol, tgtCol);
  const goingRight = tgtCol > srcCol;
  const hChar = msg.lineType === "dotted" ? (useAscii ? "." : "┄") : useAscii ? "-" : "─";

  for (let c = left + 1; c < right; c++) canvas.put(row, c, hChar, false, STYLE_EDGE);

  if (msg.arrowType === "bidirectional") {
    canvas.put(row, left, cs.arrowLeft, false, STYLE_ARROW);
    canvas.put(row, right, cs.arrowRight, false, STYLE_ARROW);
  } else if (msg.arrowType === "arrow") {
    if (goingRight) {
      canvas.put(row, right, cs.arrowRight, false, STYLE_ARROW);
      canvas.put(row, left, hChar, false, STYLE_EDGE);
    } else {
      canvas.put(row, left, cs.arrowLeft, false, STYLE_ARROW);
      canvas.put(row, right, hChar, false, STYLE_EDGE);
    }
  } else if (msg.arrowType === "cross") {
    if (goingRight) {
      canvas.put(row, right, "x", false, STYLE_ARROW);
      canvas.put(row, left, hChar, false, STYLE_EDGE);
    } else {
      canvas.put(row, left, "x", false, STYLE_ARROW);
      canvas.put(row, right, hChar, false, STYLE_EDGE);
    }
  } else if (msg.arrowType === "async") {
    if (goingRight) {
      canvas.put(row, right, ")", false, STYLE_ARROW);
      canvas.put(row, left, hChar, false, STYLE_EDGE);
    } else {
      canvas.put(row, left, "(", false, STYLE_ARROW);
      canvas.put(row, right, hChar, false, STYLE_EDGE);
    }
  } else {
    canvas.put(row, left, hChar, false, STYLE_EDGE);
    canvas.put(row, right, hChar, false, STYLE_EDGE);
  }

  putLabelAbove(canvas, row, left + 2, lines);
}

function drawSelfMessage(
  canvas: Canvas,
  col: number,
  row: number,
  msg: Message,
  lines: readonly string[],
  cs: CharSet,
  useAscii: boolean
): void {
  const loopWidth = selfLoopWidth(lines);
  const hChar = msg.lineType === "dotted" ? (useAscii ? "." : "┄") : useAscii ? "-" : "─";
  const vChar = msg.lineType === "dotted" ? (useAscii ? ":" : "┆") : useAscii ? "|" : "│";

  for (let c = col + 1; c < col + loopWidth; c++) canvas.put(row, c, hChar, false, STYLE_EDGE);

  const rightCol = col + loopWidth - 1;
  canvas.put(row + 1, rightCol, vChar, false, STYLE_EDGE);

  for (let c = col + 1; c < col + loopWidth; c++) canvas.put(row + 1, c, hChar, false, STYLE_EDGE);

  if (msg.arrowType === "arrow") {
    canvas.put(row + 1, col, cs.arrowLeft, false, STYLE_ARROW);
  } else if (msg.arrowType === "cross") {
    canvas.put(row + 1, col, "x", false, STYLE_ARROW);
  } else if (msg.arrowType === "async") {
    canvas.put(row + 1, col, "(", false, STYLE_ARROW);
  } else {
    canvas.put(row + 1, col, hChar, false, STYLE_EDGE);
  }

  if (!useAscii) {
    canvas.put(row, rightCol, "┐", false, STYLE_EDGE);
    canvas.put(row + 1, rightCol, "┘", false, STYLE_EDGE);
  } else {
    canvas.put(row, rightCol, "+", false, STYLE_EDGE);
    canvas.put(row + 1, rightCol, "+", false, STYLE_EDGE);
  }

  putLabelAbove(canvas, row, col + 2, lines);
}

export function renderSequence(
  diagram: SequenceDiagram,
  useAscii = false,
  paddingX = BOX_PAD,
  gap = MIN_GAP,
  cs: CharSet | null = null,
  maxLabelWidth: number | null = null
): Canvas {
  const charset = cs ?? defaultCharset(useAscii);
  const flatEvents = flattenEvents(diagram.events);
  const labels = collectLabels(diagram, flatEvents, maxLabelWidth);

  const layout = computeLayout(diagram, flatEvents, labels, paddingX, gap, maxLabelWidth !== null);
  if (layout.width === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const { colCenters, boxWidths, width, height, headerHeight, rowOffsets, blockBounds } = layout;
  const canvas = new Canvas(width, height);
  const activationRanges = computeActivationRanges(flatEvents, rowOffsets);

  diagram.participants.forEach((p, i) => {
    drawParticipantHeader(
      canvas,
      colCenters[i] as number,
      boxWidths[i] as number,
      headerHeight,
      p,
      labels.participants[i] ?? [],
      charset,
      useAscii
    );
  });

  const destroyed = new Map<string, number>();
  flatEvents.forEach((ev, idx) => {
    if (ev.type === "destroy" && !destroyed.has(ev.participant)) {
      destroyed.set(ev.participant, rowOffsets[idx] as number);
    }
  });

  const lifelineStart = TOP_MARGIN + headerHeight;
  const lifelineEnd = height - BOTTOM_MARGIN - 1;
  const lifelineChar = useAscii ? ":" : "┆";
  const activeChar = useAscii ? "[" : "║";
  diagram.participants.forEach((p, i) => {
    const cx = colCenters[i] as number;
    const endRow = Math.min(destroyed.get(p.id) ?? lifelineEnd + 1, lifelineEnd + 1);
    for (let r = lifelineStart; r < endRow; r++) {
      const ch = isActivated(activationRanges, p.id, r) ? activeChar : lifelineChar;
      canvas.put(r, cx, ch, false, STYLE_EDGE);
    }
  });

  const blockBorderStack: Array<[number, number, number]> = [];
  flatEvents.forEach((ev, idx) => {
    const row = rowOffsets[idx] as number;
    if (ev.type === "blockStart") {
      const [left, right] = blockBounds.get(ev.block) as [number, number];
      blockBorderStack.push([left, right, row]);
    } else if (ev.type === "blockEnd") {
      const entry = blockBorderStack.pop();
      if (entry !== undefined) {
        const [left, right, startRow] = entry;
        for (let r = startRow + 1; r < row; r++) {
          canvas.put(r, left, charset.vertical, false, STYLE_NODE);
          if (right < canvas.width) canvas.put(r, right, charset.vertical, false, STYLE_NODE);
        }
      }
    }
  });

  flatEvents.forEach((ev, idx) => {
    const row = rowOffsets[idx] as number;
    const lines = labels.events[idx] ?? [];
    if (ev.type === "activate") return;

    if (ev.type === "destroy") {
      const pi = participantIndex(diagram, ev.participant);
      if (pi >= 0) {
        canvas.put(row, colCenters[pi] as number, useAscii ? "X" : "╳", false, STYLE_ARROW);
      }
      return;
    }

    if (ev.type === "note") {
      drawNote(canvas, ev, lines, row, colCenters, diagram, charset);
      return;
    }

    if (ev.type === "blockStart") {
      drawBlockStart(
        canvas,
        row,
        blockBounds.get(ev.block) as [number, number],
        labels.blockTitles.get(ev.block) ?? [],
        charset
      );
      return;
    }

    if (ev.type === "blockSection") {
      drawBlockSection(
        canvas,
        row,
        blockBounds.get(ev.block) as [number, number],
        labels.sections.get(ev.section) ?? [],
        charset,
        useAscii
      );
      return;
    }

    if (ev.type === "blockEnd") {
      drawBlockEnd(canvas, row, blockBounds.get(ev.block) as [number, number], charset);
      return;
    }

    if (ev.type === "message") {
      const si = participantIndex(diagram, ev.source);
      const ti = participantIndex(diagram, ev.target);
      if (si < 0 || ti < 0) return;

      const arrowRow = row + extraRows(lines);
      if (si === ti) {
        drawSelfMessage(canvas, colCenters[si] as number, arrowRow, ev, lines, charset, useAscii);
      } else {
        drawMessage(
          canvas,
          colCenters[si] as number,
          colCenters[ti] as number,
          arrowRow,
          ev,
          lines,
          charset,
          useAscii
        );
      }
    }
  });

  return canvas;
}
