// The package's one entry: a mermaid source in, the drawing a terminal shows out. Everything under it mirrors the
// Python module tree of the reference (model/, graph/, parser/, layout/, routing/, renderer/, output/), file for file.
//
// Ported from src/termaid/__init__.py and the width fitting of src/termaid/utils.py.

import { Graph } from "./graph/model.ts";
import { parseArchitecture } from "./parser/architecture.ts";
import { declaresFlowchart, parseFlowchart } from "./parser/flowchart.ts";
import { parseGantt } from "./parser/gantt.ts";
import { parseBlockDiagram } from "./parser/blockdiagram.ts";
import { parseClassDiagram } from "./parser/classdiagram.ts";
import { parseERDiagram } from "./parser/erdiagram.ts";
import { parseGitGraph } from "./parser/gitgraph.ts";
import { parseJourney } from "./parser/journey.ts";
import { parseKanban } from "./parser/kanban.ts";
import { parseMindmap } from "./parser/mindmap.ts";
import { parsePacket } from "./parser/packet.ts";
import { parsePieChart } from "./parser/piechart.ts";
import { parseQuadrant } from "./parser/quadrant.ts";
import { parseSequenceDiagram } from "./parser/sequence.ts";
import { parseStateDiagram } from "./parser/statediagram.ts";
import { parseTreemap } from "./parser/treemap.ts";
import { parseXYChart } from "./parser/xychart.ts";
import { parseTimeline } from "./parser/timeline.ts";
import { renderGraphCanvas, type RenderOptions } from "./renderer/draw.ts";
import { renderGraphRich, renderSequenceRich } from "./output/rich.ts";
import { serializeCanvas, type StyledChunk, type StyledDocument } from "./output/styled.ts";
import { Text } from "./richcompat.ts";
import type { Background } from "./background.ts";
import type { Canvas } from "./renderer/canvas.ts";
import { buildCharset } from "./renderer/charset.ts";
import { renderGantt } from "./renderer/gantt.ts";
import { renderBlockDiagram } from "./renderer/blockdiagram.ts";
import { renderClassDiagram } from "./renderer/classdiagram.ts";
import { renderERDiagram } from "./renderer/erdiagram.ts";
import { renderGitGraph } from "./renderer/gitgraph.ts";
import { renderJourney } from "./renderer/journey.ts";
import { renderKanban } from "./renderer/kanban.ts";
import { renderMindmap } from "./renderer/mindmap.ts";
import { renderPacket } from "./renderer/packet.ts";
import { renderPieChart } from "./renderer/piechart.ts";
import { renderQuadrant } from "./renderer/quadrant.ts";
import { renderSequence } from "./renderer/sequence.ts";
import { renderTimeline } from "./renderer/timeline.ts";
import { renderXYChart } from "./renderer/xychart.ts";
import { renderTreemap } from "./renderer/treemap.ts";
import { completePartial } from "./partial.ts";
import { DIRECTIVE, fitToWidth } from "./utils.ts";
import { PY_SPACE_CHARS, pyStrip } from "./pycompat.ts";

export { Graph } from "./graph/model.ts";
export { parseArchitecture } from "./parser/architecture.ts";
export { parseFlowchart } from "./parser/flowchart.ts";
export { parseGantt } from "./parser/gantt.ts";
export { parseBlockDiagram } from "./parser/blockdiagram.ts";
export { parseClassDiagram } from "./parser/classdiagram.ts";
export { parseERDiagram } from "./parser/erdiagram.ts";
export { parseGitGraph } from "./parser/gitgraph.ts";
export { parseJourney } from "./parser/journey.ts";
export { parseKanban } from "./parser/kanban.ts";
export { parseMindmap } from "./parser/mindmap.ts";
export { parsePacket } from "./parser/packet.ts";
export { parsePieChart } from "./parser/piechart.ts";
export { parseQuadrant } from "./parser/quadrant.ts";
export { parseSequenceDiagram } from "./parser/sequence.ts";
export { parseStateDiagram } from "./parser/statediagram.ts";
export { parseTreemap } from "./parser/treemap.ts";
export { parseXYChart } from "./parser/xychart.ts";
export { parseTimeline } from "./parser/timeline.ts";
export { renderGraph, renderGraphCanvas } from "./renderer/draw.ts";
export { renderGantt } from "./renderer/gantt.ts";
export { renderBlockDiagram } from "./renderer/blockdiagram.ts";
export { renderClassDiagram } from "./renderer/classdiagram.ts";
export { renderERDiagram } from "./renderer/erdiagram.ts";
export { renderGitGraph } from "./renderer/gitgraph.ts";
export { renderJourney } from "./renderer/journey.ts";
export { renderKanban } from "./renderer/kanban.ts";
export { renderMindmap } from "./renderer/mindmap.ts";
export { renderPacket } from "./renderer/packet.ts";
export { renderPieChart } from "./renderer/piechart.ts";
export { renderQuadrant } from "./renderer/quadrant.ts";
export { renderSequence } from "./renderer/sequence.ts";
export { renderTimeline } from "./renderer/timeline.ts";
export { renderXYChart } from "./renderer/xychart.ts";
export { renderTreemap } from "./renderer/treemap.ts";
export { renderGraphRich, renderRich, renderSequenceRich } from "./output/rich.ts";
export { serializeCanvas, type StyledChunk, type StyledDocument } from "./output/styled.ts";
export { ARROW_STYLES, buildCharset, defaultCharset, type CharSet } from "./renderer/charset.ts";
export { getTheme, THEMES, type Theme } from "./renderer/themes.ts";
export { printToConsole, Text, CONSOLE_WIDTH } from "./richcompat.ts";
export { displayWidth, fitToWidth, maxLineWidth, wrapDisplayText } from "./utils.ts";
export { completePartial } from "./partial.ts";
export { splitMarkdown, type Segment } from "./markdown.ts";
export { Diagnostic, type DiagnosticDict, type DiagnosticSeverity } from "./diagnostics.ts";
export { DARK_BACKGROUND, LIGHT_BACKGROUND, type Background } from "./background.ts";

export const VERSION = "0.12.0";

const FRONTMATTER_RE = new RegExp(`^---[${PY_SPACE_CHARS}]*\\n[\\s\\S]*?\\n---[${PY_SPACE_CHARS}]*\\n`, "u");
const LEADING_DIRECTIVES_RE = new RegExp(`^(?:${DIRECTIVE}|%%[^\\n]*|[${PY_SPACE_CHARS}]+)*`, "u");
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
const CARRIAGE_RETURN_RE = /\r\n?/g;

const STATE_DIAGRAM = "stateDiagram";
const FLOWCHART = "flowchart";
const DEFAULT_THEME = "default";
const DEFAULT_ARROW_STYLE = "pointer";

const FLOWCHART_PADDING_X = 4;
const FLOWCHART_PADDING_Y = 2;
const FLOWCHART_GAP = 4;

const overridden = (value: number | undefined, base: number): number | undefined =>
  value === undefined || value === base ? undefined : value;

/** Strip YAML frontmatter (`---...---`) from the beginning of mermaid source. */
function stripFrontmatter(text: string): string {
  return text.replace(FRONTMATTER_RE, "");
}

/** Normalize line endings, drop control characters, a byte order mark, and frontmatter. */
export function prepareSource(source: string): string {
  const cleaned = source.replace(/^\ufeff+/u, "").replace(CARRIAGE_RETURN_RE, "\n").replace(CONTROL_CHARS_RE, "");
  return stripFrontmatter(pyStrip(cleaned));
}

/** Drop the `%%{...}%%` directives and `%%` comments before the diagram keyword. */
export function skipDirectives(text: string): string {
  const match = LEADING_DIRECTIVES_RE.exec(text);
  return match !== null ? text.slice(match[0].length) : text;
}

export interface ParseOptions {
  partial?: boolean;
}

/** Parse mermaid syntax and return a Graph model (auto-detects flowchart or state diagram). */
export function parse(source: string, options: ParseOptions = {}): Graph {
  const raw = options.partial ? completePartial(source) : source;
  const text = skipDirectives(prepareSource(raw));
  if (text.startsWith(STATE_DIAGRAM)) return parseStateDiagram(text);
  return parseFlowchart(text);
}

const SPECIALISED_PREFIXES: readonly string[] = [
  "sequenceDiagram",
  "classDiagram",
  "erDiagram",
  "block",
  "gitGraph",
  "gantt",
  "architecture",
  "pie",
  "treemap",
  "mindmap",
  "packet",
  "xychart",
  "journey",
  "timeline",
  "kanban",
  "quadrantChart",
];

/**
 * The type a source DECLARES, read the same way the dispatch reads it, or `null` where it declares none this renderer
 * knows.
 */
export function declaredType(source: string): string | null {
  const prepared = prepareSource(source);
  const text = skipDirectives(prepared);
  for (const prefix of SPECIALISED_PREFIXES) {
    if (text.startsWith(prefix)) return prefix;
  }
  if (text.startsWith(STATE_DIAGRAM)) return STATE_DIAGRAM;
  return declaresFlowchart(text) ? FLOWCHART : null;
}

export interface RenderStyledOptions {
  useAscii?: boolean;
  paddingX?: number;
  paddingY?: number;
  roundedEdges?: boolean;
  gap?: number;
  inlineEdgeLabels?: boolean;
  maxLabelWidth?: number | null;
  arrowStyle?: string;
  partial?: boolean;
  width?: number;
  divergences?: boolean;
}

export interface Options extends Partial<RenderOptions> {
  /** Arrowhead style for Unicode output: `"pointer"` (default), `"triangle"`, or `"outline"`. */
  arrowStyle?: string;
  /** Whether the source is the start of a diagram still streaming in. */
  partial?: boolean;
  /** A ceiling on the output's width: past it, the drawing is redrawn tighter until it fits or runs out of steps. */
  width?: number;
  /**
   * ◉ The side the terminal is: `dark` (default) or `light`.
   */
  background?: Background;
  /**
   * ◉ Enable this port's deliberate layout/parsing divergences from Python termaid (default: `false`).
   */
  divergences?: boolean;
}

const RENDER_STYLED_PARAMETERS: readonly string[] = [
  "source",
  "use_ascii",
  "padding_x",
  "padding_y",
  "rounded_edges",
  "gap",
  "inline_edge_labels",
  "max_label_width",
  "arrow_style",
  "partial",
];

/** Python's parameter names for `render_styled`, in snake_case and in signature order. */
export function renderStyledParameters(): readonly string[] {
  return RENDER_STYLED_PARAMETERS;
}

interface Rendered {
  canvas: Canvas | null;
  graph: Graph | null;
}

interface InternalOptions {
  useAscii: boolean;
  paddingX: number;
  paddingY: number;
  roundedEdges: boolean;
  gap: number;
  inlineEdgeLabels: boolean;
  maxLabelWidth: number | null;
  arrowStyle: string;
  partial: boolean;
  divergences: boolean;
}

function resolveOptions(options: RenderStyledOptions | Options): InternalOptions {
  return {
    useAscii: options.useAscii ?? false,
    paddingX: options.paddingX ?? FLOWCHART_PADDING_X,
    paddingY: options.paddingY ?? FLOWCHART_PADDING_Y,
    roundedEdges: options.roundedEdges ?? true,
    gap: options.gap ?? FLOWCHART_GAP,
    inlineEdgeLabels: options.inlineEdgeLabels ?? false,
    maxLabelWidth: options.maxLabelWidth ?? null,
    arrowStyle: options.arrowStyle ?? DEFAULT_ARROW_STYLE,
    partial: options.partial ?? false,
    divergences: options.divergences ?? false,
  };
}

function renderCanvas(source: string, opts: InternalOptions): Rendered {
  const {
    useAscii,
    paddingX,
    paddingY,
    roundedEdges,
    gap,
    inlineEdgeLabels,
    maxLabelWidth,
    arrowStyle,
    partial,
    divergences,
  } = opts;

  const padX = overridden(paddingX, FLOWCHART_PADDING_X);
  const padY = overridden(paddingY, FLOWCHART_PADDING_Y);
  const g = overridden(gap, FLOWCHART_GAP);

  const cs = buildCharset(useAscii, arrowStyle);
  const raw = partial ? completePartial(source) : source;
  const prepared = prepareSource(raw);
  const text = skipDirectives(prepared);

  if (text.startsWith("sequenceDiagram")) {
    return {
      canvas: renderSequence(parseSequenceDiagram(text), useAscii, padX, g, cs, maxLabelWidth),
      graph: null,
    };
  }

  if (text.startsWith("classDiagram")) {
    return {
      canvas: renderClassDiagram(parseClassDiagram(text), useAscii, padX, g, cs),
      graph: null,
    };
  }

  if (text.startsWith("erDiagram")) {
    return {
      canvas: renderERDiagram(parseERDiagram(text), useAscii, padX, g, cs),
      graph: null,
    };
  }

  if (text.startsWith("block")) {
    return {
      canvas: renderBlockDiagram(parseBlockDiagram(text), useAscii, padX, g, cs),
      graph: null,
    };
  }

  if (text.startsWith("gitGraph")) {
    return {
      canvas: renderGitGraph(parseGitGraph(prepared), useAscii, cs),
      graph: null,
    };
  }

  if (text.startsWith("gantt")) {
    return {
      canvas: renderGantt(parseGantt(text), useAscii),
      graph: null,
    };
  }

  if (text.startsWith("pie")) {
    return {
      canvas: renderPieChart(parsePieChart(text), useAscii),
      graph: null,
    };
  }

  if (text.startsWith("treemap")) {
    return {
      canvas: renderTreemap(parseTreemap(text), useAscii, cs),
      graph: null,
    };
  }

  if (text.startsWith("mindmap")) {
    return {
      canvas: renderMindmap(parseMindmap(text, divergences), useAscii, roundedEdges),
      graph: null,
    };
  }

  if (text.startsWith("packet")) {
    return {
      canvas: renderPacket(parsePacket(text), useAscii, roundedEdges, padY),
      graph: null,
    };
  }

  if (text.startsWith("xychart")) {
    return {
      canvas: renderXYChart(parseXYChart(text), useAscii, roundedEdges),
      graph: null,
    };
  }

  if (text.startsWith("journey")) {
    return {
      canvas: renderJourney(parseJourney(text), useAscii, padX, g, roundedEdges, cs),
      graph: null,
    };
  }

  if (text.startsWith("timeline")) {
    return {
      canvas: renderTimeline(parseTimeline(text), useAscii, cs),
      graph: null,
    };
  }

  if (text.startsWith("kanban")) {
    return {
      canvas: renderKanban(parseKanban(text), useAscii, padX, g, cs),
      graph: null,
    };
  }

  if (text.startsWith("quadrantChart")) {
    return {
      canvas: renderQuadrant(parseQuadrant(text), useAscii, divergences),
      graph: null,
    };
  }

  let graph: Graph;
  let effectiveInline = inlineEdgeLabels;
  if (text.startsWith("architecture")) {
    graph = parseArchitecture(text);
    effectiveInline = false;
  } else if (text.startsWith(STATE_DIAGRAM)) {
    graph = parseStateDiagram(text);
  } else {
    graph = parseFlowchart(text);
  }

  const canvas = renderGraphCanvas(graph, {
    cs,
    useAscii,
    paddingX,
    paddingY,
    roundedEdges,
    gap,
    inlineEdgeLabels: effectiveInline,
    maxLabelWidth,
    divergences,
  });
  return { canvas, graph };
}

function maybeFit<T>(
  produce: (opts: InternalOptions) => T,
  plain: (result: T) => string,
  base: InternalOptions,
  width: number | undefined
): T {
  const initial = produce(base);
  if (width === undefined) return initial;
  return fitToWidth(
    (overrides) =>
      produce({
        ...base,
        gap: overrides.gap ?? base.gap,
        paddingX: overrides.paddingX ?? base.paddingX,
        maxLabelWidth: overrides.maxLabelWidth ?? base.maxLabelWidth,
      }),
    initial,
    width,
    { gap: base.gap, paddingX: base.paddingX, plain }
  );
}

/** Render mermaid syntax as Unicode (or ASCII) art. */
export function render(source: string, options: Options = {}): string {
  const base = resolveOptions(options);
  return maybeFit(
    (opts) => {
      const { canvas } = renderCanvas(source, opts);
      return canvas !== null ? canvas.toString() : "";
    },
    (result) => result,
    base,
    options.width
  );
}

/** Render mermaid syntax as a themed `Text` object (before console folding). */
export function renderThemedText(source: string, options: Options = {}, theme: string = DEFAULT_THEME): Text {
  const base = resolveOptions(options);
  return maybeFit(
    (opts) => {
      const rendered = renderCanvas(source, opts);
      if (rendered.graph !== null) {
        return renderGraphRich(rendered.canvas, rendered.graph, theme);
      }
      return renderSequenceRich(rendered.canvas, theme);
    },
    (result) => result.plain,
    base,
    options.width
  );
}

/** Render mermaid syntax painted by a theme as ANSI terminal text. */
export function renderThemed(source: string, options: Options = {}, theme: string = DEFAULT_THEME): string {
  return renderThemedText(source, options, theme).toAnsi(options.background);
}

const plainStyled = (doc: StyledDocument): string =>
  doc.lines.map((line) => line.map((chunk) => chunk.text).join("")).join("\n");

/** Render mermaid syntax as theme-independent styled chunks (`{ version: 1, lines }`). */
export function renderStyled(source: string, options: RenderStyledOptions = {}): StyledDocument {
  const base = resolveOptions(options);
  return maybeFit(
    (opts) => serializeCanvas(renderCanvas(source, opts).canvas),
    plainStyled,
    base,
    options.width
  );
}
