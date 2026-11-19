// Ported from src/termaid/routing/pathfinder.py.
//
// A* over the grid: four directions, Manhattan distance with a corner penalty, soft obstacles, custom cell penalties,
// and perpendicular-only crossing cells. Uses CPython's exact `heapq` sift order.

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

const STEP_COST = 1;
const SOFT_PENALTY = 2;
const CORNER_PENALTY = 0.5;
const HEURISTIC_CORNER = 1;
const MAX_ITERATIONS = 5000;

export type Cell = readonly [number, number];
export const cellId = (col: number, row: number): string => `${col},${row}`;
export function parseCellId(key: string): Cell {
  const comma = key.indexOf(",");
  return [Number.parseInt(key.slice(0, comma), 10), Number.parseInt(key.slice(comma + 1), 10)];
}

interface AStarNode {
  fCost: number;
  gCost: number;
  cell: Cell;
  parent: AStarNode | null;
  heading: Cell | null;
}

const less = (a: AStarNode, b: AStarNode): boolean => a.fCost < b.fCost;

function siftDown(heap: AStarNode[], startPos: number, pos: number): void {
  const newItem = heap[pos] as AStarNode;
  while (pos > startPos) {
    const parentPos = (pos - 1) >> 1;
    const parent = heap[parentPos] as AStarNode;
    if (!less(newItem, parent)) break;
    heap[pos] = parent;
    pos = parentPos;
  }
  heap[pos] = newItem;
}

function siftUp(heap: AStarNode[], pos: number): void {
  const endPos = heap.length;
  const startPos = pos;
  const newItem = heap[pos] as AStarNode;
  let childPos = 2 * pos + 1;
  while (childPos < endPos) {
    const rightPos = childPos + 1;
    if (rightPos < endPos && !less(heap[childPos] as AStarNode, heap[rightPos] as AStarNode)) childPos = rightPos;
    heap[pos] = heap[childPos] as AStarNode;
    pos = childPos;
    childPos = 2 * pos + 1;
  }
  heap[pos] = newItem;
  siftDown(heap, startPos, pos);
}

function heapPush(heap: AStarNode[], item: AStarNode): void {
  heap.push(item);
  siftDown(heap, 0, heap.length - 1);
}

function heapPop(heap: AStarNode[]): AStarNode {
  const last = heap.pop() as AStarNode;
  if (heap.length === 0) return last;
  const top = heap[0] as AStarNode;
  heap[0] = last;
  siftUp(heap, 0);
  return top;
}

export function heuristic(c1: number, r1: number, c2: number, r2: number): number {
  const dx = Math.abs(c1 - c2);
  const dy = Math.abs(r1 - r2);
  return dx === 0 || dy === 0 ? dx + dy : dx + dy + HEURISTIC_CORNER;
}

function reconstruct(node: AStarNode): Cell[] {
  const path: Cell[] = [];
  let current: AStarNode | null = node;
  while (current !== null) {
    path.push(current.cell);
    current = current.parent;
  }
  path.reverse();
  return path;
}

export interface FindPathOptions {
  penalty?: ((col: number, row: number) => number) | null;
  crossings?: ReadonlyMap<string, boolean> | null;
}

export function findPath(
  startCol: number,
  startRow: number,
  endCol: number,
  endRow: number,
  isFree: (col: number, row: number) => boolean,
  softObstacles: ReadonlySet<string> = new Set(),
  maxIterations: number = MAX_ITERATIONS,
  options: FindPathOptions = {}
): Cell[] | null {
  if (startCol === endCol && startRow === endRow) return [[startCol, startRow]];

  const penalty = options.penalty ?? null;
  const cross = options.crossings ?? null;

  const startKey = cellId(startCol, startRow);
  const startNode: AStarNode = {
    fCost: heuristic(startCol, startRow, endCol, endRow),
    gCost: 0,
    cell: [startCol, startRow],
    parent: null,
    heading: null,
  };

  const open: AStarNode[] = [startNode];
  const closed = new Set<string>();
  const bestG = new Map<string, number>([[startKey, 0]]);

  for (let iterations = 0; open.length > 0 && iterations < maxIterations; iterations++) {
    const current = heapPop(open);
    const [col, row] = current.cell;

    if (col === endCol && row === endRow) return reconstruct(current);

    const heading = current.heading;
    const baseKey = cellId(col, row);
    const inCrossing = cross !== null && cross.has(baseKey);
    const key = inCrossing && heading !== null ? `${baseKey}:${heading[0]},${heading[1]}` : baseKey;
    if (closed.has(key)) continue;
    closed.add(key);
    const currentG = current.gCost;

    const directions: ReadonlyArray<Cell> = inCrossing && heading !== null ? [heading] : DIRS;
    for (const direction of directions) {
      const [dc, dr] = direction;
      const nc = col + dc;
      const nr = row + dr;
      const nkey = cellId(nc, nr);
      let state = nkey;
      const crossHorizontal = cross?.get(nkey);
      if (crossHorizontal !== undefined) {
        if ((dc === 0) !== crossHorizontal) continue;
        state = `${nkey}:${dc},${dr}`;
      }

      if (closed.has(state)) continue;

      const isEndpoint = nc === endCol && nr === endRow;
      if (!isEndpoint && !isFree(nc, nr)) continue;

      let stepCost = STEP_COST;
      if (softObstacles.has(nkey)) stepCost += SOFT_PENALTY;
      if (penalty !== null) stepCost += penalty(nc, nr);
      if (heading !== null && (dc !== heading[0] || dr !== heading[1])) {
        stepCost += CORNER_PENALTY;
      }

      const newG = currentG + stepCost;
      const prevG = bestG.get(state);
      if (prevG !== undefined && prevG <= newG) continue;
      bestG.set(state, newG);

      heapPush(open, {
        fCost: newG + heuristic(nc, nr, endCol, endRow),
        gCost: newG,
        cell: [nc, nr],
        parent: current,
        heading: direction,
      });
    }
  }

  return null;
}

export function simplifyPath(path: Cell[]): Cell[] {
  if (path.length <= 2) return path;
  const result: Cell[] = [path[0] as Cell];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1] as Cell;
    const current = path[i] as Cell;
    const next = path[i + 1] as Cell;
    const turned = current[0] - prev[0] !== next[0] - current[0] || current[1] - prev[1] !== next[1] - current[1];
    if (turned) result.push(current);
  }
  result.push(path[path.length - 1] as Cell);
  return result;
}
