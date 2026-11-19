// Ported from src/termaid/layout/grid.py.
//
// GRID (col, row): logical positions on a coarse grid.
// DRAW (x, y): character positions in the output.

import { Direction, Graph, isHorizontal, normalized, type Subgraph } from "../graph/model.ts";
import { adjustForNegativeBounds, computeDrawCoords } from "./coordinates.ts";
import {
  assignLayers,
  computeGapExpansions,
  expandSubgraphEdges,
  orderLayers,
  separateSubgraphLayers,
} from "./layers.ts";
import { computeSizes, normalizeSizes, placeNodes } from "./placement.ts";
import { computeSubgraphBounds, expandGapsForSubgraphs } from "./subgraphs.ts";

export const STRIDE = 4;

export const MAX_LABEL_WIDTH = 20;
export const MAX_NORMALIZED_WIDTH = 25;

export const SG_BORDER_PAD = 2;
export const SG_LABEL_HEIGHT = 2;
export const SG_GAP_PER_LEVEL = SG_BORDER_PAD + SG_LABEL_HEIGHT + 1;

const UNSIZED = 1;

export interface GridCoord {
  col: number;
  row: number;
}

export interface NodePlacement {
  nodeId: string;
  grid: GridCoord;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
}

export function makePlacement(nodeId: string, grid: GridCoord): NodePlacement {
  return { nodeId, grid, drawX: 0, drawY: 0, drawWidth: 0, drawHeight: 0 };
}

export interface SubgraphBounds {
  subgraph: Subgraph;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const cellKey = (col: number, row: number): string => `${col},${row}`;

export class GridLayout {
  placements = new Map<string, NodePlacement>();
  colWidths = new Map<number, number>();
  rowHeights = new Map<number, number>();
  gridOccupied = new Map<string, string>();
  canvasWidth = 0;
  canvasHeight = 0;
  subgraphBounds: SubgraphBounds[] = [];
  offsetX = 0;
  offsetY = 0;
  /** Grid coordinate of each layer along the flow axis. */
  layerCoords: number[] = [];

  isFree(col: number, row: number, exclude?: Set<string>): boolean {
    if (col < 0 || row < 0) return false;
    const owner = this.gridOccupied.get(cellKey(col, row));
    if (owner === undefined) return true;
    return exclude !== undefined && exclude.size > 0 && exclude.has(owner);
  }

  gridToDraw(col: number, row: number): [number, number] {
    let x = this.offsetX;
    for (let c = 0; c < col; c++) x += this.colWidths.get(c) ?? UNSIZED;
    let y = this.offsetY;
    for (let r = 0; r < row; r++) y += this.rowHeights.get(r) ?? UNSIZED;
    return [x, y];
  }

  gridToDrawCenter(col: number, row: number): [number, number] {
    const [x, y] = this.gridToDraw(col, row);
    const w = this.colWidths.get(col) ?? UNSIZED;
    const h = this.rowHeights.get(row) ?? UNSIZED;
    return [x + Math.floor(w / 2), y + Math.floor(h / 2)];
  }
}

export function layerOrderFromGrid(graph: Graph): string[][] {
  const positions = graph.gridPositions;
  if (positions === null) return [];
  const horizontal = isHorizontal(normalized(graph.direction));
  const at = (id: string): [number, number] => positions.get(id) ?? [0, 0];
  const layerOf = (id: string): number => (horizontal ? at(id)[0] : at(id)[1]);
  const posOf = (id: string): number => (horizontal ? at(id)[1] : at(id)[0]);

  const byLayer = new Map<number, string[]>();
  for (const id of graph.nodeOrder) {
    const layer = layerOf(id);
    const bucket = byLayer.get(layer);
    if (bucket === undefined) byLayer.set(layer, [id]);
    else bucket.push(id);
  }

  return [...byLayer.keys()]
    .sort((a, b) => a - b)
    .map((layer) => (byLayer.get(layer) as string[]).slice().sort((a, b) => posOf(a) - posOf(b)));
}

const MIN_GAP = 1;

export interface LayoutOptions {
  paddingX: number;
  paddingY: number;
  gap: number;
  maxLabelWidth?: number | null;
  extraGaps?: ReadonlyMap<number, number> | null;
}

export const DEFAULT_LAYOUT: LayoutOptions = { paddingX: 4, paddingY: 2, gap: 4 };

export function computeLayout(graph: Graph, options: Partial<LayoutOptions> = {}): GridLayout {
  const { paddingX, paddingY } = { ...DEFAULT_LAYOUT, ...options };
  const gap = Math.max(options.gap ?? DEFAULT_LAYOUT.gap, MIN_GAP);
  const maxLabelWidth = options.maxLabelWidth ?? null;
  const extraGaps = options.extraGaps ?? null;

  const layout = new GridLayout();
  const direction: Direction = normalized(graph.direction);
  if (graph.nodeOrder.length === 0) return layout;

  graph.dropSharedSubgraphMembers();

  let layerOrder: string[][];
  let gapExpansions = new Map<number, number>();

  if (graph.gridPositions !== null && graph.gridPositions.size > 0) {
    layerOrder = layerOrderFromGrid(graph);
  } else {
    const virtual = expandSubgraphEdges(graph);
    graph.edges.push(...virtual);
    let layers: Map<string, number>;
    try {
      layers = separateSubgraphLayers(graph, assignLayers(graph));
    } finally {
      if (virtual.length > 0) graph.edges.length = graph.edges.length - virtual.length;
    }
    layerOrder = orderLayers(graph, layers);
    gapExpansions = computeGapExpansions(graph, layerOrder);
  }

  if (extraGaps !== null) {
    for (const [gapIdx, extra] of extraGaps) {
      gapExpansions.set(gapIdx, (gapExpansions.get(gapIdx) ?? 0) + extra);
    }
  }

  placeNodes(graph, layout, layerOrder, direction, gapExpansions);
  computeSizes(graph, layout, paddingX, paddingY, gap, maxLabelWidth);
  normalizeSizes(graph, layout);
  expandGapsForSubgraphs(graph, layout, direction);
  computeDrawCoords(layout);
  computeSubgraphBounds(graph, layout);
  adjustForNegativeBounds(layout);

  let maxX = 0;
  let maxY = 0;
  for (const p of layout.placements.values()) {
    maxX = Math.max(maxX, p.drawX + p.drawWidth);
    maxY = Math.max(maxY, p.drawY + p.drawHeight);
  }
  for (const sb of layout.subgraphBounds) {
    maxX = Math.max(maxX, sb.x + sb.width);
    maxY = Math.max(maxY, sb.y + sb.height);
  }
  layout.canvasWidth = maxX;
  layout.canvasHeight = maxY;
  return layout;
}
