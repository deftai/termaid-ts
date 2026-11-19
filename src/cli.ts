// Ported from src/termaid/cli.py.
//
// `--tui` (Textual) and `--claude-hook` (Claude Code MessageDisplay hook) are not ported; both flags are accepted so
// the CLI surface matches the reference and report clearly that they are not part of the TypeScript port.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Diagnostic, type DiagnosticSeverity } from "./diagnostics.ts";
import { jsonToMermaid } from "./ingest.ts";
import {
  ARROW_STYLES,
  parse,
  prepareSource,
  render,
  renderStyled,
  renderThemedText,
  skipDirectives,
  splitMarkdown,
  type Options,
  type StyledDocument,
} from "./index.ts";
import { printToConsole, Text } from "./richcompat.ts";
import { ljust, pyStrip, rstrip } from "./pycompat.ts";
import { displayWidth, maxLineWidth } from "./utils.ts";

const PROGRAM = "termaid";
const NEWLINE = "\n";
const OK = 0;
const FAILED = 1;
const MISUSED = 2;

const FALLBACK_WIDTH = 80;

const THEME_NAMES = [
  "default",
  "terra",
  "neon",
  "mono",
  "amber",
  "phosphor",
  "gruvbox",
  "monokai",
  "dracula",
  "nord",
  "solarized",
] as const;

const ARROW_STYLE_NAMES = ["pointer", "triangle", "outline"] as const;
const FORMAT_NAMES = ["text", "styled-json"] as const;
const DIAGNOSTIC_FORMATS = ["text", "json"] as const;
const JSON_TYPES = ["treemap", "pie", "mindmap", "flowchart", "xychart"] as const;

const DEFAULT_PADDING_X = 4;
const DEFAULT_PADDING_Y = 2;
const DEFAULT_GAP = 4;
const ALL = "all";

interface Args {
  file: string | null;
  ascii: boolean;
  paddingX: number;
  paddingY: number;
  arrowStyle: string;
  gap: number;
  width: number | null;
  strictWidth: boolean;
  maxHeight: number | null;
  sharpEdges: boolean;
  theme: string | null;
  tui: boolean;
  noAutoFit: boolean;
  inlineEdgeLabels: boolean;
  outputFormat: string;
  diagnosticsFormat: string;
  output: string | null;
  showIds: boolean;
  json: string | null;
  markdown: boolean;
  claudeHook: boolean;
  arrowStyles: boolean;
  themes: boolean;
  demo: string | null;
}

const DEFAULTS: Args = {
  file: null,
  ascii: false,
  paddingX: DEFAULT_PADDING_X,
  paddingY: DEFAULT_PADDING_Y,
  arrowStyle: "pointer",
  gap: DEFAULT_GAP,
  width: null,
  strictWidth: false,
  maxHeight: null,
  sharpEdges: false,
  theme: null,
  tui: false,
  noAutoFit: false,
  inlineEdgeLabels: false,
  outputFormat: "text",
  diagnosticsFormat: "text",
  output: null,
  showIds: false,
  json: null,
  markdown: false,
  claudeHook: false,
  arrowStyles: false,
  themes: false,
  demo: null,
};

const HELP = `usage: ${PROGRAM} [-h] [--ascii] [--padding-x PADDING_X] [--padding-y PADDING_Y]
               [--arrow-style {pointer,triangle,outline}] [--gap GAP]
               [--width WIDTH] [--strict-width] [--max-height ROWS]
               [--sharp-edges] [--theme THEME] [--tui] [--no-auto-fit]
               [--inline-edge-labels] [--format {text,styled-json}]
               [--diagnostics-format {text,json}] [-o FILE] [--show-ids]
               [--json TYPE] [--markdown] [--claude-hook] [--arrow-styles]
               [--themes] [--demo [TYPE]] [--version]
               [file]

Render Mermaid diagrams as Unicode art in the terminal

positional arguments:
  file                  Mermaid diagram file (.mmd). Reads from stdin if not provided.

options:
  -h, --help            show this help message and exit
  --ascii               Use ASCII characters instead of Unicode box-drawing
  --padding-x PADDING_X
                        Horizontal padding inside node boxes (default: 4)
  --padding-y PADDING_Y
                        Vertical padding inside node boxes (default: 2)
  --arrow-style {pointer,triangle,outline}
                        Arrowheads: pointer (default, ► ◄ ▼ ▲), triangle (▶ ◀ ▼ ▲) or outline (▷ ◁ ▽ △). See --arrow-styles
  --gap GAP             Space between nodes (default: 4). Use 1 or 2 for compact diagrams.
  --width WIDTH         Max output width. Re-renders with smaller gap/padding, then wraps labels, if exceeded.
  --strict-width        Exit with status 2 instead of a warning when the output is still wider than --width.
  --max-height ROWS     Exit with status 2 when the output has more than ROWS lines.
  --sharp-edges         Use sharp corners on edge turns instead of rounded
  --theme THEME         Color theme.
  --tui                 Launch interactive TUI viewer (not part of the TypeScript port).
  --no-auto-fit         Disable automatic compaction when diagram exceeds terminal width
  --inline-edge-labels  Attach labels directly to their edges
  --format {text,styled-json}
                        Output format. styled-json prints one JSON document of text chunks tagged with style keys.
  --diagnostics-format {text,json}
                        Print errors and warnings on stderr as text or as JSON lines.
  -o FILE, --output FILE
                        Write output to file instead of stdout
  --show-ids            Show node IDs alongside labels (e.g. 'A: Start') for debugging.
  --json TYPE           Read JSON/tabular data from stdin and render as TYPE.
  --markdown            Read a Markdown document and render each \`\`\`mermaid block in place.
  --claude-hook         Run as a Claude Code MessageDisplay hook (not part of the TypeScript port).
  --arrow-styles        List available arrowhead styles and exit.
  --themes              List available color themes and exit.
  --demo [TYPE]         Render sample diagrams. Use 'all' or a type name (flowchart, sequence, etc.).
  --version             show program's version number and exit`;

const out = (line: string): void => {
  process.stdout.write(line + NEWLINE);
};
const err = (line: string): void => {
  process.stderr.write(line + NEWLINE);
};

function version(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.join(here, "..", "package.json"), path.join(here, "..", "..", "package.json")]) {
    try {
      return (JSON.parse(fs.readFileSync(candidate, "utf8")) as { version: string }).version;
    } catch {
      continue;
    }
  }
  return "0.12.0";
}

class UsageError extends Error {}

const asInteger = (flag: string, text: string): number => {
  if (!/^[+-]?\d+$/.test(pyStrip(text))) throw new UsageError(`argument ${flag}: invalid int value: '${text}'`);
  return Number.parseInt(text, 10);
};

const asChoice = (flag: string, text: string, choices: readonly string[]): string => {
  if (!choices.includes(text)) {
    throw new UsageError(
      `argument ${flag}: invalid choice: '${text}' (choose from ${choices.map((c) => `'${c}'`).join(", ")})`
    );
  }
  return text;
};

function preParseDiagnosticsFormat(argv: readonly string[]): string {
  let fmt = "text";
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i] as string;
    if (tok === "--diagnostics-format" && argv[i + 1] !== undefined) {
      fmt = argv[i + 1] as string;
      i += 1;
    } else if (tok.startsWith("--diagnostics-format=")) {
      fmt = tok.slice("--diagnostics-format=".length);
    }
  }
  return fmt;
}

function report(
  diagnosticsFormat: string,
  code: string,
  message: string,
  options: { exitCode?: number; severity?: DiagnosticSeverity; details?: Record<string, string | number> } = {}
): number {
  const diag = new Diagnostic(code, message, options);
  return diag.emit(diagnosticsFormat, err);
}

interface Reader {
  next(flag: string, inline: string | undefined): string;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { ...DEFAULTS };
  let at = 0;
  const reader: Reader = {
    next(flag, inline) {
      if (inline !== undefined) return inline;
      const value = argv[++at];
      if (value === undefined) throw new UsageError(`argument ${flag}: expected one argument`);
      return value;
    },
  };
  const optional = (inline: string | undefined): string | null => {
    if (inline !== undefined) return inline;
    const value = argv[at + 1];
    if (value === undefined || value.startsWith("-")) return null;
    at++;
    return value;
  };

  for (; at < argv.length; at++) {
    const token = argv[at] as string;
    if (!token.startsWith("-") || token === "-") {
      if (args.file !== null) throw new UsageError(`unrecognized arguments: ${token}`);
      args.file = token;
      continue;
    }

    const split = token.indexOf("=");
    const flag = split < 0 ? token : token.slice(0, split);
    const inline = split < 0 ? undefined : token.slice(split + 1);

    switch (flag) {
      case "-h":
      case "--help":
        out(HELP);
        process.exit(OK);
        break;
      case "--version":
        out(`${PROGRAM} ${version()}`);
        process.exit(OK);
        break;
      case "--ascii":
        args.ascii = true;
        break;
      case "--padding-x":
        args.paddingX = asInteger(flag, reader.next(flag, inline));
        break;
      case "--padding-y":
        args.paddingY = asInteger(flag, reader.next(flag, inline));
        break;
      case "--arrow-style":
        args.arrowStyle = asChoice(flag, reader.next(flag, inline), ARROW_STYLE_NAMES);
        break;
      case "--gap":
        args.gap = asInteger(flag, reader.next(flag, inline));
        break;
      case "--width":
        args.width = asInteger(flag, reader.next(flag, inline));
        break;
      case "--strict-width":
        args.strictWidth = true;
        break;
      case "--max-height":
        args.maxHeight = asInteger(flag, reader.next(flag, inline));
        break;
      case "--sharp-edges":
        args.sharpEdges = true;
        break;
      case "--theme":
        args.theme = asChoice(flag, reader.next(flag, inline), THEME_NAMES);
        break;
      case "--tui":
        args.tui = true;
        break;
      case "--no-auto-fit":
        args.noAutoFit = true;
        break;
      case "--inline-edge-labels":
        args.inlineEdgeLabels = true;
        break;
      case "--format":
        args.outputFormat = asChoice(flag, reader.next(flag, inline), FORMAT_NAMES);
        break;
      case "--diagnostics-format":
        args.diagnosticsFormat = asChoice(flag, reader.next(flag, inline), DIAGNOSTIC_FORMATS);
        break;
      case "-o":
      case "--output":
        args.output = reader.next(flag, inline);
        break;
      case "--show-ids":
        args.showIds = true;
        break;
      case "--json":
        args.json = asChoice(flag, reader.next(flag, inline), JSON_TYPES);
        break;
      case "--markdown":
        args.markdown = true;
        break;
      case "--claude-hook":
        args.claudeHook = true;
        break;
      case "--arrow-styles":
        args.arrowStyles = true;
        break;
      case "--themes":
        args.themes = true;
        break;
      case "--demo":
        args.demo = optional(inline) ?? ALL;
        break;
      default:
        throw new UsageError(`unrecognized arguments: ${token}`);
    }
  }

  return args;
}

type RenderResult = string | Text | StyledDocument;

function plainOf(result: RenderResult): string {
  if (typeof result === "string") return result;
  if (result instanceof Text) return result.plain;
  return result.lines.map((line) => line.map((chunk) => chunk.text).join("")).join(NEWLINE);
}

function terminalWidth(): number {
  const declared = process.env["COLUMNS"];
  if (declared !== undefined && /^\d+$/.test(declared)) return Number.parseInt(declared, 10);
  return process.stdout.columns ?? FALLBACK_WIDTH;
}

function consoleWidth(): number {
  const declared = process.env["COLUMNS"];
  if (declared !== undefined && /^\d+$/.test(declared)) return Number.parseInt(declared, 10);
  for (const stream of [process.stdin, process.stdout, process.stderr] as const) {
    const columns = (stream as { columns?: number }).columns;
    if (columns !== undefined && columns > 0) return columns;
  }
  return FALLBACK_WIDTH;
}

function targetWidth(args: Args): number | undefined {
  if (args.width !== null) return args.width;
  if (args.noAutoFit || process.stdout.isTTY !== true) return undefined;
  return terminalWidth();
}

function readSource(args: Args): string | null {
  if (args.file !== null) {
    try {
      return fs.readFileSync(args.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        report(args.diagnosticsFormat, "input_missing", `File not found: ${args.file}`, {
          details: { path: args.file },
        });
      } else {
        report(args.diagnosticsFormat, "input_missing", `Error reading file: ${(e as Error).message}`, {
          details: { path: args.file },
        });
      }
      return null;
    }
  }
  if (process.stdin.isTTY !== true) return fs.readFileSync(0, "utf8");
  report(
    args.diagnosticsFormat,
    "input_missing",
    `No input provided. Pass a file or pipe input.\nUsage: ${PROGRAM} diagram.mmd\n       echo 'graph LR; A-->B' | ${PROGRAM}`
  );
  return null;
}

const DUMB_TERMS: ReadonlySet<string> = new Set(["dumb", "unknown"]);
const NO_COLOR_VAR = "NO_COLOR";
const FORCE_COLOR_VAR = "FORCE_COLOR";
const TERM_VAR = "TERM";

function consoleShowsColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[NO_COLOR_VAR] !== undefined) return false;
  if (DUMB_TERMS.has(env[TERM_VAR] ?? "")) return false;
  const forced = env[FORCE_COLOR_VAR];
  if (forced !== undefined && forced !== "") return true;
  return process.stdout.isTTY === true;
}

const useColor = (args: Args): boolean => args.theme !== null && consoleShowsColor();

const QUOTE = '"';
const SAFE_QUOTE = "'";

function applyShowIds(source: string): string {
  let graph;
  try {
    graph = parse(source);
  } catch {
    return source;
  }

  const extra: string[] = [];
  for (const [id, node] of graph.nodes) {
    if (node.label !== id) extra.push(`  ${id}["${`${id}: ${node.label}`.replaceAll(QUOTE, SAFE_QUOTE)}"]`);
  }
  if (extra.length === 0) return source;

  const lines = skipDirectives(prepareSource(source)).split(NEWLINE);
  return [lines[0] as string, ...extra, ...lines.slice(1)].join(NEWLINE);
}

const THEME_NAME_WIDTH = 12;
const THEME_KIND_WIDTH = 8;

const THEME_LIST: ReadonlyArray<readonly [string, string, string]> = [
  ["default", "text", "Cyan nodes, yellow arrows, white labels"],
  ["terra", "text", "Warm earth tones (browns, oranges)"],
  ["neon", "text", "Magenta nodes, green arrows, cyan edges"],
  ["mono", "text", "White/gray monochrome"],
  ["amber", "text", "Amber/gold CRT-style"],
  ["phosphor", "text", "Green phosphor terminal"],
  ["gruvbox", "solid", "Gruvbox dark palette"],
  ["monokai", "solid", "Monokai dark with pink/green accents"],
  ["dracula", "solid", "Dracula purple/pink/green palette"],
  ["nord", "solid", "Nord muted blue/cyan arctic palette"],
  ["solarized", "solid", "Solarized dark blue/yellow/cyan"],
];

function listThemes(): number {
  for (const [name, kind, description] of THEME_LIST) {
    out(`  ${ljust(name, THEME_NAME_WIDTH)} ${ljust(`[${kind}]`, THEME_KIND_WIDTH)} ${description}`);
  }
  return OK;
}

function listArrowStyles(): number {
  const descriptions: Readonly<Record<string, string>> = {
    pointer: "Pointers (default)",
    triangle: "Solid triangles, matching the up and down arrows",
    outline: "Open triangles",
  };
  for (const [name, [right, left, down, up]] of Object.entries(ARROW_STYLES)) {
    out(`  ${ljust(name, 10)} ${right} ${left} ${down} ${up}   ${descriptions[name] ?? ""}`);
  }
  return OK;
}

const DEMO_SOURCES: ReadonlyMap<string, readonly [string, string]> = new Map([
  [
    "flowchart",
    ["Flowchart", "graph TD\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Process]\n  B -->|No| D[End]\n  C --> D"],
  ],
  [
    "sequence",
    [
      "Sequence diagram",
      "sequenceDiagram\n  Client->>Server: GET /api\n  Server->>DB: SELECT\n  DB-->>Server: rows\n  Server-->>Client: 200 JSON",
    ],
  ],
  [
    "class",
    [
      "Class diagram",
      "classDiagram\n  class Animal {\n    +String name\n    +makeSound()\n  }\n  class Dog {\n    +fetch()\n  }\n  Animal <|-- Dog",
    ],
  ],
  ["er", ["ER diagram", "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains"]],
  [
    "state",
    ["State diagram", "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Running : start\n  Running --> Done : complete\n  Done --> [*]"],
  ],
  ["block", ["Block diagram", "block-beta\n  columns 3\n  Frontend API Database"]],
  [
    "git",
    ["Git graph", "gitGraph\n  commit\n  branch develop\n  commit\n  commit\n  checkout main\n  merge develop\n  commit"],
  ],
  ["pie", ["Pie chart", 'pie title Languages\n  "Python" : 45\n  "Go" : 30\n  "Rust" : 25']],
  [
    "treemap",
    ["Treemap", 'treemap-beta\n  "Backend"\n    "API": 35\n    "Auth": 15\n  "Frontend"\n    "React": 30\n    "CSS": 10'],
  ],
  [
    "mindmap",
    [
      "Mindmap",
      "mindmap\n  Project\n    Design\n      Wireframes\n      Mockups\n    Development\n      Frontend\n      Backend\n    Testing",
    ],
  ],
  [
    "timeline",
    [
      "Timeline",
      "timeline\n    title Roadmap\n    section Q1\n        Research : Analysis\n        Design : Wireframes\n    section Q2\n        Build : Frontend, Backend\n        Launch : Beta",
    ],
  ],
  [
    "kanban",
    [
      "Kanban",
      "kanban\n    Todo\n        Design homepage\n        Fix login bug\n    In Progress\n        API integration\n    Done\n        Project setup",
    ],
  ],
  [
    "journey",
    [
      "User journey",
      "journey\n    title My working day\n    section Go to work\n        Make tea: 5: Me\n        Go upstairs: 3: Me\n        Do work: 1: Me, Cat\n    section Go home\n        Go downstairs: 5: Me\n        Sit down: 5: Me",
    ],
  ],
  [
    "xychart",
    [
      "XY chart",
      'xychart-beta\n    title "Monthly Revenue"\n    x-axis [Jan, Feb, Mar, Apr, May, Jun]\n    y-axis "Revenue (k)"\n    bar [12, 18, 25, 20, 30, 35]',
    ],
  ],
  [
    "quadrant",
    [
      "Quadrant chart",
      "quadrantChart\n    title Priority Matrix\n    x-axis Low Effort --> High Effort\n    y-axis Low Impact --> High Impact\n    quadrant-1 Do First\n    quadrant-2 Schedule\n    quadrant-3 Delegate\n    quadrant-4 Eliminate\n    Task A: [0.3, 0.8]\n    Task B: [0.8, 0.9]\n    Task C: [0.2, 0.2]",
    ],
  ],
]);

function runDemo(args: Args): number {
  const demoType = (args.demo as string).toLowerCase();
  let keys: string[];
  if (demoType === ALL) keys = [...DEMO_SOURCES.keys()];
  else if (DEMO_SOURCES.has(demoType)) keys = [demoType];
  else {
    return report(
      args.diagnosticsFormat,
      "invalid_arguments",
      `Unknown demo type: ${demoType}\nAvailable: all, ${[...DEMO_SOURCES.keys()].join(", ")}`
    );
  }

  const color = useColor(args);
  for (const key of keys) {
    const [title, source] = DEMO_SOURCES.get(key) as readonly [string, string];
    out(`=== ${title} ===`);
    if (color) process.stdout.write(printToConsole(renderThemedText(source, {}, args.theme as string), consoleWidth()));
    else out(render(source));
    out("");
  }

  return OK;
}

const renderOptions = (args: Args): Options => ({
  useAscii: args.ascii,
  paddingX: args.paddingX,
  paddingY: args.paddingY,
  roundedEdges: !args.sharpEdges,
  gap: args.gap,
  inlineEdgeLabels: args.inlineEdgeLabels,
  arrowStyle: args.arrowStyle,
});

function checkOutput(text: string, args: Args): number | null {
  const width = maxLineWidth(text);
  const height = text.split(NEWLINE).length;
  if (args.strictWidth && args.width !== null && width > args.width) {
    return report(
      args.diagnosticsFormat,
      "width_exceeded",
      `diagram is ${width} cols wide but target is ${args.width}.`,
      { exitCode: MISUSED, details: { actual_width: width, max_width: args.width } }
    );
  }
  if (args.maxHeight !== null && height > args.maxHeight) {
    return report(
      args.diagnosticsFormat,
      "height_exceeded",
      `diagram exceeds ${args.maxHeight} output rows.`,
      { exitCode: MISUSED, details: { actual_height: height, max_height: args.maxHeight } }
    );
  }
  return null;
}

function renderOne(
  source: string,
  args: Args,
  styled: boolean,
  color: boolean,
  target: number | undefined
): RenderResult {
  const prepared = args.showIds ? applyShowIds(source) : source;
  const options: Options = { ...renderOptions(args), ...(target === undefined ? {} : { width: target }) };
  let result: RenderResult;
  if (styled) {
    result = renderStyled(prepared, options);
  } else if (color) {
    result = renderThemedText(prepared, options, args.theme ?? "default");
  } else {
    result = render(prepared, options);
  }

  const actualWidth = maxLineWidth(plainOf(result));
  if (target !== undefined && actualWidth > target && !args.strictWidth) {
    report(
      args.diagnosticsFormat,
      "width_exceeded",
      `diagram is ${actualWidth} cols wide but target is ${target}. Try: less -S, or use 'graph TD' for vertical layout.`,
      { exitCode: OK, severity: "warning", details: { actual_width: actualWidth, max_width: target } }
    );
  }
  return result;
}

function indentResult(result: string | Text, indent: string): string | Text {
  if (indent === "") return result;
  if (typeof result === "string") {
    return result
      .split(NEWLINE)
      .map((line) => indent + line)
      .join(NEWLINE);
  }
  return result.withPrefix(indent);
}

function renderMarkdownDoc(text: string, args: Args, color: boolean): string | Text {
  const width = targetWidth(args);
  const pieces: Array<string | Text> = [];

  for (const seg of splitMarkdown(text)) {
    if (!seg.isMermaid) {
      pieces.push(seg.text);
      continue;
    }
    const target = width === undefined ? undefined : Math.max(width - displayWidth(seg.indent), 1);
    let drawn: RenderResult | null = null;
    let failure: [string, string] | null = null;
    try {
      drawn = renderOne(seg.text, args, false, color, target);
    } catch (e) {
      failure = ["render_failed", (e as Error).message];
    }
    if (failure === null && drawn !== null) {
      if (pyStrip(plainOf(drawn)) === "") {
        failure = ["render_empty", "nothing to draw"];
      } else {
        pieces.push(indentResult(drawn as string | Text, seg.indent));
        continue;
      }
    }
    const [code, reason] = failure as [string, string];
    report(args.diagnosticsFormat, code, `could not render the diagram at line ${seg.line}: ${reason}`, {
      exitCode: OK,
      severity: "warning",
      details: { line: seg.line },
    });
    pieces.push(seg.raw);
  }

  if (!color) {
    return pieces.map((p) => (typeof p === "string" ? p : p.plain)).join(NEWLINE);
  }
  return Text.joinLines(pieces.map((p) => (p instanceof Text ? p : new Text(p))));
}

export function main(argv: readonly string[]): number {
  const initialDiagFormat = preParseDiagnosticsFormat(argv);
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (initialDiagFormat === "json") {
      return report("json", "invalid_arguments", e.message, { exitCode: MISUSED });
    }
    err(`usage: ${PROGRAM} [-h] ... [file]`);
    err(`${PROGRAM}: error: ${e.message}`);
    return MISUSED;
  }

  const styled = args.outputFormat === "styled-json";
  if (styled && (args.claudeHook || args.tui || args.markdown)) {
    return report(
      args.diagnosticsFormat,
      "invalid_arguments",
      "--format styled-json cannot be combined with --claude-hook, --tui or --markdown.",
      { exitCode: MISUSED }
    );
  }

  if (args.claudeHook) {
    return report(args.diagnosticsFormat, "not_ported", "--claude-hook is not part of the TypeScript port.");
  }

  if (args.themes) return listThemes();
  if (args.arrowStyles) return listArrowStyles();
  if (args.demo !== null) return runDemo(args);

  if (args.width !== null && args.width < 1) {
    return report(args.diagnosticsFormat, "invalid_arguments", "--width must be positive.", { exitCode: MISUSED });
  }

  let source = readSource(args);
  if (source === null) return FAILED;

  source = args.markdown ? rstrip(source) : pyStrip(source);
  if (pyStrip(source) === "") {
    return report(args.diagnosticsFormat, "input_empty", "Empty input.");
  }

  if (args.markdown && (args.json !== null || args.tui)) {
    return report(args.diagnosticsFormat, "invalid_arguments", "--markdown cannot be combined with --json or --tui.");
  }

  if (args.strictWidth && args.width === null) {
    return report(args.diagnosticsFormat, "invalid_arguments", "--strict-width requires --width.", {
      exitCode: MISUSED,
    });
  }
  if (args.maxHeight !== null && args.maxHeight < 1) {
    return report(args.diagnosticsFormat, "invalid_arguments", "--max-height must be positive.", {
      exitCode: MISUSED,
    });
  }

  if (args.json !== null) {
    try {
      source = jsonToMermaid(source, args.json);
    } catch (e) {
      return report(
        args.diagnosticsFormat,
        "input_conversion_failed",
        `Error converting JSON to ${args.json}: ${(e as Error).message}`
      );
    }
  }

  if (args.tui) {
    return report(args.diagnosticsFormat, "not_ported", "--tui is not part of the TypeScript port.");
  }

  const color = !styled && useColor(args);

  try {
    let result: RenderResult;
    if (args.markdown) {
      result = renderMarkdownDoc(source, args, color);
    } else {
      result = renderOne(source, args, styled, color, targetWidth(args));
      if (pyStrip(plainOf(result)) === "") {
        return report(args.diagnosticsFormat, "render_empty", "Input produced no renderable diagram.");
      }
    }

    const failed = checkOutput(plainOf(result), args);
    if (failed !== null) return failed;

    if (color && result instanceof Text) {
      const actual = maxLineWidth(result.plain);
      if (args.output !== null) {
        try {
          fs.writeFileSync(args.output, printToConsole(result, Math.max(actual, FALLBACK_WIDTH)), "utf8");
        } catch (e) {
          return report(args.diagnosticsFormat, "output_write_failed", `Error writing to ${args.output}: ${(e as Error).message}`, {
            details: { path: args.output },
          });
        }
      } else {
        process.stdout.write(printToConsole(result, consoleWidth()));
      }
    } else {
      const textOut = styled ? JSON.stringify(result) : (result as string);
      if (args.output !== null) {
        try {
          fs.writeFileSync(args.output, textOut + NEWLINE, "utf8");
        } catch (e) {
          return report(args.diagnosticsFormat, "output_write_failed", `Error writing to ${args.output}: ${(e as Error).message}`, {
            details: { path: args.output },
          });
        }
      } else {
        out(textOut);
      }
    }
  } catch (e) {
    return report(args.diagnosticsFormat, "render_failed", `Error rendering diagram: ${(e as Error).message}`);
  }

  return OK;
}
