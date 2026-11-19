// The only verdict this port answers to: the reference's own bytes (fixtures/expected/, written by
// scripts/oracle.ts). A fixture is judged once it is CLAIMED in fixtures/claimed.json.

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONSOLE_STYLED_BASE, partialCuts } from "../scripts/partial-cuts.ts";
import { printToConsole, render, renderStyled, renderThemedText, type StyledDocument } from "../src/index.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const EXPECTED = path.join(FIXTURES, "expected");
const CLAIMED = path.join(FIXTURES, "claimed.json");
const SOURCE_EXT = ".mmd";
const DRAWN_EXT = ".txt";
const WIDTHS = [40, 80];
const THEME = "neon";

const claims = JSON.parse(fs.readFileSync(CLAIMED, "utf8")) as { plain: string[]; themed: string[] };
const claimed = [...claims.plain, ...claims.themed];
const source = (name: string): string => fs.readFileSync(path.join(FIXTURES, `${name}${SOURCE_EXT}`), "utf8");
const take = (name: string, width: number, theme: string | null): string =>
  fs.readFileSync(path.join(EXPECTED, `${name}@${width}${theme === null ? "" : `.${theme}`}${DRAWN_EXT}`), "utf8");
const styledTake = (name: string, useAscii: boolean): string =>
  fs.readFileSync(path.join(EXPECTED, `${name}${useAscii ? ".ascii" : ""}.styled.json`), "utf8").trim();
const partialTake = (name: string): { frames: StyledDocument[]; indices: number[] } =>
  JSON.parse(fs.readFileSync(path.join(EXPECTED, `${name}.partial.json`), "utf8")) as {
    frames: StyledDocument[];
    indices: number[];
  };

describe("what the reference draws", () => {
  it("is frozen on disk for every fixture, or the port has nothing to answer to", () => {
    const sources = fs
      .readdirSync(FIXTURES)
      .filter((file) => file.endsWith(SOURCE_EXT))
      .map((file) => file.slice(0, -SOURCE_EXT.length));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      for (const width of WIDTHS) {
        for (const theme of [null, THEME]) expect(() => take(name, width, theme)).not.toThrow();
      }
      expect(() => styledTake(name, false)).not.toThrow();
      expect(() => styledTake(name, true)).not.toThrow();
      expect(() => partialTake(name)).not.toThrow();
    }
  });

  it("names the version it came from, since a bump invalidates every byte of it", () => {
    expect(fs.readFileSync(path.join(EXPECTED, "reference.txt"), "utf8")).toMatch(/^termaid \d+\.\d+\.\d+/);
  });

  it("only claims fixtures that exist, so a rename cannot quietly shrink the list", () => {
    for (const name of claimed) expect(fs.existsSync(path.join(FIXTURES, `${name}${SOURCE_EXT}`))).toBe(true);
  });
});

const printed = (drawn: string): string => `${drawn}\n`;

describe.each(claims.plain)("%s, the layout drawn by the port", (name) => {
  it.each(WIDTHS)("matches the reference at width %i", (width) => {
    expect(printed(render(source(name), { width }))).toBe(take(name, width, null));
  });

  it("matches render_styled at Console's unicode and ASCII settings", () => {
    const src = source(name);
    expect(JSON.stringify(renderStyled(src, { ...CONSOLE_STYLED_BASE, useAscii: false }))).toBe(styledTake(name, false));
    expect(JSON.stringify(renderStyled(src, { ...CONSOLE_STYLED_BASE, useAscii: true }))).toBe(styledTake(name, true));
  });

  it("matches render_styled with partial=true across every streamed cut", () => {
    const src = source(name);
    const cuts = partialCuts(src);
    const expected = partialTake(name);
    expect(cuts.length).toBe(expected.indices.length);
    const frames = expected.frames.map((f) => JSON.stringify(f));
    for (let i = 0; i < cuts.length; i++) {
      const got = JSON.stringify(renderStyled(cuts[i] as string, { ...CONSOLE_STYLED_BASE, useAscii: false, partial: true }));
      expect(got).toBe(frames[expected.indices[i] as number] as string);
    }
  });
});

describe.each(claims.themed)("%s, the same drawing painted", (name) => {
  it.each(WIDTHS)("matches the reference at width %i, colours included", (width) => {
    expect(printToConsole(renderThemedText(source(name), { width }, THEME))).toBe(take(name, width, THEME));
  });
});
