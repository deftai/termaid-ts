// Ported from src/termaid/parser/flowchart.py.
//
// Recursive descent over mermaid flowchart syntax: the graph/flowchart header and its directions, every node shape,
// every edge form, edge labels, subgraphs, classDef, comments, chained arrows and the `&` operator.

import { decodeDecimalCharRef, lookupHtml5Entity } from "../data/htmlentities.ts";
import {
  ArrowType,
  Direction,
  EdgeStyle,
  Graph,
  makeEdge,
  makeNode,
  makeSubgraph,
  type LabelSegment,
  type Node,
  type Subgraph,
} from "../graph/model.ts";
import { NodeShape } from "../graph/shapes.ts";
import { isPySpace, lstrip, pyStrip } from "../pycompat.ts";
import { lineBreaks } from "../utils.ts";

/** Node shape delimiters, MOST SPECIFIC FIRST: `((` must be tried before `(` or a circle reads as a rounded box. */
const SHAPE_PATTERNS: ReadonlyArray<readonly [string, string, NodeShape]> = [
  ["(((", ")))", NodeShape.DOUBLE_CIRCLE],
  ["((", "))", NodeShape.CIRCLE],
  ["([", "])", NodeShape.STADIUM],
  ["[(", ")]", NodeShape.CYLINDER],
  ["[[", "]]", NodeShape.SUBROUTINE],
  ["[/", "\\]", NodeShape.TRAPEZOID],
  ["[\\", "/]", NodeShape.TRAPEZOID_ALT],
  ["[/", "/]", NodeShape.PARALLELOGRAM],
  ["[\\", "\\]", NodeShape.PARALLELOGRAM_ALT],
  ["{{", "}}", NodeShape.HEXAGON],
  ["{", "}", NodeShape.DIAMOND],
  ["(", ")", NodeShape.ROUNDED],
  [">", "]", NodeShape.ASYMMETRIC],
  ["[", "]", NodeShape.RECTANGLE],
];

/** What `@{shape: name}` may name. */
const AT_SHAPE_MAP: ReadonlyMap<string, NodeShape> = new Map([
  ["rect", NodeShape.RECTANGLE],
  ["rectangle", NodeShape.RECTANGLE],
  ["rounded", NodeShape.ROUNDED],
  ["circle", NodeShape.CIRCLE],
  ["circ", NodeShape.CIRCLE],
  ["diam", NodeShape.DIAMOND],
  ["diamond", NodeShape.DIAMOND],
  ["hex", NodeShape.HEXAGON],
  ["hexagon", NodeShape.HEXAGON],
  ["stadium", NodeShape.STADIUM],
  ["terminal", NodeShape.STADIUM],
  ["cyl", NodeShape.CYLINDER],
  ["cylinder", NodeShape.CYLINDER],
  ["db", NodeShape.CYLINDER],
  ["subroutine", NodeShape.SUBROUTINE],
  ["lean-r", NodeShape.PARALLELOGRAM],
  ["lean-l", NodeShape.PARALLELOGRAM_ALT],
  ["trap-t", NodeShape.TRAPEZOID],
  ["trap-b", NodeShape.TRAPEZOID_ALT],
  ["dbl-circ", NodeShape.DOUBLE_CIRCLE],
]);

const COMMENT = "%%";
const QUOTE = '"';
const SEMICOLON = ";";
const PIPE = "|";
const AMPERSAND = "&";
const OPENERS = "([{";
const CLOSERS = ")]}";
const HEADER_KEYWORDS = ["graph", "flowchart"];
const HEADED_BASE = 2;
const OPEN_BASE = 3;
const MIN_LENGTH = 1;
const DEFAULT_LINK_STYLE = -1;

const count = (text: string, ch: string): number => text.split(ch).length - 1;

function stripChars(text: string, chars: string, left: boolean, right: boolean): string {
  let start = 0;
  let end = text.length;
  if (left) while (start < end && chars.includes(text[start] as string)) start++;
  if (right) while (end > start && chars.includes(text[end - 1] as string)) end--;
  return text.slice(start, end);
}

const words = (line: string): string[] => line.split(/\s+/).filter((w) => w !== "");

function splitWords(line: string, maxsplit: number): string[] {
  const out: string[] = [];
  let rest = line.trimStart();
  while (out.length < maxsplit && rest !== "") {
    const at = rest.search(/\s/);
    if (at === -1) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at).trimStart();
  }
  if (rest !== "") out.push(rest);
  return out;
}

/** Blank out the inside of double-quoted spans, keeping every UTF-16 index in place. */
function maskQuotes(text: string): string {
  let out = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === QUOTE) {
      inQuote = !inQuote;
      out += ch;
    } else if (inQuote) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

const ENTITY_CODE_RE = /#([A-Za-z0-9]+);/g;

/** Decode Mermaid entity codes: `#quot;` and other HTML5 names, `#9829;` in base 10. */
function decodeEntities(text: string): string {
  return text.replace(ENTITY_CODE_RE, (whole, code: string) => {
    const decoded = /^\d+$/.test(code) ? decodeDecimalCharRef(code) : (lookupHtml5Entity(code) ?? whole);
    const cps = [...decoded];
    if (cps.length === 1) {
      const ch = cps[0] as string;
      const cp = ch.codePointAt(0) as number;
      if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) {
        return isPySpace(ch) ? " " : "";
      }
    }
    return decoded;
  });
}

/** `<br>` in a node label: the literal `\n` line breaks node labels use. */
const nodeLineBreaks = (label: string): string => lineBreaks(label, "\\n");

/** How long an edge runs: a base arrow is one, and every repeated character past the base adds one. */
export function computeArrowLength(arrowText: string, style: EdgeStyle): number {
  const hasHead = arrowText.trimEnd().endsWith(">") || arrowText.trimStart().startsWith("<");
  const s = stripChars(stripChars(arrowText, "<ox", true, false), ">ox", false, true);
  if (style === EdgeStyle.DOTTED) return Math.max(MIN_LENGTH, count(s, "."));
  if (style === EdgeStyle.THICK) {
    const base = hasHead ? HEADED_BASE : OPEN_BASE;
    return Math.max(MIN_LENGTH, count(s, "=") - base + 1);
  }
  if (style === EdgeStyle.SOLID) {
    const base = hasHead ? HEADED_BASE : OPEN_BASE;
    return Math.max(MIN_LENGTH, count(s, "-") - base + 1);
  }
  return MIN_LENGTH;
}

function parseAtShapeProps(body: string): Map<string, string> {
  const props = new Map<string, string>();
  const parts: string[] = [];
  let current: string[] = [];
  let inQuote = false;
  for (const ch of body) {
    if (ch === QUOTE) {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      parts.push(current.join(""));
      current = [];
      continue;
    }
    current.push(ch);
  }
  if (current.length > 0) parts.push(current.join(""));

  for (const raw of parts) {
    const part = pyStrip(raw);
    const at = part.indexOf(":");
    if (at === -1) continue;
    props.set(pyStrip(part.slice(0, at)), stripChars(pyStrip(part.slice(at + 1)), QUOTE, true, true));
  }
  return props;
}

/** Remove `%%` comments from a line, leaving `%%` inside quoted labels. */
const stripComments = (line: string): string => {
  const at = maskQuotes(line).indexOf(COMMENT);
  return at >= 0 ? line.slice(0, at) : line;
};

/** A backtick-quoted markdown label, or null where the label is ordinary text. */
export function parseMarkdownLabel(text: string): { plain: string; segments: LabelSegment[] } | null {
  const stripped = pyStrip(text);
  if (!(stripped.startsWith('"`') && stripped.endsWith('`"'))) return null;

  const md = stripped.slice(2, -2);
  const rawSegments: LabelSegment[] = [];
  let i = 0;
  while (i < md.length) {
    if (md.slice(i, i + 2) === "**") {
      const end = md.indexOf("**", i + 2);
      if (end !== -1) {
        rawSegments.push({ text: md.slice(i + 2, end), bold: true, italic: false });
        i = end + 2;
        continue;
      }
    }
    if (md[i] === "*") {
      const end = md.indexOf("*", i + 1);
      if (end !== -1) {
        rawSegments.push({ text: md.slice(i + 1, end), bold: false, italic: true });
        i = end + 1;
        continue;
      }
    }
    // Start one past i: an unmatched "*" at i is kept as literal text instead of producing an empty segment forever.
    let j = i + 1;
    while (j < md.length && md[j] !== "*") j++;
    rawSegments.push({ text: md.slice(i, j), bold: false, italic: false });
    i = j;
  }
  const segments = rawSegments.map((s) => ({ ...s, text: decodeEntities(s.text) }));
  return { plain: segments.map((s) => s.text).join(""), segments };
}

function parseCssProps(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const prop of text.split(",")) {
    const at = prop.indexOf(":");
    if (at === -1) continue;
    props.set(pyStrip(prop.slice(0, at)), pyStrip(prop.slice(at + 1)));
  }
  return props;
}

const stripQuotes = (text: string): string =>
  text.length >= 2 && text.startsWith(QUOTE) && text.endsWith(QUOTE) ? text.slice(1, -1) : text;

function splitOnSemicolons(line: string): string[] {
  const parts: string[] = [];
  let buf: string[] = [];
  let inQuote = false;
  for (const ch of line) {
    if (ch === QUOTE) {
      inQuote = !inQuote;
      buf.push(ch);
    } else if (ch === SEMICOLON && !inQuote) {
      parts.push(buf.join(""));
      buf = [];
    } else {
      buf.push(ch);
    }
  }
  parts.push(buf.join(""));
  return parts;
}

interface Segment {
  text: string;
  isArrow: boolean;
  edgeStyle: EdgeStyle;
  hasArrowStart: boolean;
  hasArrowEnd: boolean;
  arrowTypeStart: ArrowType;
  arrowTypeEnd: ArrowType;
  label: string;
  minLength: number;
}

function makeSegment(fields: Partial<Segment> & { text: string }): Segment {
  return {
    isArrow: false,
    edgeStyle: EdgeStyle.SOLID,
    hasArrowStart: false,
    hasArrowEnd: true,
    arrowTypeStart: ArrowType.ARROW,
    arrowTypeEnd: ArrowType.ARROW,
    label: "",
    minLength: MIN_LENGTH,
    ...fields,
  };
}

interface ArrowMatch {
  pos: number;
  end: number;
  style: EdgeStyle;
  hasStart: boolean;
  hasEnd: boolean;
  label: string;
  length: number;
  typeStart: ArrowType;
  typeEnd: ArrowType;
}

const PLAIN_ARROWS: ReadonlyArray<{
  re: RegExp;
  style: EdgeStyle;
  hasStart: boolean;
  hasEnd: boolean;
  typeStart: ArrowType;
  typeEnd: ArrowType;
}> = [
  { re: /<-\.+->/, style: EdgeStyle.DOTTED, hasStart: true, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /<=+=>/, style: EdgeStyle.THICK, hasStart: true, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /<-+->/, style: EdgeStyle.SOLID, hasStart: true, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /o-+o/, style: EdgeStyle.SOLID, hasStart: true, hasEnd: true, typeStart: ArrowType.CIRCLE, typeEnd: ArrowType.CIRCLE },
  { re: /x-+x/, style: EdgeStyle.SOLID, hasStart: true, hasEnd: true, typeStart: ArrowType.CROSS, typeEnd: ArrowType.CROSS },
  { re: /-\.+->/, style: EdgeStyle.DOTTED, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /=+=>/, style: EdgeStyle.THICK, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-+->/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-+o(?=\s|$)/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.CIRCLE },
  { re: /-+x(?=\s|$)/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true, typeStart: ArrowType.ARROW, typeEnd: ArrowType.CROSS },
  { re: /~~~/, style: EdgeStyle.INVISIBLE, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-\.-/, style: EdgeStyle.DOTTED, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /={3,}/, style: EdgeStyle.THICK, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
  { re: /-{3,}/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: false, typeStart: ArrowType.ARROW, typeEnd: ArrowType.ARROW },
];

const PIPED_ARROW = /(<--|<-\.|-\.|-+|=+|<)([-=.]+)(>?)(\|)([^|]*)(\|)/;

const SPLIT_ARROWS: ReadonlyArray<{ re: RegExp; style: EdgeStyle; hasStart: boolean; hasEnd: boolean }> = [
  { re: /(--)(\s+.+?\s+)(-->)/, style: EdgeStyle.SOLID, hasStart: false, hasEnd: true },
  { re: /(==)(\s+.+?\s+)(==>)/, style: EdgeStyle.THICK, hasStart: false, hasEnd: true },
  { re: /(-\.)(\s+.+?\s+)(\.+->)/, style: EdgeStyle.DOTTED, hasStart: false, hasEnd: true },
];

const AT_SHAPE_RE = /^([a-zA-Z_]\w*)\s*@\{([\s\S]+)\}$/;
const SUBGRAPH_BRACKET_RE = /^([^\s\[]+)\s*\[(.+)\]/;
const PLAIN_ID_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const DELIM_IN_ID_RE = /[[\](){}<>]/;
const STYLE_CLASS_MARK = ":::";

class FlowchartParser {
  private readonly graph = new Graph();
  private readonly subgraphStack: Subgraph[] = [];
  private readonly shapedNodeIds = new Set<string>();
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  parse(): Graph {
    const lines = this.preprocess(this.text);
    const header = lines[0];
    if (header === undefined) return this.graph;
    this.parseHeader(header);
    for (const line of lines.slice(1)) this.parseLine(line);
    this.resolveSubgraphEdges();
    return this.graph;
  }

  private preprocess(text: string): string[] {
    const raw: string[] = [];
    for (const line of text.split("\n")) {
      if (lstrip(line).startsWith(COMMENT)) continue;
      raw.push(...splitOnSemicolons(line));
    }
    return raw.map((line) => pyStrip(stripComments(line))).filter((line) => line !== "");
  }

  private parseHeader(line: string): void {
    const parts = words(line);
    const keyword = (parts[0] ?? "").toLowerCase();
    if (!HEADER_KEYWORDS.includes(keyword)) return;
    const named = (parts[1] ?? "").toUpperCase();
    this.graph.direction =
      named in Direction ? ((Direction as Record<string, Direction>)[named] as Direction) : Direction.TB;
  }

  private parseLine(line: string): void {
    const lower = pyStrip(line.toLowerCase());
    if (lower.startsWith("subgraph")) return this.parseSubgraph(line);
    if (lower === "end") return this.closeSubgraph();
    if (lower.startsWith("direction ")) return this.parseDirectionOverride(line);
    if (lower.startsWith("classdef ")) return this.parseClassDef(line);
    if (lower.startsWith("class ")) return this.parseClassAssignment(line);
    if (lower.startsWith("linkstyle ")) return this.parseLinkStyle(line);
    if (lower.startsWith("style ")) return this.parseStyle(line);
    if (lower.startsWith("click ")) return;
    this.parseStatement(line);
  }

  private parseSubgraph(line: string): void {
    const rest = pyStrip(line.slice("subgraph".length));
    let id = rest;
    let label = rest;
    const bracket = SUBGRAPH_BRACKET_RE.exec(rest);
    if (bracket !== null) {
      id = bracket[1] as string;
      label = bracket[2] as string;
    } else if (rest.includes(" ")) {
      id = words(rest)[0] as string;
      label = rest;
    }

    const parent = this.subgraphStack[this.subgraphStack.length - 1] ?? null;
    const sg = makeSubgraph(stripQuotes(id), decodeEntities(lineBreaks(stripQuotes(label), " ")), { parent });
    if (parent === null) this.graph.subgraphs.push(sg);
    else parent.children.push(sg);
    this.subgraphStack.push(sg);
  }

  private closeSubgraph(): void {
    this.subgraphStack.pop();
  }

  private parseDirectionOverride(line: string): void {
    const parts = words(line);
    const current = this.subgraphStack[this.subgraphStack.length - 1];
    const named = (parts[1] ?? "").toUpperCase();
    if (parts.length >= 2 && current !== undefined && named in Direction) {
      current.direction = (Direction as Record<string, Direction>)[named] as Direction;
    }
  }

  private parseClassDef(line: string): void {
    const parts = splitWords(line, 2);
    if (parts.length < 3) return;
    this.graph.classDefs.set(parts[1] as string, parseCssProps(parts[2] as string));
  }

  private parseClassAssignment(line: string): void {
    const parts = words(line);
    if (parts.length < 3) return;
    const node = this.graph.nodes.get(parts[1] as string);
    if (node !== undefined) node.styleClass = parts[2] as string;
  }

  private parseStyle(line: string): void {
    const parts = splitWords(line, 2);
    if (parts.length < 3) return;
    this.graph.nodeStyles.set(parts[1] as string, parseCssProps(parts[2] as string));
  }

  private parseLinkStyle(line: string): void {
    const parts = splitWords(line, 2);
    if (parts.length < 3) return;
    const indices = parts[1] as string;
    const props = parseCssProps(parts[2] as string);
    if (indices.toLowerCase() === "default") {
      this.graph.linkStyles.set(DEFAULT_LINK_STYLE, props);
      return;
    }
    for (const raw of indices.split(",")) {
      const index = pyStrip(raw);
      if (/^\d+$/.test(index)) this.graph.linkStyles.set(Number.parseInt(index, 10), props);
    }
  }

  private parseStatement(line: string): void {
    const segments = this.splitByArrows(line);

    if (segments.length === 1) {
      for (const text of this.splitAmpersand((segments[0] as Segment).text)) {
        const node = this.parseNode(pyStrip(text));
        if (node === null) continue;
        this.graph.addNode(node);
        this.registerInSubgraph(node.id);
      }
      return;
    }

    let prevNodes: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i] as Segment;
      if (seg.isArrow) continue;

      const currentNodes: string[] = [];
      for (const text of this.splitAmpersand(seg.text)) {
        const node = this.parseNode(pyStrip(text));
        if (node === null) continue;
        this.graph.addNode(node);
        this.registerInSubgraph(node.id);
        currentNodes.push(node.id);
      }

      if (prevNodes.length > 0 && i > 0) {
        const arrow = segments[i - 1] as Segment;
        for (const source of prevNodes) {
          for (const target of currentNodes) {
            this.graph.addEdge(
              makeEdge(source, target, {
                label: arrow.label,
                style: arrow.edgeStyle,
                hasArrowStart: arrow.hasArrowStart,
                hasArrowEnd: arrow.hasArrowEnd,
                arrowTypeStart: arrow.arrowTypeStart,
                arrowTypeEnd: arrow.arrowTypeEnd,
                minLength: arrow.minLength,
              })
            );
          }
        }
      }
      prevNodes = currentNodes;
    }
  }

  private registerInSubgraph(nodeId: string): void {
    const sg = this.subgraphStack[this.subgraphStack.length - 1];
    if (sg !== undefined && !sg.nodeIds.includes(nodeId)) sg.nodeIds.push(nodeId);
  }

  private resolveSubgraphEdges(): void {
    const ids = new Set<string>();
    const collect = (subs: Subgraph[]): void => {
      for (const sg of subs) {
        ids.add(sg.id);
        collect(sg.children);
      }
    };
    collect(this.graph.subgraphs);
    if (ids.size === 0) return;

    const toRemove = new Set<string>();
    for (const edge of this.graph.edges) {
      if (ids.has(edge.source) && !this.shapedNodeIds.has(edge.source)) {
        edge.sourceIsSubgraph = true;
        toRemove.add(edge.source);
      }
      if (ids.has(edge.target) && !this.shapedNodeIds.has(edge.target)) {
        edge.targetIsSubgraph = true;
        toRemove.add(edge.target);
      }
    }

    const removeFrom = (subs: Subgraph[], id: string): void => {
      for (const sg of subs) {
        const at = sg.nodeIds.indexOf(id);
        if (at !== -1) sg.nodeIds.splice(at, 1);
        removeFrom(sg.children, id);
      }
    };
    for (const id of toRemove) {
      this.graph.nodes.delete(id);
      const at = this.graph.nodeOrder.indexOf(id);
      if (at !== -1) this.graph.nodeOrder.splice(at, 1);
      removeFrom(this.graph.subgraphs, id);
    }
  }

  private splitAmpersand(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current: string[] = [];
    let i = 0;
    while (i < text.length) {
      const ch = text[i] as string;
      if (OPENERS.includes(ch)) {
        depth++;
        current.push(ch);
      } else if (CLOSERS.includes(ch)) {
        depth = Math.max(0, depth - 1);
        current.push(ch);
      } else if (depth === 0 && ch === AMPERSAND && i > 0 && text[i - 1] === " ") {
        if (i + 1 < text.length && text[i + 1] === " ") {
          const part = current.join("").trimEnd();
          if (part !== "") parts.push(part);
          current = [];
          i += 2;
          continue;
        }
        current.push(ch);
      } else {
        current.push(ch);
      }
      i++;
    }
    const last = pyStrip(current.join(""));
    if (last !== "") parts.push(last);
    return parts;
  }

  private splitByArrows(line: string): Segment[] {
    const segments: Segment[] = [];
    let remaining = pyStrip(line);

    while (remaining !== "") {
      const masked = maskQuotes(remaining);
      let best: ArrowMatch | null = null;

      const labelled = FlowchartParser.findLabelledArrow(masked);
      if (labelled !== null) {
        const span = remaining.slice(labelled.pos, labelled.end);
        const pipeStart = span.indexOf(PIPE);
        const pipeEnd = span.lastIndexOf(PIPE);
        let label: string;
        if (pipeStart >= 0 && pipeEnd > pipeStart) {
          label = stripQuotes(pyStrip(span.slice(pipeStart + 1, pipeEnd)));
        } else {
          const at = masked.indexOf(labelled.label, labelled.pos);
          label = at >= 0 ? stripQuotes(remaining.slice(at, at + labelled.label.length)) : labelled.label;
        }
        best = { ...labelled, label };
      }

      const plain = FlowchartParser.findPlainArrow(masked);
      if (plain !== null && (best === null || plain.pos < best.pos)) best = plain;

      if (best === null) {
        const text = pyStrip(remaining);
        if (text !== "") segments.push(makeSegment({ text }));
        break;
      }

      const before = pyStrip(remaining.slice(0, best.pos));
      if (before !== "") segments.push(makeSegment({ text: before }));

      segments.push(
        makeSegment({
          text: remaining.slice(best.pos, best.end),
          isArrow: true,
          edgeStyle: best.style,
          hasArrowStart: best.hasStart,
          hasArrowEnd: best.hasEnd,
          arrowTypeStart: best.typeStart,
          arrowTypeEnd: best.typeEnd,
          label: decodeEntities(lineBreaks(best.label)),
          minLength: best.length,
        })
      );

      remaining = pyStrip(remaining.slice(best.end));
    }

    return segments.length > 0 ? segments : [makeSegment({ text: pyStrip(line) })];
  }

  private static findLabelledArrow(text: string): ArrowMatch | null {
    const piped = PIPED_ARROW.exec(text);
    if (piped !== null) {
      const whole = piped[0] as string;
      const arrowPart = text.slice(piped.index, piped.index + whole.indexOf(PIPE));
      const { style, hasStart, hasEnd, typeStart, typeEnd } = FlowchartParser.classifyArrow(arrowPart);
      return {
        pos: piped.index,
        end: piped.index + whole.length,
        style,
        hasStart,
        hasEnd,
        label: pyStrip(piped[5] as string),
        length: computeArrowLength(arrowPart, style),
        typeStart,
        typeEnd,
      };
    }

    for (const { re, style, hasStart, hasEnd } of SPLIT_ARROWS) {
      const m = re.exec(text);
      if (m === null) continue;
      return {
        pos: m.index,
        end: m.index + (m[0] as string).length,
        style,
        hasStart,
        hasEnd,
        label: pyStrip(m[2] as string),
        length: computeArrowLength(m[3] as string, style),
        typeStart: ArrowType.ARROW,
        typeEnd: ArrowType.ARROW,
      };
    }
    return null;
  }

  private static findPlainArrow(text: string): ArrowMatch | null {
    let best: ArrowMatch | null = null;
    for (const { re, style, hasStart, hasEnd, typeStart, typeEnd } of PLAIN_ARROWS) {
      const m = re.exec(text);
      if (m === null || (best !== null && m.index >= best.pos)) continue;
      best = {
        pos: m.index,
        end: m.index + (m[0] as string).length,
        style,
        hasStart,
        hasEnd,
        label: "",
        length: MIN_LENGTH,
        typeStart,
        typeEnd,
      };
    }
    if (best === null) return null;
    return { ...best, length: computeArrowLength(text.slice(best.pos, best.end), best.style) };
  }

  private static classifyArrow(arrow: string): {
    style: EdgeStyle;
    hasStart: boolean;
    hasEnd: boolean;
    typeStart: ArrowType;
    typeEnd: ArrowType;
  } {
    const s = pyStrip(arrow);
    const hasStart = s.startsWith("<") || s.startsWith("o") || s.startsWith("x");
    const hasEnd = s.endsWith(">") || s.endsWith("x") || s.endsWith("o");
    let typeStart: ArrowType = ArrowType.ARROW;
    let typeEnd: ArrowType = ArrowType.ARROW;
    if (s.startsWith("o")) typeStart = ArrowType.CIRCLE;
    else if (s.startsWith("x")) typeStart = ArrowType.CROSS;
    if (s.endsWith("o")) typeEnd = ArrowType.CIRCLE;
    else if (s.endsWith("x")) typeEnd = ArrowType.CROSS;

    if (s.includes(".")) return { style: EdgeStyle.DOTTED, hasStart, hasEnd, typeStart, typeEnd };
    if (s.includes("=")) return { style: EdgeStyle.THICK, hasStart, hasEnd, typeStart, typeEnd };
    if (s.includes("~")) return { style: EdgeStyle.INVISIBLE, hasStart, hasEnd, typeStart, typeEnd };
    return { style: EdgeStyle.SOLID, hasStart, hasEnd, typeStart, typeEnd };
  }

  private parseNode(raw: string): Node | null {
    if (raw === "") return null;
    let text = stripChars(pyStrip(raw), SEMICOLON, false, true);

    let styleClass: string | null = null;
    const classAt = maskQuotes(text).lastIndexOf(STYLE_CLASS_MARK);
    if (classAt !== -1) {
      styleClass = pyStrip(text.slice(classAt + STYLE_CLASS_MARK.length));
      text = pyStrip(text.slice(0, classAt));
    }

    const at = AT_SHAPE_RE.exec(text);
    if (at !== null) {
      const id = at[1] as string;
      const props = parseAtShapeProps(at[2] as string);
      const shape = AT_SHAPE_MAP.get(props.get("shape") ?? "rect") ?? NodeShape.RECTANGLE;
      const label = decodeEntities(nodeLineBreaks(props.get("label") ?? id));
      this.shapedNodeIds.add(id);
      return makeNode(id, label, { shape, styleClass });
    }

    const masked = maskQuotes(text);
    for (const [open, close, shape] of SHAPE_PATTERNS) {
      const idx = masked.indexOf(open);
      if (idx <= 0) continue;
      const rest = text.slice(idx + open.length);
      if (!rest.endsWith(close)) continue;
      const id = pyStrip(text.slice(0, idx));
      if (id === "" || DELIM_IN_ID_RE.test(id)) continue;
      const rawLabel = pyStrip(rest.slice(0, -close.length));
      this.shapedNodeIds.add(id);
      const md = parseMarkdownLabel(rawLabel);
      if (md !== null) return makeNode(id, md.plain, { shape, styleClass, labelSegments: md.segments });
      const label = decodeEntities(nodeLineBreaks(stripQuotes(rawLabel)));
      return makeNode(id, label, { shape, styleClass });
    }

    let id = pyStrip(text);
    if (id === "" || !PLAIN_ID_RE.test(id)) {
      id = stripQuotes(id);
      if (id === "") return null;
    }
    return makeNode(id, id, { shape: NodeShape.RECTANGLE, styleClass });
  }
}

export function parseFlowchart(text: string): Graph {
  return new FlowchartParser(text).parse();
}

export function declaresFlowchart(text: string): boolean {
  for (const raw of text.split("\n")) {
    if (lstrip(raw).startsWith(COMMENT)) continue;
    const line = pyStrip(stripComments(raw));
    if (line === "") continue;
    return HEADER_KEYWORDS.includes((words(line)[0] ?? "").toLowerCase());
  }
  return false;
}
