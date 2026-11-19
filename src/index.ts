// The package's one entry: a mermaid source in, the drawing a terminal shows out. Everything under it mirrors the
// Python module tree of the reference (model/, graph/, parser/, layout/, routing/, renderer/), file for file.
//
// Ported from src/termaid/__init__.py and the auto-fit of src/termaid/cli.py, which is part of what `--width` means.

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
import { DEFAULT_RENDER, renderGraph, type RenderOptions } from "./renderer/draw.ts";
import { renderRich, renderSequenceRich } from "./output/rich.ts";
import { Text } from "./richcompat.ts";
import type { Background } from "./background.ts";
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
import { displayWidth } from "./utils.ts";
import { pyStrip } from "./pycompat.ts";

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
export { renderText } from "./output/text.ts";
export { renderRich, renderSequenceRich } from "./output/rich.ts";
export { getTheme, THEMES, type Theme } from "./renderer/themes.ts";
export { printToConsole, Text, CONSOLE_WIDTH } from "./richcompat.ts";
export { displayWidth } from "./utils.ts";
export { DARK_BACKGROUND, LIGHT_BACKGROUND, type Background } from "./background.ts";

/** YAML frontmatter, which the reference drops before it reads a line of the diagram. */
const FRONTMATTER_RE = /^---\s*\n[\s\S]*?\n---\s*\n/;
const STATE_DIAGRAM = "stateDiagram";

/** The steps a too-wide drawing is retried at, in order: the gap first, then the horizontal padding. */
const COMPACT_STEPS: ReadonlyArray<{ gap?: number; paddingX?: number }> = [
  { gap: 2 },
  { gap: 1 },
  { gap: 1, paddingX: 2 },
  { gap: 1, paddingX: 0 },
];

export interface Options extends Partial<RenderOptions> {
  /** A ceiling on the output's width: past it, the drawing is redrawn tighter until it fits or runs out of steps. */
  width?: number;
  /**
   * ◉ The side the terminal is: every theme was drawn for `dark`, which is the default and mirrors nothing. On
   * `light` each colour is flipped about its luminance, hue kept, so a pale foreground stops being fog on white.
   * Layout is untouched either way: the same drawing, painted for the other side.
   */
  background?: Background;
}

/** The FLOWCHART's own defaults. A renderer of its own keeps its own, unless the caller has moved off these. */
const FLOWCHART_PADDING_X = 4;
const FLOWCHART_PADDING_Y = 2;
const FLOWCHART_GAP = 4;

/** What the caller actually asked for, or nothing at all where the value is the flowchart's default. */
const overridden = (value: number | undefined, base: number): number | undefined =>
  value === undefined || value === base ? undefined : value;

type Draw = (source: string, options: Partial<RenderOptions>) => string;
type Paint = (source: string, options: Partial<RenderOptions>, theme: string) => Text;

/**
 * The diagram types drawn by a renderer of their own, each read off the first word of the source.
 *
 * `draw` and `paint` are the SAME dispatch written twice in the reference, and they do not pass the same arguments:
 * a themed journey, mindmap, packet or xychart is handed the source alone, so its renderer falls back to its own
 * padding and gap and the drawing comes out WIDER than the plain one. The prefix is stated once here, the divergence
 * is kept where the reference put it.
 */
const SPECIALISED: ReadonlyArray<{ prefix: string; draw: Draw; paint: Paint }> = [
  {
    prefix: "sequenceDiagram",
    draw: (source, o) =>
      renderSequence(
        parseSequenceDiagram(source),
        o.useAscii ?? false,
        overridden(o.paddingX, FLOWCHART_PADDING_X),
        overridden(o.gap, FLOWCHART_GAP)
      ).toString(),
    paint: (source, o, theme) =>
      renderSequenceRich(
        renderSequence(
          parseSequenceDiagram(source),
          o.useAscii ?? false,
          overridden(o.paddingX, FLOWCHART_PADDING_X),
          overridden(o.gap, FLOWCHART_GAP)
        ),
        theme
      ),
  },
  {
    prefix: "classDiagram",
    draw: (source, o) =>
      renderClassDiagram(
        parseClassDiagram(source),
        o.useAscii ?? false,
        overridden(o.paddingX, FLOWCHART_PADDING_X),
        overridden(o.gap, FLOWCHART_GAP)
      ).toString(),
    paint: (source, o, theme) =>
      renderSequenceRich(
        renderClassDiagram(
          parseClassDiagram(source),
          o.useAscii ?? false,
          overridden(o.paddingX, FLOWCHART_PADDING_X),
          overridden(o.gap, FLOWCHART_GAP)
        ),
        theme
      ),
  },
  {
    prefix: "erDiagram",
    draw: (source, o) =>
      renderERDiagram(
        parseERDiagram(source),
        o.useAscii ?? false,
        overridden(o.paddingX, FLOWCHART_PADDING_X),
        overridden(o.gap, FLOWCHART_GAP)
      ).toString(),
    paint: (source, o, theme) =>
      renderSequenceRich(
        renderERDiagram(
          parseERDiagram(source),
          o.useAscii ?? false,
          overridden(o.paddingX, FLOWCHART_PADDING_X),
          overridden(o.gap, FLOWCHART_GAP)
        ),
        theme
      ),
  },
  {
    prefix: "block",
    draw: (source, o) =>
      renderBlockDiagram(
        parseBlockDiagram(source),
        o.useAscii ?? false,
        overridden(o.paddingX, FLOWCHART_PADDING_X),
        overridden(o.gap, FLOWCHART_GAP)
      ).toString(),
    paint: (source, o, theme) =>
      renderSequenceRich(
        renderBlockDiagram(
          parseBlockDiagram(source),
          o.useAscii ?? false,
          overridden(o.paddingX, FLOWCHART_PADDING_X),
          overridden(o.gap, FLOWCHART_GAP)
        ),
        theme
      ),
  },
  {
    prefix: "gitGraph",
    draw: (source, o) => renderGitGraph(parseGitGraph(source), o.useAscii ?? false).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderGitGraph(parseGitGraph(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "gantt",
    draw: (source, o) => renderGantt(parseGantt(source), o.useAscii ?? false).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderGantt(parseGantt(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "architecture",
    draw: (source, o) => renderGraph(parseArchitecture(source), o),
    // The gap is NOT handed on here, where the plain call above hands on everything.
    paint: (source, o, theme) =>
      renderRich(
        parseArchitecture(source),
        {
          useAscii: o.useAscii ?? DEFAULT_RENDER.useAscii,
          paddingX: o.paddingX ?? DEFAULT_RENDER.paddingX,
          paddingY: o.paddingY ?? DEFAULT_RENDER.paddingY,
          roundedEdges: o.roundedEdges ?? DEFAULT_RENDER.roundedEdges,
        },
        theme
      ),
  },
  {
    prefix: "pie",
    draw: (source, o) => renderPieChart(parsePieChart(source), o.useAscii ?? false).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderPieChart(parsePieChart(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "treemap",
    draw: (source, o) => renderTreemap(parseTreemap(source), o.useAscii ?? false).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderTreemap(parseTreemap(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "mindmap",
    draw: (source, o) => renderMindmap(parseMindmap(source), o.useAscii ?? false, o.roundedEdges ?? true).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderMindmap(parseMindmap(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "packet",
    draw: (source, o) =>
      renderPacket(
        parsePacket(source),
        o.useAscii ?? false,
        o.roundedEdges ?? true,
        overridden(o.paddingY, FLOWCHART_PADDING_Y)
      ).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderPacket(parsePacket(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "xychart",
    draw: (source, o) => renderXYChart(parseXYChart(source), o.useAscii ?? false, o.roundedEdges ?? true).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderXYChart(parseXYChart(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "journey",
    draw: (source, o) =>
      renderJourney(
        parseJourney(source),
        o.useAscii ?? false,
        overridden(o.paddingX, FLOWCHART_PADDING_X),
        overridden(o.gap, FLOWCHART_GAP),
        o.roundedEdges ?? true
      ).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderJourney(parseJourney(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "timeline",
    draw: (source, o) => renderTimeline(parseTimeline(source), o.useAscii ?? false).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderTimeline(parseTimeline(source), o.useAscii ?? false), theme),
  },
  {
    prefix: "kanban",
    draw: (source, o) =>
      renderKanban(
        parseKanban(source),
        o.useAscii ?? false,
        overridden(o.paddingX, FLOWCHART_PADDING_X),
        overridden(o.gap, FLOWCHART_GAP)
      ).toString(),
    paint: (source, o, theme) =>
      renderSequenceRich(
        renderKanban(
          parseKanban(source),
          o.useAscii ?? false,
          overridden(o.paddingX, FLOWCHART_PADDING_X),
          overridden(o.gap, FLOWCHART_GAP)
        ),
        theme
      ),
  },
  {
    prefix: "quadrantChart",
    draw: (source, o) => renderQuadrant(parseQuadrant(source), o.useAscii ?? false).toString(),
    paint: (source, o, theme) => renderSequenceRich(renderQuadrant(parseQuadrant(source), o.useAscii ?? false), theme),
  },
];

/** A gitGraph may declare itself in an init directive rather than in its first word. */
const INIT_DIRECTIVE = "%%{init";
const GIT_GRAPH = "gitGraph";

const declared = (text: string): (typeof SPECIALISED)[number] | undefined =>
  SPECIALISED.find(
    (type) =>
      text.startsWith(type.prefix) ||
      (type.prefix === GIT_GRAPH && text.startsWith(INIT_DIRECTIVE) && text.includes(GIT_GRAPH))
  );

/** What `declaredType` answers for the family the fallback parser draws, whichever of its header words was used. */
const FLOWCHART = "flowchart";

/**
 * ◉ The byte order mark an editor writes in front of a UTF-8 file, taken off before anything reads the header. The
 * reference does not: `strip()` leaves it, so the first word becomes `﻿pie` and the source falls to the flowchart
 * parser, which draws the pie's own syntax as boxes. `pie`, `sequenceDiagram`, `gantt`, `mindmap` and `classDiagram`
 * all lose their diagram there, and a flowchart keeps only its default direction (measured 2026-08-17).
 *
 * What widens is the input ACCEPTED, never the drawing: a source the reference accepts renders its own bytes, since a
 * BOM is by definition the first character of a file and nowhere else.
 */
const BOM = "﻿";
const withoutBom = (source: string): string => (source.startsWith(BOM) ? source.slice(BOM.length) : source);

/** What every entry point reads instead of the source it was handed: `str.strip()` and no frontmatter. */
const headed = (source: string): string => pyStrip(withoutBom(source)).replace(FRONTMATTER_RE, "");

/**
 * The type a source DECLARES, read exactly the way the dispatch reads it, or null where it declares none this renderer
 * knows. null is not a refusal here: such a source still falls to the flowchart parser, which draws its lines as node
 * labels, the reference's own behaviour. It is the caller's one chance to tell a type from a NEWER mermaid apart from
 * a diagram, and to show the source rather than boxes of its syntax.
 */
export function declaredType(source: string): string | null {
  const text = headed(source);
  const type = declared(text);
  if (type !== undefined) return type.prefix;
  if (text.startsWith(STATE_DIAGRAM)) return STATE_DIAGRAM;
  return declaresFlowchart(text) ? FLOWCHART : null;
}

/** A mermaid source as a graph, the type read off its first word. */
export function parse(source: string): Graph {
  const text = headed(source);
  if (text.startsWith(STATE_DIAGRAM)) return parseStateDiagram(text);
  return parseFlowchart(text);
}

const widestLine = (text: string): number => Math.max(0, ...text.split("\n").map(displayWidth));

/** One drawing, at the sizes given, with no attempt to fit it anywhere. */
function drawn(source: string, options: Partial<RenderOptions>): string {
  const text = headed(source);
  const type = declared(text);
  if (type !== undefined) return type.draw(text, options);
  return renderGraph(parse(text), options);
}

/** The same drawing, still carrying the style of every cell, which is what a theme needs. */
function painted(source: string, options: Partial<RenderOptions>, theme: string): Text {
  const text = headed(source);
  const type = declared(text);
  if (type !== undefined) return type.paint(text, options, theme);
  return renderRich(parse(text), options, theme);
}

/**
 * The reference's auto-fit: a drawing wider than the target is redrawn tighter, gap first and padding after, until it
 * fits or the steps run out. What is measured is the PLAIN text, a painted one carrying escape sequences that take no
 * room on screen.
 */
function fitted<T>(
  produce: (options: Partial<RenderOptions>) => T,
  plainOf: (result: T) => string,
  options: Partial<RenderOptions>,
  width: number | undefined
): T {
  // The parse is repeated per attempt on purpose: sizing WRITES the wrapped label back onto the node.
  let result = produce(options);
  if (width === undefined || widestLine(plainOf(result)) <= width) return result;

  const gap = options.gap ?? FLOWCHART_GAP;
  const paddingX = options.paddingX ?? FLOWCHART_PADDING_X;
  for (const step of COMPACT_STEPS) {
    const stepGap = step.gap ?? gap;
    const stepPaddingX = step.paddingX ?? paddingX;
    if (stepGap >= gap && stepPaddingX >= paddingX) continue;
    result = produce({ ...options, gap: Math.min(stepGap, gap), paddingX: stepPaddingX });
    if (widestLine(plainOf(result)) <= width) return result;
  }
  return result;
}

/** The drawing a terminal shows. A `width` compacts the layout until it fits, the way the reference's CLI does. */
export function render(source: string, options: Options = {}): string {
  const { width, background: _background, ...renderOptions } = options;
  return fitted((o) => drawn(source, o), (result) => result, renderOptions, width);
}

const DEFAULT_THEME = "default";

/**
 * The same drawing, painted by a theme. What comes back is the text with its colours ON, and NOT yet folded to a
 * console's width: folding is what a console does to a text, and `cli.ts` is where the reference does it.
 */
export function renderThemedText(source: string, options: Options = {}, theme: string = DEFAULT_THEME): Text {
  const { width, background: _background, ...renderOptions } = options;
  return fitted((o) => painted(source, o, theme), (result) => result.plain, renderOptions, width);
}

/** The same drawing, painted by a theme, as the bytes a terminal reads. */
export function renderThemed(source: string, options: Options = {}, theme: string = DEFAULT_THEME): string {
  return renderThemedText(source, options, theme).toAnsi(options.background);
}
