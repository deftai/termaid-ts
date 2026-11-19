// Node type-stripping parity check: imports src/index.ts directly under Node (no Bun APIs, no build step),
// renders every claimed fixture at every width and theme the corpus has, and compares byte for byte with
// fixtures/expected/ just as scripts/compare.ts does.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printToConsole, render, renderThemedText } from "../src/index.ts";

const F = fileURLToPath(new URL("../fixtures", import.meta.url));
const CLAIMED = path.join(F, "claimed.json");
const THEME = "neon";
const WIDTHS = [40, 80];

const claims = JSON.parse(fs.readFileSync(CLAIMED, "utf8")) as {
  plain: string[];
  themed: string[];
};

const thrown = (e: unknown): string => `THROWN: ${(e as Error).message}`;

let anyFailed = false;

for (const [label, names, suffix, draw] of [
  ["plain", claims.plain, "", (src: string, width: number) => render(src, { width }) + "\n"],
  [
    "neon ",
    claims.themed,
    `.${THEME}`,
    (src: string, width: number) => printToConsole(renderThemedText(src, { width }, THEME)),
  ],
] as const) {
  let ok = 0;
  let total = 0;
  const fails: string[] = [];
  for (const name of names) {
    const src = fs.readFileSync(path.join(F, `${name}.mmd`), "utf8");
    for (const width of WIDTHS) {
      total++;
      const expected = fs.readFileSync(
        path.join(F, "expected", `${name}@${width}${suffix}.txt`),
        "utf8"
      );
      let got = "";
      try {
        got = draw(src, width);
      } catch (e) {
        got = thrown(e);
      }
      if (got === expected) ok++;
      else fails.push(`${name}@${width}`);
    }
  }
  if (fails.length > 0) anyFailed = true;
  console.log(`${label} : ${ok}/${total}${fails.length > 0 ? `\n  echecs : ${fails.join(" ")}` : ""}`);
}

if (anyFailed) {
  process.exitCode = 1;
}
