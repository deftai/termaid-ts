// Ported from src/termaid/parser/statediagram.py.
//
// A state diagram is read into the SAME Graph the flowchart produces, so it reaches the layout, the routing and the
// canvas already written: the only thing new here is the syntax.

import {
  Direction,
  EdgeStyle,
  Graph,
  makeEdge,
  makeNode,
  makeSubgraph,
  type Subgraph,
} from "../graph/model.ts";
import { NodeShape } from "../graph/shapes.ts";
import { PY_WORD, pyStrip } from "../pycompat.ts";
import { lineBreaks } from "../utils.ts";

const START_ID = "[*]_start";
const END_ID = "[*]_end";
const HEADER = "stateDiagram";
const COMMENT = "%%";
const CLOSE_BRACE = "}";
const START_MARK = "[*]";

/** What `[*]` is drawn as, entering and leaving. */
const START_LABEL = "●";
const END_LABEL = "◉";

const WORD = PY_WORD;

const NOTE_RE = new RegExp(String.raw`^note\s+(right\s+of|left\s+of)\s+(\S+)\s*:\s*(.*)`, "iu");
const NOTE_PREFIX = "note ";
const ALIAS_RE = new RegExp(String.raw`^state\s+"([^"]+)"\s+as\s+(\S+)\s*(<<${WORD}+>>)?`, "u");
const STEREOTYPE_RE = new RegExp(String.raw`^state\s+(\S+)\s+(<<${WORD}+>>)`, "u");
const COMPOSITE_RE = /^state\s+"?([^"{}]+)"?\s*\{/u;
const TRANSITION_RE = /^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.+))?$/u;
const PLAIN_STATE_RE = new RegExp(String.raw`^[a-zA-Z_]${WORD}*$`, "u");
const DIRECTION_PREFIX = "direction ";

const DIRECTIONS = new Set<string>(Object.values(Direction));

/** A mermaid state diagram as a Graph. */
export function parseStateDiagram(text: string): Graph {
  return new StateDiagramParser(text).parse();
}

class StateDiagramParser {
  private graph = new Graph();
  /** An alias to the label it displays under. */
  private aliases = new Map<string, string>();
  private subgraphStack: Subgraph[] = [];
  private startCount = 0;
  private endCount = 0;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): Graph {
    const lines = this.preprocess(this.text);
    if (lines.length === 0) return this.graph;

    const header = pyStrip(lines[0] as string);
    if (header.startsWith(HEADER)) this.graph.direction = Direction.TB;

    for (const line of lines.slice(1)) this.parseLine(line);
    this.resolveCompositeEdges();
    return this.graph;
  }

  /** The lines that carry something, comments cut off wherever they open. */
  private preprocess(text: string): string[] {
    const result: string[] = [];
    for (let line of text.split("\n")) {
      const idx = line.indexOf(COMMENT);
      if (idx >= 0) line = line.slice(0, idx);
      const stripped = pyStrip(line);
      if (stripped !== "") result.push(stripped);
    }
    return result;
  }

  private parseLine(line: string): void {
    const lower = pyStrip(line).toLowerCase();

    if (lower.startsWith(DIRECTION_PREFIX)) {
      const parts = line.split(/\s+/).filter((p) => p !== "");
      const named = (parts[1] ?? "").toUpperCase();
      if (parts.length >= 2 && DIRECTIONS.has(named)) this.graph.direction = named as Direction;
      return;
    }

    if (lower === CLOSE_BRACE) {
      this.subgraphStack.pop();
      return;
    }

    const note = NOTE_RE.exec(line);
    if (note !== null) {
      const position = (note[1] as string).toLowerCase().replaceAll(" ", "");
      const target = note[2] as string;
      const text = lineBreaks(pyStrip(note[3] as string));
      if (!this.graph.nodes.has(target)) {
        this.ensureNode(target, this.aliases.get(target) ?? target, NodeShape.ROUNDED);
      }
      this.graph.notes.push({ text, position, target });
      return;
    }
    if (lower.startsWith(NOTE_PREFIX)) return;

    const alias = ALIAS_RE.exec(line);
    if (alias !== null) {
      const label = lineBreaks(alias[1] as string, "\\n");
      const id = alias[2] as string;
      this.aliases.set(id, label);
      this.ensureNode(id, label, stereotypeToShape(alias[3]));
      return;
    }

    const stereotyped = STEREOTYPE_RE.exec(line);
    if (stereotyped !== null) {
      const id = stereotyped[1] as string;
      this.ensureNode(id, id, stereotypeToShape(stereotyped[2]));
      return;
    }

    const composite = COMPOSITE_RE.exec(line);
    if (composite !== null) {
      const sgLabel = pyStrip(composite[1] as string);
      const sgId = sgLabel.replaceAll(" ", "_");
      const parent = this.subgraphStack[this.subgraphStack.length - 1] ?? null;
      const sg = makeSubgraph(sgId, lineBreaks(sgLabel, " "), { parent });
      if (parent !== null) parent.children.push(sg);
      else this.graph.subgraphs.push(sg);
      this.subgraphStack.push(sg);
      return;
    }

    const transition = TRANSITION_RE.exec(line);
    if (transition !== null) {
      const source = this.resolveState(pyStrip(transition[1] as string), true);
      const target = this.resolveState(pyStrip(transition[2] as string), false);
      const label = lineBreaks(pyStrip(transition[3] ?? ""));
      this.graph.addEdge(makeEdge(source, target, { label, style: EdgeStyle.SOLID, hasArrowEnd: true }));
      return;
    }

    if (PLAIN_STATE_RE.test(pyStrip(line))) {
      const id = pyStrip(line);
      if (!this.graph.nodes.has(id)) this.ensureNode(id, id, NodeShape.ROUNDED);
    }
  }

  /**
   * Point transitions at composite states to the subgraph itself, removing any duplicate plain node created before or
   * after the composite `state Foo { ... }` block.
   */
  private resolveCompositeEdges(): void {
    const sgIds = new Set<string>();
    const allSubgraphs: Subgraph[] = [];
    const collect = (subs: Subgraph[]): void => {
      for (const sg of subs) {
        sgIds.add(sg.id);
        allSubgraphs.push(sg);
        collect(sg.children);
      }
    };
    collect(this.graph.subgraphs);
    if (sgIds.size === 0) return;

    const toRemove = new Set<string>();
    for (const edge of this.graph.edges) {
      if (sgIds.has(edge.source)) {
        edge.sourceIsSubgraph = true;
        toRemove.add(edge.source);
      }
      if (sgIds.has(edge.target)) {
        edge.targetIsSubgraph = true;
        toRemove.add(edge.target);
      }
    }

    for (const nid of toRemove) {
      this.graph.nodes.delete(nid);
      const orderIdx = this.graph.nodeOrder.indexOf(nid);
      if (orderIdx !== -1) this.graph.nodeOrder.splice(orderIdx, 1);
      for (const sg of allSubgraphs) {
        const sgIdx = sg.nodeIds.indexOf(nid);
        if (sgIdx !== -1) sg.nodeIds.splice(sgIdx, 1);
      }
    }
  }

  private resolveState(raw: string, isSource: boolean): string {
    if (raw === START_MARK) {
      if (isSource) {
        this.startCount += 1;
        const id = `${START_ID}_${this.startCount}`;
        this.ensureNode(id, START_LABEL, NodeShape.CIRCLE);
        return id;
      }
      this.endCount += 1;
      const id = `${END_ID}_${this.endCount}`;
      this.ensureNode(id, END_LABEL, NodeShape.CIRCLE);
      return id;
    }

    if (!this.graph.nodes.has(raw)) {
      this.ensureNode(raw, this.aliases.get(raw) ?? raw, NodeShape.ROUNDED);
    }
    return raw;
  }

  private ensureNode(id: string, label: string, shape: NodeShape): void {
    this.graph.addNode(makeNode(id, label, { shape }));
    const sg = this.subgraphStack[this.subgraphStack.length - 1];
    if (sg !== undefined && !sg.nodeIds.includes(id)) sg.nodeIds.push(id);
  }
}

function stereotypeToShape(stereotype: string | undefined): NodeShape {
  if (stereotype === undefined || stereotype === "") return NodeShape.ROUNDED;
  const s = stereotype.toLowerCase();
  if (s.includes("choice")) return NodeShape.DIAMOND;
  if (s.includes("fork") || s.includes("join")) return NodeShape.FORK_JOIN;
  return NodeShape.ROUNDED;
}
