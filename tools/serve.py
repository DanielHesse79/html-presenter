"""Serve a deck over http:// so the operator panel can drive it.

    python tools/serve.py my-deck.html      # serve its folder, open the panel
    python tools/serve.py                   # serve the current folder
    python tools/serve.py deck.html --port 9000 --no-open
    python tools/serve.py deck.html --deck-first   # open the deck, not the panel

Point it at *any* deck, anywhere on disk. The framework files are mounted at
/__deck/ and injected into decks that do not already load them, so a deck
Claude just wrote for you gets an operator panel without being edited.

Why a server at all: browsers give every file:// URL its own opaque origin, so
two windows opened from the same file cannot share a BroadcastChannel. Over
http://localhost they share one origin and the panel syncs with the deck.

Only localhost is bound, so nothing is exposed to the network.
"""

from __future__ import annotations

import argparse
import contextlib
import html as html_entities
import http.server
import json
import re
import socketserver
import sys
import threading
import urllib.parse
import webbrowser
from pathlib import Path

DEFAULT_PORT = 8765

# Repository root - deck-stage.js and friends live here.
FRAMEWORK_DIR = Path(__file__).resolve().parent.parent
MOUNT = "/__deck/"

# Single files servable from the mount.
FRAMEWORK_FILES = {
    "deck-stage.js", "deck-audio.js", "deck-agent.js",
    "panel.html",
    # Legacy path, kept working for decks that wire it up by hand.
    "presenter.js", "presenter.html",
}
# Whole directories servable from the mount.
FRAMEWORK_DIRS = ("core", "panel")

PANEL_URL = MOUNT + "panel.html"
DECKS_ENDPOINT = MOUNT + "decks.json"

# How far into a file to look for <deck-stage>. A deck with embedded images
# runs to megabytes, and the element can sit well past the CSS.
DECK_SCAN_BYTES = 4 * 1024 * 1024
DECK_LIST_LIMIT = 200

CONTENT_TYPES = {".js": "text/javascript", ".html": "text/html", ".css": "text/css"}

QUIET_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif",
                  ".mp3", ".mp4", ".woff", ".woff2", ".ico")


def framework_path(name: str) -> Path | None:
    """Resolve a /__deck/ request to a file, or None if it is not ours.

    Subdirectories are allowed for core/ and panel/, so the request has to be
    checked for traversal rather than matched against a flat name set.
    """
    if not name or name.endswith("/"):
        return None
    target = (FRAMEWORK_DIR / name).resolve()
    try:
        rel = target.relative_to(FRAMEWORK_DIR)
    except ValueError:
        return None                       # escaped the framework directory
    parts = rel.parts
    if len(parts) == 1:
        allowed = parts[0] in FRAMEWORK_FILES
    else:
        allowed = parts[0] in FRAMEWORK_DIRS and target.suffix in CONTENT_TYPES
    return target if allowed and target.is_file() else None


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
    skips any script the author already wired up themselves. A deck that loads
    the legacy presenter.js is left alone entirely: it has opted into the old
    path, and injecting the agent on top would put two publishers on the channel.
    """
    if "<deck-stage" not in html:
        return html

    # Check against a comment-free copy; insert into the original.
    probe = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    if _loads_script(probe, "presenter.js") or _loads_script(probe, "deck-agent.js"):
        return html

    tags = []
    if not _loads_script(probe, "deck-stage.js"):
        tags.append('<script src="' + MOUNT + 'deck-stage.js"></script>')
    if not _loads_script(probe, "deck-audio.js"):
        tags.append('<script src="' + MOUNT + 'deck-audio.js"></script>')
    tags.append(
        '<script type="module" src="' + MOUNT + 'deck-agent.js"'
        ' data-panel="' + PANEL_URL + '"></script>'
    )

    block = "\n" + "\n".join(tags) + "\n"
    lowered = html.lower()
    for close in ("</body>", "</html>"):
        at = lowered.rfind(close)
        if at != -1:
            return html[:at] + block + html[at:]
    return html + block



# Scanning a folder of multi-megabyte decks on every request would be wasteful,
# and the answer only changes when a file does.
_deck_cache = {}


def describe_html(path: Path, root: Path) -> dict:
    """Enough about one HTML file for the panel to offer or refuse it."""
    stat = path.stat()
    key = (str(path), stat.st_mtime_ns, stat.st_size)
    cached = _deck_cache.get(key)
    if cached is not None:
        return cached

    title = ""
    is_deck = False
    try:
        head = path.read_text(encoding="utf-8", errors="replace")[:DECK_SCAN_BYTES]
        is_deck = "<deck-stage" in head
        m = re.search(r"<title[^>]*>(.*?)</title>", head, re.S | re.I)
        if m:
            title = html_entities.unescape(
                re.sub(r"\s+", " ", m.group(1))).strip()[:120]
    except OSError:
        pass

    info = {
        "path": "/" + path.relative_to(root).as_posix(),
        "name": path.name,
        "title": title,
        "isDeck": is_deck,
        "size": stat.st_size,
        "modified": int(stat.st_mtime),
    }
    _deck_cache[key] = info
    return info


def list_decks(root: Path) -> dict:
    """Every HTML file in the served tree, decks first.

    Non-decks are listed too rather than filtered out. A file that is missing
    its <deck-stage> is exactly the file someone is about to wonder why they
    cannot pick, and saying so beats leaving a gap in the list.
    """
    found = []
    for depth in (root.glob("*.htm*"), root.glob("*/*.htm*")):
        for p in depth:
            if not p.is_file() or p.name.startswith("."):
                continue
            if p.name in FRAMEWORK_FILES:
                continue
            found.append(p)
            if len(found) >= DECK_LIST_LIMIT:
                break

    items = [describe_html(p, root) for p in found]
    items.sort(key=lambda d: (not d["isDeck"], d["name"].lower()))
    return {"root": str(root), "decks": items, "truncated": len(found) >= DECK_LIST_LIMIT}


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

            # What is there to present? Answered before the file mount so the
            # name cannot collide with a framework file.
            if path == DECKS_ENDPOINT:
                body = json.dumps(list_decks(root)).encode("utf-8")
                self._send_bytes(body, "application/json; charset=utf-8")
                return

            # Framework files, wherever the deck itself lives.
            if path.startswith(MOUNT):
                name = urllib.parse.unquote(path[len(MOUNT):])
                target = framework_path(name)
                if target is None:
                    self.send_error(404, "Not a framework file: " + name)
                    return
                ctype = CONTENT_TYPES.get(target.suffix, "application/octet-stream")
                self._send_bytes(target.read_bytes(), ctype + "; charset=utf-8")
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
    ap.add_argument("--deck-first", action="store_true",
                    help="open the deck itself instead of the operator panel")
    ap.add_argument("--no-inject", action="store_true",
                    help="serve decks untouched instead of adding framework tags")
    args = ap.parse_args()

    try:
        root, deck = resolve_deck(args.root, args.deck)
    except FileNotFoundError as e:
        print("error: " + str(e) + " not found", file=sys.stderr)
        return 1
    if not root.is_dir():
        print("error: " + str(root) + " is not a directory", file=sys.stderr)
        return 1

    base = "http://localhost:" + str(args.port)
    deck_url = base + "/" + (urllib.parse.quote(deck.as_posix()) if deck else "")
    if deck is not None and args.deck_first:
        url = deck_url
    elif deck is None:
        url = base + PANEL_URL          # the panel will offer what it can find
    else:
        url = (base + PANEL_URL + "?deck="
               + urllib.parse.quote("/" + deck.as_posix(), safe=""))

    socketserver.TCPServer.allow_reuse_address = True
    try:
        server = socketserver.TCPServer(
            ("127.0.0.1", args.port), make_handler(root, not args.no_inject))
    except OSError as e:
        print("error: cannot bind port " + str(args.port) + " - " + str(e) + "\n"
              "Another server may already be running; try --port "
              + str(args.port + 1) + ".", file=sys.stderr)
        return 1

    print()
    print("  deck-stage - local operator server")
    print("  " + "-" * 44)
    print("  serving   : " + str(root))
    print("  framework : " + str(FRAMEWORK_DIR) + "  (mounted at " + MOUNT + ")")
    print("  open      : " + url)
    if deck is None:
        print("  (no deck named - pick one in the panel)")
    else:
        print("  deck      : " + deck_url)
    print()
    if deck is not None and not args.deck_first:
        print("  The panel is the operator console: keep it on the laptop and")
        print("  press Open projector to put the deck on the second screen.")
    else:
        print("  Press P in the deck to open the operator panel,")
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
