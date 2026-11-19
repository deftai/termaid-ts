// Shared deterministic partial-source cut generator for Step 4 (`partial: true` parity).
//
// For every fixture, generates the source cut off after each of its lines, and at three points in the middle of a line.

export const CONSOLE_STYLED_BASE = {
  paddingX: 2,
  paddingY: 0,
  gap: 2,
  arrowStyle: "triangle",
} as const;

export function partialCuts(source: string): string[] {
  const cuts: string[] = [];
  const lines = source.split("\n");
  let prefix = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const chars = [...line];
    if (chars.length >= 4) {
      const p1 = Math.max(1, Math.floor(chars.length / 4));
      const p2 = Math.max(p1 + 1, Math.floor(chars.length / 2));
      const p3 = Math.max(p2 + 1, Math.floor((chars.length * 3) / 4));
      for (const p of [p1, p2, p3]) {
        if (p < chars.length) cuts.push(prefix + chars.slice(0, p).join(""));
      }
    } else if (chars.length > 0) {
      cuts.push(prefix + chars.slice(0, 1).join(""));
    }
    prefix += line + (i < lines.length - 1 ? "\n" : "");
    cuts.push(prefix);
  }
  return cuts;
}
