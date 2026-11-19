// Ported from src/termaid/renderer/draw.py.
//
// Layout, routing and drawing brought together, back to front: subgraph boxes, node boxes, edge lines, corners,
// arrowheads, the tees where an edge leaves a border, edge labels, subgraph labels, notes.

import { ArrowType, Direction, EdgeStyle, type Graph } from "../graph/model.ts";
import { NodeShape } from "../graph/shapes.ts";
import { type GridLayout } from "../layout/grid.ts";
import { layoutAndRoute, type RoutedEdge } from "../routing/router.ts";
import { displayWidth, truncateToWidth } from "../utils.ts";
import { Canvas } from "./canvas.ts";
import { ARROW_STYLES, ASCII, UNICODE, defaultCharset, type CharSet } from "./charset.ts";
import { drawRectangle, SHAPE_RENDERERS } from "./shapes.ts";

/** Style keys the theme paints from. */
const STYLE_SUBGRAPH = "subgraph";
const STYLE_SUBGRAPH_LABEL = "subgraph_label";
const STYLE_NODE = "node";
const STYLE_EDGE = "edge";
const STYLE_ARROW = "arrow";
const STYLE_EDGE_LABEL = "edge_label";
/** What a cut label ends with, so a reader is never handed a truncation that looks like the whole word. */
const ELLIPSIS = "…";
const STYLE_LABEL = "label";
const STYLE_BOLD_LABEL = "bold_label";
const STYLE_ITALIC_LABEL = "italic_label";
const CLASS_DEFAULT = "default";
/** The index `linkStyle default` writes under. */
const DEFAULT_LINK_STYLE = -1;

/** Margin added around the measured layout, for a back edge routed past every node. */
const CANVAS_MARGIN = 4;
const CELL_MARGIN = 2;
/** How far a label may be pushed off its segment before the placement is given up. */
const LABEL_SEARCH = 4;
/** Minimum column gap between two labels sharing the same row. */
const LABEL_GAP = 3;
/** A label sits beside a vertical segment only where the segment is at least this long. */
const MIN_VERTICAL_SEGMENT = 2;

export interface RenderOptions {
  useAscii: boolean;
  paddingX: number;
  paddingY: number;
  roundedEdges: boolean;
  gap: number;
  inlineEdgeLabels: boolean;
  maxLabelWidth: number | null;
  cs: CharSet | null;
  divergences: boolean;
}

export const DEFAULT_RENDER: RenderOptions = {
  useAscii: false,
  paddingX: 4,
  paddingY: 2,
  roundedEdges: true,
  gap: 4,
  inlineEdgeLabels: false,
  maxLabelWidth: null,
  cs: null,
  divergences: false,
};

type Point = readonly [number, number];
/** A label already on the canvas: its row, and the columns `[colStart, colEnd)` it took. */
type PlacedLabel = readonly [number, number, number];

interface LabelRules {
  readonly mayCover: ReadonlySet<string> | null;
  readonly shareRows: boolean;
}

const sign = (n: number): number => (n === 0 ? 0 : n > 0 ? 1 : -1);

/** The whole graph drawn, or the empty string for a graph with no nodes at all. */
export function renderGraph(graph: Graph, options: Partial<RenderOptions> = {}): string {
  const canvas = renderGraphCanvas(graph, options);
  return canvas === null ? "" : canvas.toString();
}

/** The same drawing as a Canvas, which is what a theme or styled output needs. */
export function renderGraphCanvas(graph: Graph, options: Partial<RenderOptions> = {}): Canvas | null {
  const {
    useAscii,
    paddingX,
    paddingY,
    roundedEdges,
    gap,
    inlineEdgeLabels,
    maxLabelWidth,
    cs: givenCharset,
    divergences,
  } = { ...DEFAULT_RENDER, ...options };
  if (graph.nodeOrder.length === 0) return null;

  const cs = givenCharset ?? defaultCharset(useAscii);

  // A graph running up or leftwards is laid out the ordinary way and the finished canvas is flipped.
  const direction = graph.direction;
  const flipV = direction === Direction.BT;
  const flipH = direction === Direction.RL;
  if (flipV) graph.direction = Direction.TB;
  else if (flipH) graph.direction = Direction.LR;

  const [layout, routed] = layoutAndRoute(graph, paddingX, paddingY, gap, maxLabelWidth);

  let width = layout.canvasWidth + CANVAS_MARGIN;
  let height = layout.canvasHeight + CANVAS_MARGIN;
  for (const re of routed) {
    for (const [x, y] of re.drawPath) {
      width = Math.max(width, x + CELL_MARGIN);
      height = Math.max(height, y + CELL_MARGIN);
    }
  }
  const canvas = new Canvas(width, height);

  drawSubgraphBorders(canvas, layout, cs);
  drawNodes(canvas, graph, layout, cs);
  drawEdges(canvas, graph, routed, cs, roundedEdges, inlineEdgeLabels, divergences);
  drawSubgraphLabels(canvas, layout);
  drawNotes(canvas, graph, layout, cs);

  if (flipV) {
    canvas.flipVertical();
    graph.direction = Direction.BT;
  } else if (flipH) {
    canvas.flipHorizontal();
    graph.direction = Direction.RL;
  }
  return canvas;
}

function drawSubgraphBorders(canvas: Canvas, layout: GridLayout, cs: CharSet): void {
  for (const sb of layout.subgraphBounds) {
    const w = sb.width;
    const h = sb.height;
    if (w <= 0 || h <= 0) continue;
    const x = Math.max(0, sb.x);
    const y = Math.max(0, sb.y);

    canvas.put(y, x, cs.sgTopLeft, true, STYLE_SUBGRAPH);
    for (let c = x + 1; c < x + w - 1; c++) canvas.put(y, c, cs.sgHorizontal, true, STYLE_SUBGRAPH);
    canvas.put(y, x + w - 1, cs.sgTopRight, true, STYLE_SUBGRAPH);

    canvas.put(y + h - 1, x, cs.sgBottomLeft, true, STYLE_SUBGRAPH);
    for (let c = x + 1; c < x + w - 1; c++) canvas.put(y + h - 1, c, cs.sgHorizontal, true, STYLE_SUBGRAPH);
    canvas.put(y + h - 1, x + w - 1, cs.sgBottomRight, true, STYLE_SUBGRAPH);

    for (let r = y + 1; r < y + h - 1; r++) {
      canvas.put(r, x, cs.sgVertical, true, STYLE_SUBGRAPH);
      canvas.put(r, x + w - 1, cs.sgVertical, true, STYLE_SUBGRAPH);
    }
  }
}

function drawSubgraphLabels(canvas: Canvas, layout: GridLayout): void {
  for (const sb of layout.subgraphBounds) {
    if (sb.width <= 0 || sb.height <= 0) continue;
    const label = sb.subgraph.label;
    if (label === "") continue;
    canvas.putText(Math.max(0, sb.y) + 1, Math.max(0, sb.x) + 2, label, STYLE_SUBGRAPH_LABEL);
  }
}

function drawNodes(canvas: Canvas, graph: Graph, layout: GridLayout, cs: CharSet): void {
  for (const id of graph.nodeOrder) {
    const p = layout.placements.get(id);
    const node = graph.nodes.get(id);
    if (p === undefined || node === undefined) continue;

    // An inline style wins over a `:::class`, which wins over a `classDef default`.
    let style: string;
    if (graph.nodeStyles.has(id)) style = `nodestyle:${id}`;
    else if (node.styleClass !== null && graph.classDefs.has(node.styleClass)) style = `class:${node.styleClass}`;
    else if (graph.classDefs.has(CLASS_DEFAULT)) style = `class:${CLASS_DEFAULT}`;
    else style = STYLE_NODE;

    const renderer = SHAPE_RENDERERS.get(node.shape) ?? SHAPE_RENDERERS.get(NodeShape.RECTANGLE);
    renderer?.(canvas, p.drawX, p.drawY, p.drawWidth, p.drawHeight, node.label, cs, style);

    // The whole block is protected, or an edge line would run straight through the border it meets.
    for (let r = p.drawY; r < p.drawY + p.drawHeight; r++) {
      for (let c = p.drawX; c < p.drawX + p.drawWidth; c++) canvas.protect(r, c);
    }

    if (node.labelSegments === null || node.labelSegments.length === 0) continue;
    const row = p.drawY + Math.floor(p.drawHeight / 2);
    const total = node.labelSegments.reduce((sum, seg) => sum + displayWidth(seg.text), 0);
    const col = p.drawX + Math.floor((p.drawWidth - total) / 2);
    canvas.putStyledText(
      row,
      col,
      node.labelSegments.map(
        (seg) => [seg.text, seg.bold ? STYLE_BOLD_LABEL : seg.italic ? STYLE_ITALIC_LABEL : STYLE_LABEL] as const
      )
    );
  }
}

/** The style key an edge draws under: its own `linkStyle`, or the shared one. */
function edgeStyleKey(graph: Graph, re: RoutedEdge): string {
  if (graph.linkStyles.has(re.index) || graph.linkStyles.has(DEFAULT_LINK_STYLE)) return `linkstyle:${re.index}`;
  return STYLE_EDGE;
}

function edgeLineChars(style: EdgeStyle, cs: CharSet): [string, string] {
  if (style === EdgeStyle.DOTTED) return [cs.lineDottedH, cs.lineDottedV];
  if (style === EdgeStyle.THICK) return [cs.lineThickH, cs.lineThickV];
  if (style === EdgeStyle.INVISIBLE) return [" ", " "];
  return [cs.lineHorizontal, cs.lineVertical];
}

/** A fallback nothing on an A* path should ever need. */
function drawDiagonal(canvas: Canvas, x1: number, y1: number, x2: number, y2: number, ch: string): void {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  if (steps === 0) return;
  for (let step = 0; step <= steps; step++) {
    canvas.put(y1 + Math.floor(((y2 - y1) * step) / steps), x1 + Math.floor(((x2 - x1) * step) / steps), ch);
  }
}

/** The character a turn draws, from the direction it came in and the one it leaves by. */
function cornerChar(prev: Point, current: Point, next: Point, cs: CharSet, rounded: boolean): string | undefined {
  const dxIn = sign(current[0] - prev[0]);
  const dyIn = sign(current[1] - prev[1]);
  const dxOut = sign(next[0] - current[0]);
  const dyOut = sign(next[1] - current[1]);

  const corners: ReadonlyMap<string, string> = rounded
    ? new Map([
        ["1,0,0,1", cs.roundTopRight],
        ["1,0,0,-1", cs.roundBottomRight],
        ["-1,0,0,1", cs.roundTopLeft],
        ["-1,0,0,-1", cs.roundBottomLeft],
        ["0,1,1,0", cs.roundBottomLeft],
        ["0,1,-1,0", cs.roundBottomRight],
        ["0,-1,1,0", cs.roundTopLeft],
        ["0,-1,-1,0", cs.roundTopRight],
      ])
    : new Map([
        ["1,0,0,1", cs.cornerTopRight],
        ["1,0,0,-1", cs.cornerBottomRight],
        ["-1,0,0,1", cs.cornerTopLeft],
        ["-1,0,0,-1", cs.cornerBottomLeft],
        ["0,1,1,0", cs.cornerBottomLeft],
        ["0,1,-1,0", cs.cornerBottomRight],
        ["0,-1,1,0", cs.cornerTopLeft],
        ["0,-1,-1,0", cs.cornerTopRight],
      ]);
  return corners.get(`${dxIn},${dyIn},${dxOut},${dyOut}`);
}

/** The head, drawn one cell SHORT of the border so it never lands on a shape's own marker. */
function drawArrowHead(canvas: Canvas, from: Point, to: Point, cs: CharSet, style: string, type: ArrowType): void {
  const ndx = sign(to[0] - from[0]);
  const ndy = sign(to[1] - from[1]);
  const ax = to[0] - ndx;
  const ay = to[1] - ndy;

  if (type === ArrowType.CIRCLE) canvas.put(ay, ax, cs.circleEndpoint, true, style);
  else if (type === ArrowType.CROSS) canvas.put(ay, ax, cs.crossEndpoint, true, style);
  else if (ndx > 0) canvas.put(ay, ax, cs.arrowRight, true, style);
  else if (ndx < 0) canvas.put(ay, ax, cs.arrowLeft, true, style);
  else if (ndy > 0) canvas.put(ay, ax, cs.arrowDown, true, style);
  else if (ndy < 0) canvas.put(ay, ax, cs.arrowUp, true, style);
}

/** The tee where an edge meets a node border. */
function drawBoxStart(canvas: Canvas, at: Point, next: Point, cs: CharSet): void {
  const dx = next[0] - at[0];
  const dy = next[1] - at[1];
  const unicode = cs.horizontal === "─";
  let tee: string;
  if (dx > 0) tee = unicode ? cs.teeRight : "+";
  else if (dx < 0) tee = unicode ? cs.teeLeft : "+";
  else if (dy > 0) tee = unicode ? cs.teeDown : "+";
  else if (dy < 0) tee = unicode ? cs.teeUp : "+";
  else return;
  canvas.put(at[1], at[0], tee);
}

function blockWidth(lines: readonly string[]): number {
  return Math.max(...lines.map(displayWidth));
}

function pathCells(path: ReadonlyArray<Point>): Set<string> {
  const cells = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const [x1, y1] = path[i] as Point;
    const [x2, y2] = path[i + 1] as Point;
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        cells.add(`${x},${y}`);
      }
    }
  }
  return cells;
}

function labelOverlaps(
  row: number,
  colStart: number,
  colEnd: number,
  placed: PlacedLabel[],
  shareRows = false
): boolean {
  for (const [pr, ps, pe] of placed) {
    if (pr !== row) continue;
    if (!shareRows || (colStart < pe + LABEL_GAP && colEnd + LABEL_GAP > ps)) {
      return true;
    }
  }
  return false;
}

/**
 * ◉ Both charsets, a cell holding whichever one wrote it. A rule may be written over, but an arrowhead is the only
 * mark that an edge ARRIVES anywhere: written over, the edge leaves the drawing.
 */
const ARROWHEADS: ReadonlySet<string> = new Set([
  ...[UNICODE, ASCII].flatMap((set) => [set.arrowRight, set.arrowLeft, set.arrowDown, set.arrowUp]),
  ...Object.values(ARROW_STYLES).flat(),
]);

const blocksLabel = (canvas: Canvas, row: number, col: number): boolean =>
  canvas.isProtected(row, col) || ARROWHEADS.has(canvas.get(row, col));

/** ◉ Whether a label may be written from here without landing inside a protected box or on an arrowhead. */
function labelFits(canvas: Canvas, row: number, col: number, label: string): boolean {
  if (row < 0 || col < 0) return false;
  if (row >= canvas.height) return true;
  const end = Math.min(col + displayWidth(label), canvas.width);
  for (let c = col; c < end; c++) if (blocksLabel(canvas, row, c)) return false;
  return true;
}

/** ◉ The label cut to the free run starting here, ending in an ellipsis where anything had to go. */
function fittedLabel(canvas: Canvas, row: number, col: number, label: string): string {
  if (labelFits(canvas, row, col, label)) return label;
  let free = 0;
  while (col + free < canvas.width && row < canvas.height && !blocksLabel(canvas, row, col + free)) free++;
  if (free <= 1) return "";
  return truncateToWidth(label, free, ELLIPSIS);
}

function placeLabel(
  canvas: Canvas,
  row: number,
  col: number,
  lines: readonly string[],
  placed: PlacedLabel[],
  mayCover: ReadonlySet<string> | null = null,
  divergences = false
): boolean {
  const colEnd = col + blockWidth(lines);
  if (col < 0 || row < 0) return false;
  const strict = lines.length > 1 && mayCover !== null;
  for (let targetRow = row; targetRow < row + lines.length; targetRow++) {
    for (let targetCol = col; targetCol < colEnd; targetCol++) {
      if (divergences && blocksLabel(canvas, targetRow, targetCol)) return false;
      if (canvas.get(targetRow, targetCol) === " ") continue;
      if (strict || canvas.isProtected(targetRow, targetCol)) return false;
      if (mayCover !== null && !mayCover.has(`${targetCol},${targetRow}`)) return false;
    }
  }
  const neededWidth = colEnd + 1;
  const neededHeight = row + lines.length;
  if (neededWidth > canvas.width || neededHeight > canvas.height) {
    canvas.resize(Math.max(canvas.width, neededWidth), Math.max(canvas.height, neededHeight));
  }
  for (let i = 0; i < lines.length; i++) {
    canvas.putText(row + i, col, lines[i] as string, STYLE_EDGE_LABEL, true);
    placed.push([row + i, col, colEnd]);
  }
  return true;
}

function tryPlaceLabel(
  canvas: Canvas,
  row: number,
  col: number,
  lines: readonly string[],
  placed: PlacedLabel[],
  rules: LabelRules,
  divergences: boolean
): boolean {
  const colEnd = col + blockWidth(lines);
  for (let r = row; r < row + lines.length; r++) {
    if (labelOverlaps(r, col, colEnd, placed, rules.shareRows)) return false;
  }
  return placeLabel(canvas, row, col, lines, placed, rules.mayCover, divergences);
}

/** The last turn in a path, or -1 for a path that runs straight. */
function findLastTurn(path: ReadonlyArray<Point>): number {
  for (let i = path.length - 2; i > 0; i--) {
    const prev = path[i - 1] as Point;
    const current = path[i] as Point;
    const next = path[i + 1] as Point;
    const dxIn = current[0] - prev[0];
    const dyIn = current[1] - prev[1];
    const dxOut = next[0] - current[0];
    const dyOut = next[1] - current[1];
    if ((dxIn === 0 && dyIn === 0) || (dxOut === 0 && dyOut === 0)) continue;
    if (sign(dxIn) !== sign(dxOut) || sign(dyIn) !== sign(dyOut)) return i;
  }
  return -1;
}

/** A label placed against one segment: beside a vertical run, above or below (or inline on) a horizontal one. */
function tryPlaceOnSegment(
  canvas: Canvas,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  lines: readonly string[],
  placed: PlacedLabel[],
  prev: Point | null,
  preferLeft: boolean,
  biasTarget: boolean,
  inline: boolean,
  useAscii: boolean,
  leaderChar: string,
  rules: LabelRules,
  divergences: boolean
): boolean {
  const labelLen = blockWidth(lines);
  const labelRows = lines.length;

  if (x1 === x2 && Math.abs(y2 - y1) >= MIN_VERTICAL_SEGMENT) {
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    const midY = biasTarget ? y1 + Math.floor(((y2 - y1) * 2) / 3) : Math.floor((low + high) / 2);

    let left = preferLeft;
    if (!left && prev !== null) {
      const [px, py] = prev;
      // A turn arriving from the right puts the label on the left, which is the inside of the branch.
      if (py === y1 && px !== x1) left = px > x1;
    }

    if (inline) {
      const label = lines[0] as string;
      const rightLabel = useAscii ? `+-${label}` : `├${leaderChar}${label}`;
      const leftLabel = useAscii ? `${label}-+` : `${label}${leaderChar}┤`;
      const sides: Array<[number, number, string[]]> = [
        [midY, x1, [rightLabel]],
        [midY, x1 - displayWidth(leftLabel) + 1, [leftLabel]],
      ];
      if (left) sides.reverse();

      for (const [row, col, anchored] of sides) {
        if (tryPlaceLabel(canvas, row, col, anchored, placed, rules, divergences)) return true;
      }
      for (let offset = 1; offset < LABEL_SEARCH; offset++) {
        for (const [row, col, anchored] of sides) {
          if (tryPlaceLabel(canvas, row - offset, col, anchored, placed, rules, divergences)) return true;
          if (tryPlaceLabel(canvas, row + offset, col, anchored, placed, rules, divergences)) return true;
        }
      }
      return false;
    }

    const top = Math.max(low + 1, midY - Math.floor(labelRows / 2));
    const sides: Array<[number, number]> = left
      ? [
          [top, x1 - labelLen],
          [top, x1 + 1],
        ]
      : [
          [top, x1 + 1],
          [top, x1 - labelLen],
        ];

    for (const [row, col] of sides) {
      if (tryPlaceLabel(canvas, row, col, lines, placed, rules, divergences)) return true;
    }
    for (let offset = 1; offset < LABEL_SEARCH; offset++) {
      for (const [row, col] of sides) {
        if (tryPlaceLabel(canvas, row - offset, col, lines, placed, rules, divergences)) return true;
        if (tryPlaceLabel(canvas, row + offset, col, lines, placed, rules, divergences)) return true;
      }
    }
    return false;
  }

  if (y1 === y2) {
    const segLen = Math.abs(x2 - x1);
    if (segLen >= labelLen + 2) {
      const mid = Math.floor((Math.min(x1, x2) + Math.max(x1, x2)) / 2);
      const start = mid - Math.floor(labelLen / 2);
      if (inline) {
        return tryPlaceLabel(canvas, y1, start, lines, placed, rules, divergences);
      }
      if (tryPlaceLabel(canvas, y1 - labelRows, start, lines, placed, rules, divergences)) return true;
      if (tryPlaceLabel(canvas, y1 + 1, start, lines, placed, rules, divergences)) return true;
      return false;
    }
  }

  return false;
}

/**
 * A label on the best segment of its path: after the LAST TURN first, since that stretch belongs to this edge alone
 * and the trunk before it may be shared with its siblings.
 */
function drawEdgeLabel(
  canvas: Canvas,
  re: RoutedEdge,
  placed: PlacedLabel[],
  inline: boolean,
  cs: CharSet,
  divergences: boolean
): void {
  if (re.label === "") return;
  const lines = re.label.split("\n");
  const useInline = inline && lines.length === 1;

  const path = re.drawPath;
  const leaderChar = edgeLineChars(re.edge.style, cs)[0];
  const nSegs = path.length - 1;
  if (nSegs <= 0) return;

  const lastTurn = findLastTurn(path);
  const preferred: number[] = [];
  const remaining: number[] = [];
  if (lastTurn >= 0) {
    for (let i = lastTurn; i < nSegs; i++) preferred.push(i);
    for (let i = lastTurn - 1; i >= 0; i--) remaining.push(i);
  } else {
    for (let i = 0; i < nSegs; i++) remaining.push(i);
  }

  const isStraight = lastTurn < 0;
  const own = pathCells(path);
  const rulePasses: LabelRules[] = [
    { mayCover: own, shareRows: false },
    { mayCover: own, shareRows: true },
    { mayCover: null, shareRows: false },
  ];
  const order = [...preferred, ...remaining];

  for (const rules of rulePasses) {
    for (const i of order) {
      const [x1, y1] = path[i] as Point;
      const [x2, y2] = path[i + 1] as Point;
      const prev = i > 0 ? (path[i - 1] as Point) : null;
      if (
        tryPlaceOnSegment(
          canvas,
          x1,
          y1,
          x2,
          y2,
          lines,
          placed,
          prev,
          isStraight,
          isStraight,
          useInline,
          cs === ASCII,
          leaderChar,
          rules,
          divergences
        )
      ) {
        return;
      }
    }
  }

  if (useInline) {
    drawEdgeLabel(canvas, re, placed, false, cs, divergences);
    return;
  }

  const [mx, my] = path[Math.floor(path.length / 2)] as Point;
  if (!divergences) {
    placeLabel(canvas, my - lines.length, mx + 1, lines, placed, null, false);
    return;
  }

  // ◉ When `divergences: true`, never land inside a node box or on an arrowhead, and mark truncations with `…`.
  const col = mx + 1;
  const baseRow = my - lines.length;
  const rows: number[] = [baseRow];
  for (let off = 1; off <= LABEL_SEARCH; off++) rows.push(baseRow - off, baseRow + off);

  for (const row of rows) {
    if (tryPlaceLabel(canvas, row, col, lines, placed, { mayCover: null, shareRows: false }, true)) return;
  }
  if (lines.length === 1) {
    const single = lines[0] as string;
    for (const row of rows) {
      if (row < 0 || labelOverlaps(row, col, col + displayWidth(single), placed, false)) continue;
      const shown = fittedLabel(canvas, row, col, single);
      if (shown === "") continue;
      canvas.putText(row, col, shown, STYLE_EDGE_LABEL, true);
      placed.push([row, col, col + displayWidth(shown)]);
      return;
    }
  }
}

/**
 * Every edge, in three passes: the lines and their corners, then the heads and tees so a later edge's line cannot
 * bury them, then the labels on top of the lot.
 */
function drawEdges(
  canvas: Canvas,
  graph: Graph,
  routed: RoutedEdge[],
  cs: CharSet,
  rounded: boolean,
  inlineEdgeLabels: boolean,
  divergences: boolean
): void {
  for (const re of routed) {
    if (re.drawPath.length < 2) continue;
    const key = edgeStyleKey(graph, re);
    const [hChar, vChar] = edgeLineChars(re.edge.style, cs);

    for (let i = 0; i < re.drawPath.length - 1; i++) {
      const [fromX, fromY] = re.drawPath[i] as Point;
      const [toX, toY] = re.drawPath[i + 1] as Point;
      const dx = sign(toX - fromX);
      const dy = sign(toY - fromY);

      // Both ends pull back one cell, so a corner or a junction owns its own cell and merges with the right bits.
      let x1 = fromX + dx;
      let y1 = fromY + dy;
      if (i === 0 && re.edge.hasArrowStart) {
        x1 += dx;
        y1 += dy;
      }
      const x2 = toX - dx;
      const y2 = toY - dy;

      // Classified on the ORIGINAL direction: clipping can collapse a segment to one point.
      if (dy === 0) {
        if ((dx > 0 && x1 > x2) || (dx < 0 && x1 < x2)) continue;
        canvas.drawHorizontal(y1, x1, x2, hChar, key);
      } else if (dx === 0) {
        if ((dy > 0 && y1 > y2) || (dy < 0 && y1 < y2)) continue;
        canvas.drawVertical(x1, y1, y2, vChar, key);
      } else {
        drawDiagonal(canvas, x1, y1, x2, y2, hChar);
      }
    }

    for (let i = 1; i < re.drawPath.length - 1; i++) {
      const corner = cornerChar(
        re.drawPath[i - 1] as Point,
        re.drawPath[i] as Point,
        re.drawPath[i + 1] as Point,
        cs,
        rounded
      );
      if (corner !== undefined) canvas.put((re.drawPath[i] as Point)[1], (re.drawPath[i] as Point)[0], corner, true, key);
    }
  }

  for (const re of routed) {
    if (re.drawPath.length < 2) continue;
    const key = edgeStyleKey(graph, re);
    const arrowKey = key === STYLE_EDGE ? STYLE_ARROW : key;
    const last = re.drawPath.length - 1;

    if (re.edge.hasArrowEnd) {
      drawArrowHead(canvas, re.drawPath[last - 1] as Point, re.drawPath[last] as Point, cs, arrowKey, re.edge.arrowTypeEnd);
    }
    if (re.edge.hasArrowStart) {
      drawArrowHead(canvas, re.drawPath[1] as Point, re.drawPath[0] as Point, cs, arrowKey, re.edge.arrowTypeStart);
    }
    if (!re.edge.hasArrowStart) drawBoxStart(canvas, re.drawPath[0] as Point, re.drawPath[1] as Point, cs);
    if (!re.edge.hasArrowEnd) drawBoxStart(canvas, re.drawPath[last] as Point, re.drawPath[last - 1] as Point, cs);
  }

  const placed: PlacedLabel[] = [];
  for (const re of routed) {
    if (re.label !== "" && re.drawPath.length >= 2) {
      drawEdgeLabel(canvas, re, placed, inlineEdgeLabels, cs, divergences);
    }
  }
}

/** A note box beside the node it names. */
function drawNotes(canvas: Canvas, graph: Graph, layout: GridLayout, cs: CharSet): void {
  for (const note of graph.notes) {
    const p = layout.placements.get(note.target);
    if (p === undefined) continue;

    const lines = note.text.split("\n");
    const noteWidth = Math.max(...lines.map(displayWidth)) + 4;
    const noteHeight = lines.length + 2;

    const noteX =
      note.position === "rightof" ? p.drawX + p.drawWidth + 2 : Math.max(0, p.drawX - noteWidth - 2);
    const noteY = p.drawY + Math.floor((p.drawHeight - noteHeight) / 2);

    const neededWidth = noteX + noteWidth + 2;
    const neededHeight = noteY + noteHeight + 2;
    if (neededWidth > canvas.width || neededHeight > canvas.height) {
      canvas.resize(Math.max(canvas.width, neededWidth), Math.max(canvas.height, neededHeight));
    }
    drawRectangle(canvas, noteX, noteY, noteWidth, noteHeight, note.text, cs, STYLE_NODE);
  }
}
