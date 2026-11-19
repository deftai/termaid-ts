// Unit tests for 0.12.0 additions not varied by the standard --width CLI oracle:
// renderStyledParameters, arrowStyle, inlineEdgeLabels, maxLabelWidth, splitMarkdown, Diagnostics, and CLI flags.

import { describe, it, expect } from "bun:test";
import { main as cliMain } from "../src/cli.ts";
import {
  Diagnostic,
  parse,
  render,
  renderStyled,
  renderStyledParameters,
  splitMarkdown,
} from "../src/index.ts";

describe("renderStyled and renderStyledParameters", () => {
  it("lists Python's exact parameter names in snake_case signature order", () => {
    expect(renderStyledParameters()).toEqual([
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
    ]);
  });

  it("returns version 1 styled chunks whose joined text equals render()", () => {
    const src = "flowchart LR\n  A[Start] -->|go| B[End]\n";
    const doc = renderStyled(src, { paddingX: 2, paddingY: 0, gap: 2, arrowStyle: "triangle" });
    expect(doc.version).toBe(1);
    const joined = doc.lines.map((line) => line.map((c) => c.text).join("")).join("\n");
    expect(joined).toBe(render(src, { paddingX: 2, paddingY: 0, gap: 2, arrowStyle: "triangle" }));
  });

  it("completes unfinished brackets and holds back dangling links when partial is true", () => {
    const partialNode = "flowchart LR\n  A[Start] --> B[Work in prog";
    const doc = renderStyled(partialNode, { partial: true });
    const text = doc.lines.map((l) => l.map((c) => c.text).join("")).join("\n");
    expect(text).toContain("Work in prog");
    expect(text).not.toContain("[Work");

    const danglingEdge = "flowchart LR\n  A[Start] --> B[Mid]\n  B -->|pend";
    const held = parse(danglingEdge, { partial: true });
    expect(held.edges).toHaveLength(1);
  });
});

describe("arrowStyle and inlineEdgeLabels", () => {
  it("supports pointer, triangle, and outline arrowheads and rejects unknown styles", () => {
    const src = "flowchart LR\n  A --> B\n";
    expect(render(src, { arrowStyle: "pointer" })).toContain("►");
    expect(render(src, { arrowStyle: "triangle" })).toContain("▶");
    expect(render(src, { arrowStyle: "outline" })).toContain("▷");
    expect(() => render(src, { arrowStyle: "chevron" })).toThrow(/unknown arrow style/);
  });

  it("keeps class diagram dependency arrows solid when arrowStyle is outline", () => {
    const cls = "classDiagram\n  Animal <|-- Duck\n  Duck ..> Pond\n";
    const out = render(cls, { arrowStyle: "outline" });
    expect(out).toContain("△");
    expect(out).toContain("▼");
  });

  it("attaches single-line edge labels directly to edges when inlineEdgeLabels is true", () => {
    const src = "flowchart TD\n  A[Top] -->|yes| B[Bottom]\n";
    expect(render(src, { inlineEdgeLabels: true })).toContain("yes─┤");
    expect(render(src, { inlineEdgeLabels: true, useAscii: true })).toContain("yes-+");
  });

  it("wraps long node and edge labels when maxLabelWidth is set", () => {
    const src = "flowchart TD\n  A[Very long node description here] -->|another long edge description| B[End]\n";
    const wrapped = render(src, { maxLabelWidth: 12 });
    const unwrapped = render(src);
    expect(wrapped.split("\n").length).toBeGreaterThan(unwrapped.split("\n").length);
  });
});

describe("splitMarkdown and Diagnostic", () => {
  it("extracts fenced mermaid blocks with indentation and preserves CRLF outside", () => {
    const md = "Intro\r\n  ```mermaid\r\n  graph LR\r\n    A --> B\r\n  ```\r\nOutro\r\n";
    const segs = splitMarkdown(md);
    expect(segs).toHaveLength(3);
    expect(segs[0]?.isMermaid).toBe(false);
    expect(segs[1]?.isMermaid).toBe(true);
    expect(segs[1]?.indent).toBe("  ");
    expect(segs[1]?.text).toBe("graph LR\n  A --> B");
    expect(segs[2]?.text).toBe("Outro\r\n");
  });

  it("formats diagnostics as text and JSON lines", () => {
    const d = new Diagnostic("width_exceeded", "too wide", {
      exitCode: 2,
      severity: "warning",
      details: { actual_width: 50, max_width: 40 },
    });
    expect(d.format("text")).toBe("Warning: too wide");
    expect(JSON.parse(d.format("json"))).toEqual({
      version: 1,
      severity: "warning",
      code: "width_exceeded",
      message: "too wide",
      details: { actual_width: 50, max_width: 40 },
      exit_code: 2,
    });
  });

  it("reports --claude-hook and --tui as not ported with non-zero exit code", () => {
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errs.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      expect(cliMain(["--claude-hook"])).toBe(1);
      expect(errs.join("")).toContain("--claude-hook is not part of the TypeScript port");
    } finally {
      process.stderr.write = origWrite;
    }
  });
});
