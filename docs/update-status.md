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

### Raw Baseline `compare` Output

```
plain : 155/212
  echecs : architecture-basic@40 block-shapes@40 block-shapes@80 class-basic@40 class-basic@80 crossing@40 crossing@80 emoji@40 er-attributes@40 fan@40 fan@80 gallery-architecture-nested-groups@40 gallery-architecture-service-group@40 gallery-class-basic-class@40 gallery-class-basic-class@80 gallery-class-mvc-pattern@40 gallery-class-mvc-pattern@80 gallery-class-relationship-types@40 gallery-er-all-cardinality-types@40 gallery-er-all-cardinality-types@80 gallery-er-basic-relationships@40 gallery-er-basic-relationships@80 gallery-er-e-commerce-schema@40 gallery-er-e-commerce-schema@80 gallery-flowchart-system-architecture@40 gallery-flowchart-system-architecture@80 gallery-git-basic@40 gallery-git-basic@80 gallery-git-feature-branches@40 gallery-git-feature-branches@80 gallery-sequence-basic-messages@40 gallery-sequence-notes@40 gallery-sequence-oauth-2-0-flow@40 gallery-treemap-basic@40 gallery-treemap-basic@80 long-labels@40 pie-basic@40 pie-basic@80 pie-showdata@40 pie-showdata@80 pie-untitled@40 pie-untitled@80 seq-basic@40 seq-basic@80 seq-blocks@40 seq-blocks@80 seq-kinds@40 seq-kinds@80 shapes@40 shapes@80 state-composite@40 state-composite@80 subgraph-lr@40 subgraph-overlap@40 subgraph-overlap@80 treemap-basic@40 treemap-basic@80
neon  : 145/212
  echecs : architecture-basic@40 architecture-flat@40 architecture-junction@40 block-shapes@40 block-shapes@80 class-basic@40 class-basic@80 crossing@40 crossing@80 emoji@40 er-attributes@40 fan@40 fan@80 gallery-architecture-nested-groups@40 gallery-architecture-service-group@40 gallery-class-basic-class@40 gallery-class-basic-class@80 gallery-class-mvc-pattern@40 gallery-class-mvc-pattern@80 gallery-class-relationship-types@40 gallery-er-all-cardinality-types@40 gallery-er-all-cardinality-types@80 gallery-er-basic-relationships@40 gallery-er-basic-relationships@80 gallery-er-e-commerce-schema@40 gallery-er-e-commerce-schema@80 gallery-flowchart-system-architecture@40 gallery-flowchart-system-architecture@80 gallery-git-basic@40 gallery-git-basic@80 gallery-git-feature-branches@40 gallery-git-feature-branches@80 gallery-journey-basic@40 gallery-journey-basic@80 gallery-journey-onboarding-flow@40 gallery-journey-onboarding-flow@80 gallery-sequence-basic-messages@40 gallery-sequence-notes@40 gallery-sequence-oauth-2-0-flow@40 gallery-treemap-basic@40 gallery-treemap-basic@80 journey-bare@40 journey-bare@80 journey-basic@40 journey-basic@80 long-labels@40 pie-basic@40 pie-basic@80 pie-showdata@40 pie-showdata@80 pie-untitled@40 pie-untitled@80 seq-basic@40 seq-basic@80 seq-blocks@40 seq-blocks@80 seq-kinds@40 seq-kinds@80 shapes@40 shapes@80 state-composite@40 state-composite@80 subgraph-lr@40 subgraph-overlap@40 subgraph-overlap@80 treemap-basic@40 treemap-basic@80
```

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

- [ ] `src/termaid/utils.py`
- [ ] `src/termaid/graph/model.py`
- [ ] `src/termaid/model/gantt.py`
- [ ] `src/termaid/model/gitgraph.py`
- [ ] `src/termaid/renderer/charset.py`
- [ ] `src/termaid/renderer/canvas.py`
- [ ] `src/termaid/renderer/shapes/__init__.py`
- [ ] `src/termaid/diagnostics.py` (new)
- [ ] `src/termaid/output/__init__.py`
- [ ] `src/termaid/output/styled.py` (new)
- [ ] `src/termaid/output/text.py` (deleted)
- [ ] `src/termaid/output/rich.py`
- [ ] `src/termaid/output/widget.py` (not ported: Textual TUI widget)
- [ ] `src/termaid/parser/flowchart.py`
- [ ] `src/termaid/parser/gantt.py`
- [ ] `src/termaid/parser/statediagram.py`
- [ ] `src/termaid/parser/gitgraph.py`
- [ ] `src/termaid/parser/blockdiagram.py`
- [x] `src/termaid/parser/piechart.py`
- [ ] `src/termaid/parser/erdiagram.py`
- [ ] `src/termaid/parser/sequence.py`
- [ ] `src/termaid/layout/layers.py`
- [ ] `src/termaid/layout/grid.py`
- [ ] `src/termaid/layout/subgraphs.py`
- [ ] `src/termaid/layout/placement.py`
- [ ] `src/termaid/routing/pathfinder.py`
- [ ] `src/termaid/routing/router.py`
- [ ] `src/termaid/renderer/draw.py`
- [ ] `src/termaid/renderer/relation_tracks.py` (new)
- [ ] `src/termaid/renderer/sequence.py`
- [ ] `src/termaid/renderer/classdiagram.py`
- [ ] `src/termaid/renderer/erdiagram.py`
- [ ] `src/termaid/renderer/gantt.py`
- [x] `src/termaid/renderer/xychart.py`
- [ ] `src/termaid/renderer/piechart.py`
- [ ] `src/termaid/renderer/gitgraph.py`
- [ ] `src/termaid/renderer/blockdiagram.py`
- [ ] `src/termaid/renderer/journey.py`
- [ ] `src/termaid/renderer/kanban.py`
- [ ] `src/termaid/renderer/timeline.py`
- [ ] `src/termaid/renderer/treemap.py`
- [ ] `src/termaid/partial.py` (new)
- [ ] `src/termaid/__init__.py`
- [ ] `src/termaid/markdown.py` (new)
- [ ] `src/termaid/cli.py`
- [ ] `src/termaid/claude_hook.py` (new — unported, CLI reports not ported and exits)
