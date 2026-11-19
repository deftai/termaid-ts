// Ported from src/termaid/output/styled.py.
//
// Theme-independent styled output for editors and other non-terminal clients.

import { pyStrip } from "../pycompat.ts";
import type { Canvas } from "../renderer/canvas.ts";

export interface StyledChunk {
  text: string;
  style: string;
}

export interface StyledDocument {
  version: number;
  lines: StyledChunk[][];
}

/** Group a canvas into styled chunks, trimmed the way `Canvas.toString` trims. */
export function serializeCanvas(canvas: Canvas | null): StyledDocument {
  const lines: StyledChunk[][] = [];
  const rows = canvas !== null ? canvas.toStyledPairs() : [];
  for (const row of rows) {
    let end = row.length;
    while (end > 0 && pyStrip((row[end - 1] as readonly [string, string])[0]) === "") {
      end -= 1;
    }
    const chunks: StyledChunk[] = [];
    for (let i = 0; i < end; i++) {
      const [ch, rawStyle] = row[i] as readonly [string, string];
      if (ch === "") continue;
      const style = rawStyle || "default";
      const last = chunks[chunks.length - 1];
      if (last !== undefined && last.style === style) {
        last.text += ch;
      } else {
        chunks.push({ text: ch, style });
      }
    }
    lines.push(chunks);
  }
  while (lines.length > 0 && (lines[lines.length - 1] as StyledChunk[]).length === 0) {
    lines.pop();
  }
  return { version: 1, lines };
}
