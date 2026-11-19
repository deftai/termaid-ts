// Ported from src/termaid/renderer/relation_tracks.py.
//
// Track assignment for relationship lines that jog sideways between layers.

/**
 * Colour column intervals so overlapping ones get different tracks.
 *
 * `intervals` maps a key to the inclusive `[left, right]` columns of a run.
 * Returns `Map<key, trackIndex>`; tracks are numbered from 0 and runs on the
 * same track are at least one blank column apart so their corners do not touch.
 */
export function assignTracks(intervals: ReadonlyMap<number, readonly [number, number]>): Map<number, number> {
  const tracks: number[] = [];
  const result = new Map<number, number>();
  const sorted = [...intervals.entries()].sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[0] - b[0]);

  for (const [key, [left, right]] of sorted) {
    let placed = false;
    for (let index = 0; index < tracks.length; index++) {
      const lastRight = tracks[index] as number;
      if (lastRight + 2 <= left) {
        tracks[index] = right;
        result.set(key, index);
        placed = true;
        break;
      }
    }
    if (!placed) {
      tracks.push(right);
      result.set(key, tracks.length - 1);
    }
  }
  return result;
}
