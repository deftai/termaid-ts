// Ported from src/termaid/renderer/classdiagram.py.
//
// Renders a ClassDiagram directly to a Canvas using layered layout.

import {
  DASHED,
  type ClassDef,
  type ClassDiagram,
  type Member,
  type Note,
  type Relationship,
} from "../model/classdiagram.ts";
import { pyCompare } from "../pycompat.ts";
import { displayWidth } from "../utils.ts";
import { Canvas } from "./canvas.ts";
import { defaultCharset, type CharSet } from "./charset.ts";
import { assignTracks } from "./relation_tracks.ts";

const CLASS_PAD = 2;
const MIN_BOX_WIDTH = 16;
const SIBLING_GAP = 4;
const MARGIN = 2;
const EMPTY_SIZE = 1;

const STYLE_NODE = "node";
const STYLE_LABEL = "label";
const STYLE_EDGE = "edge";
const STYLE_EDGE_LABEL = "edge_label";
const STYLE_ARROW = "arrow";
const STYLE_NOTE = "note";

const LR = "LR";
const ANNOTATION_OPEN = "«";
const ANNOTATION_CLOSE = "»";
const NOTE_BREAK = "\\n";

type Heading = "up" | "down" | "left" | "right";
type Phase = "all" | "lines" | "text";

function pairKey(a: string, b: string): string {
  return pyCompare(a, b) <= 0 ? `${a}\0${b}` : `${b}\0${a}`;
}

function formatMember(member: Member): string {
  const parts: string[] = [];
  if (member.visibility !== "") parts.push(member.visibility);
  if (member.returnType !== "" && !member.isMethod) parts.push(`${member.returnType} `);
  parts.push(member.name);
  if (member.isMethod && member.returnType !== "") parts.push(` ${member.returnType}`);
  if (member.classifier !== "") parts.push(member.classifier);
  return parts.join("");
}

function computeBoxSize(cls: ClassDef, paddingX = CLASS_PAD): [number, number] {
  const lines: string[] = [];
  if (cls.annotation !== "") lines.push(`${ANNOTATION_OPEN}${cls.annotation}${ANNOTATION_CLOSE}`);
  lines.push(cls.name);

  const attributes = cls.members.filter((m) => !m.isMethod);
  const methods = cls.members.filter((m) => m.isMethod);
  const memberLines = [...attributes.map(formatMember), ...methods.map(formatMember)];
  const allLines = [...lines, ...memberLines];

  const maxText = allLines.length > 0 ? Math.max(...allLines.map(displayWidth)) : 0;
  const width = Math.max(maxText + paddingX * 2, MIN_BOX_WIDTH);

  let height = 2 + lines.length;
  const hasAttrs = attributes.length > 0;
  const hasMethods = methods.length > 0;
  if (hasAttrs || hasMethods) {
    height += 1 + attributes.length;
    if (hasAttrs && hasMethods) height += 1;
    height += methods.length;
  }
  return [width, height];
}

function drawClassBox(
  canvas: Canvas,
  x: number,
  y: number,
  cls: ClassDef,
  cs: CharSet,
  paddingX = CLASS_PAD
): [number, number] {
  const [width, height] = computeBoxSize(cls, paddingX);

  canvas.put(y, x, cs.topLeft, true, STYLE_NODE);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y, x + width - 1, cs.topRight, true, STYLE_NODE);

  canvas.put(y + height - 1, x, cs.bottomLeft, true, STYLE_NODE);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y + height - 1, c, cs.horizontal, true, STYLE_NODE);
  canvas.put(y + height - 1, x + width - 1, cs.bottomRight, true, STYLE_NODE);

  for (let r = y + 1; r < y + height - 1; r++) {
    canvas.put(r, x, cs.vertical, true, STYLE_NODE);
    canvas.put(r, x + width - 1, cs.vertical, true, STYLE_NODE);
  }

  let row = y + 1;
  if (cls.annotation !== "") {
    const annText = `${ANNOTATION_OPEN}${cls.annotation}${ANNOTATION_CLOSE}`;
    const annCol = x + Math.floor((width - displayWidth(annText)) / 2);
    canvas.putText(row, annCol, annText, STYLE_LABEL);
    row += 1;
  }

  const nameCol = x + Math.floor((width - displayWidth(cls.name)) / 2);
  canvas.putText(row, nameCol, cls.name, STYLE_LABEL);
  row += 1;

  const attributes = cls.members.filter((m) => !m.isMethod);
  const methods = cls.members.filter((m) => m.isMethod);
  const hasAttrs = attributes.length > 0;
  const hasMethods = methods.length > 0;

  if (hasAttrs || hasMethods) {
    canvas.put(row, x, cs.teeRight, true, STYLE_NODE);
    for (let c = x + 1; c < x + width - 1; c++) canvas.put(row, c, cs.horizontal, true, STYLE_NODE);
    canvas.put(row, x + width - 1, cs.teeLeft, true, STYLE_NODE);
    row += 1;

    for (const m of attributes) {
      canvas.putText(row, x + paddingX, formatMember(m), STYLE_LABEL);
      row += 1;
    }

    if (hasAttrs && hasMethods) {
      canvas.put(row, x, cs.teeRight, true, STYLE_NODE);
      for (let c = x + 1; c < x + width - 1; c++) canvas.put(row, c, cs.horizontal, true, STYLE_NODE);
      canvas.put(row, x + width - 1, cs.teeLeft, true, STYLE_NODE);
      row += 1;
    }

    for (const m of methods) {
      canvas.putText(row, x + paddingX, formatMember(m), STYLE_LABEL);
      row += 1;
    }
  }

  return [width, height];
}

function assignLayers(diagram: ClassDiagram): string[][] {
  const classNames = [...diagram.classes.keys()];
  if (classNames.length === 0) return [];

  const children = new Map<string, string[]>(classNames.map((n) => [n, []]));
  const hasParent = new Set<string>();

  for (const rel of diagram.relationships) {
    if (rel.sourceMarker === "<|" || rel.targetMarker === "|>") {
      const parent = rel.sourceMarker === "<|" ? rel.source : rel.target;
      const child = rel.sourceMarker === "<|" ? rel.target : rel.source;
      children.get(parent)?.push(child);
      hasParent.add(child);
    } else {
      children.get(rel.source)?.push(rel.target);
      hasParent.add(rel.target);
    }
  }

  let roots = classNames.filter((n) => !hasParent.has(n));
  if (roots.length === 0) roots = [classNames[0] as string];

  const assigned = new Set<string>(roots);
  const layers: string[][] = [];
  let queue: string[] = [...roots];

  while (queue.length > 0) {
    const layer = [...queue];
    layers.push(layer);
    const nextQueue: string[] = [];
    for (const node of layer) {
      for (const child of children.get(node) ?? []) {
        if (!assigned.has(child)) {
          assigned.add(child);
          nextQueue.push(child);
        }
      }
    }
    queue = nextQueue;
  }

  const disconnected = classNames.filter((n) => !assigned.has(n));
  if (disconnected.length > 0) layers.push(disconnected);

  return layers;
}

function computeExitOffsets(
  diagram: ClassDiagram,
  layerOf: ReadonlyMap<string, number>,
  end: "source" | "target" = "source"
): Map<number, number> {
  const groups = new Map<string, number[]>();
  diagram.relationships.forEach((rel, i) => {
    const sLayer = layerOf.get(rel.source) ?? -1;
    const tLayer = layerOf.get(rel.target) ?? -2;
    const side = sLayer === tLayer ? "side" : "bottom";
    const cls = end === "source" ? rel.source : rel.target;
    const key = `${cls}\0${side}`;
    let bucket = groups.get(key);
    if (bucket === undefined) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(i);
  });

  const offsets = new Map<number, number>();
  for (const indices of groups.values()) {
    if (indices.length <= 1) {
      for (const idx of indices) offsets.set(idx, 0);
      continue;
    }
    const n = indices.length;
    const widest = Math.max(
      ...indices.map((idx) => {
        const rel = diagram.relationships[idx] as Relationship;
        const card = end === "source" ? rel.sourceCard : rel.targetCard;
        return [...(card || "")].length;
      })
    );
    const spacing = Math.max(4, widest + 2);
    indices.forEach((idx, j) => {
      offsets.set(idx, (j - (n - 1) / 2) * spacing);
    });
  }
  return offsets;
}

function computeRowOffsets(diagram: ClassDiagram, layerOf: ReadonlyMap<string, number>): Map<number, number> {
  const groups = new Map<string, number[]>();
  diagram.relationships.forEach((rel, i) => {
    if ((layerOf.get(rel.source) ?? -1) !== (layerOf.get(rel.target) ?? -2)) return;
    const key = pairKey(rel.source, rel.target);
    let bucket = groups.get(key);
    if (bucket === undefined) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(i);
  });

  const offsets = new Map<number, number>();
  for (const indices of groups.values()) {
    const n = indices.length;
    indices.forEach((idx, j) => {
      offsets.set(idx, 2 * j - (n - 1));
    });
  }
  return offsets;
}

function assignGapTracks(
  diagram: ClassDiagram,
  layerOf: ReadonlyMap<string, number>,
  positions: ReadonlyMap<string, readonly [number, number]>,
  sizes: ReadonlyMap<string, readonly [number, number]>
): [Map<number, [number, number]>, Map<number, number>] {
  const exitOffsets = computeExitOffsets(diagram, layerOf, "source");
  const entryOffsets = computeExitOffsets(diagram, layerOf, "target");
  const intervals = new Map<number, Map<number, [number, number]>>();
  const hanging = new Map<number, boolean>();

  diagram.relationships.forEach((rel, i) => {
    const srcPos = positions.get(rel.source);
    const tgtPos = positions.get(rel.target);
    const srcSize = sizes.get(rel.source);
    const tgtSize = sizes.get(rel.target);
    if (srcPos === undefined || tgtPos === undefined || srcSize === undefined || tgtSize === undefined) return;
    const ls = layerOf.get(rel.source) ?? -1;
    const lt = layerOf.get(rel.target) ?? -2;
    if (Math.abs(ls - lt) !== 1) return;

    const startCol = srcPos[0] + Math.floor(srcSize[0] / 2) + Math.trunc(exitOffsets.get(i) ?? 0);
    const endCol = tgtPos[0] + Math.floor(tgtSize[0] / 2) + Math.trunc(entryOffsets.get(i) ?? 0);
    if (startCol === endCol) return;

    const boundary = Math.min(ls, lt);
    const left = Math.min(startCol, endCol);
    let right = Math.max(startCol, endCol);
    const labelWidth = rel.label !== "" ? displayWidth(rel.label) : 0;
    const isHanging = labelWidth > 0 && right - left - 2 < labelWidth;
    hanging.set(i, isHanging);
    if (isHanging) {
      right = Math.max(right, endCol + 2 + labelWidth);
    }
    let runs = intervals.get(boundary);
    if (runs === undefined) {
      runs = new Map();
      intervals.set(boundary, runs);
    }
    runs.set(i, [left, right]);
  });

  const rows = new Map<number, [number, number]>();
  const gapHeights = new Map<number, number>();
  for (const [boundary, runs] of intervals) {
    const tracks = assignTracks(runs);
    const maxTrack = Math.max(...tracks.values());
    const heights = Array.from({ length: maxTrack + 1 }, () => 1);
    for (const [index, track] of tracks) {
      if (hanging.get(index) === true) heights[track] = 2;
    }
    const offsets = [1];
    for (const h of heights) offsets.push((offsets[offsets.length - 1] as number) + h);
    for (const [index, track] of tracks) {
      rows.set(index, [boundary, offsets[track] as number]);
    }
    gapHeights.set(boundary, (offsets[offsets.length - 1] as number) - 1);
  }
  return [rows, gapHeights];
}

interface ClassLayout {
  positions: Map<string, [number, number]>;
  sizes: Map<string, [number, number]>;
  width: number;
  height: number;
  layerOf: Map<string, number>;
  runRows: Map<number, number>;
}

function computeLayout(diagram: ClassDiagram, paddingX = CLASS_PAD, gap = SIBLING_GAP): ClassLayout {
  const layers = assignLayers(diagram);
  if (layers.length === 0) {
    return {
      positions: new Map(),
      sizes: new Map(),
      width: 1,
      height: 1,
      layerOf: new Map(),
      runRows: new Map(),
    };
  }

  const sizes = new Map<string, [number, number]>();
  for (const [name, cls] of diagram.classes) {
    sizes.set(name, computeBoxSize(cls, paddingX));
  }

  const layerOf = new Map<string, number>();
  layers.forEach((layer, li) => {
    for (const name of layer) layerOf.set(name, li);
  });

  const pairGap = new Map<string, number>();
  for (const rel of diagram.relationships) {
    const s = rel.source;
    const t = rel.target;
    if (layerOf.has(s) && layerOf.has(t) && layerOf.get(s) === layerOf.get(t)) {
      const pairG = Math.max(rel.label !== "" ? displayWidth(rel.label) + 4 : gap, gap);
      const key = pairKey(s, t);
      pairGap.set(key, Math.max(pairGap.get(key) ?? gap, pairG));
    }
  }

  const isLr = diagram.direction === LR;
  const positions = new Map<string, [number, number]>();
  const runRows = new Map<number, number>();
  let canvasWidth = 1;
  let canvasHeight = 1;

  if (isLr) {
    let colX = MARGIN;
    let maxHeight = 0;
    for (const layer of layers) {
      const layerWidth = Math.max(...layer.map((n) => (sizes.get(n) as [number, number])[0]));
      let rowY = MARGIN;
      for (const name of layer) {
        const [w, h] = sizes.get(name) as [number, number];
        const xOffset = Math.floor((layerWidth - w) / 2);
        positions.set(name, [colX + xOffset, rowY]);
        rowY += h + gap;
      }
      const totalLayerHeight = rowY - gap + MARGIN;
      maxHeight = Math.max(maxHeight, totalLayerHeight);
      colX += layerWidth + gap;
    }
    canvasWidth = colX - gap + MARGIN;
    canvasHeight = maxHeight;

    for (const layer of layers) {
      const layerH =
        layer.reduce((sum, n) => sum + (sizes.get(n) as [number, number])[1], 0) + gap * (layer.length - 1);
      const offset = Math.floor((canvasHeight - 2 * MARGIN - layerH) / 2);
      if (offset > 0) {
        for (const name of layer) {
          const [x, y] = positions.get(name) as [number, number];
          positions.set(name, [x, y + offset]);
        }
      }
    }
  } else {
    const layerHeights: number[] = [];
    let maxWidth = 0;
    for (const layer of layers) {
      layerHeights.push(Math.max(...layer.map((n) => (sizes.get(n) as [number, number])[1])));
      let colX = MARGIN;
      layer.forEach((name, idx) => {
        const [w] = sizes.get(name) as [number, number];
        positions.set(name, [colX, 0]);
        if (idx < layer.length - 1) {
          const nextName = layer[idx + 1] as string;
          colX += w + (pairGap.get(pairKey(name, nextName)) ?? gap);
        } else {
          colX += w;
        }
      });
      maxWidth = Math.max(maxWidth, colX + MARGIN);
    }
    canvasWidth = maxWidth;

    for (const layer of layers) {
      const minX = Math.min(...layer.map((n) => (positions.get(n) as [number, number])[0]));
      const maxX = Math.max(
        ...layer.map((n) => (positions.get(n) as [number, number])[0] + (sizes.get(n) as [number, number])[0])
      );
      const offset = Math.floor((canvasWidth - 2 * MARGIN - (maxX - minX)) / 2);
      if (offset > 0) {
        for (const name of layer) {
          positions.set(name, [(positions.get(name) as [number, number])[0] + offset, 0]);
        }
      }
    }

    const [tracks, gapHeights] = assignGapTracks(diagram, layerOf, positions, sizes);
    const layerTops: number[] = [];
    let rowY = MARGIN;
    layers.forEach((layer, li) => {
      layerTops.push(rowY);
      const layerHeight = layerHeights[li] as number;
      for (const name of layer) {
        const [x] = positions.get(name) as [number, number];
        const [, h] = sizes.get(name) as [number, number];
        positions.set(name, [x, rowY + Math.floor((layerHeight - h) / 2)]);
      }
      rowY += layerHeight + Math.max(gap, (gapHeights.get(li) ?? 0) + 2);
    });
    canvasHeight = (layerTops[layerTops.length - 1] as number) + (layerHeights[layerHeights.length - 1] as number) + MARGIN;

    for (const [index, [boundary, offset]] of tracks) {
      runRows.set(index, (layerTops[boundary] as number) + (layerHeights[boundary] as number) + offset);
    }
  }

  return { positions, sizes, width: canvasWidth, height: canvasHeight, layerOf, runRows };
}

function drawRoutedLine(
  canvas: Canvas,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
  hChar: string,
  vChar: string,
  useAscii: boolean,
  style = STYLE_EDGE,
  midRow: number | null = null
): void {
  canvas.resize(Math.max(c1, c2) + 1, canvas.height);
  if (c1 === c2) {
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) canvas.put(r, c1, vChar, true, style);
  } else if (r1 === r2) {
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) canvas.put(r1, c, hChar, true, style);
  } else {
    const mid = midRow ?? Math.floor((r1 + r2) / 2);
    for (let r = Math.min(r1, mid); r <= Math.max(r1, mid); r++) canvas.put(r, c1, vChar, true, style);
    for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) canvas.put(mid, c, hChar, true, style);
    for (let r = Math.min(mid, r2); r <= Math.max(mid, r2); r++) canvas.put(r, c2, vChar, true, style);

    if (!useAscii) {
      const corner1 = r1 < mid ? (c2 < c1 ? "┘" : "└") : c2 < c1 ? "┐" : "┌";
      canvas.put(mid, c1, corner1, false, style);
      const corner2 = r2 > mid ? (c2 < c1 ? "┌" : "┐") : c2 < c1 ? "└" : "┘";
      canvas.put(mid, c2, corner2, false, style);
    }
  }
}

function markerChar(marker: string, direction: Heading, cs: CharSet): string {
  if (marker === "|>" || marker === "<|") {
    if (direction === "down") return cs.inheritDown;
    if (direction === "up") return cs.inheritUp;
    if (direction === "right") return cs.inheritRight;
    return cs.inheritLeft;
  }
  if (marker === ">" || marker === "<") {
    if (direction === "down") return cs.dependencyDown;
    if (direction === "up") return cs.dependencyUp;
    if (direction === "right") return cs.dependencyRight;
    return cs.dependencyLeft;
  }
  if (marker === "*") return "◆";
  if (marker === "o") return "◇";
  return "";
}

function drawRelationship(
  canvas: Canvas,
  rel: Relationship,
  positions: ReadonlyMap<string, readonly [number, number]>,
  sizes: ReadonlyMap<string, readonly [number, number]>,
  layerOf: ReadonlyMap<string, number>,
  cs: CharSet,
  useAscii: boolean,
  srcColOffset = 0,
  tgtColOffset = 0,
  isLr = false,
  rowOffset = 0,
  phase: Phase = "all",
  runRow: number | null = null
): void {
  const sPos = positions.get(rel.source);
  const tPos = positions.get(rel.target);
  const sSize = sizes.get(rel.source);
  const tSize = sizes.get(rel.target);
  if (sPos === undefined || tPos === undefined || sSize === undefined || tSize === undefined) return;

  const [sx, sy] = sPos;
  const [sw, sh] = sSize;
  const [tx, ty] = tPos;
  const [tw, th] = tSize;

  const sCx = sx + Math.floor(sw / 2);
  const sCy = sy + Math.floor(sh / 2);
  const tCx = tx + Math.floor(tw / 2);
  const tCy = ty + Math.floor(th / 2);
  const dx = tCx - sCx;
  const dy = tCy - sCy;

  const sLayer = layerOf.get(rel.source) ?? -1;
  const tLayer = layerOf.get(rel.target) ?? -2;
  const sameLayer = sLayer === tLayer;
  const useHorizontal = isLr ? !sameLayer : sameLayer;

  let startCol: number;
  let endCol: number;
  let startRow: number;
  let endRow: number;
  let srcDir: Heading;
  let tgtDir: Heading;

  if (!useHorizontal) {
    startCol = sCx + srcColOffset;
    endCol = tCx + tgtColOffset;
    if (dy > 0) {
      startRow = sy + sh;
      endRow = ty - 1;
      srcDir = "up";
      tgtDir = "down";
    } else {
      startRow = sy - 1;
      endRow = ty + th;
      srcDir = "down";
      tgtDir = "up";
    }
  } else {
    if (dx > 0) {
      startCol = sx + sw;
      endCol = tx - 1;
      srcDir = "left";
      tgtDir = "right";
    } else {
      startCol = sx - 1;
      endCol = tx + tw;
      srcDir = "right";
      tgtDir = "left";
    }
    startRow = sCy;
    endRow = tCy;
    if (sameLayer) {
      const lo = Math.max(sy + 1, ty + 1);
      const hi = Math.min(sy + sh - 2, ty + th - 2);
      if (lo <= hi) {
        const row = Math.floor((sCy + tCy) / 2) + rowOffset;
        startRow = Math.min(Math.max(row, lo), hi);
        endRow = startRow;
      }
    }
  }

  const hChar = rel.lineStyle === DASHED ? cs.lineDottedH : cs.lineHorizontal;
  const vChar = rel.lineStyle === DASHED ? cs.lineDottedV : cs.lineVertical;

  if (phase === "all" || phase === "lines") {
    drawRoutedLine(canvas, startRow, startCol, endRow, endCol, hChar, vChar, useAscii, STYLE_EDGE, runRow);
    if (!useAscii) {
      const srcMarkerCh = markerChar(rel.sourceMarker, srcDir, cs);
      const tgtMarkerCh = markerChar(rel.targetMarker, tgtDir, cs);
      if (srcMarkerCh !== "") canvas.put(startRow, startCol, srcMarkerCh, false, STYLE_ARROW);
      if (tgtMarkerCh !== "") canvas.put(endRow, endCol, tgtMarkerCh, false, STYLE_ARROW);
    } else {
      if (rel.sourceMarker === "<|" || rel.sourceMarker === "<") {
        canvas.put(startRow, startCol, "<", false, STYLE_ARROW);
      } else if (rel.sourceMarker === "*" || rel.sourceMarker === "o") {
        canvas.put(startRow, startCol, rel.sourceMarker, false, STYLE_ARROW);
      }
      if (rel.targetMarker === "|>" || rel.targetMarker === ">") {
        canvas.put(endRow, endCol, ">", false, STYLE_ARROW);
      } else if (rel.targetMarker === "*" || rel.targetMarker === "o") {
        canvas.put(endRow, endCol, rel.targetMarker, false, STYLE_ARROW);
      }
    }
  }
  if (phase === "lines") return;

  const leftCol = Math.min(startCol, endCol);
  const rightCol = Math.max(startCol, endCol);
  const midR = runRow ?? Math.floor((startRow + endRow) / 2);

  if (rel.label !== "") {
    const labelW = displayWidth(rel.label);
    if (startRow === endRow) {
      const midC = Math.floor((startCol + endCol) / 2);
      canvas.putText(midR - 1, midC - Math.floor(labelW / 2), rel.label, STYLE_EDGE_LABEL, false, true);
    } else if (startCol === endCol) {
      canvas.putText(midR, startCol + 2, rel.label, STYLE_EDGE_LABEL, false, true);
    } else if (useHorizontal) {
      canvas.putText(midR, Math.floor((startCol + endCol) / 2) + 2, rel.label, STYLE_EDGE_LABEL, false, true);
    } else if (rightCol - leftCol - 2 >= labelW) {
      canvas.putText(midR, leftCol + 2, rel.label, STYLE_EDGE_LABEL, false, true);
    } else {
      canvas.putText(midR + 1, endCol + 2, rel.label, STYLE_EDGE_LABEL, false, true);
    }
  }

  if (useHorizontal && startRow === endRow) {
    if (rel.sourceCard !== "") {
      const col = startCol < endCol ? startCol + 1 : startCol - displayWidth(rel.sourceCard);
      canvas.putText(startRow + 1, col, rel.sourceCard, STYLE_EDGE_LABEL, false, true);
    }
    if (rel.targetCard !== "") {
      const col = startCol < endCol ? endCol - displayWidth(rel.targetCard) : endCol + 1;
      canvas.putText(endRow + 1, col, rel.targetCard, STYLE_EDGE_LABEL, false, true);
    }
  } else {
    if (rel.sourceCard !== "") {
      canvas.putText(startRow, startCol + 1, rel.sourceCard, STYLE_EDGE_LABEL, false, true);
    }
    if (rel.targetCard !== "") {
      canvas.putText(endRow, endCol + 1, rel.targetCard, STYLE_EDGE_LABEL, false, true);
    }
  }
}

function noteLines(note: Note): string[] {
  return note.text.split(NOTE_BREAK);
}

function noteBoxSize(note: Note): [number, number] {
  const lines = noteLines(note);
  const maxLine = lines.length > 0 ? Math.max(...lines.map(displayWidth)) : 0;
  const width = Math.max(maxLine + 4, MIN_BOX_WIDTH);
  const height = lines.length + 2;
  return [width, height];
}

function drawNoteBox(canvas: Canvas, x: number, y: number, note: Note, cs: CharSet): void {
  const [width, height] = noteBoxSize(note);
  const lines = noteLines(note);

  canvas.put(y, x, cs.topLeft, true, STYLE_NOTE);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y, c, cs.horizontal, true, STYLE_NOTE);
  canvas.put(y, x + width - 1, cs.topRight, true, STYLE_NOTE);

  canvas.put(y + height - 1, x, cs.bottomLeft, true, STYLE_NOTE);
  for (let c = x + 1; c < x + width - 1; c++) canvas.put(y + height - 1, c, cs.horizontal, true, STYLE_NOTE);
  canvas.put(y + height - 1, x + width - 1, cs.bottomRight, true, STYLE_NOTE);

  for (let r = y + 1; r < y + height - 1; r++) {
    canvas.put(r, x, cs.vertical, true, STYLE_NOTE);
    canvas.put(r, x + width - 1, cs.vertical, true, STYLE_NOTE);
  }

  lines.forEach((line, li) => {
    canvas.putText(y + 1 + li, x + 2, line, STYLE_LABEL);
  });
}

function layoutNotes(
  diagram: ClassDiagram,
  positions: Map<string, [number, number]>,
  sizes: ReadonlyMap<string, readonly [number, number]>,
  gap = SIBLING_GAP
): { notes: Array<[number, number]>; positions: Map<string, [number, number]>; width: number; height: number } {
  if (diagram.notes.length === 0) {
    let maxW = 0;
    let maxH = 0;
    for (const [name, [x, y]] of positions) {
      const [w, h] = sizes.get(name) as [number, number];
      maxW = Math.max(maxW, x + w);
      maxH = Math.max(maxH, y + h);
    }
    return { notes: [], positions, width: maxW + MARGIN, height: maxH + MARGIN };
  }

  const targeted: Array<[number, Note]> = [];
  const floating: Array<[number, Note]> = [];
  diagram.notes.forEach((note, i) => {
    if (note.target !== "" && positions.has(note.target)) targeted.push([i, note]);
    else floating.push([i, note]);
  });

  const shiftY = floating.length > 0 ? Math.max(...floating.map(([, n]) => noteBoxSize(n)[1])) + 2 : 0;
  const shiftX = targeted.length > 0 ? Math.max(...targeted.map(([, n]) => noteBoxSize(n)[0])) + 2 : 0;

  const adjusted = new Map<string, [number, number]>();
  for (const [name, [x, y]] of positions) {
    adjusted.set(name, [x + shiftX, y + shiftY]);
  }

  const notePositions: Array<[number, number]> = Array.from({ length: diagram.notes.length }, () => [-1, -1]);

  let floatX = MARGIN;
  for (const [i, note] of floating) {
    const [nw] = noteBoxSize(note);
    notePositions[i] = [floatX, MARGIN];
    floatX += nw + gap;
  }

  for (const [i, note] of targeted) {
    const [nw] = noteBoxSize(note);
    const [tx, ty] = adjusted.get(note.target) as [number, number];
    const nx = Math.max(MARGIN, tx - nw - 2);
    notePositions[i] = [nx, ty];
  }

  let maxW = 0;
  let maxH = 0;
  for (const [name, [x, y]] of adjusted) {
    const [w, h] = sizes.get(name) as [number, number];
    maxW = Math.max(maxW, x + w);
    maxH = Math.max(maxH, y + h);
  }
  diagram.notes.forEach((note, i) => {
    const [nx, ny] = notePositions[i] as [number, number];
    const [nw, nh] = noteBoxSize(note);
    maxW = Math.max(maxW, nx + nw);
    maxH = Math.max(maxH, ny + nh);
  });

  return { notes: notePositions, positions: adjusted, width: maxW + MARGIN, height: maxH + MARGIN };
}

export function renderClassDiagram(
  diagram: ClassDiagram,
  useAscii = false,
  paddingX = CLASS_PAD,
  gap = SIBLING_GAP,
  cs: CharSet | null = null
): Canvas {
  const charset = cs ?? defaultCharset(useAscii);
  const layout = computeLayout(diagram, paddingX, gap);
  if (layout.width <= 1 && diagram.notes.length === 0) return new Canvas(EMPTY_SIZE, EMPTY_SIZE);

  const placed = layoutNotes(diagram, layout.positions, layout.sizes, gap);
  const positions = placed.positions;
  const width = placed.width;
  const height = placed.height;

  const exitOffsets = computeExitOffsets(diagram, layout.layerOf, "source");
  const entryOffsets = computeExitOffsets(diagram, layout.layerOf, "target");
  const rowOffsets = computeRowOffsets(diagram, layout.layerOf);
  const canvas = new Canvas(width, height);
  const isLr = diagram.direction === LR;

  for (const phase of ["lines", "text"] as const) {
    diagram.relationships.forEach((rel, i) => {
      const colOffset = Math.trunc(exitOffsets.get(i) ?? 0);
      const entryOffset = Math.trunc(entryOffsets.get(i) ?? 0);
      drawRelationship(
        canvas,
        rel,
        positions,
        layout.sizes,
        layout.layerOf,
        charset,
        useAscii,
        colOffset,
        entryOffset,
        isLr,
        rowOffsets.get(i) ?? 0,
        phase,
        layout.runRows.get(i) ?? null
      );
    });
  }

  for (const [name, cls] of diagram.classes) {
    const at = positions.get(name);
    if (at !== undefined) drawClassBox(canvas, at[0], at[1], cls, charset, paddingX);
  }

  diagram.notes.forEach((note, i) => {
    const at = placed.notes[i];
    if (at !== undefined) drawNoteBox(canvas, at[0], at[1], note, charset);
  });

  return canvas;
}
