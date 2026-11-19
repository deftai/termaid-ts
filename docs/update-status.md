# Update Status: `termaid-ts` → `deftai/termaid` `0f2fb37f` (`0.12.0`)

Reference commit: `0f2fb37f5cb65a75a778b298480d2fc2b306f634` (`https://github.com/deftai/termaid`, branch `console-pin`).
Node runtime checked: `v25.2.1` (Bun `1.3.4`).

## Step 1 Baseline (`bun run compare`)

424 total takes (106 fixtures × 2 widths `[40, 80]` × 2 modes `[plain, neon]`):
- **Plain**: `155/212` matching, `57` differing
- **Neon**: `145/212` matching, `67` differing
- **Overall**: `300/424` matching, `124` differing

### Baseline by Diagram Type

| Diagram Type | Plain Match | Plain Differ | Neon Match | Neon Differ | Total Match | Total Differ |
|---|---:|---:|---:|---:|---:|---:|
| `architecture` | 7 | 3 | 5 | 5 | 12 | 8 |
| `block` | 8 | 2 | 8 | 2 | 16 | 4 |
| `classDiagram` | 7 | 7 | 7 | 7 | 14 | 14 |
| `erDiagram` | 7 | 7 | 7 | 7 | 14 | 14 |
| `flowchart` | 41 | 13 | 41 | 13 | 82 | 26 |
| `gantt` | 10 | 0 | 10 | 0 | 20 | 0 |
| `gitGraph` | 6 | 4 | 6 | 4 | 12 | 8 |
| `journey` | 8 | 0 | 0 | 8 | 8 | 8 |
| `kanban` | 6 | 0 | 6 | 0 | 12 | 0 |
| `mindmap` | 6 | 0 | 6 | 0 | 12 | 0 |
| `packet` | 6 | 0 | 6 | 0 | 12 | 0 |
| `pie` | 0 | 6 | 0 | 6 | 0 | 12 |
| `quadrantChart` | 4 | 0 | 4 | 0 | 8 | 0 |
| `sequenceDiagram` | 9 | 9 | 9 | 9 | 18 | 18 |
| `stateDiagram` | 12 | 2 | 12 | 2 | 24 | 4 |
| `timeline` | 6 | 0 | 6 | 0 | 12 | 0 |
| `treemap` | 2 | 4 | 2 | 4 | 4 | 8 |
| `xychart` | 10 | 0 | 10 | 0 | 20 | 0 |
| **Total** | **155** | **57** | **145** | **67** | **300** | **124** |

## Step 2: Divergences (`divergences?: boolean`, default `false`)

All 21 `.mmd` sources previously isolated under `fixtures/divergences/` joined `fixtures/` (508 total takes = 127 fixtures × 2 widths × 2 modes).

- **Fixed upstream (divergence deleted)**:
  1. Leading UTF-8 BOM (`__init__.py`: `source.lstrip("\ufeff")`) — `bom-*` now match by default.
  2. Inline `pie` header title (`parser/piechart.py`) — `pie-title-inline`, `gallery-pie-*` parsed by default.
  3. `xychart-beta` `y-axis` label (`renderer/xychart.py`) — `xychart-y-axis*`, `gallery-xychart-*` now match reference by default.
- **Remaining behind `divergences: true` (9 fixtures kept in `fixtures/divergences/`)**:
  1. `quadrantChart` `y-axis` label (`renderer/quadrant.ts`) — upstream still omits `diagram.y_label`.
  2. `mindmap` id + shape unwrapping (`parser/mindmap.ts`) — upstream still keeps `id((shape))` / `!bang!` verbatim.
  3. Flowchart/state edge-label collision & arrowhead protection (`renderer/draw.ts`) — upstream last-resort fallback still writes labels into protected interior spaces of adjacent node boxes.
- **After Step 2 `compare` (127 fixtures, 508 takes)**: `plain 182/254`, `neon 172/254` (`354/508` matching).

## 46-File Python Diff Checklist (`v0.8.0..0f2fb37f`)

- [x] `src/termaid/utils.py` → `src/utils.ts`
- [x] `src/termaid/graph/model.py` → `src/graph/model.ts`
- [x] `src/termaid/model/gantt.py` → `src/model/gantt.ts` + `src/pydate.ts`
- [x] `src/termaid/model/gitgraph.py` → `src/model/gitgraph.ts`
- [x] `src/termaid/renderer/charset.py` → `src/renderer/charset.ts`
- [x] `src/termaid/renderer/canvas.py` → `src/renderer/canvas.ts`
- [x] `src/termaid/renderer/shapes/__init__.py` → `src/renderer/shapes.ts`
- [x] `src/termaid/diagnostics.py` (new) → `src/diagnostics.ts`
- [x] `src/termaid/output/__init__.py` → `src/index.ts`
- [x] `src/termaid/output/styled.py` (new) → `src/output/styled.ts`
- [x] `src/termaid/output/text.py` (deleted) → deleted `src/output/text.ts`
- [x] `src/termaid/output/rich.py` → `src/output/rich.ts`
- [x] `src/termaid/output/widget.py` (not ported: Textual TUI widget)
- [x] `src/termaid/parser/flowchart.py` → `src/parser/flowchart.ts` + `src/data/htmlentities.ts`
- [x] `src/termaid/parser/gantt.py` → `src/parser/gantt.ts`
- [x] `src/termaid/parser/statediagram.py` → `src/parser/statediagram.ts`
- [x] `src/termaid/parser/gitgraph.py` → `src/parser/gitgraph.ts`
- [x] `src/termaid/parser/blockdiagram.py` → `src/parser/blockdiagram.ts`
- [x] `src/termaid/parser/piechart.py` → `src/parser/piechart.ts`
- [x] `src/termaid/parser/erdiagram.py` → `src/parser/erdiagram.ts`
- [x] `src/termaid/parser/sequence.py` → `src/parser/sequence.ts`
- [x] `src/termaid/layout/layers.py` → `src/layout/layers.ts`
- [x] `src/termaid/layout/grid.py` → `src/layout/grid.ts`
- [x] `src/termaid/layout/subgraphs.py` → `src/layout/subgraphs.ts`
- [x] `src/termaid/layout/placement.py` → `src/layout/placement.ts`
- [x] `src/termaid/routing/pathfinder.py` → `src/routing/pathfinder.ts`
- [x] `src/termaid/routing/router.py` → `src/routing/router.ts`
- [x] `src/termaid/renderer/draw.py` → `src/renderer/draw.ts`
- [x] `src/termaid/renderer/relation_tracks.py` (new) → `src/renderer/relation_tracks.ts`
- [x] `src/termaid/renderer/sequence.py` → `src/renderer/sequence.ts`
- [x] `src/termaid/renderer/classdiagram.py` → `src/renderer/classdiagram.ts`
- [x] `src/termaid/renderer/erdiagram.py` → `src/renderer/erdiagram.ts`
- [x] `src/termaid/renderer/gantt.py` → `src/renderer/gantt.ts`
- [x] `src/termaid/renderer/xychart.py` → `src/renderer/xychart.ts`
- [x] `src/termaid/renderer/piechart.py` → `src/renderer/piechart.ts`
- [x] `src/termaid/renderer/gitgraph.py` → `src/renderer/gitgraph.ts`
- [x] `src/termaid/renderer/blockdiagram.py` → `src/renderer/blockdiagram.ts`
- [x] `src/termaid/renderer/journey.py` → `src/renderer/journey.ts`
- [x] `src/termaid/renderer/kanban.py` → `src/renderer/kanban.ts`
- [x] `src/termaid/renderer/timeline.py` → `src/renderer/timeline.ts`
- [x] `src/termaid/renderer/treemap.py` → `src/renderer/treemap.ts`
- [x] `src/termaid/partial.py` (new) → `src/partial.ts`
- [x] `src/termaid/__init__.py` → `src/index.ts`
- [x] `src/termaid/markdown.py` (new) → `src/markdown.ts`
- [x] `src/termaid/cli.py` → `src/cli.ts`
- [x] `src/termaid/claude_hook.py` (new — unported, CLI reports `--claude-hook` not ported and exits)

## Final Verification Results (Steps 4 & 5)

- **Fixtures corpus**: `412` `.mmd` sources (`127` prior + `276` upstream `tests/fixtures/` additions + `9` Deft feature fixtures). All `412` claimed in `fixtures/claimed.json`; **0 unclaimed**.
- **`bun run compare` & `node scripts/node-parity.ts` (`verify:node`)**:
  - `plain          : 824/824`
  - `neon           : 824/824`
  - `styled-unicode : 412/412`
  - `styled-ascii   : 412/412`
  - `partial        : 10434/10434`
- **`bun run verify`**: `2,582` tests pass, `0` fail (`17,636` `expect()` calls); `ourtakes.ts --check` clean; `verify:node` passes under Node `v25.2.1`.
- **`bun run differential`**: `9,296/9,296` identical (`9,264` live renders + `33` CLI cases; `1` CPython hash-seed nondeterministic case `architecture-junction [ascii@80]`; `4` malformed sources refused on both sides; `0` allowance entries; `0` divergences).
