"""Export a <deck-stage> deck to PDF, one slide per page.

    python tools/export_pdf.py my-deck.html
    python tools/export_pdf.py my-deck.html -o handout.pdf --size 1280x720

Speaker notes are never rendered — they live in a <script type="application/json">
block that the browser does not paint.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _chrome import ChromeNotFound, print_to_pdf  # noqa: E402


def parse_size(value: str) -> tuple[int, int]:
    try:
        w, h = value.lower().split("x")
        return int(w), int(h)
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"--size expects WIDTHxHEIGHT, e.g. 1920x1080 (got {value!r})"
        )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("deck", type=Path, help="path to the deck .html")
    ap.add_argument("-o", "--out", type=Path, help="output .pdf (default: alongside the deck)")
    ap.add_argument("--size", type=parse_size, default=(1920, 1080),
                    help="slide size in px (default: 1920x1080)")
    ap.add_argument("--chrome", help="path to a Chrome/Chromium/Edge binary")
    args = ap.parse_args()

    if not args.deck.is_file():
        print(f"error: {args.deck} not found", file=sys.stderr)
        return 1

    out = args.out or args.deck.with_suffix(".pdf")
    width, height = args.size

    print(f"Rendering {args.deck.name} at {width}x{height}...")
    try:
        print_to_pdf(args.deck, out, width=width, height=height, chrome=args.chrome)
    except ChromeNotFound as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    print(f"Wrote {out}  ({out.stat().st_size / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
