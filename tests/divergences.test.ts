// Tests for the ◉ behaviours:
// - Leading BOM and inline `pie` header title were fixed upstream in termaid 0.12.0, so they now work by default.
// - Edge-label box/arrowhead guard, mindmap id+shape unwrapping, and quadrantChart y-axis label remain behind
//   `divergences: true`, while `divergences: false` (default) reproduces the Python reference byte for byte.

import { describe, it, expect } from "bun:test";
import { declaredType, render } from "../src/index.ts";
import { parsePieChart } from "../src/parser/piechart.ts";

const BOM = "\ufeff";

describe("leading BOM (fixed upstream in 0.12.0)", () => {
  const declared: ReadonlyArray<readonly [string, string]> = [
    ["pie", 'pie\n    title T\n    "A" : 60\n    "B" : 40\n'],
    ["sequenceDiagram", "sequenceDiagram\n    Alice->>Bob: hi\n"],
    ["gantt", "gantt\n    dateFormat YYYY-MM-DD\n    section S\n    a :2020-01-01, 3d\n"],
    ["mindmap", "mindmap\n  Root\n    Branch\n"],
    ["classDiagram", "classDiagram\n    class Dog {\n      +bark()\n    }\n"],
  ];

  it.each(declared)("still reads %s as its own type", (type, source) => {
    expect(declaredType(BOM + source)).toBe(type);
  });

  it.each(declared)("draws %s exactly as it would without the mark", (_type, source) => {
    expect(render(BOM + source, { width: 60 })).toBe(render(source, { width: 60 }));
  });

  it("keeps a flowchart's direction", () => {
    const source = "graph LR\n  A[Start] --> B[End]\n";
    expect(render(BOM + source, { width: 60 })).toBe(render(source, { width: 60 }));
  });

  it("takes off leading BOMs alone, a later one being ordinary text", () => {
    const trailing = `graph LR\n  A --> B\n${BOM}`;
    expect(render(trailing, { width: 60 })).toContain(BOM);
  });
});

describe("pie title written on the header line (fixed upstream in 0.12.0)", () => {
  it("reads the title mermaid allows after the keyword", () => {
    expect(parsePieChart("pie title Where the time goes\n").title).toBe("Where the time goes");
  });

  it("reads it after showData too, which is the order mermaid writes them in", () => {
    const chart = parsePieChart('pie showData title Languages\n  "Go" : 30\n');
    expect(chart.title).toBe("Languages");
    expect(chart.showData).toBe(true);
  });

  it("puts the title in the drawing, not merely in the model", () => {
    expect(render('pie title Languages\n  "Go" : 30\n  "Rust" : 70\n', { width: 60 })).toContain("Languages");
  });

  it("leaves the two-line form alone", () => {
    expect(parsePieChart('pie\n    title Languages\n    "Go" : 30\n').title).toBe("Languages");
  });

  it("invents no title where the header carries none", () => {
    expect(parsePieChart('pie showData\n  "Go" : 30\n').title).toBe("");
  });
});

describe("◉ an edge label, which the reference writes inside the box next door", () => {
  const SOURCE = "graph TD\n    A --> B\n    A -.-> C\n    A ==> D\n    B -->|label| C\n";

  it.each([40, 80])("keeps every arrowhead at width %i with divergences: true", (width) => {
    const drawn = render(SOURCE, { width, divergences: true });
    expect([...drawn].filter((c) => c === "▼")).toHaveLength(3);
  });

  it.each([40, 80])("still draws the label at width %i with divergences: true", (width) => {
    expect(render(SOURCE, { width, divergences: true })).toContain("label");
  });

  it("keeps the label out of every node's box with divergences: true", () => {
    const boxed = render(SOURCE, { width: 80, divergences: true })
      .split("\n")
      .filter((line) => line.includes("│") && line.includes("label"));
    expect(boxed).toEqual([]);
  });
});

describe("◉ a mindmap id and the shape it wraps, which the reference draws as text", () => {
  const SHAPED: ReadonlyArray<readonly [string, string]> = [
    ["circle", "root((Central))"],
    ["square", "id1[Central]"],
    ["hexagon", "id2{{Central}}"],
    ["rounded square", "id3(Central)"],
    ["cloud", "id4)Central("],
    ["bang", "id5!Central!"],
  ];

  it.each(SHAPED)("keeps the text alone out of a %s behind an id with divergences: true", (_shape, written) => {
    expect(render(`mindmap\n  ${written}\n    Branch\n`, { width: 60, divergences: true })).toContain("Central ");
  });

  it.each(SHAPED)("draws neither the id nor the delimiters of a %s with divergences: true", (_shape, written) => {
    const drawn = render(`mindmap\n  ${written}\n    Branch\n`, { width: 60, divergences: true });
    expect(drawn).not.toContain(written);
  });

  it("keeps the reference's verbatim id+shape text when divergences is false", () => {
    expect(render("mindmap\n  root((Central))\n    Branch\n", { width: 60 })).toContain("root((Central))");
  });

  it("reads the circle rather than leaving half of it in the text with divergences: true", () => {
    expect(render("mindmap\n  ((Central))\n    Branch\n", { width: 60, divergences: true })).toContain("Central ");
  });

  it("leaves a bare label alone, having no delimiters to drop", () => {
    expect(render("mindmap\n  Plain label\n    Branch\n", { width: 60, divergences: true })).toContain("Plain label");
  });
});

describe("◉ quadrantChart y-axis label", () => {
  const SOURCE =
    "quadrantChart\n  title Matrix\n  x-axis Low --> High\n  y-axis Weak --> Strong\n  Task: [0.5, 0.5]\n";

  it("draws the y-axis label when divergences is true", () => {
    expect(render(SOURCE, { width: 80, divergences: true })).toContain("Weak -> Strong");
  });

  it("omits the y-axis label by default to match the reference", () => {
    expect(render(SOURCE, { width: 80 })).not.toContain("Weak -> Strong");
  });
});
