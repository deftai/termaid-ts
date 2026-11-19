// The drawings this port answers for ALONE when `divergences: true`, frozen under `fixtures/divergences/` by
// `scripts/ourtakes.ts`. Every source here is ALSO in `fixtures/` where parity holds it to the reference with
// `divergences: false` (the default).

import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIVERGENCES, THEME, WIDTHS, drawn, sourcePath, sources, takePath } from "../scripts/ourtakes.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const SOURCE_EXT = ".mmd";

const names = sources();
const source = (name: string): string => fs.readFileSync(sourcePath(name), "utf8");

describe("what this port draws when divergences: true", () => {
  it("has a source to answer for, or the directory says nothing", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("is frozen on disk at every width and theme", () => {
    for (const name of names) {
      for (const width of WIDTHS) {
        for (const theme of [null, THEME]) expect(fs.existsSync(takePath(name, width, theme))).toBe(true);
      }
    }
  });

  it("is also present in the parity corpus for default (divergences: false) verification", () => {
    const flat = fs.readdirSync(FIXTURES).filter((file) => file.endsWith(SOURCE_EXT));
    for (const name of names) expect(flat).toContain(`${name}${SOURCE_EXT}`);
    expect(path.dirname(sourcePath(names[0] as string))).toBe(DIVERGENCES);
  });
});

describe.each(names)("%s, the drawing this port stands behind with divergences: true", (name) => {
  it.each(WIDTHS)("has not moved at width %i", (width) => {
    expect(drawn(source(name), width, null)).toBe(fs.readFileSync(takePath(name, width, null), "utf8"));
  });

  it.each(WIDTHS)("has not moved at width %i, colours included", (width) => {
    expect(drawn(source(name), width, THEME)).toBe(fs.readFileSync(takePath(name, width, THEME), "utf8"));
  });
});
