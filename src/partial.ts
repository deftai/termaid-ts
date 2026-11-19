// Ported from src/termaid/partial.py.
//
// Draw a diagram from the start of its source, while the rest is still arriving.

import { PY_SPACE_CHARS, PY_WORD, pySplit, pyStrip, rstrip, splitLines } from "./pycompat.ts";

const CLOSERS: Readonly<Record<string, string>> = { "[": "]", "(": ")", "{": "}" };

const LINK_SOURCE = "[<xo]?(?:-{2,}|={2,}|-\\.+-?|~{3,})[->xo]?";
const LINK_RE = new RegExp(LINK_SOURCE, "g");
const LINK_FULL_RE = new RegExp(`^(?:${LINK_SOURCE})$`);

const TEXT_LINK_OPENERS: ReadonlySet<string> = new Set(["--", "==", "-."]);

const SEQUENCE_ARROW_RE = /(?:<<)?--?(?:>>|>|x|\))/;

const PY_S = `[${PY_SPACE_CHARS}]`;
const TRAILING_OPERATOR_RE = new RegExp(
  `(?:${PY_S}|(?<=${PY_WORD}))[<xo]?[-=.~]+[->xo]?${PY_S}*$|${PY_S}*(?:<|&|:{1,2}|%)${PY_S}*$`,
  "u"
);
const TRAILING_ARROW_RE = new RegExp(
  `(?:${PY_S}[<xo]?[-=~]+|(?<=${PY_WORD})[-=~]{2,})[->xo]?${PY_S}*$|${PY_S}*%${PY_S}*$`,
  "u"
);
const BARE_OPENER_RE = new RegExp(`${PY_S}*[\\[({"]+${PY_S}*$`, "u");
const SINGLE_WORD_RE = new RegExp(`^${PY_S}*[^${PY_SPACE_CHARS}]+$`, "u");

const HOLD_BACK_KINDS: ReadonlySet<string> = new Set(["erDiagram", "classDiagram"]);
const GRAPH_KINDS: ReadonlySet<string> = new Set(["graph", "flowchart", "stateDiagram"]);

const MAX_PARTIAL_LINE = 1000;

function diagramKind(text: string): string {
  for (const line of splitLines(text)) {
    const stripped = pyStrip(line);
    if (stripped !== "" && !stripped.startsWith("%%") && stripped !== "---") {
      return pySplit(stripped)[0] ?? "";
    }
  }
  return "";
}

function outsideAndStack(line: string): [string, string[]] {
  const outside: string[] = [];
  const stack: string[] = [];
  for (const ch of line) {
    if (stack.length > 0 && stack[stack.length - 1] === '"') {
      if (ch === '"') stack.pop();
      outside.push(" ");
      continue;
    }
    if (ch === '"') {
      stack.push('"');
      outside.push(" ");
    } else if (CLOSERS[ch] !== undefined) {
      stack.push(ch);
      outside.push(" ");
    } else if (stack.length > 0 && ch === CLOSERS[stack[stack.length - 1] as string]) {
      stack.pop();
      outside.push(" ");
    } else {
      outside.push(stack.length > 0 ? " " : ch);
    }
  }
  return [outside.join(""), stack];
}

function closeOpeners(stack: readonly string[]): string {
  let suffix = "";
  for (let i = stack.length - 1; i >= 0; i--) {
    const o = stack[i] as string;
    suffix += o === '"' ? '"' : (CLOSERS[o] as string);
  }
  return suffix;
}

function completeGraphLine(initial: string): string {
  let line = initial;
  while (true) {
    const before = line;
    line = line.replace(BARE_OPENER_RE, "");
    let [outside] = outsideAndStack(line);
    const trailing = TRAILING_OPERATOR_RE.exec(outside);
    if (trailing !== null && !LINK_FULL_RE.test(pyStrip(trailing[0]))) {
      line = rstrip(line.slice(0, trailing.index));
      [outside] = outsideAndStack(line);
    }
    const links = [...outside.matchAll(LINK_RE)];
    if (links.length > 0) {
      const last = links[links.length - 1] as RegExpExecArray;
      const lastStart = last.index;
      const lastEnd = lastStart + last[0].length;
      const rest = pyStrip(outside.slice(lastEnd));
      let dangling: boolean;
      if (rest.startsWith("|")) {
        const closing = rest.indexOf("|", 1);
        dangling = closing === -1 || pyStrip(rest.slice(closing + 1)) === "";
      } else {
        dangling = rest === "" || TEXT_LINK_OPENERS.has(last[0]);
      }
      if (dangling) {
        line = rstrip(line.slice(0, lastStart));
      }
    }
    if (line === before) break;
  }
  const [, stack] = outsideAndStack(line);
  return line + closeOpeners(stack);
}

function completeSequenceLine(line: string): string {
  if (SINGLE_WORD_RE.test(line)) return "";
  if (SEQUENCE_ARROW_RE.test(line) && !line.includes(":")) return "";
  return line;
}

function completeLine(kind: string, line: string): string {
  if (kind === "sequenceDiagram") return completeSequenceLine(line);
  if (GRAPH_KINDS.has(kind)) return completeGraphLine(line);
  if (HOLD_BACK_KINDS.has(kind)) return "";
  const cleaned = line.replace(BARE_OPENER_RE, "").replace(TRAILING_ARROW_RE, "");
  const [, stack] = outsideAndStack(cleaned);
  return cleaned + closeOpeners(stack);
}

/**
 * Make the unfinished last line of streamed Mermaid source safe to draw.
 * Source that ends with a newline is complete and is returned unchanged.
 */
export function completePartial(source: string): string {
  const text = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (text === "" || text.endsWith("\n")) return text;
  const nl = text.lastIndexOf("\n");
  if (nl <= 0) return text;
  const head = text.slice(0, nl);
  const last = text.slice(nl + 1);
  if ([...last].length > MAX_PARTIAL_LINE) return head;
  const kind = diagramKind(head);
  const completed = completeLine(kind, last);
  return pyStrip(completed) !== "" ? `${head}\n${completed}` : head;
}
