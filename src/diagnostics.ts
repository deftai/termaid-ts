// Ported from src/termaid/diagnostics.py.
//
// CLI diagnostics, formatted as text for people or as JSON lines for tools. Kept pure (no `process.stderr` dependency)
// so `src/` outside `cli.ts` remains runtime-agnostic.

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticDict {
  version: 1;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  details: Record<string, string | number>;
  exit_code: number;
}

export class Diagnostic {
  public readonly code: string;
  public readonly message: string;
  public readonly exitCode: number;
  public readonly severity: DiagnosticSeverity;
  public readonly details: Readonly<Record<string, string | number>>;

  constructor(
    code: string,
    message: string,
    options: {
      exitCode?: number;
      severity?: DiagnosticSeverity;
      details?: Readonly<Record<string, string | number>>;
    } = {}
  ) {
    this.code = code;
    this.message = message;
    this.exitCode = options.exitCode ?? 1;
    this.severity = options.severity ?? "error";
    this.details = { ...(options.details ?? {}) };
  }

  toDict(): DiagnosticDict {
    return {
      version: 1,
      severity: this.severity,
      code: this.code,
      message: this.message,
      details: { ...this.details },
      exit_code: this.exitCode,
    };
  }

  format(outputFormat = "text"): string {
    if (outputFormat === "json") {
      // Python's `json.dumps(..., ensure_ascii=False)` uses `", "` and `": "` separators by default.
      return pythonJsonDumps(this.toDict());
    }
    const prefix = this.severity.slice(0, 1).toUpperCase() + this.severity.slice(1);
    return this.message.startsWith(prefix) ? this.message : `${prefix}: ${this.message}`;
  }

  emit(outputFormat = "text", writeLine?: (line: string) => void): number {
    const line = this.format(outputFormat);
    writeLine?.(line);
    return this.exitCode;
  }
}

/** Match Python's default `json.dumps(obj, ensure_ascii=False)` spacing (`": "` and `", "`). */
function pythonJsonDumps(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pythonJsonDumps).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${JSON.stringify(k)}: ${pythonJsonDumps(v)}`
  );
  return `{${entries.join(", ")}}`;
}
