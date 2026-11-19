// Ported from src/termaid/layout/layers.py.
//
// Which layer a node sits in (its depth from a root) and in what order the nodes of one layer run, ordered by a
// barycentre heuristic so edges cross as little as they can.

import { isSelfReference, isVertical, makeEdge, normalized, type Edge, type Graph, type Subgraph } from "../graph/model.ts";

const ONE_LAYER = 1;
const MAX_PASSES = 8;
const MAX_FRUITLESS = 4;

/**
 * Expand subgraph-endpoint edges into member-to-member virtual edges for layer assignment.
 */
export function expandSubgraphEdges(graph: Graph): Edge[] {
  const members = (sg: Subgraph, into: Set<string>): void => {
    for (const id of sg.nodeIds) into.add(id);
    for (const child of sg.children) members(child, into);
  };

  const order = new Map<string, number>();
  graph.nodeOrder.forEach((nid, i) => order.set(nid, i));

  const virtual: Edge[] = [];
  for (const e of graph.edges) {
    if (!e.sourceIsSubgraph && !e.targetIsSubgraph) continue;
    const sources = new Set<string>();
    const targets = new Set<string>();
    for (const [endpoint, isSubgraph, bucket] of [
      [e.source, e.sourceIsSubgraph, sources],
      [e.target, e.targetIsSubgraph, targets],
    ] as Array<[string, boolean, Set<string>]>) {
      if (!isSubgraph) {
        bucket.add(endpoint);
        continue;
      }
      const sg = graph.findSubgraphById(endpoint);
      if (sg !== null) members(sg, bucket);
    }
    const shared = [...sources].some((s) => targets.has(s));
    if (sources.size === 0 || targets.size === 0 || shared) continue;

    const sortedSources = [...sources].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const sortedTargets = [...targets].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    for (const s of sortedSources) {
      for (const t of sortedTargets) {
        virtual.push(makeEdge(s, t, { minLength: e.minLength }));
      }
    }
  }
  return virtual;
}

function orthogonalSubgraphNodes(graph: Graph): Array<Set<string>> {
  const graphVertical = isVertical(normalized(graph.direction));
  const result: Array<Set<string>> = [];
  const walk = (subs: Subgraph[]): void => {
    for (const sg of subs) {
      if (sg.direction !== null && isVertical(normalized(sg.direction)) !== graphVertical) {
        result.push(new Set(sg.nodeIds));
      }
      walk(sg.children);
    }
  };
  walk(graph.subgraphs);
  return result;
}

type Endpoints = readonly [string, string];
type ByEndpoints<T> = Map<string, Map<string, T>>;

function put<T>(into: ByEndpoints<T>, source: string, target: string, value: T): void {
  const row = into.get(source);
  if (row === undefined) into.set(source, new Map([[target, value]]));
  else row.set(target, value);
}

export function assignLayers(graph: Graph): Map<string, number> {
  const layers = new Map<string, number>();
  const roots = graph.getRoots();
  for (const root of roots) if (!layers.has(root)) layers.set(root, 0);

  const treeEdges: Endpoints[] = [];
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (visited.has(root)) continue;
    visited.add(root);
    queue.push(root);
  }

  const walk = (): void => {
    while (queue.length > 0) {
      const node = queue.shift() as string;
      for (const child of graph.getChildren(node)) {
        if (visited.has(child)) continue;
        visited.add(child);
        treeEdges.push([node, child]);
        queue.push(child);
      }
    }
  };
  walk();
  for (const id of graph.nodeOrder) {
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(id);
    walk();
  }

  const minLengths: ByEndpoints<number> = new Map();
  const minLengthOf = (source: string, target: string): number =>
    minLengths.get(source)?.get(target) ?? ONE_LAYER;
  for (const e of graph.edges) put(minLengths, e.source, e.target, Math.max(minLengthOf(e.source, e.target), e.minLength));

  const relax = (skip: Set<string> | null): void => {
    let changed = true;
    const maxIterations = graph.nodeOrder.length * 2;
    for (let iteration = 0; changed && iteration < maxIterations; iteration++) {
      changed = false;
      for (const [src, tgt] of treeEdges) {
        const from = layers.get(src);
        if (from === undefined) continue;
        if (skip !== null && skip.has(tgt)) continue;
        const candidate = from + minLengthOf(src, tgt);
        const current = layers.get(tgt);
        if (current === undefined || current < candidate) {
          layers.set(tgt, candidate);
          changed = true;
        }
      }
    }
  };

  relax(null);
  for (const id of graph.nodeOrder) if (!layers.has(id)) layers.set(id, 0);

  const orthoSets = orthogonalSubgraphNodes(graph);
  if (orthoSets.length === 0) return layers;

  for (const nodes of orthoSets) {
    const present = [...nodes].filter((id) => layers.has(id));
    if (present.length === 0) continue;
    const min = Math.min(...present.map((id) => layers.get(id) as number));
    for (const id of present) layers.set(id, min);
  }

  const allOrtho = new Set<string>();
  for (const set of orthoSets) for (const id of set) allOrtho.add(id);
  for (const id of graph.nodeOrder) if (!allOrtho.has(id)) layers.delete(id);
  for (const root of graph.getRoots()) if (!layers.has(root)) layers.set(root, 0);
  relax(allOrtho);
  for (const id of graph.nodeOrder) if (!layers.has(id)) layers.set(id, 0);

  return layers;
}

export function separateSubgraphLayers(graph: Graph, layers: Map<string, number>): Map<string, number> {
  if (graph.subgraphs.length === 0) return layers;

  const nodeSg = new Map<string, string>();
  const mapSg = (subs: Subgraph[]): void => {
    for (const sg of subs) {
      mapSg(sg.children);
      for (const id of sg.nodeIds) nodeSg.set(id, sg.id);
    }
  };
  mapSg(graph.subgraphs);

  const ranges = new Map<string, [number, number]>();
  for (const [id, layer] of layers) {
    const sgId = nodeSg.get(id);
    if (sgId === undefined) continue;
    const range = ranges.get(sgId);
    if (range === undefined) ranges.set(sgId, [layer, layer]);
    else ranges.set(sgId, [Math.min(range[0], layer), Math.max(range[1], layer)]);
  }
  if (ranges.size < 2) return layers;

  // Declaration order, so sibling subgraphs stack the way they were written.
  const sgIds: string[] = [];
  const collectDeclared = (subs: Subgraph[]): void => {
    for (const sg of subs) {
      if (ranges.has(sg.id)) sgIds.push(sg.id);
      collectDeclared(sg.children);
    }
  };
  collectDeclared(graph.subgraphs);

  let overlap = false;
  for (let i = 0; i < sgIds.length && !overlap; i++) {
    for (let j = i + 1; j < sgIds.length; j++) {
      const a = ranges.get(sgIds[i] as string) as [number, number];
      const b = ranges.get(sgIds[j] as string) as [number, number];
      if (a[0] <= b[1] && b[0] <= a[1]) {
        overlap = true;
        break;
      }
    }
  }
  if (!overlap) return layers;

  const succs = new Map<string, string[]>(sgIds.map((id) => [id, []]));
  const inDegree = new Map<string, number>(sgIds.map((id) => [id, 0]));
  for (const e of graph.edges) {
    const from = nodeSg.get(e.source);
    const to = nodeSg.get(e.target);
    if (from === undefined || to === undefined || from === to) continue;
    const bucket = succs.get(from);
    if (bucket === undefined || bucket.includes(to)) continue;
    bucket.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  const pending = sgIds.filter((id) => inDegree.get(id) === 0);
  const topo: string[] = [];
  while (pending.length > 0) {
    const id = pending.shift() as string;
    topo.push(id);
    for (const succ of succs.get(id) ?? []) {
      const left = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, left);
      if (left === 0) pending.push(succ);
    }
  }
  if (topo.length !== sgIds.length) return layers;

  const internals = new Map<string, Map<string, number>>();
  const sizes = new Map<string, number>();
  for (const sgId of topo) {
    const sgNodes = graph.nodeOrder.filter((nid) => nodeSg.get(nid) === sgId);
    const sgMember = new Set(sgNodes);
    const edges = graph.edges.filter((e) => sgMember.has(e.source) && sgMember.has(e.target) && !isSelfReference(e));
    const targets = new Set(edges.map((e) => e.target));
    let roots = sgNodes.filter((id) => !targets.has(id));
    if (roots.length === 0) roots = sgNodes.slice(0, 1);

    const internal = new Map<string, number>(roots.map((id) => [id, 0]));
    let changed = true;
    for (let i = 0; i < sgNodes.length * 2 + 1 && changed; i++) {
      changed = false;
      for (const e of edges) {
        const from = internal.get(e.source);
        if (from === undefined) continue;
        const current = internal.get(e.target);
        if (current === undefined || current < from + 1) {
          internal.set(e.target, from + 1);
          changed = true;
        }
      }
    }
    for (const id of sgNodes) if (!internal.has(id)) internal.set(id, 0);
    internals.set(sgId, internal);
    sizes.set(sgId, internal.size > 0 ? Math.max(...internal.values()) + 1 : 0);
  }

  const outside = [...layers].filter(([id]) => !nodeSg.has(id)).map(([, layer]) => layer);
  const firstMin = topo.length > 0 ? (ranges.get(topo[0] as string) as [number, number])[0] : 0;
  const above = outside.filter((layer) => layer < firstMin);
  let offset = above.length > 0 ? Math.max(...above) + 1 : 0;

  const offsets = new Map<string, number>();
  for (const sgId of topo) {
    offsets.set(sgId, offset);
    offset += sizes.get(sgId) ?? 0;
  }

  const next = new Map(layers);
  for (const [sgId, internal] of internals) {
    for (const [id, relative] of internal) next.set(id, (offsets.get(sgId) ?? 0) + relative);
  }

  for (const id of graph.nodeOrder) {
    if (nodeSg.has(id)) continue;
    let best = -1;
    for (const e of graph.edges) {
      if (e.target !== id) continue;
      const from = next.get(e.source);
      if (from !== undefined) best = Math.max(best, from);
    }
    if (best >= 0) next.set(id, best + 1);
  }
  return next;
}

function countCrossings(graph: Graph, layerLists: string[][]): number {
  let total = 0;
  for (let layer = 1; layer < layerLists.length; layer++) {
    const prev = new Map((layerLists[layer - 1] as string[]).map((id, i) => [id, i]));
    const current = new Map((layerLists[layer] as string[]).map((id, i) => [id, i]));
    const between: Array<[number, number]> = [];
    for (const edge of graph.edges) {
      const from = prev.get(edge.source);
      const to = current.get(edge.target);
      if (from !== undefined && to !== undefined) between.push([from, to]);
    }
    for (let i = 0; i < between.length; i++) {
      for (let j = i + 1; j < between.length; j++) {
        const [u1, v1] = between[i] as [number, number];
        const [u2, v2] = between[j] as [number, number];
        if ((u1 - u2) * (v1 - v2) < 0) total++;
      }
    }
  }
  return total;
}

export function orderLayers(graph: Graph, layers: Map<string, number>): string[][] {
  const maxLayer = layers.size > 0 ? Math.max(...layers.values()) : 0;
  let layerLists: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const id of graph.nodeOrder) (layerLists[layers.get(id) ?? 0] as string[]).push(id);

  let bestCrossings = countCrossings(graph, layerLists);
  let bestOrdering = layerLists.map((layer) => layer.slice());
  let fruitless = 0;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    for (let layer = 1; layer < layerLists.length; layer++) {
      const prev = new Map((layerLists[layer - 1] as string[]).map((id, i) => [id, i]));
      const nodes = layerLists[layer] as string[];
      const barycenters = new Map<string, number>();
      for (const id of nodes) {
        const positions: number[] = [];
        for (const edge of graph.edges) {
          if (edge.target !== id) continue;
          const at = prev.get(edge.source);
          if (at !== undefined) positions.push(at);
        }
        barycenters.set(
          id,
          positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : nodes.indexOf(id)
        );
      }
      nodes.sort((a, b) => (barycenters.get(a) ?? 0) - (barycenters.get(b) ?? 0));
    }

    const crossings = countCrossings(graph, layerLists);
    if (crossings < bestCrossings) {
      bestCrossings = crossings;
      bestOrdering = layerLists.map((layer) => layer.slice());
      fruitless = 0;
    } else {
      fruitless++;
    }
    if (fruitless >= MAX_FRUITLESS || bestCrossings === 0) break;
  }

  layerLists = bestOrdering;

  const orthoSets = orthogonalSubgraphNodes(graph);
  if (orthoSets.length === 0) return layerLists;

  for (const layer of layerLists) {
    for (const nodes of orthoSets) {
      const inLayer = layer.filter((id) => nodes.has(id));
      if (inLayer.length <= 1) continue;
      const internal = new Set(inLayer);
      const successors = new Map<string, string[]>([...internal].map((id) => [id, []]));
      const inDegree = new Map<string, number>([...internal].map((id) => [id, 0]));
      for (const edge of graph.edges) {
        if (!internal.has(edge.source) || !internal.has(edge.target)) continue;
        (successors.get(edge.source) as string[]).push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      }
      const pending = inLayer.filter((id) => inDegree.get(id) === 0);
      const topo: string[] = [];
      while (pending.length > 0) {
        const id = pending.shift() as string;
        topo.push(id);
        for (const succ of successors.get(id) ?? []) {
          const left = (inDegree.get(succ) ?? 0) - 1;
          inDegree.set(succ, left);
          if (left === 0) pending.push(succ);
        }
      }
      const positions = layer.map((id, i) => (internal.has(id) ? i : -1)).filter((i) => i !== -1);
      if (topo.length === positions.length) {
        positions.forEach((pos, i) => {
          layer[pos] = topo[i] as string;
        });
      }
    }
  }

  return layerLists;
}

/** Fan-out edge groups eligible to share a horizontal/vertical bus lane. */
export function busEdges(graph: Graph): Map<string, number[]> {
  const inDegree = new Map<string, number>();
  for (const e of graph.edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }
  const bySource = new Map<string, number[]>();
  graph.edges.forEach((e, i) => {
    if (e.label === "" && !isSelfReference(e) && inDegree.get(e.target) === 1) {
      const list = bySource.get(e.source);
      if (list === undefined) bySource.set(e.source, [i]);
      else list.push(i);
    }
  });
  const result = new Map<string, number[]>();
  for (const [src, idxs] of bySource) {
    if (idxs.length > 1) result.set(src, idxs);
  }
  return result;
}

export function computeGapExpansions(graph: Graph, layerOrder: string[][]): Map<number, number> {
  const nodeLayer = new Map<string, number>();
  const nodePos = new Map<string, number>();
  layerOrder.forEach((nodes, layer) => {
    nodes.forEach((id, pos) => {
      nodeLayer.set(id, layer);
      nodePos.set(id, pos);
    });
  });

  const onBus = new Set<number>();
  for (const idxs of busEdges(graph).values()) {
    for (const i of idxs) onBus.add(i);
  }

  const lanesPerGap = new Map<number, Set<string>>();
  graph.edges.forEach((edge, i) => {
    if (isSelfReference(edge)) return;
    const from = nodeLayer.get(edge.source);
    const to = nodeLayer.get(edge.target);
    if (from === undefined || to === undefined) return;
    if ((nodePos.get(edge.source) ?? 0) === (nodePos.get(edge.target) ?? 0)) return;
    for (let gap = Math.min(from, to); gap < Math.max(from, to); gap++) {
      const laneKey = onBus.has(i) && to === from + 1 ? `bus:${edge.source}` : `edge:${i}`;
      let set = lanesPerGap.get(gap);
      if (set === undefined) {
        set = new Set();
        lanesPerGap.set(gap, set);
      }
      set.add(laneKey);
    }
  });

  const expansions = new Map<number, number>();
  for (const [gap, lanes] of lanesPerGap) expansions.set(gap, Math.max(0, lanes.size - 1));
  return expansions;
}
