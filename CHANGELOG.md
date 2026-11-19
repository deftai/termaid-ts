# Changelog

This file records what THIS package changes, release by release. The upstream
[termaid](https://github.com/fasouto/termaid) keeps its own history: the version's major.minor names the termaid
release the port reproduces, and the patch counts this package's own additions on top of it. An entry marked ◉ is this
package's own: an addition with no counterpart in termaid, or a deliberate divergence from it; every other entry ports
something the upstream did.

## Unreleased

- ◉ Four inputs that made the renderer loop forever or run out of memory now return. The pinned reference does the same
  on all four, so none has a reference drawing and none is in the parity corpus (`tests/hangs.test.ts` covers them):
  an unmatched `*` in a markdown flowchart label is kept as literal text (as termaid 0.13.0 does); an edge whose
  last-resort route would be a diagonal that cannot be walked throws "no axis-aligned path was found"; an `xychart-beta`
  value far off the chart is clipped to the chart before any loop, and a value that is not finite throws; a `packet-beta`
  field reaching past 5000 strips (160,000 bits) throws before anything is allocated

## 0.12.0 (2026-11-18, deftai/termaid 0f2fb37f / 0.12.0)

- Ported all upstream and Deft changes through `deftai/termaid` commit `0f2fb37f5cb65a75a778b298480d2fc2b306f634` (`0.12.0`)
- Added `renderStyled(source, options)` and `renderStyledParameters()` for theme-independent styled-chunk rendering
- Added `partial: true` streaming completion (`completePartial`), `arrowStyle` (`pointer`, `triangle`, `outline`),
  `inlineEdgeLabels`, `maxLabelWidth` wrapping, `splitMarkdown`, and structured `Diagnostic` output (`--format styled-json`,
  `--diagnostics-format json`, `--markdown`, `--strict-width`, `--max-height`)
- Ported bus-trunk edge routing, iterative crowded-gap expansion (`layoutAndRoute`), multi-line `<br>` labels,
  `classDef color:` text colouring, class/ER relationship gap tracks, sequence frame sizing & wrapping, sub-day/millisecond
  `gantt` scales, HTML entity decoding, and leading directive skipping
- ◉ Added `divergences?: boolean` (default `false`) so default rendering matches the Python reference byte for byte;
  retired the BOM, inline `pie` header title, and `xychart-beta` y-axis divergences now fixed upstream
- Made the TypeScript source loadable directly under Node type stripping (`.ts` import specifiers, `erasableSyntaxOnly`,
  `verbatimModuleSyntax`, `verify:node`) with zero runtime APIs in library modules

## 0.8.3 (2026-08-18)

- ◉ A `pie` title written on the header line is read, where the reference drops it and leaves the chart untitled
- ◉ The y-axis label is drawn, in `xychart-beta` and `quadrantChart`, both parsing it into the model and neither
  renderer ever reading it back
- ◉ An edge label never lands on a node or on an arrowhead, and is never cut without a mark: it takes a clear row
  instead, crossing a plain rule where it must, since a stroke of a border reads again and a swallowed arrowhead
  deletes an edge from the drawing
- ◉ A mindmap id is read as the handle it is and the shape behind it unwrapped, where the reference draws both as text,
  its four patterns anchoring at the start of a line and two of mermaid's six shapes having no pattern at all
- The parity corpus takes the 41 sources of the upstream gallery, 30 of them judged against the reference like any
  other fixture and 11 held apart as divergences, their drawings written by the oracle and never copied
- `fixtures/divergences/` freezes what this port draws alone, kept out of the parity corpus and its mutants
- `str.strip()` spelled out rather than approximated by `trim()`, which disagrees with it on six code points
- Rich's `strip_control_codes` and `expand_tabs` ported, the two steps a painted text takes and a plain one does not
- A layering key holds its endpoints instead of joining them, so an id carrying the separator no longer flattens the graph
- `scripts/probe.ts`, `scripts/probe-controls.ts` and `scripts/audit.ts` keep the probes that found the porting bugs and
  the audit that holds all 18 types against silent information loss, each naming the divergences it assumes
- Test discovery is pinned to `tests/`, so a checkout read on the side under `tmp/` no longer answers for this suite

## 0.8.2 (2026-08-15)

- ◉ `background: "light"` paints a drawing for a light terminal, every colour mirrored about its luminance, hue kept
- ◉ The mirror sits at the ONE seam a colour crosses, so a theme's palette, a chart's sections and a node's own `fill` all turn together
- ◉ Asking for `dark`, or asking for nothing, moves not a byte: the parity the bench measures is the default path

## 0.8.1 (2026-08-13)

- ◉ `declaredType(source)` answers the type a source declares, `null` where the fallback would draw boxes of its syntax

## 0.8.0 (2026-08-13, termaid 0.8.0)

- Initial release: the termaid 0.8.0 renderer ported to TypeScript, held to byte parity with the reference
- ◉ A leading BOM is taken off before the header is read, where the reference keeps it and loses the diagram
