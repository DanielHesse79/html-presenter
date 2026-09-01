"""Serve a deck over http:// so the presenter window can talk to it.

    python tools/serve.py my-deck.html      # serve its folder, open it
    python tools/serve.py                   # serve the current folder
    python tools/serve.py deck.html --port 9000 --no-open

Point it at *any* deck, anywhere on disk. The framework files are mounted at
/__deck/ and injected into decks that do not already load them, so a deck
Claude just wrote for you gets a presenter view without being edited.

Why a server at all: browsers give every file:// URL its own opaque origin, so
two windows opened from the same file cannot share a BroadcastChannel. Over
http://localhost they share one origin and the presenter view syncs.

Only localhost is bound, so nothing is exposed to the network.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import re
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

DEFAULT_PORT = 8765

# Repository root — deck-stage.js and friends live here.
FRAMEWORK_DIR = Path(__file__).resolve().parent.parent
MOUNT = "/__deck/"
FRAMEWORK_FILES = {
    "deck-stage.js", "presenter.js", "presenter.html", "deck-audio.js",
}

QUIET_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif",
                  ".mp3", ".mp4", ".woff", ".woff2", ".ico")


def _loads_script(html: str, name: str) -> bool:
    """True if the document actually has a <script src=...name...> tag.

    A plain substring test is not enough: a deck may well *mention* these
    filenames in a comment or in visible prose, and the starter template does
    exactly that. Comments are stripped first so a commented-out tag does not
    count either.
    """
    pattern = r"""<script[^>]+src=["'][^"']*""" + re.escape(name)
    return re.search(pattern, html, re.I) is not None


def inject_framework(html: str) -> str:
    """Add the framework tags to a deck that does not already load them.

    Only touches documents that actually contain a <deck-stage> element, and
    skips any script the author already wired up themselves.
    """
    if "<deck-stage" not in html:
        return html

    # Check against a comment-free copy; insert into the original.
    probe = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    if _loads_script(probe, MOUNT + "presenter.js"):
        return html

    tags = []
    if not _loads_script(probe, "deck-stage.js"):
        tags.append(f'<script src="{MOUNT}deck-stage.js"></script>')
    if not _loads_script(probe, "presenter.js"):
        tags.append(
            f'<script src="{MOUNT}presenter.js" '
            f'data-presenter="{MOUNT}presenter.html"></script>'
        )
    if not _loads_script(probe, "deck-audio.js"):
        tags.append(f'<script src="{MOUNT}deck-audio.js"></script>')
    if not tags:
        return html

    block = "\n" + "\n".join(tags) + "\n"
    lowered = html.lower()
    for close in ("</body>", "</html>"):
        at = lowered.rfind(close)
        if at != -1:
            return html[:at] + block + html[at:]
    return html + block


def make_handler(root: Path, inject: bool):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(root), **kw)

        def log_message(self, fmt, *args):  # noqa: A003
            if not self.path.endswith(QUIET_SUFFIXES):
                super().log_message(fmt, *args)

        def end_headers(self):
            # Decks get edited and reloaded constantly during rehearsal.
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def _send_bytes(self, body: bytes, content_type: str) -> None:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            path = urllib.parse.urlparse(self.path).path

            # Framework files, wherever the deck itself lives.
            if path.startswith(MOUNT):
                name = path[len(MOUNT):]
                if name not in FRAMEWORK_FILES:
                    self.send_error(404, "Not a framework file")
                    return
                target = FRAMEWORK_DIR / name
                if not target.is_file():
                    self.send_error(404, f"{name} missing from {FRAMEWORK_DIR}")
                    return
                ctype = "text/html" if name.endswith(".html") else "text/javascript"
                self._send_bytes(target.read_bytes(), f"{ctype}; charset=utf-8")
                return

            # Decks: inject the framework unless the author wired it up.
            if inject and path.endswith((".html", ".htm")):
                local = self.translate_path(self.path)
                candidate = Path(local)
                if candidate.is_file():
                    try:
                        source = candidate.read_text(encoding="utf-8")
                    except UnicodeDecodeError:
                        return super().do_GET()
                    body = inject_framework(source).encode("utf-8")
                    self._send_bytes(body, "text/html; charset=utf-8")
                    return

            return super().do_GET()

    return Handler


def pick_deck(root: Path) -> Path | None:
    """Guess the deck when the user did not name one."""
    candidates = [
        p for p in sorted(root.glob("*.html"))
        if p.name not in FRAMEWORK_FILES and not p.name.startswith(".")
    ]
    if len(candidates) == 1:
        return candidates[0]
    for p in candidates:
        if p.stem.lower() in {"index", "deck", "slides"}:
            return p
    return None


def resolve_deck(root: Path | None, deck: Path | None) -> tuple[Path, Path | None]:
    """Return (root_to_serve, deck_path_relative_to_root).

    With no --root, a named deck serves its own folder. With an explicit
    --root, a deck inside that tree keeps it, so shared assets one level up
    stay reachable; only a deck outside the tree moves the root.
    """
    if deck is None:
        base = (root or Path.cwd()).resolve()
        guess = pick_deck(base)
        return base, (guess.relative_to(base) if guess else None)

    resolved = deck.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(deck)
    if root is None:
        return resolved.parent, Path(resolved.name)

    base = root.resolve()
    try:
        return base, resolved.relative_to(base)
    except ValueError:
        return resolved.parent, Path(resolved.name)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("deck", nargs="?", type=Path, help="deck .html to open")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--root", type=Path, default=None,
                    help="folder to serve (default: the deck's own folder)")
    ap.add_argument("--no-open", action="store_true", help="do not launch a browser")
    ap.add_argument("--no-inject", action="store_true",
                    help="serve decks untouched instead of adding framework tags")
    args = ap.parse_args()

    try:
        root, deck = resolve_deck(args.root, args.deck)
    except FileNotFoundError as e:
        print(f"error: {e} not found", file=sys.stderr)
        return 1
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 1

    url = f"http://localhost:{args.port}/"
    if deck is not None:
        url += urllib.parse.quote(deck.as_posix())

    socketserver.TCPServer.allow_reuse_address = True
    try:
        server = socketserver.TCPServer(
            ("127.0.0.1", args.port), make_handler(root, not args.no_inject))
    except OSError as e:
        print(f"error: cannot bind port {args.port} — {e}\n"
              f"Another server may already be running; try --port {args.port + 1}.",
              file=sys.stderr)
        return 1

    print()
    print("  deck-stage — local presenter server")
    print("  " + "-" * 44)
    print(f"  serving   : {root}")
    print(f"  framework : {FRAMEWORK_DIR}  (mounted at {MOUNT})")
    print(f"  open      : {url}")
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
