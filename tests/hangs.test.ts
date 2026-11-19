// ◉ Four inputs made the renderer loop forever or run out of memory, and the pinned reference does the same on all of
// them, so no reference drawing exists and none of them belongs in the parity corpus. What is pinned here is that each
// one RETURNS (a drawing or a thrown error). No test measures time: a test that never returns is the failure, and it is
// run under a time limit and a memory cap by whoever runs it:
//
//     perl -e 'alarm 180; exec @ARGV' bun test tests/hangs.test.ts

import { describe, expect, it } from "bun:test";
import { render } from "../src/index.ts";
import { MAX_PACKET_STRIPS } from "../src/renderer/packet.ts";

const draw = (source: string): string => render(source, { width: 80 });

describe("inputs that used to make the renderer loop without end", () => {
  it("keeps an unmatched star of a markdown label as literal text", () => {
    const drawing = draw('flowchart LR\n  A["`literal *`"]');
    expect(drawing).toContain("literal *");
    // One box, not several.
    expect(drawing.split("\n").filter((line) => line.includes("┌"))).toHaveLength(1);
  });

  it("returns, or refuses, an edge it cannot route, instead of stepping a diagonal forever", () => {
    const source = `flowchart TD\n  A ${"-".repeat(1000)}> B & C\n  X --> Y`;
    let drawing: string | null = null;
    try {
      drawing = draw(source);
    } catch (error) {
      expect((error as Error).message).toContain("no axis-aligned path");
    }
    if (drawing !== null) {
      expect(drawing).toContain("A");
      expect(drawing).toContain("X");
    }
  });

  it("clips a bar far taller than the chart to the chart", () => {
    const drawing = draw("xychart-beta\n  y-axis 0 --> 1\n  bar [1000000000000]");
    expect(drawing).toContain("█");
    expect(drawing.split("\n").length).toBeLessThan(40);
  });

  it("refuses a packet field at a huge offset before allocating anything", () => {
    expect(() => draw('packet-beta\n20000000000: "Flag"')).toThrow(
      `Packet too large to draw: a field reaches strip 625000001, and at most ${MAX_PACKET_STRIPS} strips are drawn`,
    );
  });
});

describe("the same faults in the neighbouring code", () => {
  it("clips a horizontal bar and the lines of both orientations to the chart", () => {
    const bars = draw("xychart-beta horizontal\n  y-axis 0 --> 1\n  bar [1000000000000]");
    expect(bars).toContain("█");
    expect(draw("xychart-beta\n  y-axis 0 --> 1\n  line [1000000000000, 0, 1000000000000]")).toContain("╰");
    expect(draw("xychart-beta horizontal\n  y-axis 0 --> 1\n  line [1000000000000, 0, -1000000000000]")).toContain("└");
  });

  it("refuses a value that is not a finite number", () => {
    for (const value of ["nan", "inf", "-inf"]) {
      expect(() => draw(`xychart-beta\n  bar [1, ${value}]`)).toThrow("must be finite numbers");
      expect(() => draw(`xychart-beta horizontal\n  line [1, ${value}]`)).toThrow("must be finite numbers");
    }
  });

  it("refuses a packet field that spans too many strips, however it is written", () => {
    expect(() => draw('packet-beta\n0-20000000000: "Flag"')).toThrow("Packet too large to draw");
    expect(() => draw('packet-beta\n+20000000000: "Flag"')).toThrow("Packet too large to draw");
    expect(draw('packet-beta\n0-100000: "Flag"')).toContain("Flag");
  });

  it("reads every run of stars in a markdown label, matched or not", () => {
    for (const label of ["*", "**", "***", "a *", "**a", "*a**", "*a *b"]) {
      expect(draw(`flowchart LR\n  A["\`${label}\`"]`)).toContain("┌");
    }
    expect(draw('flowchart LR\n  A["`**b** and *i*`"]')).toContain("b and i");
  });
});
