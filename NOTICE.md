# Origin

This package is a TypeScript port of [termaid](https://github.com/fasouto/termaid) by Fabio Souto, MIT licensed,
originally ported to TypeScript (`termaid-ts` 0.8.3) by Pierre Moati, MIT licensed.

Deft updated this fork to reproduce [deftai/termaid](https://github.com/deftai/termaid) at commit
`0f2fb37f5cb65a75a778b298480d2fc2b306f634` (`0.12.0`, branch `console-pin`).

The port keeps the original module tree file for file, so an upstream change names its own place here. Behaviour is
judged against the reference binary itself: `fixtures/expected/` holds what `deftai/termaid` `0f2fb37f` (`0.12.0`) draws,
and a fixture is claimed only once the port renders the same bytes.

The fixtures named `gallery-*` are the diagram sources of the upstream gallery at
[termaid.com](https://termaid.com/examples.html), written by the same author and under the same licence. Their SOURCES
alone are kept: what any of them is expected to draw is written here by the oracle, from the reference itself, never
copied from the gallery.
