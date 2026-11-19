// Ported from src/termaid/layout/layers.py.
//
// Which layer a node sits in (its depth from a root) and in what order the nodes of one layer run, ordered by a
// barycentre heuristic so edges cross as little as they can.

import { isSelfReference, isVertical, makeEdge, normalized, type Edge, type Graph, type Subgraph } from "../graph/model.ts";

/** A back edge is worth no layer, and an edge with no length named runs one layer. */
const ONE_LAYER = 1;
/** How many barycentre passes are worth running, and how many fruitless ones end it. */
const MAX_PASSES = 8;
const MAX_FRUITLESS = 4;

/**
 * An edge naming a SUBGRAPH constrains every node of the target under every node of the source, which layering, which
 * only understands node-to-node edges, cannot see. Expanded into one virtual edge per pair, for the layering alone.
 */
export function expandSubgraphEdges(graph: Graph): Edge[] {
  const members = (sg: Subgraph, into: Set<string>): void => {
    for (const id of sg.nodeIds) into.add(id);
    for (const child of sg.children) members(child, into);
  };

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
    // An empty subgraph, a self-edge or nested endpoints: the constraint cannot be satisfied, so it is not stated.
    const shared = [...sources].some((s) => targets.has(s));
    if (sources.size === 0 || targets.size === 0 || shared) continue;
    for (const s of sources) for (const t of targets) virtual.push(makeEdge(s, t, { minLength: e.minLength }));
  }
  return virtual;
}

/** Nodes of a subgraph running ACROSS the graph's own direction, which are laid out as one layer. */
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

/**
 * Two endpoints held as a PAIR, the way `layers.py` keys them (`tuple[str, str]`, lines 72 and 103). Flattening one
 * into a joined string loses the boundary the tuple kept: every separator is a character an id may legally carry,
 * and the id that carries it takes the whole layering down with it.
 */
type Endpoints = readonly [string, string];

/** What one source owes each of its targets, looked up by the two ends and never by a key made of both. */
type ByEndpoints<T> = Map<string, Map<string, T>>;

function put<T>(into: ByEndpoints<T>, source: string, target: string, value: T): void {
  const row = into.get(source);
  if (row === undefined) into.set(source, new Map([[target, value]]));
  else row.set(target, value);
}

/**
 * A layer per node, the LONGEST path from a root. Only tree edges count, discovered breadth first: a node is found at
 * its shallowest depth, so an edge reaching back up is a back edge and never lengthens anything.
 */
export function assignLayers(graph: Graph): Map<string, number> {
  const layers = new Map<string, number>();
  const roots = graph.getRoots();
  for (const root of roots) if (!layers.has(root)) layers.set(root, 0);

  // A list and not a set: the walk below adds an edge only for a child it has never visited, so no pair repeats.
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
  // Whatever the first walk never reached is its own component, and starts its own walk.
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

  // Everything else is recomputed from scratch, or a node below the collapsed set keeps the depth it had before it.
  const allOrtho = new Set<string>();
  for (const set of orthoSets) for (const id of set) allOrtho.add(id);
  for (const id of graph.nodeOrder) if (!allOrtho.has(id)) layers.delete(id);
  for (const root of graph.getRoots()) if (!layers.has(root)) layers.set(root, 0);
  relax(allOrtho);
  for (const id of graph.nodeOrder) if (!layers.has(id)) layers.set(id, 0);

  return layers;
}

/**
 * Two subgraphs sharing a layer draw two boxes over one another. Where that happens, each one is given a contiguous
 * range of its own: internal edges fix the nodes inside, cross-boundary edges fix the order between.
 */
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

  const sgIds = [...ranges.keys()];
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

  const succs = new Map<string, Set<string>>(sgIds.map((id) => [id, new Set<string>()]));
  const inDegree = new Map<string, number>(sgIds.map((id) => [id, 0]));
  for (const e of graph.edges) {
    const from = nodeSg.get(e.source);
    const to = nodeSg.get(e.target);
    if (from === undefined || to === undefined || from === to) continue;
    const bucket = succs.get(from);
    if (bucket === undefined || bucket.has(to)) continue;
    bucket.add(to);
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
  // A cycle between subgraphs has no stacking order, so nothing is moved.
  if (topo.length !== sgIds.length) return layers;

  const internals = new Map<string, Map<string, number>>();
  const sizes = new Map<string, number>();
  for (const sgId of topo) {
    const nodes = new Set([...nodeSg].filter(([, id]) => id === sgId).map(([nid]) => nid));
    const edges = graph.edges.filter((e) => nodes.has(e.source) && nodes.has(e.target) && !isSelfReference(e));
    const targets = new Set(edges.map((e) => e.target));
    let roots = [...nodes].filter((id) => !targets.has(id));
    if (roots.length === 0) roots = [...nodes].slice(0, 1);

    const internal = new Map<string, number>(roots.map((id) => [id, 0]));
    let changed = true;
    for (let i = 0; i < nodes.size * 2 + 1 && changed; i++) {
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
    for (const id of nodes) if (!internal.has(id)) internal.set(id, 0);
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

/** How many pairs of edges cross between adjacent layers. */
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

/** The nodes of every layer, ordered by the barycentre of what points at them. */
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
      // A stable sort, the way Python's is: two nodes sharing a barycentre keep the order they had.
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
      // A cycle leaves the topological order short: rewriting then would duplicate some nodes and drop others.
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

/**
 * How many extra grid cells a gap needs. One edge running diagonally fits in the single gap cell; every other one
 * needs a cell of its own, or the routing lays them over each other.
 */
export function computeGapExpansions(graph: Graph, layerOrder: string[][]): Map<number, number> {
  const nodeLayer = new Map<string, number>();
  const nodePos = new Map<string, number>();
  layerOrder.forEach((nodes, layer) => {
    nodes.forEach((id, pos) => {
      nodeLayer.set(id, layer);
      nodePos.set(id, pos);
    });
  });

  const diagonals = new Map<number, number>();
  for (const edge of graph.edges) {
    if (isSelfReference(edge)) continue;
    const from = nodeLayer.get(edge.source);
    const to = nodeLayer.get(edge.target);
    if (from === undefined || to === undefined) continue;
    if ((nodePos.get(edge.source) ?? 0) === (nodePos.get(edge.target) ?? 0)) continue;
    for (let gap = Math.min(from, to); gap < Math.max(from, to); gap++) {
      diagonals.set(gap, (diagonals.get(gap) ?? 0) + 1);
    }
  }

  const expansions = new Map<number, number>();
  for (const [gap, n] of diagonals) expansions.set(gap, Math.max(0, n - 1));
  return expansions;
}
