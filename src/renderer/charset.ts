// Ported from src/termaid/renderer/charset.py.

import { pyRepr } from "../pycompat.ts";

/** Every character a drawing is made of, so the same layout can be drawn in box characters or in plain ASCII. */
export interface CharSet {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;

  roundTopLeft: string;
  roundTopRight: string;
  roundBottomLeft: string;
  roundBottomRight: string;

  arrowRight: string;
  arrowLeft: string;
  arrowDown: string;
  arrowUp: string;

  /** Class-diagram inheritance markers (open triangles). */
  inheritRight: string;
  inheritLeft: string;
  inheritDown: string;
  inheritUp: string;

  /** Class-diagram dependency arrows: the arrowheads, unless those would look like inheritance markers. */
  dependencyRight: string;
  dependencyLeft: string;
  dependencyDown: string;
  dependencyUp: string;

  lineHorizontal: string;
  lineVertical: string;
  lineDottedH: string;
  lineDottedV: string;
  lineThickH: string;
  lineThickV: string;

  cornerTopLeft: string;
  cornerTopRight: string;
  cornerBottomLeft: string;
  cornerBottomRight: string;

  teeRight: string;
  teeLeft: string;
  teeDown: string;
  teeUp: string;

  cross: string;

  diamondTop: string;
  diamondBottom: string;
  diamondLeft: string;
  diamondRight: string;

  /** Front rim of a cylinder's lid, drawn inside its sides. */
  lidLeft: string;
  lidFill: string;
  lidRight: string;

  circleEndpoint: string;
  crossEndpoint: string;

  sgTopLeft: string;
  sgTopRight: string;
  sgBottomLeft: string;
  sgBottomRight: string;
  sgHorizontal: string;
  sgVertical: string;
}

export const UNICODE: CharSet = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  roundTopLeft: "╭",
  roundTopRight: "╮",
  roundBottomLeft: "╰",
  roundBottomRight: "╯",
  arrowRight: "►",
  arrowLeft: "◄",
  arrowDown: "▼",
  arrowUp: "▲",
  inheritRight: "▷",
  inheritLeft: "◁",
  inheritDown: "▽",
  inheritUp: "△",
  dependencyRight: "►",
  dependencyLeft: "◄",
  dependencyDown: "▼",
  dependencyUp: "▲",
  lineHorizontal: "─",
  lineVertical: "│",
  lineDottedH: "┄",
  lineDottedV: "┆",
  lineThickH: "━",
  lineThickV: "┃",
  cornerTopLeft: "┌",
  cornerTopRight: "┐",
  cornerBottomLeft: "└",
  cornerBottomRight: "┘",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
  diamondTop: "◇",
  diamondBottom: "◇",
  diamondLeft: "◇",
  diamondRight: "◇",
  lidLeft: "╰",
  lidFill: "─",
  lidRight: "╯",
  circleEndpoint: "○",
  crossEndpoint: "×",
  sgTopLeft: "┌",
  sgTopRight: "┐",
  sgBottomLeft: "└",
  sgBottomRight: "┘",
  sgHorizontal: "─",
  sgVertical: "│",
};

export const ASCII: CharSet = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  roundTopLeft: "+",
  roundTopRight: "+",
  roundBottomLeft: "+",
  roundBottomRight: "+",
  arrowRight: ">",
  arrowLeft: "<",
  arrowDown: "v",
  arrowUp: "^",
  inheritRight: ">",
  inheritLeft: "<",
  inheritDown: "v",
  inheritUp: "^",
  dependencyRight: ">",
  dependencyLeft: "<",
  dependencyDown: "v",
  dependencyUp: "^",
  lineHorizontal: "-",
  lineVertical: "|",
  lineDottedH: ".",
  lineDottedV: ":",
  lineThickH: "=",
  lineThickV: "H",
  cornerTopLeft: "+",
  cornerTopRight: "+",
  cornerBottomLeft: "+",
  cornerBottomRight: "+",
  teeRight: "+",
  teeLeft: "+",
  teeDown: "+",
  teeUp: "+",
  cross: "+",
  diamondTop: "/",
  diamondBottom: "\\",
  diamondLeft: "/",
  diamondRight: "\\",
  lidLeft: "\\",
  lidFill: "_",
  lidRight: "/",
  circleEndpoint: "o",
  crossEndpoint: "x",
  sgTopLeft: "+",
  sgTopRight: "+",
  sgBottomLeft: "+",
  sgBottomRight: "+",
  sgHorizontal: "-",
  sgVertical: "|",
};

/** Unicode arrowhead styles, for `arrowStyle`. ASCII always uses `> < v ^`. */
export const ARROW_STYLES: Readonly<Record<string, readonly [string, string, string, string]>> = {
  pointer: ["►", "◄", "▼", "▲"],
  triangle: ["▶", "◀", "▼", "▲"],
  outline: ["▷", "◁", "▽", "△"],
};

/** The built-in character set: ASCII, or Unicode box drawing. */
export function defaultCharset(useAscii: boolean): CharSet {
  return useAscii ? ASCII : UNICODE;
}

/**
 * The character set for a render: ASCII, or Unicode with an arrowhead style.
 * Throws an Error when `arrowStyle` is not one of `ARROW_STYLES`.
 */
export function buildCharset(useAscii = false, arrowStyle = "pointer"): CharSet {
  const arrows = ARROW_STYLES[arrowStyle];
  if (arrows === undefined) {
    throw new Error(
      `unknown arrow style ${pyRepr(arrowStyle)}; expected one of ${Object.keys(ARROW_STYLES).join(", ")}`
    );
  }
  if (useAscii || arrowStyle === "pointer") {
    return defaultCharset(useAscii);
  }
  const [right, left, down, up] = arrows;
  const matchesInherit =
    right === UNICODE.inheritRight &&
    left === UNICODE.inheritLeft &&
    down === UNICODE.inheritDown &&
    up === UNICODE.inheritUp;
  const dependency = matchesInherit ? (ARROW_STYLES["triangle"] as readonly [string, string, string, string]) : arrows;
  return {
    ...UNICODE,
    arrowRight: right,
    arrowLeft: left,
    arrowDown: down,
    arrowUp: up,
    dependencyRight: dependency[0],
    dependencyLeft: dependency[1],
    dependencyDown: dependency[2],
    dependencyUp: dependency[3],
  };
}
