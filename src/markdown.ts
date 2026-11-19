// Ported from src/termaid/markdown.py.
//
// Find Mermaid diagrams in Markdown.

import { pySplit } from "./pycompat.ts";

const OPEN_RE = /^([ \t]*)(`{3,}|~{3,})([\s\S]*)$/;

export interface Segment {
  text: string;
  isMermaid: boolean;
  raw: string;
  indent: string;
  line: number;
}

function dedent(line: string, width: number): string {
  let n = 0;
  while (n < width && n < line.length && (line[n] === " " || line[n] === "\t")) {
    n += 1;
  }
  return line.slice(n);
}

/**
 * Split Markdown into text segments and Mermaid diagram segments.
 *
 * Lines are split on `\n` only, so a CRLF document keeps its `\r` characters
 * in text segments and in `raw`, while `\r` is dropped from the diagram source.
 */
export function splitMarkdown(text: string): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  const pending: string[] = [];

  const flush = (): void => {
    if (pending.length > 0) {
      segments.push({ text: pending.join("\n"), isMermaid: false, raw: "", indent: "", line: 0 });
      pending.length = 0;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const current = lines[i] as string;
    const match = OPEN_RE.exec(current);
    const fence = match !== null ? (match[2] as string) : "";
    const info = match !== null ? (match[3] as string) : "";
    if (match === null || (fence[0] === "`" && info.includes("`"))) {
      pending.push(current);
      i += 1;
      continue;
    }

    const fenceChar = fence[0] === "`" ? "`" : "~";
    const closeRe = new RegExp(`^[ \\t]*${fenceChar}{${fence.length},}[ \\t]*\\r?$`);
    let end: number | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      if (closeRe.test(lines[j] as string)) {
        end = j;
        break;
      }
    }

    const words = pySplit(info);
    const isMermaid = words.length > 0 && (words[0] as string).toLowerCase() === "mermaid";
    if (end === null || !isMermaid) {
      const stop = end === null ? lines.length : end + 1;
      for (let k = i; k < stop; k++) pending.push(lines[k] as string);
      i = stop;
      continue;
    }

    const indent = match[1] as string;
    const body: string[] = [];
    for (let k = i + 1; k < end; k++) {
      body.push(dedent(lines[k] as string, indent.length).replace(/\r+$/, ""));
    }
    flush();
    segments.push({
      text: body.join("\n"),
      isMermaid: true,
      raw: lines.slice(i, end + 1).join("\n"),
      indent,
      line: i + 1,
    });
    i = end + 1;
  }

  flush();
  return segments;
}
