// Ported from src/termaid/parser/mindmap.py.

import { makeMindmap, makeMindmapNode, type Mindmap, type MindmapNode } from "../model/mindmap.ts";
import { lstrip, pyStrip, rstrip, splitLines } from "../pycompat.ts";

const COMMENT = "%%";

/** Python's exact shape-stripping patterns (anchored at start of label, no id prefix). */
const REFERENCE_SHAPES: readonly RegExp[] = [
  /^\((.+)\)$/,
  /^\[(.+)\]$/,
  /^\{\{(.+)\}\}$/,
  /^\)(.+)\($/,
];

/**
 * ◉ Extended shape-stripping patterns (enabled with `divergences: true`): an id may sit in front of any of Mermaid's
 * six mindmap shapes, and `((circle))` is tried before `(round)` so it does not leave a stray paren.
 */
const DIVERGENT_SHAPES: readonly RegExp[] = [
  /^[\w-]*\(\((.+)\)\)$/,
  /^[\w-]*\[(.+)\]$/,
  /^[\w-]*\{\{(.+)\}\}$/,
  /^[\w-]*\((.+)\)$/,
  /^[\w-]*\)(.+)\($/,
  /^[\w-]*!(.+)!$/,
];

/** A mermaid mindmap definition. */
export function parseMindmap(text: string, divergences = false): Mindmap {
  const lines = splitLines(pyStrip(text));
  const mindmap = makeMindmap();
  if (lines.length === 0) return mindmap;

  const shapes = divergences ? DIVERGENT_SHAPES : REFERENCE_SHAPES;

  const body: Array<readonly [number, string]> = [];
  for (let line of lines.slice(1)) {
    const comment = line.indexOf(COMMENT);
    if (comment >= 0) line = line.slice(0, comment);

    const stripped = rstrip(line);
    if (pyStrip(stripped) === "") continue;

    let label = pyStrip(stripped);
    for (const shape of shapes) {
      const wrapped = shape.exec(label);
      if (wrapped !== null) {
        label = wrapped[1] as string;
        break;
      }
    }

    body.push([stripped.length - lstrip(stripped).length, label]);
  }
  if (body.length === 0) return mindmap;

  const stack: Array<readonly [number, MindmapNode]> = [];
  for (const [indent, label] of body) {
    const node = makeMindmapNode(label);
    while (stack.length > 0 && (stack[stack.length - 1] as readonly [number, MindmapNode])[0] >= indent) stack.pop();

    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent[1].children.push(node);
    else if (mindmap.root === null) mindmap.root = node;
    // A second root is not a second tree: it hangs off the first, which is the only one drawn.
    else mindmap.root.children.push(node);

    stack.push([indent, node]);
  }

  return mindmap;
}
