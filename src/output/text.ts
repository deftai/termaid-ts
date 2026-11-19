// Ported from src/termaid/output/text.py.

import { Graph } from "../graph/model.ts";
import { renderGraph, type RenderOptions } from "../renderer/draw.ts";

/** A graph as plain text. */
export function renderText(graph: Graph, options: Partial<RenderOptions> = {}): string {
  return renderGraph(graph, options);
}
