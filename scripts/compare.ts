// Every fixture drawn by the port and held against the take the reference left on disk, byte for byte:
// plain (@40, @80), neon (@40, @80), styled-JSON at Console's settings (unicode & ascii), and every partial cut.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { printToConsole, render, renderStyled, renderThemedText, type StyledDocument } from "../src/index.ts";
import { CONSOLE_STYLED_BASE, partialCuts } from "./partial-cuts.ts";

const F = fileURLToPath(new URL("../fixtures", import.meta.url));
const THEME = "neon";
const WIDTHS = [40, 80];

const names = fs
  .readdirSync(F)
  .filter((f) => f.endsWith(".mmd"))
  .map((f) => f.slice(0, -4))
  .sort();

const thrown = (e: unknown): string => `THROWN: ${(e as Error).message}`;

let anyFailed = false;

for (const [label, suffix, draw] of [
  ["plain", "", (src: string, width: number) => render(src, { width }) + "\n"],
  ["neon ", `.${THEME}`, (src: string, width: number) => printToConsole(renderThemedText(src, { width }, THEME))],
] as const) {
  let ok = 0;
  let total = 0;
  const fails: string[] = [];
  for (const name of names) {
    const src = fs.readFileSync(path.join(F, `${name}.mmd`), "utf8");
    for (const width of WIDTHS) {
      total++;
      const expected = fs.readFileSync(path.join(F, "expected", `${name}@${width}${suffix}.txt`), "utf8");
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

for (const [label, useAscii, ext] of [
  ["styled-unicode", false, ".styled.json"],
  ["styled-ascii  ", true, ".ascii.styled.json"],
] as const) {
  let ok = 0;
  let total = 0;
  const fails: string[] = [];
  for (const name of names) {
    total++;
    const src = fs.readFileSync(path.join(F, `${name}.mmd`), "utf8");
    const expected = fs.readFileSync(path.join(F, "expected", `${name}${ext}`), "utf8").trim();
    let got = "";
    try {
      got = JSON.stringify(renderStyled(src, { ...CONSOLE_STYLED_BASE, useAscii }));
    } catch (e) {
      got = thrown(e);
    }
    if (got === expected) ok++;
    else fails.push(name);
  }
  if (fails.length > 0) anyFailed = true;
  console.log(`${label} : ${ok}/${total}${fails.length > 0 ? `\n  echecs : ${fails.join(" ")}` : ""}`);
}

let partialOk = 0;
let partialTotal = 0;
const partialFails: string[] = [];
for (const name of names) {
  const src = fs.readFileSync(path.join(F, `${name}.mmd`), "utf8");
  const expectedBundle = JSON.parse(
    fs.readFileSync(path.join(F, "expected", `${name}.partial.json`), "utf8")
  ) as { frames: StyledDocument[]; indices: number[] };
  const expectedFrames = expectedBundle.frames.map((frame) => JSON.stringify(frame));
  const cuts = partialCuts(src);
  let fixtureOk = cuts.length === expectedBundle.indices.length;
  for (let i = 0; i < cuts.length; i++) {
    partialTotal++;
    const expectedJson = expectedFrames[expectedBundle.indices[i] as number] ?? "";
    let got = "";
    try {
      got = JSON.stringify(renderStyled(cuts[i] as string, { ...CONSOLE_STYLED_BASE, useAscii: false, partial: true }));
    } catch (e) {
      got = thrown(e);
    }
    if (got === expectedJson) partialOk++;
    else fixtureOk = false;
  }
  if (!fixtureOk) partialFails.push(name);
}
if (partialFails.length > 0) anyFailed = true;
console.log(
  `partial        : ${partialOk}/${partialTotal}${partialFails.length > 0 ? `\n  echecs : ${partialFails.join(" ")}` : ""}`
);

if (anyFailed) {
  process.exitCode = 1;
}
