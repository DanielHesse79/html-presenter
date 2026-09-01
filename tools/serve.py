"""Serve a deck over http:// so the presenter window can talk to it.

    python tools/serve.py                 # serve the current folder
    python tools/serve.py my-deck.html    # ...and open this deck
    python tools/serve.py --port 9000 --no-open

Why this exists: browsers give every file:// URL its own opaque origin, so
two windows opened from the same file cannot share a BroadcastChannel. Over
http://localhost they share one origin and the presenter view syncs.

Only localhost is bound, so nothing is exposed to the network.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

DEFAULT_PORT = 8765


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    """Same as the default handler, minus a log line per asset."""

    def log_message(self, fmt, *args):  # noqa: A003
        if not self.path.endswith((".png", ".jpg", ".jpeg", ".webp", ".svg",
                                   ".mp3", ".woff", ".woff2", ".ico")):
            super().log_message(fmt, *args)

    def end_headers(self):
        # Decks get edited and reloaded constantly during rehearsal.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def pick_deck(root: Path) -> Path | None:
    """Guess the deck when the user did not name one."""
    candidates = [
        p for p in sorted(root.glob("*.html"))
        if p.name not in {"presenter.html"} and not p.name.startswith(".")
    ]
    if len(candidates) == 1:
        return candidates[0]
    for p in candidates:
        if p.stem.lower() in {"index", "deck", "slides"}:
            return p
    return None


def resolve_deck(root: Path, deck: Path | None) -> tuple[Path, Path | None]:
    """Return (root_to_serve, deck_path_relative_to_root).

    A deck inside the served folder keeps that folder as the root, so shared
    assets one level up — presenter.html, deck-stage.js — stay reachable.
    Only a deck outside the tree moves the root to its own folder.
    """
    if deck is None:
        guess = pick_deck(root)
        return root, (guess.relative_to(root) if guess else None)

    resolved = deck.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(deck)
    try:
        return root, resolved.relative_to(root)
    except ValueError:
        return resolved.parent, Path(resolved.name)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("deck", nargs="?", type=Path, help="deck .html to open")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--root", type=Path, default=Path.cwd(), help="folder to serve")
    ap.add_argument("--no-open", action="store_true", help="do not launch a browser")
    args = ap.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 1

    try:
        root, deck = resolve_deck(root, args.deck)
    except FileNotFoundError as e:
        print(f"error: {e} not found", file=sys.stderr)
        return 1

    url = f"http://localhost:{args.port}/"
    if deck is not None:
        url += urllib.parse.quote(deck.as_posix())

    handler = lambda *a, **kw: QuietHandler(*a, directory=str(root), **kw)  # noqa: E731

    socketserver.TCPServer.allow_reuse_address = True
    try:
        server = socketserver.TCPServer(("127.0.0.1", args.port), handler)
    except OSError as e:
        print(f"error: cannot bind port {args.port} — {e}\n"
              f"Another server may already be running; try --port {args.port + 1}.",
              file=sys.stderr)
        return 1

    print()
    print("  deck-stage — local presenter server")
    print("  " + "-" * 44)
    print(f"  serving : {root}")
    print(f"  open    : {url}")
    if deck is None:
        print("  (no deck named and none guessed — pick one from the listing)")
    print()
    print("  Press P in the deck to open presenter notes,")
    print("  then drag that window to your second screen.")
    print()
    print("  Ctrl+C to stop.")
    print()

    if not args.no_open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()
    server.server_close()
    print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
