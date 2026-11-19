// The ORACLE: what the reference DRAWS, frozen on disk so the port is judged against bytes and never against a reading
// of the Python source. Run it once per reference version (or with `--missing-only` for newly added fixtures).

import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { partialCuts } from "./partial-cuts.ts";
import { REFERENCE_COMMAND, referenceArgs, referencePythonArgs } from "./reference.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXTURES = path.join(ROOT, "fixtures");
const EXPECTED = path.join(FIXTURES, "expected");
const STYLED_ORACLE_SCRIPT = path.join(ROOT, "scripts", "styled_oracle.py");
const SOURCE_EXT = ".mmd";
const DRAWN_EXT = ".txt";

export const WIDTHS = [40, 80];
const WIDTH_FLAG = "--width";
const THEME_FLAG = "--theme";
const THEME = "neon";
const COLOUR_ENV = { FORCE_COLOR: "1", TERM: "xterm-256color" };
const VERSION_FLAG = "--version";
const STAMP = "reference.txt";
const CONCURRENCY = Math.max(2, os.cpus().length - 2);

export function expectedPath(name: string, width: number, theme: string | null): string {
  return path.join(EXPECTED, `${name}@${width}${theme === null ? "" : `.${theme}`}${DRAWN_EXT}`);
}

export function expectedStyledPath(name: string, useAscii: boolean): string {
  return path.join(EXPECTED, `${name}${useAscii ? ".ascii" : ""}.styled.json`);
}

export function expectedPartialPath(name: string): string {
  return path.join(EXPECTED, `${name}.partial.json`);
}

export function sources(): string[] {
  return fs
    .readdirSync(FIXTURES)
    .filter((file) => file.endsWith(SOURCE_EXT))
    .map((file) => file.slice(0, -SOURCE_EXT.length))
    .sort();
}

export const sourcePath = (name: string): string => path.join(FIXTURES, `${name}${SOURCE_EXT}`);

function childEnv(theme: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = theme === null ? { ...process.env } : { ...process.env, ...COLOUR_ENV };
  delete env["NO_COLOR"];
  return env;
}

function drawn(source: string, width: number, theme: string | null): Promise<string> {
  const args = [WIDTH_FLAG, String(width), ...(theme === null ? [] : [THEME_FLAG, theme])];
  return new Promise((resolve, reject) => {
    const child = execFile(
      REFERENCE_COMMAND,
      referenceArgs(args),
      {
        encoding: "utf8",
        env: childEnv(theme),
        maxBuffer: Number.MAX_SAFE_INTEGER,
      },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`oracle failed (${args.join(" ")}): ${stderr || error.message}`));
          return;
        }
        resolve(stdout);
      }
    );
    child.stdin?.end(source);
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const missingOnly = process.argv.includes("--missing-only");
  fs.mkdirSync(EXPECTED, { recursive: true });
  const tasks: Array<() => Promise<void>> = [];
  const styledBatch: Array<{ name: string; source: string; cuts: string[] }> = [];

  for (const name of sources()) {
    const source = fs.readFileSync(sourcePath(name), "utf8");
    for (const width of WIDTHS) {
      for (const theme of [null, THEME]) {
        const outPath = expectedPath(name, width, theme);
        if (missingOnly && fs.existsSync(outPath)) continue;
        tasks.push(async () => {
          const out = await drawn(source, width, theme);
          fs.writeFileSync(outPath, out);
        });
      }
    }

    const uPath = expectedStyledPath(name, false);
    const aPath = expectedStyledPath(name, true);
    const pPath = expectedPartialPath(name);
    if (!missingOnly || !fs.existsSync(uPath) || !fs.existsSync(aPath) || !fs.existsSync(pPath)) {
      styledBatch.push({ name, source, cuts: partialCuts(source) });
    }
  }

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (next < tasks.length) {
        const idx = next++;
        await (tasks[idx] as () => Promise<void>)();
      }
    })
  );

  let styledWritten = 0;
  if (styledBatch.length > 0) {
    const raw = execFileSync(REFERENCE_COMMAND, referencePythonArgs([STYLED_ORACLE_SCRIPT]), {
      input: JSON.stringify(styledBatch),
      encoding: "utf8",
      maxBuffer: Number.MAX_SAFE_INTEGER,
    });
    const parsed = JSON.parse(raw) as Record<string, { unicode: string; ascii: string; partial: string }>;
    for (const { name } of styledBatch) {
      const item = parsed[name];
      if (item === undefined) throw new Error(`styled_oracle missing output for ${name}`);
      const uPath = expectedStyledPath(name, false);
      const aPath = expectedStyledPath(name, true);
      const pPath = expectedPartialPath(name);
      if (!missingOnly || !fs.existsSync(uPath)) {
        fs.writeFileSync(uPath, item.unicode + "\n");
        styledWritten++;
      }
      if (!missingOnly || !fs.existsSync(aPath)) {
        fs.writeFileSync(aPath, item.ascii + "\n");
        styledWritten++;
      }
      if (!missingOnly || !fs.existsSync(pPath)) {
        fs.writeFileSync(pPath, item.partial + "\n");
        styledWritten++;
      }
    }
  }

  const stamp = execFileSync(REFERENCE_COMMAND, referenceArgs([VERSION_FLAG]), { encoding: "utf8" });
  fs.writeFileSync(path.join(EXPECTED, STAMP), stamp);
  console.log(`oracle: ${tasks.length} CLI takes + ${styledWritten} styled/partial takes from ${stamp.trim()}`);
}
