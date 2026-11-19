// Ported from src/termaid/layout/placement.py.
//
// Where each node's 3x3 block lands on the grid, how wide a column and how tall a row must be to hold what it carries,
// and the room a labelled edge needs in the gap between two layers.

import { Direction, isHorizontal, isSelfReference, isVertical, normalized, type Graph } from "../graph/model.ts";
import { NodeShape } from "../graph/shapes.ts";
import { displayWidth, wrapDisplayText } from "../utils.ts";
import {
  cellKey,
  makePlacement,
  MAX_LABEL_WIDTH,
  MAX_NORMALIZED_WIDTH,
  STRIDE,
  type GridCoord,
  type GridLayout,
  type NodePlacement,
} from "./grid.ts";

const UNSIZED = 1;
const MIN_CONTENT_WIDTH = 3;
const MIN_CONTENT_HEIGHT = 1;
const LABEL_GAP_ROWS = 3;
const LITERAL_NEWLINE = "\\n";
const DEFAULT_GAP = 4;
const MIN_TURN_GAP = 3;

function canPlace(layout: GridLayout, at: GridCoord): boolean {
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) if (!layout.isFree(at.col + dc, at.row + dr)) return false;
  }
  return true;
}

function alignedSlots(graph: Graph, layerOrder: string[][]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const nodes of layerOrder) {
    nodes.forEach((nid, i) => slots.set(nid, i));
  }
  if (
    graph.subgraphs.length > 0 ||
    (graph.gridPositions !== null && graph.gridPositions.size > 0) ||
    layerOrder.length < 2
  ) {
    return slots;
  }

  const layerOf = new Map<string, number>();
  layerOrder.forEach((nodes, li) => {
    for (const nid of nodes) layerOf.set(nid, li);
  });

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const nid of slots.keys()) {
    parents.set(nid, []);
    children.set(nid, []);
  }
  for (const edge of graph.edges) {
    const srcLayer = layerOf.get(edge.source) ?? -2;
    const tgtLayer = layerOf.get(edge.target) ?? -1;
    if (tgtLayer === srcLayer + 1) {
      parents.get(edge.target)?.push(edge.source);
      children.get(edge.source)?.push(edge.target);
    }
  }

  const centre = (placed: number[], wants: number[], start: number, end: number): void => {
    let sum = 0;
    for (let i = start; i < end; i++) sum += (placed[i] as number) - (wants[i] as number);
    const overshoot = sum / (end - start);
    const floor = start > 0 ? (placed[start - 1] as number) + 1 : 0;
    const shift = Math.min(Math.trunc(overshoot), (placed[start] as number) - floor);
    for (let i = start; i < end; i++) placed[i] = (placed[i] as number) - shift;
  };

  const sweep = (order: string[][], neighbours: Map<string, string[]>): void => {
    for (const nodes of order) {
      if (nodes.length === 0) continue;
      const wants: number[] = [];
      for (const nid of nodes) {
        const anchors = (neighbours.get(nid) ?? []).map((n) => slots.get(n) ?? 0);
        if (anchors.length > 0) {
          wants.push(anchors.reduce((a, b) => a + b, 0) / anchors.length);
        } else {
          wants.push(wants.length > 0 ? (wants[wants.length - 1] as number) + 1 : 0);
        }
      }

      const placed: number[] = [];
      let runStart = 0;
      wants.forEach((want, i) => {
        const minSlot = placed.length > 0 ? (placed[placed.length - 1] as number) + 1 : 0;
        const slot = Math.max(Math.trunc(want), minSlot);
        if (placed.length > 0 && slot > (placed[placed.length - 1] as number) + 1) {
          centre(placed, wants, runStart, i);
          runStart = i;
        }
        placed.push(slot);
      });
      centre(placed, wants, runStart, placed.length);
      nodes.forEach((nid, i) => slots.set(nid, placed[i] as number));
    }
  };

  const downward = layerOrder.slice(1);
  const upward = layerOrder.slice(0, -1).reverse();
  for (let pass = 0; pass < 3; pass++) {
    sweep(downward, parents);
    sweep(upward, children);
  }

  let lowest = Number.POSITIVE_INFINITY;
  for (const s of slots.values()) lowest = Math.min(lowest, s);
  if (!Number.isFinite(lowest)) lowest = 0;
  const out = new Map<string, number>();
  for (const [nid, s] of slots) out.set(nid, s - lowest);
  return out;
}

export function placeNodes(
  graph: Graph,
  layout: GridLayout,
  layerOrder: string[][],
  direction: Direction,
  gapExpansions: Map<number, number> = new Map()
): void {
  const horizontal = isHorizontal(direction);
  const slots = alignedSlots(graph, layerOrder);
  let extra = 0;
  layerOrder.forEach((nodes, layer) => {
    if (layer > 0) extra += gapExpansions.get(layer - 1) ?? 0;
    const layerCoord = layer * STRIDE + 1 + extra;
    layout.layerCoords.push(layerCoord);
    for (const id of nodes) {
      const pos = slots.get(id) ?? 0;
      let at: GridCoord = horizontal
        ? { col: layerCoord, row: pos * STRIDE + 1 }
        : { col: pos * STRIDE + 1, row: layerCoord };

      while (!canPlace(layout, at)) {
        at = horizontal ? { col: at.col, row: at.row + STRIDE } : { col: at.col + STRIDE, row: at.row };
      }

      layout.placements.set(id, makePlacement(id, at));
      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) layout.gridOccupied.set(cellKey(at.col + dc, at.row + dr), id);
      }
    }
  });
}

export function computeSizes(
  graph: Graph,
  layout: GridLayout,
  paddingX: number,
  paddingY: number,
  gap: number = DEFAULT_GAP,
  maxLabelWidth: number | null = null
): void {
  let effectiveMaxLabelWidth: number;
  if (maxLabelWidth === null) {
    effectiveMaxLabelWidth = MAX_LABEL_WIDTH;
  } else {
    effectiveMaxLabelWidth = maxLabelWidth;
    for (const edge of graph.edges) {
      if (edge.label.split("\n").some((line) => displayWidth(line) > effectiveMaxLabelWidth)) {
        edge.label = wrapDisplayText(edge.label, effectiveMaxLabelWidth, { hardBreak: false }).join("\n");
      }
    }
  }

  for (const [id, placement] of layout.placements) {
    const node = graph.nodes.get(id);
    if (node === undefined) continue;
    const { col, row } = placement.grid;

    if (node.shape === NodeShape.JUNCTION) {
      layout.colWidths.set(col, Math.max(layout.colWidths.get(col) ?? UNSIZED, 1));
      layout.rowHeights.set(row, Math.max(layout.rowHeights.get(row) ?? UNSIZED, 1));
      continue;
    }

    const lines = node.label.includes(LITERAL_NEWLINE) ? node.label.split(LITERAL_NEWLINE) : [node.label];
    const wrapped: string[] = [];
    for (const line of lines) {
      if (displayWidth(line) <= effectiveMaxLabelWidth) wrapped.push(line);
      else wrapped.push(...wrapDisplayText(line, effectiveMaxLabelWidth, { hardBreak: false }));
    }
    if (wrapped.length > 1 && wrapped.join(LITERAL_NEWLINE) !== lines.join(LITERAL_NEWLINE)) {
      node.label = wrapped.join(LITERAL_NEWLINE);
    }

    const textWidth = wrapped.length > 0 ? Math.max(...wrapped.map(displayWidth)) : 0;
    const contentWidth = Math.max(textWidth + paddingX, MIN_CONTENT_WIDTH);
    const contentHeight = Math.max(wrapped.length + paddingY, MIN_CONTENT_HEIGHT);

    layout.colWidths.set(col, Math.max(layout.colWidths.get(col) ?? UNSIZED, contentWidth));
    layout.rowHeights.set(row, Math.max(layout.rowHeights.get(row) ?? UNSIZED, contentHeight));
  }

  const allCols = new Set<number>();
  const allRows = new Set<number>();
  for (const placement of layout.placements.values()) {
    for (let d = -1; d <= 1; d++) {
      allCols.add(placement.grid.col + d);
      allRows.add(placement.grid.row + d);
    }
  }
  for (const c of allCols) if (!layout.colWidths.has(c)) layout.colWidths.set(c, 1);
  for (const r of allRows) if (!layout.rowHeights.has(r)) layout.rowHeights.set(r, 1);

  const maxCol = allCols.size > 0 ? Math.max(...allCols) : 0;
  const maxRow = allRows.size > 0 ? Math.max(...allRows) : 0;
  for (let c = 0; c < maxCol + 2; c++) if (!layout.colWidths.has(c)) layout.colWidths.set(c, gap);
  for (let r = 0; r < maxRow + 2; r++) if (!layout.rowHeights.has(r)) layout.rowHeights.set(r, Math.max(gap - 1, 1));

  expandGapsForTurns(graph, layout);
  expandGapsForEdgeLabels(graph, layout);
}

function expandGapsForTurns(graph: Graph, layout: GridLayout): void {
  const vertical = isVertical(normalized(graph.direction));
  for (const edge of graph.edges) {
    const src = layout.placements.get(edge.source);
    const tgt = layout.placements.get(edge.target);
    if (src === undefined || tgt === undefined || isSelfReference(edge)) continue;
    if (vertical && tgt.grid.row > src.grid.row && tgt.grid.col !== src.grid.col) {
      const lastGapRow = tgt.grid.row - 2;
      layout.rowHeights.set(lastGapRow, Math.max(layout.rowHeights.get(lastGapRow) ?? 1, MIN_TURN_GAP));
    } else if (!vertical && tgt.grid.col > src.grid.col && tgt.grid.row !== src.grid.row) {
      const lastGapCol = tgt.grid.col - 2;
      layout.colWidths.set(lastGapCol, Math.max(layout.colWidths.get(lastGapCol) ?? 1, MIN_TURN_GAP));
    }
  }
}

function expandGapsForEdgeLabels(graph: Graph, layout: GridLayout): void {
  const horizontal = isHorizontal(normalized(graph.direction));

  for (const edge of graph.edges) {
    if (edge.label === "") continue;
    const lines = edge.label.split("\n");
    const labelLength = Math.max(...lines.map(displayWidth));
    const source = layout.placements.get(edge.source);
    const target = layout.placements.get(edge.target);
    if (source === undefined || target === undefined) continue;

    if (horizontal) {
      const start = Math.min(source.grid.col, target.grid.col) + 2;
      const end = Math.max(source.grid.col, target.grid.col) - 2;
      if (start > end) continue;
      layout.colWidths.set(start, Math.max(layout.colWidths.get(start) ?? DEFAULT_GAP, labelLength + 1));
      if (lines.length === 1) continue;
      if (source.grid.row !== target.grid.row) {
        layout.colWidths.set(start, Math.max(layout.colWidths.get(start) as number, 2 * labelLength + 2));
        const gapRow = Math.min(source.grid.row, target.grid.row) + 2;
        layout.rowHeights.set(gapRow, Math.max(layout.rowHeights.get(gapRow) ?? 1, lines.length));
      }
      for (const r of new Set([source.grid.row, target.grid.row])) {
        const above = Math.floor((layout.rowHeights.get(r) ?? 1) / 2) + 1;
        const gapRow = r - 2;
        if (gapRow < 0) {
          layout.offsetY = Math.max(layout.offsetY, lines.length - above);
        } else {
          layout.rowHeights.set(gapRow, Math.max(layout.rowHeights.get(gapRow) ?? 1, lines.length - above));
        }
      }
      continue;
    }

    const start = Math.min(source.grid.row, target.grid.row) + 2;
    const end = Math.max(source.grid.row, target.grid.row) - 2;
    if (start > end) continue;
    layout.rowHeights.set(
      start,
      Math.max(layout.rowHeights.get(start) ?? LABEL_GAP_ROWS, LABEL_GAP_ROWS, lines.length)
    );

    const gapCols = new Set<number>();
    if (target.grid.col >= source.grid.col) gapCols.add(source.grid.col + 2);
    if (target.grid.col <= source.grid.col) gapCols.add(source.grid.col - 2);
    const low = Math.min(source.grid.col, target.grid.col);
    const high = Math.max(source.grid.col, target.grid.col);
    for (let c = low + 2; c < high; c += STRIDE) gapCols.add(c);
    for (const c of gapCols) {
      if (c < 0 || !layout.colWidths.has(c)) continue;
      layout.colWidths.set(c, Math.max(layout.colWidths.get(c) as number, labelLength + 1));
    }
  }

  if (horizontal) return;

  const labelledCount = new Map<string, number>();
  const rowsPerSrc = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.label === "") continue;
    labelledCount.set(edge.source, (labelledCount.get(edge.source) ?? 0) + 1);
    const nlCount = edge.label.split("\n").length - 1;
    rowsPerSrc.set(edge.source, (rowsPerSrc.get(edge.source) ?? 0) + nlCount + 2);
  }
  for (const [id, count] of labelledCount) {
    if (count < 2) continue;
    const source = layout.placements.get(id);
    if (source === undefined) continue;
    const gapRow = source.grid.row + 2;
    const needed = (rowsPerSrc.get(id) ?? 0) + 1;
    layout.rowHeights.set(gapRow, Math.max(layout.rowHeights.get(gapRow) ?? LABEL_GAP_ROWS, needed));
  }
}

export function normalizeSizes(graph: Graph, layout: GridLayout): void {
  if (!isVertical(normalized(graph.direction))) return;

  const groups = new Map<number, NodePlacement[]>();
  for (const [id, placement] of layout.placements) {
    const node = graph.nodes.get(id);
    if (node !== undefined && node.shape === NodeShape.JUNCTION) continue;
    const bucket = groups.get(placement.grid.row);
    if (bucket === undefined) groups.set(placement.grid.row, [placement]);
    else bucket.push(placement);
  }

  for (const placements of groups.values()) {
    if (placements.length < 2) continue;
    const cols = new Set(placements.map((p) => p.grid.col));
    const widest = Math.max(...[...cols].map((c) => layout.colWidths.get(c) ?? UNSIZED));
    const target = Math.min(widest, MAX_NORMALIZED_WIDTH);
    for (const c of cols) layout.colWidths.set(c, Math.max(layout.colWidths.get(c) ?? UNSIZED, target));
  }
}
