// Ported from src/termaid/routing/router.py.
//
// Edge routing orchestrator: attachment points, A* pathfinding, bus trunk sharing, perpendicular crossing rules,
// crowded-gap expansion, and near-side back-edge trials.

import {
  Direction,
  isHorizontal,
  isSelfReference,
  isVertical,
  normalized,
  type Edge,
  type Graph,
  type Subgraph,
} from "../graph/model.ts";
import {
  SG_BORDER_PAD,
  computeLayout,
  makePlacement,
  type GridLayout,
  type NodePlacement,
  type SubgraphBounds,
} from "../layout/grid.ts";
import { busEdges } from "../layout/layers.ts";
import { pyCompare } from "../pycompat.ts";
import { cellId, findPath, parseCellId, simplifyPath, type Cell } from "./pathfinder.ts";

export const AttachDir = {
  TOP: "TOP",
  BOTTOM: "BOTTOM",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
} as const;
export type AttachDir = (typeof AttachDir)[keyof typeof AttachDir];

export interface RoutedEdge {
  edge: Edge;
  gridPath: Cell[];
  drawPath: Array<[number, number]>;
  startDir: AttachDir;
  endDir: AttachDir;
  label: string;
  index: number;
  occupiedCells: Set<string>;
  crowded: Set<string>;
}

const MAX_GAP_ROUNDS = 3;
const CROWDING_COST = 10.0;
const OFF_BUS_COST = 0.5;
const MAX_NEAR_SIDE_TRIALS = 12;
const NEAR_SIDE_SAVING = 4;

const BEND_COST = 2.0;
const CROSSING_COST = 4.0;
const LABELLED_SHARE_COST = 8.0;
const FOREIGN_SG_COST = 6.0;

const PREFER_BIAS = 3;
const MIN_APPROACH = 4;
const MAX_SPREAD_STEP = 2;

interface BusCells {
  branches: Set<string>;
  preferred: Set<string>;
}

type SgRegion = readonly [number, number, number, number];
type Places = readonly [ReadonlySet<string>, ReadonlySet<string>];
type CellAxesMap = Map<string, boolean | null>;

function countCrowdedRoutes(routed: readonly RoutedEdge[]): number {
  let count = 0;
  for (const r of routed) {
    if (r.crowded.size > 0) count += 1;
  }
  return count;
}

export function layoutAndRoute(
  graph: Graph,
  paddingX: number,
  paddingY: number,
  gap: number,
  maxLabelWidth: number | null
): [GridLayout, RoutedEdge[]] {
  let extra = new Map<number, number>();
  let layout = computeLayout(graph, { paddingX, paddingY, gap, maxLabelWidth });
  let routed = routeEdges(graph, layout);

  for (let round = 0; round < MAX_GAP_ROUNDS; round++) {
    const crowded = crowdedGaps(routed, layout, normalized(graph.direction));
    if (crowded.size === 0) break;
    const grown = new Map<number, number>();
    for (const g of new Set([...extra.keys(), ...crowded])) {
      grown.set(g, (extra.get(g) ?? 0) + (crowded.has(g) ? 1 : 0));
    }
    const nextLayout = computeLayout(graph, {
      paddingX,
      paddingY,
      gap,
      maxLabelWidth,
      extraGaps: grown,
    });
    const nextRouted = routeEdges(graph, nextLayout);
    if (countCrowdedRoutes(nextRouted) >= countCrowdedRoutes(routed)) break;
    extra = grown;
    layout = nextLayout;
    routed = nextRouted;
  }

  const candidates = nearSideCandidates(graph, layout, routed).slice(0, MAX_NEAR_SIDE_TRIALS);
  if (candidates.length > 0) {
    let near = new Set<number>();
    let best = routeScore(graph, routed, layout);
    for (const i of candidates) {
      const trial = new Set(near);
      trial.add(i);
      const trialLayout = computeLayout(graph, {
        paddingX,
        paddingY,
        gap,
        maxLabelWidth,
        extraGaps: extra.size > 0 ? extra : null,
      });
      const trialRouted = routeEdges(graph, trialLayout, trial);
      const score = routeScore(graph, trialRouted, trialLayout);
      if (score < best) {
        near = trial;
        best = score;
        layout = trialLayout;
        routed = trialRouted;
      }
    }
  }

  return [layout, routed];
}

function gridPathLength(path: readonly Cell[]): number {
  let sum = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [c1, r1] = path[i] as Cell;
    const [c2, r2] = path[i + 1] as Cell;
    sum += Math.abs(c2 - c1) + Math.abs(r2 - r1);
  }
  return sum;
}

function nearSideCandidates(graph: Graph, layout: GridLayout, routed: readonly RoutedEdge[]): number[] {
  const direction = normalized(graph.direction);
  const length = new Map<number, number>();
  for (const re of routed) {
    length.set(re.index, gridPathLength(re.gridPath));
  }
  const found: number[] = [];
  graph.edges.forEach((edge, i) => {
    if (isSelfReference(edge) || edge.sourceIsSubgraph || edge.targetIsSubgraph) return;
    const src = layout.placements.get(edge.source);
    const tgt = layout.placements.get(edge.target);
    if (src === undefined || tgt === undefined) return;
    const near = nearSideDirections(src, tgt, direction);
    if (near === null) return;
    const [sc, sr] = getAttachPoint(src, near[0]);
    const [tc, tr] = getAttachPoint(tgt, near[1]);
    const direct = Math.abs(tc - sc) + Math.abs(tr - sr);
    if ((length.get(i) ?? 0) >= direct + NEAR_SIDE_SAVING) {
      found.push(i);
    }
  });
  return found;
}

function setIntersectionCount<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  let count = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) count += 1;
  }
  return count;
}

function setsIntersect<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of smaller) {
    if (larger.has(item)) return true;
  }
  return false;
}

function routeScore(graph: Graph, routed: readonly RoutedEdge[], layout: GridLayout): number {
  const sgBounds = new Map<string, SubgraphBounds>();
  for (const sb of layout.subgraphBounds) sgBounds.set(sb.subgraph.id, sb);
  const sgRegions = computeSgRegions(layout, sgBounds);

  let total = 0;
  const cellsOf: Array<readonly [Set<string>, boolean, Set<string>]> = [];
  for (const re of routed) {
    const path = re.gridPath;
    total += gridPathLength(path);
    total += BEND_COST * Math.max(0, path.length - 2);
    const cells = new Set(re.occupiedCells);
    if (sgRegions.size > 0) {
      total += FOREIGN_SG_COST * setIntersectionCount(cells, foreignSgCells(re.edge, graph, sgRegions));
    }
    cellsOf.push([cells, re.label !== "", new Set([re.edge.source, re.edge.target])]);
  }

  for (let a = 0; a < cellsOf.length; a++) {
    const [cellsA, labelledA, endsA] = cellsOf[a] as readonly [Set<string>, boolean, Set<string>];
    for (let b = a + 1; b < cellsOf.length; b++) {
      const [cellsB, labelledB, endsB] = cellsOf[b] as readonly [Set<string>, boolean, Set<string>];
      const commonCount = setIntersectionCount(cellsA, cellsB);
      if (commonCount === 0) continue;
      if (setsIntersect(endsA, endsB)) {
        if (labelledA && labelledB) total += LABELLED_SHARE_COST;
      } else {
        total += CROSSING_COST * commonCount;
      }
    }
  }
  return total;
}

function crowdedGaps(routed: readonly RoutedEdge[], layout: GridLayout, direction: Direction): Set<number> {
  const coords = layout.layerCoords;
  const vertical = isVertical(direction);
  const gaps = new Set<number>();
  for (const re of routed) {
    for (const key of re.crowded) {
      const [col, row] = parseCellId(key);
      const flow = vertical ? row : col;
      for (let i = 0; i < coords.length - 1; i++) {
        if ((coords[i] as number) + 1 < flow && flow < (coords[i + 1] as number) - 1) {
          gaps.add(i);
        }
      }
    }
  }
  return gaps;
}

export function routeEdges(
  graph: Graph,
  layout: GridLayout,
  nearSide: ReadonlySet<number> = new Set()
): RoutedEdge[] {
  const direction = normalized(graph.direction);
  const routed: RoutedEdge[] = [];
  const vertical = isVertical(direction);
  const buses = busEdges(graph);
  const onBus = new Set<number>();
  for (const idxs of buses.values()) {
    for (const i of idxs) onBus.add(i);
  }
  const spans = busSpans(graph, layout, buses, vertical);
  const busCells = new Map<string, BusCells>();

  const sgBounds = new Map<string, SubgraphBounds>();
  for (const sb of layout.subgraphBounds) {
    sgBounds.set(sb.subgraph.id, sb);
  }

  const sgRegions = computeSgRegions(layout, sgBounds);
  const facingHomes: Array<readonly [RoutedEdge, Set<string>]> = [];

  const endpoints = graph.edges.map((edge) => resolveEndpoints(edge, layout, sgBounds));
  const places = graph.edges.map((edge) => endpointPlaces(edge, graph));
  const ends = new Map<number, Array<readonly [string, boolean]>>();
  endpoints.forEach(([src, tgt], i) => {
    const edge = graph.edges[i] as Edge;
    if (src !== null && tgt !== null && !isSelfReference(edge)) {
      ends.set(i, endCells(src, tgt, direction, nearSide.has(i)));
    }
  });

  const axesByIndex = new Map<number, CellAxesMap>();
  const getCellAxes = (re: RoutedEdge): CellAxesMap => {
    let axes = axesByIndex.get(re.index);
    if (axes === undefined) {
      axes = cellAxes(re);
      axesByIndex.set(re.index, axes);
    }
    return axes;
  };

  const edgesOn = new Map<string, Set<number>>();
  places.forEach(([srcIds, tgtIds], j) => {
    for (const nodeId of new Set([...srcIds, ...tgtIds])) {
      let set = edgesOn.get(nodeId);
      if (set === undefined) {
        set = new Set();
        edgesOn.set(nodeId, set);
      }
      set.add(j);
    }
  });

  const order = routingOrder(graph, layout, buses);
  for (let pos = 0; pos < order.length; pos++) {
    const i = order[pos] as number;
    const edge = graph.edges[i] as Edge;
    const [src, tgt] = endpoints[i] as [NodePlacement | null, NodePlacement | null];
    if (src === null || tgt === null) continue;

    if (isSelfReference(edge) && !edge.sourceIsSubgraph) {
      const re = routeSelfEdge(edge, src, layout);
      re.index = i;
      routed.push(re);
      continue;
    }

    const forbidden = foreignSgCells(edge, graph, sgRegions);
    const facing = flowFacingHomes(edge, graph, src, tgt, sgRegions, direction);
    const penalty = sideExitPenalty(facing, sgRegions, direction);

    const placeI = places[i] as Places;
    const related = new Set<number>();
    for (const nodeId of new Set([...placeI[0], ...placeI[1]])) {
      for (const j of edgesOn.get(nodeId) ?? []) {
        if (areRelated(placeI, places[j] as Places)) related.add(j);
      }
    }

    const pendingEnds: Array<Array<readonly [string, boolean]>> = [];
    for (let p = pos + 1; p < order.length; p++) {
      const j = order[p] as number;
      if (!related.has(j)) {
        const endJ = ends.get(j);
        if (endJ !== undefined) pendingEnds.push(endJ);
      }
    }

    const [shared, crossings, blocked] = computeOccupancy(
      routed.map((r) => [r, related.has(r.index)] as const),
      pendingEnds,
      getCellAxes
    );

    let bus: BusCells;
    if (onBus.has(i)) {
      let existing = busCells.get(edge.source);
      if (existing === undefined) {
        existing = { branches: new Set(), preferred: new Set() };
        busCells.set(edge.source, existing);
      }
      bus = existing;
    } else {
      bus = { branches: new Set(), preferred: new Set() };
    }

    const soft = new Set<string>();
    for (const c of shared) {
      if (!bus.branches.has(c)) soft.add(c);
    }
    for (const c of forbidden) soft.add(c);

    const re = routeSingleEdge(
      edge,
      src,
      tgt,
      layout,
      direction,
      soft,
      preferCells(bus.preferred, penalty),
      crossings,
      blocked,
      nearSide.has(i)
    );
    re.index = i;
    routed.push(re);
    facingHomes.push([re, facing]);
    for (const c of re.occupiedCells) bus.branches.add(c);
    if (onBus.has(i) && misalignment(edge, layout, vertical) > 0) {
      if (bus.preferred.size === 0) {
        const span = spans.get(edge.source);
        if (span !== undefined) {
          for (const c of busLane(re.gridPath, span, vertical)) bus.preferred.add(c);
        }
      }
      for (const c of re.occupiedCells) bus.preferred.add(c);
    }
  }

  routed.sort((a, b) => a.index - b.index);
  stepOffFourWaySplits(routed, layout, vertical);
  fitBoxesToCorridors(facingHomes, layout, sgBounds, sgRegions, direction);

  for (const re of routed) {
    const edge = re.edge;
    if (edge.sourceIsSubgraph) {
      const sb = sgBounds.get(edge.source);
      if (sb !== undefined) clipEndpointToBox(re.drawPath, sb, true);
    }
    if (edge.targetIsSubgraph) {
      const sb = sgBounds.get(edge.target);
      if (sb !== undefined) clipEndpointToBox(re.drawPath, sb, false);
    }
  }

  spreadSharedEndpoints(routed, layout, sgBounds);
  return routed;
}

function endpointPlaces(edge: Edge, graph: Graph): Places {
  const place = (endpoint: string, isSg: boolean): Set<string> => {
    const ids = new Set<string>([endpoint]);
    const stack: Array<Subgraph | null> = isSg ? [graph.findSubgraphById(endpoint)] : [];
    while (stack.length > 0) {
      const sg = stack.pop();
      if (sg !== undefined && sg !== null) {
        for (const nid of sg.nodeIds) ids.add(nid);
        for (const child of sg.children) stack.push(child);
      }
    }
    return ids;
  };
  return [place(edge.source, edge.sourceIsSubgraph), place(edge.target, edge.targetIsSubgraph)];
}

function areRelated(a: Places, b: Places): boolean {
  const [aSrc, aTgt] = a;
  const [bSrc, bTgt] = b;
  return (
    setsIntersect(aSrc, bSrc) ||
    setsIntersect(aTgt, bTgt) ||
    (setsIntersect(aSrc, bTgt) && setsIntersect(aTgt, bSrc))
  );
}

function endCells(
  src: NodePlacement,
  tgt: NodePlacement,
  direction: Direction,
  nearSide = false
): Array<readonly [string, boolean]> {
  const [[sDir, tDir]] = getDirections(src, tgt, direction, nearSide);
  const cells: Array<readonly [string, boolean]> = [];
  for (const [placement, attach] of [
    [src, sDir],
    [tgt, tDir],
  ] as const) {
    const [c, r] = getAttachPoint(placement, attach);
    const dc = c - placement.grid.col;
    const dr = r - placement.grid.row;
    cells.push([cellId(c + dc, r + dr), dr === 0]);
  }
  return cells;
}

function computeOccupancy(
  routed: ReadonlyArray<readonly [RoutedEdge, boolean]>,
  pendingEnds: ReadonlyArray<ReadonlyArray<readonly [string, boolean]>>,
  getCellAxes: (re: RoutedEdge) => CellAxesMap
): [Set<string>, Map<string, boolean>, Set<string>] {
  const shared = new Set<string>();
  const crossings = new Map<string, boolean>();
  const blocked = new Set<string>();

  const applyItem = (cell: string, horizontal: boolean | null): void => {
    if (horizontal === null) {
      blocked.add(cell);
      return;
    }
    const existing = crossings.get(cell);
    if (existing === undefined) {
      crossings.set(cell, horizontal);
    } else if (existing !== horizontal) {
      blocked.add(cell);
    }
  };

  for (const [other, isRelated] of routed) {
    if (isRelated) {
      for (const c of other.occupiedCells) shared.add(c);
    } else {
      for (const [cell, horizontal] of getCellAxes(other)) {
        applyItem(cell, horizontal);
      }
    }
  }
  for (const list of pendingEnds) {
    for (const [cell, horizontal] of list) {
      applyItem(cell, horizontal);
    }
  }
  for (const cell of blocked) {
    crossings.delete(cell);
  }
  return [shared, crossings, blocked];
}

function cellAxes(re: RoutedEdge): CellAxesMap {
  if (isSelfReference(re.edge)) {
    const m: CellAxesMap = new Map();
    for (const c of re.occupiedCells) m.set(c, null);
    return m;
  }
  return pathAxes(re.gridPath);
}

function pathAxes(path: readonly Cell[]): CellAxesMap {
  const axes: CellAxesMap = new Map();
  if (path.length === 0) return axes;
  const cells: Cell[] = [path[0] as Cell];
  for (let i = 0; i < path.length - 1; i++) {
    const [c0, r0] = path[i] as Cell;
    const [c1, r1] = path[i + 1] as Cell;
    const dc = (c1 > c0 ? 1 : 0) - (c1 < c0 ? 1 : 0);
    const dr = (r1 > r0 ? 1 : 0) - (r1 < r0 ? 1 : 0);
    while ((cells[cells.length - 1] as Cell)[0] !== c1 || (cells[cells.length - 1] as Cell)[1] !== r1) {
      const last = cells[cells.length - 1] as Cell;
      cells.push([last[0] + dc, last[1] + dr]);
    }
  }
  const first = cells[0] as Cell;
  const last = cells[cells.length - 1] as Cell;
  axes.set(cellId(first[0], first[1]), null);
  axes.set(cellId(last[0], last[1]), null);
  for (let i = 1; i < cells.length - 1; i++) {
    const prev = cells[i - 1] as Cell;
    const cell = cells[i] as Cell;
    const nxt = cells[i + 1] as Cell;
    const straight = cell[0] - prev[0] === nxt[0] - cell[0] && cell[1] - prev[1] === nxt[1] - cell[1];
    axes.set(cellId(cell[0], cell[1]), straight ? prev[1] === cell[1] : null);
  }
  return axes;
}

function routingOrder(graph: Graph, layout: GridLayout, buses: ReadonlyMap<string, number[]>): number[] {
  const vertical = isVertical(normalized(graph.direction));
  const order = Array.from({ length: graph.edges.length }, (_, i) => i);
  for (const indexes of buses.values()) {
    const straightestFirst = [...indexes].sort((a, b) => {
      const diff = misalignment(graph.edges[a] as Edge, layout, vertical) - misalignment(graph.edges[b] as Edge, layout, vertical);
      return diff !== 0 ? diff : a - b;
    });
    indexes.forEach((slot, k) => {
      order[slot] = straightestFirst[k] as number;
    });
  }
  return order;
}

function exitsByCell(paths: ReadonlyArray<readonly Cell[]>): Map<string, Set<string>> {
  const exits = new Map<string, Set<string>>();
  const addExit = (c: number, r: number, dc: number, dr: number): void => {
    const key = cellId(c, r);
    let set = exits.get(key);
    if (set === undefined) {
      set = new Set();
      exits.set(key, set);
    }
    set.add(`${dc},${dr}`);
  };
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [c0, r0] = path[i] as Cell;
      const [c1, r1] = path[i + 1] as Cell;
      const dc = (c1 > c0 ? 1 : 0) - (c1 < c0 ? 1 : 0);
      const dr = (r1 > r0 ? 1 : 0) - (r1 < r0 ? 1 : 0);
      let c = c0;
      let r = r0;
      while (c !== c1 || r !== r1) {
        addExit(c, r, dc, dr);
        c += dc;
        r += dr;
        addExit(c, r, -dc, -dr);
      }
    }
  }
  return exits;
}

function isStraightExits(exits: ReadonlySet<string>): boolean {
  if (exits.size !== 2) return false;
  const [[a, b], [c, d]] = [...exits].map((s) => parseCellId(s)) as [Cell, Cell];
  return a === -c && b === -d;
}

function stepAside(path: Array<[number, number]>, x: number, y: number, vertical: boolean): boolean {
  for (let k = 0; k < path.length - 1; k++) {
    const [x0, y0] = path[k] as [number, number];
    const [x1, y1] = path[k + 1] as [number, number];
    const through = vertical
      ? x0 === x && x1 === x && Math.min(y0, y1) < y && y < Math.max(y0, y1)
      : y0 === y && y1 === y && Math.min(x0, x1) < x && x < Math.max(x0, x1);
    if (through) {
      const side: [number, number] = vertical ? [x + 1, y] : [x, y + 1];
      const end: [number, number] = vertical ? [x1 + 1, y1] : [x1, y1 + 1];
      path.splice(k + 1, 1, [x, y], side, end);
      return true;
    }
  }
  return false;
}

function stepOffFourWaySplits(routed: readonly RoutedEdge[], layout: GridLayout, vertical: boolean): void {
  const bySource = new Map<string, RoutedEdge[]>();
  for (const re of routed) {
    if (isSelfReference(re.edge)) continue;
    let list = bySource.get(re.edge.source);
    if (list === undefined) {
      list = [];
      bySource.set(re.edge.source, list);
    }
    list.push(re);
  }
  for (const lines of bySource.values()) {
    if (lines.length < 3) continue;
    const exitsPerLine = lines.map((re) => exitsByCell([re.gridPath]));
    for (const [cellKeyStr, exits] of exitsByCell(lines.map((re) => re.gridPath))) {
      let straightThrough = 0;
      for (const own of exitsPerLine) {
        const ownExits = own.get(cellKeyStr);
        if (ownExits !== undefined && isStraightExits(ownExits)) straightThrough += 1;
      }
      const isCrossing = straightThrough >= 2;
      if (exits.size === 4 && !isCrossing) {
        const [col, row] = parseCellId(cellKeyStr);
        const [x, y] = layout.gridToDrawCenter(col, row);
        for (const re of lines) {
          if (stepAside(re.drawPath, x, y, vertical)) break;
        }
      }
    }
  }
}

function misalignment(edge: Edge, layout: GridLayout, vertical: boolean): number {
  const src = layout.placements.get(edge.source);
  const tgt = layout.placements.get(edge.target);
  if (src === undefined || tgt === undefined) return 0;
  return vertical ? Math.abs(tgt.grid.col - src.grid.col) : Math.abs(tgt.grid.row - src.grid.row);
}

function busSpans(
  graph: Graph,
  layout: GridLayout,
  buses: ReadonlyMap<string, number[]>,
  vertical: boolean
): Map<string, readonly [number, number]> {
  const spans = new Map<string, readonly [number, number]>();
  for (const [source, indexes] of buses) {
    const src = layout.placements.get(source);
    if (src === undefined) continue;
    const a = vertical ? src.grid.col : src.grid.row;
    let lo = a;
    let hi = a;
    for (const i of indexes) {
      const tgt = layout.placements.get((graph.edges[i] as Edge).target);
      if (tgt !== undefined) {
        const b = vertical ? tgt.grid.col : tgt.grid.row;
        lo = Math.min(lo, b);
        hi = Math.max(hi, b);
      }
    }
    spans.set(source, [lo, hi]);
  }
  return spans;
}

function busLane(path: readonly Cell[], span: readonly [number, number], vertical: boolean): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < path.length - 1; i++) {
    const [c1, r1] = path[i] as Cell;
    const [c2, r2] = path[i + 1] as Cell;
    if (vertical && r1 === r2 && c1 !== c2) {
      for (let c = span[0]; c <= span[1]; c++) out.add(cellId(c, r1));
      return out;
    }
    if (!vertical && c1 === c2 && r1 !== r2) {
      for (let r = span[0]; r <= span[1]; r++) out.add(cellId(c1, r));
      return out;
    }
  }
  return out;
}

function preferCells(
  cells: ReadonlySet<string>,
  penalty: ((col: number, row: number) => number) | null
): ((col: number, row: number) => number) | null {
  if (cells.size === 0) return penalty;
  return (c: number, r: number): number => {
    const base = penalty !== null ? penalty(c, r) : 0;
    return base + (cells.has(cellId(c, r)) ? 0 : OFF_BUS_COST);
  };
}

function spreadSharedEndpoints(
  routed: RoutedEdge[],
  layout: GridLayout,
  sgBounds: ReadonlyMap<string, SubgraphBounds>
): void {
  const endGroups = new Map<string, RoutedEdge[]>();
  for (const re of routed) {
    if (re.drawPath.length < 2) continue;
    const [x, y] = re.drawPath[re.drawPath.length - 1] as [number, number];
    const key = cellId(x, y);
    const group = endGroups.get(key);
    if (group === undefined) endGroups.set(key, [re]);
    else group.push(re);
  }

  for (const [, edges] of endGroups) {
    if (edges.length <= 1) continue;
    const targetId = (edges[0] as RoutedEdge).edge.target;
    let target = layout.placements.get(targetId);
    if (target === undefined) {
      const sb = sgBounds.get(targetId);
      if (sb !== undefined) {
        target = {
          ...makePlacement(targetId, { col: 0, row: 0 }),
          drawX: sb.x,
          drawY: sb.y,
          drawWidth: sb.width,
          drawHeight: sb.height,
        };
      }
    }
    if (target === undefined) continue;
    applySpread(edges, (edges[0] as RoutedEdge).drawPath[edges[0]!.drawPath.length - 1] as [number, number], target);
  }
}

function applySpread(edges: RoutedEdge[], point: [number, number], placement: NodePlacement): void {
  const n = edges.length;
  const [px, py] = point;
  const attach = (edges[0] as RoutedEdge).endDir;

  if (attach === AttachDir.TOP || attach === AttachDir.BOTTOM) {
    const minX = placement.drawX + 1;
    const maxX = placement.drawX + placement.drawWidth - 2;
    const range = maxX - minX;
    if (range < n - 1) return;
    const step = Math.min(MAX_SPREAD_STEP, Math.floor(range / Math.max(n - 1, 1)));
    edges.forEach((re, i) => {
      const offset = Math.trunc((i - (n - 1) / 2) * step);
      if (offset === 0) return;
      const newX = Math.max(minX, Math.min(maxX, px + offset));
      const [, adjY] = re.drawPath[re.drawPath.length - 2] as [number, number];
      re.drawPath[re.drawPath.length - 1] = [newX, py];
      re.drawPath[re.drawPath.length - 2] = [newX, adjY];
    });
    return;
  }

  const minY = placement.drawY + 1;
  const maxY = placement.drawY + placement.drawHeight - 2;
  const range = maxY - minY;
  if (range < n - 1) return;
  const minGap = Math.min(
    ...edges.map((re) => Math.abs(px - (re.drawPath[re.drawPath.length - 2] as [number, number])[0]))
  );
  if (minGap < MIN_APPROACH) return;
  const step = Math.min(MAX_SPREAD_STEP, Math.floor(range / Math.max(n - 1, 1)));
  edges.forEach((re, i) => {
    const offset = Math.trunc((i - (n - 1) / 2) * step);
    if (offset === 0) return;
    const newY = Math.max(minY, Math.min(maxY, py + offset));
    const [adjX] = re.drawPath[re.drawPath.length - 2] as [number, number];
    re.drawPath[re.drawPath.length - 1] = [px, newY];
    re.drawPath.splice(re.drawPath.length - 1, 0, [adjX, newY]);
  });
}

function sgMemberPlacements(sb: SubgraphBounds, layout: GridLayout): NodePlacement[] {
  const ids = new Set<string>();
  const gather = (sg: Subgraph): void => {
    for (const id of sg.nodeIds) ids.add(id);
    for (const child of sg.children) gather(child);
  };
  gather(sb.subgraph);
  const placements: NodePlacement[] = [];
  for (const id of ids) {
    const p = layout.placements.get(id);
    if (p !== undefined) placements.push(p);
  }
  return placements;
}

function resolveEndpoints(
  edge: Edge,
  layout: GridLayout,
  sgBounds: ReadonlyMap<string, SubgraphBounds>
): [NodePlacement | null, NodePlacement | null] {
  if (!edge.sourceIsSubgraph && !edge.targetIsSubgraph) {
    return [layout.placements.get(edge.source) ?? null, layout.placements.get(edge.target) ?? null];
  }

  const candidates = (id: string, isSg: boolean): NodePlacement[] => {
    if (!isSg) {
      const p = layout.placements.get(id);
      return p === undefined ? [] : [p];
    }
    const sb = sgBounds.get(id);
    return sb === undefined ? [] : sgMemberPlacements(sb, layout);
  };

  const srcCands = candidates(edge.source, edge.sourceIsSubgraph);
  const tgtCands = candidates(edge.target, edge.targetIsSubgraph);
  if (srcCands.length === 0 || tgtCands.length === 0) return [null, null];

  const centre = (p: NodePlacement): [number, number] => [
    p.drawX + Math.floor(p.drawWidth / 2),
    p.drawY + Math.floor(p.drawHeight / 2),
  ];

  let bestSrc = srcCands[0] as NodePlacement;
  let bestTgt = tgtCands[0] as NodePlacement;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of srcCands) {
    const [sx, sy] = centre(s);
    for (const t of tgtCands) {
      const [tx, ty] = centre(t);
      const dist = Math.abs(sx - tx) + Math.abs(sy - ty);
      const better =
        dist < bestDist ||
        (dist === bestDist &&
          (pyCompare(s.nodeId, bestSrc.nodeId) < 0 ||
            (s.nodeId === bestSrc.nodeId && pyCompare(t.nodeId, bestTgt.nodeId) < 0)));
      if (better) {
        bestDist = dist;
        bestSrc = s;
        bestTgt = t;
      }
    }
  }

  const virtualize = (id: string, isSg: boolean, member: NodePlacement): NodePlacement => {
    if (!isSg) return member;
    const sb = sgBounds.get(id) as SubgraphBounds;
    return {
      nodeId: id,
      grid: { col: member.grid.col, row: member.grid.row },
      drawX: sb.x,
      drawY: sb.y,
      drawWidth: sb.width,
      drawHeight: sb.height,
    };
  };

  return [
    virtualize(edge.source, edge.sourceIsSubgraph, bestSrc),
    virtualize(edge.target, edge.targetIsSubgraph, bestTgt),
  ];
}

function clipEndpointToBox(drawPath: Array<[number, number]>, sb: SubgraphBounds, fromStart: boolean): void {
  if (drawPath.length < 2) return;
  const pts = fromStart ? drawPath : drawPath.slice().reverse();
  const x0 = sb.x;
  const y0 = sb.y;
  const x1 = sb.x + sb.width - 1;
  const y1 = sb.y + sb.height - 1;
  const inside = ([px, py]: [number, number]): boolean => px > x0 && px < x1 && py > y0 && py < y1;

  let k = 0;
  while (k < pts.length && inside(pts[k] as [number, number])) k++;
  if (k >= pts.length) return;

  let clipped: Array<[number, number]>;
  if (k === 0) {
    const [ax, ay] = pts[0] as [number, number];
    const [bx] = pts[1] as [number, number];
    const snapped: [number, number] =
      ax === bx ? [ax, Math.min(Math.max(ay, y0), y1)] : [Math.min(Math.max(ax, x0), x1), ay];
    clipped = [snapped, ...pts.slice(1)];
  } else {
    const [px, py] = pts[k - 1] as [number, number];
    const [qx, qy] = pts[k] as [number, number];
    const cross: [number, number] = px === qx ? [px, qy > py ? y1 : y0] : [qx > px ? x1 : x0, py];
    clipped = [cross, ...pts.slice(k)];
  }

  if (clipped.length >= 2 && clipped[0]![0] === clipped[1]![0] && clipped[0]![1] === clipped[1]![1]) {
    clipped = clipped.slice(1);
  }
  if (clipped.length < 2) return;

  if (clipped.length >= 4) {
    const [cx, cy] = clipped[0] as [number, number];
    const [nx, ny] = clipped[1] as [number, number];
    const [mx, my] = clipped[2] as [number, number];
    const [px, py] = clipped[3] as [number, number];
    if (cx === nx && ny === my && Math.abs(cy - ny) < 3) {
      const sign = cy > ny ? 1 : -1;
      const newY = cy - 3 * sign;
      if ((sign > 0 && py < newY) || (sign < 0 && py > newY)) {
        clipped[1] = [nx, newY];
        clipped[2] = [mx, newY];
      }
    } else if (cy === ny && nx === mx && Math.abs(cx - nx) < 3) {
      const sign = cx > nx ? 1 : -1;
      const newX = cx - 3 * sign;
      if ((sign > 0 && px < newX) || (sign < 0 && px > newX)) {
        clipped[1] = [newX, ny];
        clipped[2] = [newX, my];
      }
    }
  }

  if (!fromStart) clipped.reverse();
  drawPath.splice(0, drawPath.length, ...clipped);
}

function computeSgRegions(layout: GridLayout, sgBounds: ReadonlyMap<string, SubgraphBounds>): Map<string, SgRegion> {
  const regions = new Map<string, SgRegion>();
  for (const [id, sb] of sgBounds) {
    const members = sgMemberPlacements(sb, layout);
    if (members.length === 0) continue;
    const cols = members.map((p) => p.grid.col);
    const rows = members.map((p) => p.grid.row);
    regions.set(id, [Math.min(...cols) - 1, Math.max(...cols) + 1, Math.min(...rows) - 1, Math.max(...rows) + 1]);
  }
  return regions;
}

function homeChain(endpoint: string, isSg: boolean, graph: Graph): string[] {
  let sg = isSg ? graph.findSubgraphById(endpoint) : graph.findSubgraphForNode(endpoint);
  const chain: string[] = [];
  while (sg !== null) {
    chain.push(sg.id);
    sg = sg.parent;
  }
  return chain;
}

function flowFacingHomes(
  edge: Edge,
  graph: Graph,
  src: NodePlacement,
  tgt: NodePlacement,
  sgRegions: ReadonlyMap<string, SgRegion>,
  direction: Direction
): Set<string> {
  const srcChain = homeChain(edge.source, edge.sourceIsSubgraph, graph);
  const tgtChain = homeChain(edge.target, edge.targetIsSubgraph, graph);
  const vertical = isVertical(direction);
  const facing = new Set<string>();
  for (const [chain, otherChain, other] of [
    [srcChain, new Set(tgtChain), tgt],
    [tgtChain, new Set(srcChain), src],
  ] as const) {
    const otherFlow = vertical ? other.grid.row : other.grid.col;
    for (const sgId of chain) {
      const region = sgRegions.get(sgId);
      if (region === undefined) continue;
      const [c0, c1, r0, r1] = region;
      const [f0, f1] = vertical ? [r0, r1] : [c0, c1];
      if (otherChain.has(sgId) || !(f0 <= otherFlow && otherFlow <= f1)) {
        facing.add(sgId);
      }
    }
  }
  return facing;
}

function foreignSgCells(edge: Edge, graph: Graph, sgRegions: ReadonlyMap<string, SgRegion>): Set<string> {
  if (sgRegions.size === 0) return new Set();

  const allowed = new Set<string>([
    ...homeChain(edge.source, edge.sourceIsSubgraph, graph),
    ...homeChain(edge.target, edge.targetIsSubgraph, graph),
  ]);
  for (const [endpoint, isSg] of [
    [edge.source, edge.sourceIsSubgraph],
    [edge.target, edge.targetIsSubgraph],
  ] as const) {
    if (!isSg) continue;
    const stack: Array<Subgraph | null> = [graph.findSubgraphById(endpoint)];
    while (stack.length > 0) {
      const sg = stack.pop();
      if (sg !== undefined && sg !== null) {
        allowed.add(sg.id);
        for (const child of sg.children) stack.push(child);
      }
    }
  }

  const cells = new Set<string>();
  for (const [id, [c0, c1, r0, r1]] of sgRegions) {
    if (allowed.has(id)) continue;
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) cells.add(cellId(c, r));
    }
  }
  return cells;
}

function sideExitPenalty(
  homes: ReadonlySet<string>,
  sgRegions: ReadonlyMap<string, SgRegion>,
  direction: Direction
): ((col: number, row: number) => number) | null {
  const vertical = isVertical(direction);
  const bands: Array<readonly [number, number, number, number]> = [];
  for (const sgId of homes) {
    const region = sgRegions.get(sgId);
    if (region === undefined) continue;
    const [c0, c1, r0, r1] = region;
    bands.push(vertical ? [r0, r1, c0 - 1, c1 + 1] : [c0, c1, r0 - 1, r1 + 1]);
  }
  if (bands.length === 0) return null;

  return (col: number, row: number): number => {
    const flow = vertical ? row : col;
    const cross = vertical ? col : row;
    let hits = 0;
    for (const [f0, f1, x0, x1] of bands) {
      if (f0 <= flow && flow <= f1 && !(x0 <= cross && cross <= x1)) hits += 1;
    }
    return 2.0 * hits;
  };
}

function fitBoxesToCorridors(
  facingHomes: ReadonlyArray<readonly [RoutedEdge, Set<string>]>,
  layout: GridLayout,
  sgBounds: ReadonlyMap<string, SubgraphBounds>,
  sgRegions: ReadonlyMap<string, SgRegion>,
  direction: Direction
): void {
  const vertical = isVertical(direction);
  for (const [re, facing] of facingHomes) {
    for (const sgId of facing) {
      const region = sgRegions.get(sgId);
      const sb = sgBounds.get(sgId);
      if (region === undefined || sb === undefined) continue;
      const [c0, c1, r0, r1] = region;
      const [f0, f1, x0, x1] = vertical ? [r0, r1, c0, c1] : [c0, c1, r0, r1];
      const step: Cell = vertical ? [0, 1] : [1, 0];

      const besideSet = new Set<string>();
      const besideCells: Cell[] = [];
      for (const key of re.occupiedCells) {
        const [c, r] = parseCellId(key);
        const flow = vertical ? r : c;
        const cross = vertical ? c : r;
        if (f0 <= flow && flow <= f1 && (cross === x0 - 1 || cross === x1 + 1)) {
          besideSet.add(key);
          besideCells.push([c, r]);
        }
      }
      besideCells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

      const corridor: Array<[number, number]> = [];
      for (const [c, r] of besideCells) {
        if (
          besideSet.has(cellId(c + step[0], r + step[1])) ||
          besideSet.has(cellId(c - step[0], r - step[1]))
        ) {
          corridor.push(layout.gridToDrawCenter(c, r));
        }
      }
      if (corridor.length > 0) {
        growBox(sb, corridor, layout, vertical);
      }
    }
  }

  for (const sb of layout.subgraphBounds) {
    for (const child of sb.subgraph.children) {
      const cb = sgBounds.get(child.id);
      if (cb !== undefined) {
        growBox(
          sb,
          [
            [cb.x, cb.y],
            [cb.x + cb.width - 1, cb.y + cb.height - 1],
          ],
          layout,
          vertical
        );
      }
    }
  }
}

function growBox(
  sb: SubgraphBounds,
  points: ReadonlyArray<readonly [number, number]>,
  layout: GridLayout,
  vertical: boolean
): void {
  if (vertical) {
    const lo = Math.min(sb.x, Math.min(...points.map(([x]) => x)) - SG_BORDER_PAD);
    const hi = Math.max(sb.x + sb.width - 1, Math.max(...points.map(([x]) => x)) + SG_BORDER_PAD);
    sb.x = lo;
    sb.width = hi - lo + 1;
    layout.canvasWidth = Math.max(layout.canvasWidth, hi + 1);
  } else {
    const lo = Math.min(sb.y, Math.min(...points.map(([, y]) => y)) - SG_BORDER_PAD);
    const hi = Math.max(sb.y + sb.height - 1, Math.max(...points.map(([, y]) => y)) + SG_BORDER_PAD);
    sb.y = lo;
    sb.height = hi - lo + 1;
    layout.canvasHeight = Math.max(layout.canvasHeight, hi + 1);
  }
}

function getAttachPoint(placement: NodePlacement, dir: AttachDir): Cell {
  const { col, row } = placement.grid;
  if (dir === AttachDir.TOP) return [col, row - 1];
  if (dir === AttachDir.BOTTOM) return [col, row + 1];
  if (dir === AttachDir.LEFT) return [col - 1, row];
  return [col + 1, row];
}

function nearSideDirections(
  src: NodePlacement,
  tgt: NodePlacement,
  direction: Direction
): [AttachDir, AttachDir] | null {
  const sc = src.grid.col;
  const sr = src.grid.row;
  const tc = tgt.grid.col;
  const tr = tgt.grid.row;
  if (isHorizontal(direction)) {
    if (tc < sc && tr !== sr) {
      return tr > sr ? [AttachDir.BOTTOM, AttachDir.TOP] : [AttachDir.TOP, AttachDir.BOTTOM];
    }
  } else if (tr < sr && tc !== sc) {
    return tc > sc ? [AttachDir.RIGHT, AttachDir.LEFT] : [AttachDir.LEFT, AttachDir.RIGHT];
  }
  return null;
}

function getDirections(
  src: NodePlacement,
  tgt: NodePlacement,
  direction: Direction,
  nearSide = false
): [[AttachDir, AttachDir], [AttachDir, AttachDir]] {
  if (nearSide) {
    const near = nearSideDirections(src, tgt, direction);
    if (near !== null) return [near, near];
  }
  return determineDirections(src, tgt, direction);
}

function determineDirections(
  src: NodePlacement,
  tgt: NodePlacement,
  direction: Direction
): [[AttachDir, AttachDir], [AttachDir, AttachDir]] {
  const sc = src.grid.col;
  const sr = src.grid.row;
  const tc = tgt.grid.col;
  const tr = tgt.grid.row;

  if (isHorizontal(direction)) {
    let preferred: [AttachDir, AttachDir];
    if (tc > sc) preferred = [AttachDir.RIGHT, AttachDir.LEFT];
    else if (tc < sc) return [[AttachDir.BOTTOM, AttachDir.BOTTOM], [AttachDir.BOTTOM, AttachDir.TOP]];
    else preferred = tr > sr ? [AttachDir.BOTTOM, AttachDir.TOP] : [AttachDir.TOP, AttachDir.BOTTOM];

    const alt: [AttachDir, AttachDir] =
      tr > sr ? [AttachDir.BOTTOM, AttachDir.TOP] : tr < sr ? [AttachDir.TOP, AttachDir.BOTTOM] : preferred;
    return [preferred, alt];
  }

  let preferred: [AttachDir, AttachDir];
  if (tr > sr) preferred = [AttachDir.BOTTOM, AttachDir.TOP];
  else if (tr < sr) return [[AttachDir.RIGHT, AttachDir.RIGHT], [AttachDir.RIGHT, AttachDir.LEFT]];
  else preferred = tc > sc ? [AttachDir.RIGHT, AttachDir.LEFT] : [AttachDir.LEFT, AttachDir.RIGHT];

  const alt: [AttachDir, AttachDir] =
    tc > sc ? [AttachDir.RIGHT, AttachDir.LEFT] : tc < sc ? [AttachDir.LEFT, AttachDir.RIGHT] : preferred;
  return [preferred, alt];
}

function routeSingleEdge(
  edge: Edge,
  src: NodePlacement,
  tgt: NodePlacement,
  layout: GridLayout,
  direction: Direction,
  softObstacles: ReadonlySet<string>,
  penalty: ((col: number, row: number) => number) | null,
  crossings: ReadonlyMap<string, boolean>,
  blocked: ReadonlySet<string>,
  nearSide = false
): RoutedEdge {
  const [preferred, alt] = getDirections(src, tgt, direction, nearSide);
  const startPref = getAttachPoint(src, preferred[0]);
  const endPref = getAttachPoint(tgt, preferred[1]);
  const startAlt = getAttachPoint(src, alt[0]);
  const endAlt = getAttachPoint(tgt, alt[1]);

  const clear = (c: number, r: number): boolean => layout.isFree(c, r) && !blocked.has(cellId(c, r));
  const crowding = (c: number, r: number): number => {
    const key = cellId(c, r);
    const held = blocked.has(key) || crossings.has(key);
    return (penalty !== null ? penalty(c, r) : 0) + (held ? CROWDING_COST : 0);
  };

  const search = (start: Cell, end: Cell, strict: boolean): Cell[] | null => {
    if (strict) {
      return findPath(start[0], start[1], end[0], end[1], clear, softObstacles, undefined, {
        penalty,
        crossings,
      });
    }
    return findPath(start[0], start[1], end[0], end[1], (c, r) => layout.isFree(c, r), softObstacles, undefined, {
      penalty: crowding,
    });
  };

  let pathPref = search(startPref, endPref, true);
  let pathAlt = search(startAlt, endAlt, true);

  const idealSoft = new Set<string>(softObstacles);
  for (const k of blocked) idealSoft.add(k);
  for (const k of crossings.keys()) idealSoft.add(k);
  const ideal = findPath(
    startPref[0],
    startPref[1],
    endPref[0],
    endPref[1],
    (c, r) => layout.isFree(c, r),
    idealSoft,
    undefined,
    { penalty }
  );

  const crowded = new Set<string>();
  if (ideal !== null) {
    for (const [cell, horizontal] of pathAxes(ideal)) {
      if (blocked.has(cell) || (crossings.has(cell) && (horizontal === null || horizontal === crossings.get(cell)))) {
        crowded.add(cell);
      }
    }
  }

  if (pathPref === null && pathAlt === null) {
    pathPref = search(startPref, endPref, false);
    pathAlt = search(startAlt, endAlt, false);
  }

  let path: Cell[];
  let startDir: AttachDir;
  let endDir: AttachDir;
  if (pathPref !== null && pathAlt !== null) {
    [path, [startDir, endDir]] =
      pathPref.length <= pathAlt.length + PREFER_BIAS ? [pathPref, preferred] : [pathAlt, alt];
  } else if (pathPref !== null) {
    [path, [startDir, endDir]] = [pathPref, preferred];
  } else if (pathAlt !== null) {
    [path, [startDir, endDir]] = [pathAlt, alt];
  } else {
    // Last resort: a straight two-point path. When the points differ on both axes by different amounts it is a
    // diagonal that pathAxes and exitsByCell can never walk (they step both coordinates by one and never land on
    // the end point), so refuse it. The pinned reference loops forever on this input, so no reference drawing exists.
    const dCol = Math.abs(endPref[0] - startPref[0]);
    const dRow = Math.abs(endPref[1] - startPref[1]);
    if (dCol !== 0 && dRow !== 0 && dCol !== dRow) {
      throw new Error("Cannot route an edge between two nodes: no axis-aligned path was found");
    }
    path = [startPref, endPref];
    [startDir, endDir] = preferred;
  }

  const simplified = simplifyPath(path);
  return {
    edge,
    gridPath: simplified,
    drawPath: simplified.map(([c, r]) => layout.gridToDrawCenter(c, r)),
    startDir,
    endDir,
    label: edge.label,
    index: 0,
    occupiedCells: new Set(path.map(([c, r]) => cellId(c, r))),
    crowded,
  };
}

function routeSelfEdge(edge: Edge, src: NodePlacement, layout: GridLayout): RoutedEdge {
  const { col, row } = src.grid;
  const path: Cell[] = [
    [col, row - 1],
    [col, row - 2],
    [col + 2, row - 2],
    [col + 2, row],
    [col + 1, row],
  ];
  return {
    edge,
    gridPath: path,
    drawPath: path.map(([c, r]) => layout.gridToDrawCenter(c, r)),
    startDir: AttachDir.TOP,
    endDir: AttachDir.RIGHT,
    label: edge.label,
    index: 0,
    occupiedCells: new Set(path.map(([c, r]) => cellId(c, r))),
    crowded: new Set(),
  };
}
