// Ported from src/termaid/utils.py.
//
// Display-width measurement, text wrapping, width fitting, and shared directive/line-break helpers.

import { isFullwidthOrWide } from "./data/eastasianwidth.ts";
import {
  PY_SPACE_CHARS,
  isPyAlpha,
  isPyDigit,
  isPyLower,
  isPySpace,
  isPyUpper,
  lstrip,
  pySplit,
  pyStrip,
  rstrip,
} from "./pycompat.ts";

/**
 * A `%%{...}%%` directive, which may span lines. It ends at the next `%%{`, so an unclosed one is not rescanned to
 * the end of the source from every later `%%{`.
 */
export const DIRECTIVE = "%%\\{(?:(?!%%\\{)[\\s\\S])*?\\}%%";

const BR_RE = new RegExp(`[${PY_SPACE_CHARS}]*<br[${PY_SPACE_CHARS}]*\\/?>[${PY_SPACE_CHARS}]*`, "giu");

/**
 * Replace Mermaid's `<br>`, `<br/>` and `<br />` (and surrounding whitespace) with `sep`.
 * Pass `" "` where a label has a single row.
 */
export function lineBreaks(text: string, sep = "\n"): string {
  return text.replace(BR_RE, () => sep);
}

/** What the reference widens on top of East Asian Width: symbols, dingbats, emoji, variation selectors. */
const SYMBOL_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x2600, 0x27bf],
  [0x1f300, 0x1faff],
  [0xfe00, 0xfe0f],
];

const WIDE_COLUMNS = 2;
const NARROW_COLUMNS = 1;

function inAny(cp: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  return ranges.some(([low, high]) => cp >= low && cp <= high);
}

/** East Asian Width alone, which is what the CANVAS advances a column by: a dingbat is narrow there. */
export function isWideEastAsian(ch: string): boolean {
  return isFullwidthOrWide(ch.codePointAt(0) ?? 0);
}

/** Whether a character occupies two terminal columns, an emoji counted wide the way the reference counts it. */
export function isWide(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return isFullwidthOrWide(cp) || inAny(cp, SYMBOL_RANGES);
}

/** The terminal display width of `text`, counted the way the reference counts it. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += isWide(ch) ? WIDE_COLUMNS : NARROW_COLUMNS;
  return width;
}

/** Return the display width of the widest line in `text`. */
export function maxLineWidth(text: string): number {
  const lines = text.split("\n");
  let hasWide = false;
  const seen = new Set<string>();
  for (const ch of text) {
    if (seen.has(ch)) continue;
    seen.add(ch);
    if (isWide(ch)) {
      hasWide = true;
      break;
    }
  }
  if (!hasWide) {
    let best = 0;
    for (const line of lines) best = Math.max(best, [...line].length);
    return best;
  }
  let best = 0;
  for (const line of lines) best = Math.max(best, displayWidth(line));
  return best;
}

export interface FitOverrides {
  gap?: number;
  paddingX?: number;
  maxLabelWidth?: number;
}

/**
 * Fit a drawing to `targetWidth` columns, or get as close as it can.
 * Spacing shrinks one step at a time; if that is not enough, labels wrap at word boundaries at the widest label width
 * that fits.
 */
export function fitToWidth<T>(
  renderFn: (overrides: FitOverrides) => T,
  initial: T,
  targetWidth: number,
  options: { gap?: number; paddingX?: number; plain?: (value: T) => string } = {}
): T {
  const gap = options.gap ?? 4;
  const paddingX = options.paddingX ?? 4;
  const plain = options.plain ?? ((v: T) => String(v));
  const widthOf = (candidate: T): number => maxLineWidth(plain(candidate));

  let result = initial;
  if (widthOf(result) <= targetWidth) return result;

  const steps: ReadonlyArray<readonly [number, number]> = [
    [Math.min(gap, 2), paddingX],
    [1, paddingX],
    [1, 2],
    [1, 0],
  ];
  for (const [stepGap, stepPadding] of steps) {
    if (stepGap >= gap && stepPadding >= paddingX) continue;
    const candidate = renderFn({ gap: stepGap, paddingX: stepPadding });
    if (widthOf(candidate) <= targetWidth) return candidate;
    result = candidate;
  }

  const narrowest = renderFn({ gap: 1, paddingX: 0, maxLabelWidth: 1 });
  if (plain(narrowest) !== plain(result)) {
    result = narrowest;
    if (widthOf(narrowest) <= targetWidth) {
      let low = 2;
      let high = Math.min(targetWidth, 64);
      while (low <= high) {
        const labelWidth = Math.floor((low + high) / 2);
        const candidate = renderFn({ gap: 1, paddingX: 0, maxLabelWidth: labelWidth });
        if (widthOf(candidate) <= targetWidth) {
          result = candidate;
          low = labelWidth + 1;
        } else {
          high = labelWidth - 1;
        }
      }
    }
  }
  return result;
}

const SEPARATOR_CHARS = new Set([..."_-/,;!?，；！？"]);
const PHRASE_CHARS = new Set([...",;，；!?！？"]);

function textBreak(chars: readonly string[], cellLimitEnd: number): number {
  let preferredEnd = 0;
  const stop = Math.min(cellLimitEnd + 1, chars.length);
  for (let index = 1; index < stop; index++) {
    const previous = chars[index - 1] as string;
    const current = chars[index] as string;
    const following = chars[index + 1] ?? "";
    const memberAccess =
      (current === "." && !isPyDigit(previous)) ||
      (current === ":" && following === ":" && previous !== ":");
    const separator = SEPARATOR_CHARS.has(previous) && !SEPARATOR_CHARS.has(current);
    const scriptBoundary =
      isPyAlpha(previous) && isPyAlpha(current) && isWide(previous) !== isWide(current);
    const camelCase =
      isPyUpper(current) &&
      (isPyLower(previous) ||
        isPyDigit(previous) ||
        (isPyUpper(previous) && following !== "" && isPyLower(following)));
    if (memberAccess || separator || camelCase || scriptBoundary) {
      preferredEnd = index;
    }
  }
  return preferredEnd;
}

/**
 * Wrap text to terminal display cells, hard-breaking long tokens when `hardBreak` is true (default).
 */
export function wrapDisplayText(
  text: string,
  maxWidth: number,
  options: { hardBreak?: boolean } = {}
): string[] {
  const hardBreak = options.hardBreak ?? true;
  if (maxWidth < 1) throw new Error("max_width must be positive");

  const wrapped: string[] = [];
  for (const logicalLine of text.split("\n")) {
    if (!hardBreak) {
      const words = pySplit(logicalLine);
      if (words.length === 0) {
        wrapped.push(logicalLine);
        continue;
      }
      let current = words[0] as string;
      for (const word of words.slice(1)) {
        if (displayWidth(current) + 1 + displayWidth(word) <= maxWidth) {
          current += " " + word;
        } else {
          wrapped.push(current);
          current = word;
        }
      }
      wrapped.push(current);
      continue;
    }

    let remaining = logicalLine;
    if (remaining === "") {
      wrapped.push("");
      continue;
    }

    while (displayWidth(remaining) > maxWidth) {
      const chars = [...remaining];
      let used = 0;
      let end = 0;
      let lastSpace = -1;
      for (let index = 0; index < chars.length; index++) {
        const ch = chars[index] as string;
        const charWidth = isWide(ch) ? WIDE_COLUMNS : NARROW_COLUMNS;
        if (used + charWidth > maxWidth) break;
        used += charWidth;
        end = index + 1;
        if (isPySpace(ch)) lastSpace = end;
      }

      if (end === 0) end = 1;

      const nextChar = chars[end] ?? "";
      const wordEnd = isPySpace(nextChar) ? end : lastSpace;
      let phraseEnd = 0;
      for (let index = 0; index < end; index++) {
        if (PHRASE_CHARS.has(chars[index] as string)) phraseEnd = index + 1;
      }
      const proseEnd = Math.max(wordEnd, phraseEnd);
      const boundaryEnd = proseEnd <= 0 ? textBreak(chars, end) : 0;
      let splitAt = proseEnd > 0 ? proseEnd : boundaryEnd || end;

      if (
        phraseEnd > 0 &&
        phraseEnd < splitAt &&
        displayWidth(pyStrip(chars.slice(splitAt).join(""))) <= Math.floor(maxWidth / 3) &&
        displayWidth(pyStrip(chars.slice(phraseEnd).join(""))) <= maxWidth
      ) {
        splitAt = phraseEnd;
      }

      let line = rstrip(chars.slice(0, splitAt).join(""));
      if (line === "") {
        line = chars.slice(0, end).join("");
        splitAt = end;
      }
      wrapped.push(line);
      remaining = lstrip(chars.slice(splitAt).join(""));
    }

    wrapped.push(rstrip(remaining));
  }

  return wrapped;
}

const ELLIPSIS = ".";

/** `text` clipped to `cols` columns, never splitting a wide character in half. */
function clip(text: string, cols: number): string {
  const out: string[] = [];
  let width = 0;
  for (const ch of text) {
    const chWidth = isWide(ch) ? WIDE_COLUMNS : NARROW_COLUMNS;
    if (width + chWidth > cols) break;
    out.push(ch);
    width += chWidth;
  }
  return out.join("");
}

/** `text` cut to fit `width` columns, the ellipsis appended only where something was actually cut. */
export function truncateToWidth(text: string, width: number, ellipsis: string = ELLIPSIS): string {
  if (displayWidth(text) <= width) return text;
  const ellipsisWidth = displayWidth(ellipsis);
  if (width <= ellipsisWidth) return clip(ellipsis, width);
  return clip(text, width - ellipsisWidth) + ellipsis;
}
