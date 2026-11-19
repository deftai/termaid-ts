"""Batch oracle for termaid.render_styled() at Console's settings, including partial=True."""
from __future__ import annotations

import json
import sys
import termaid

ARROW_STYLE = "triangle"
PADDING_X = 2
PADDING_Y = 0
GAP = 2


def dump_compact(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    payload = json.loads(sys.stdin.read())
    output: dict[str, dict[str, object]] = {}
    for item in payload:
        name = item["name"]
        source = item["source"]
        cuts = item["cuts"]

        unicode_doc = termaid.render_styled(
            source,
            use_ascii=False,
            padding_x=PADDING_X,
            padding_y=PADDING_Y,
            gap=GAP,
            arrow_style=ARROW_STYLE,
        )
        ascii_doc = termaid.render_styled(
            source,
            use_ascii=True,
            padding_x=PADDING_X,
            padding_y=PADDING_Y,
            gap=GAP,
            arrow_style=ARROW_STYLE,
        )

        frames: list[object] = []
        seen: dict[str, int] = {}
        indices: list[int] = []
        for cut in cuts:
            doc = termaid.render_styled(
                cut,
                use_ascii=False,
                padding_x=PADDING_X,
                padding_y=PADDING_Y,
                gap=GAP,
                arrow_style=ARROW_STYLE,
                partial=True,
            )
            serialized = dump_compact(doc)
            idx = seen.get(serialized)
            if idx is None:
                idx = len(frames)
                seen[serialized] = idx
                frames.append(doc)
            indices.append(idx)

        output[name] = {
            "unicode": dump_compact(unicode_doc),
            "ascii": dump_compact(ascii_doc),
            "partial": dump_compact({"frames": frames, "indices": indices}),
        }

    sys.stdout.write(dump_compact(output))


if __name__ == "__main__":
    main()
