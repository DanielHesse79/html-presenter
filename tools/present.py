"""Start the presenter as an application window rather than a browser tab.

    python tools/present.py                  # pick a deck in the panel
    python tools/present.py my-deck.html     # go straight to this one
    python tools/present.py --root ~/talks

On Windows, Present.cmd in the repository root does the same by double-click.

What this adds over tools/serve.py is the shell: it starts the server in this
process, opens the operator panel in a Chromium app window with no address bar
or tabs, and stops the server when that window is closed. The result behaves
like a program while still being the same few files underneath.

The app window runs in its own browser profile, kept beside this repository's
own data rather than in your everyday browser. That profile exists for one
reason: it is the only place where disabling the popup blocker is reasonable.
The panel opens the projector with window.open(), a fresh profile blocks that
by default, and being told to allow popups is not something anyone should meet
five minutes before a talk. Nothing but http://localhost is ever loaded in it.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import serve                                    # noqa: E402
from _chrome import ChromeNotFound, find_chrome  # noqa: E402

# If the browser exits sooner than this, it handed off to an instance that was
# already running and there is no window of ours to wait on.
HANDOFF_SECONDS = 3.0
PORT_ATTEMPTS = 12


def profile_dir() -> Path:
    """Somewhere durable, so a granted permission survives to the next talk."""
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_DATA_HOME")
    if not base:
        base = str(Path.home() / ".local" / "share")
    return Path(base) / "html-presenter" / "browser-profile"


def start_server(root: Path, port: int, inject: bool):
    """Bind the first free port at or after `port`. Returns (server, port)."""
    last = None
    for candidate in range(port, port + PORT_ATTEMPTS):
        try:
            httpd = serve.Server(
                ("127.0.0.1", candidate), serve.make_handler(root, inject))
        except OSError as e:
            last = e
            continue
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        return httpd, candidate
    raise SystemExit(f"error: no free port in {port}..{port + PORT_ATTEMPTS - 1} ({last})")


def panel_url(port: int, deck: Path | None) -> str:
    url = f"http://localhost:{port}{serve.PANEL_URL}"
    if deck is not None:
        url += "?deck=" + urllib.parse.quote("/" + deck.as_posix(), safe="")
    return url


def launch(binary: str, url: str) -> subprocess.Popen:
    profile = profile_dir()
    profile.mkdir(parents=True, exist_ok=True)
    return subprocess.Popen([
        binary,
        f"--app={url}",
        f"--user-data-dir={profile}",
        "--disable-popup-blocking",   # the panel opens the projector itself
        "--no-first-run",
        "--no-default-browser-check",
    ])


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("deck", nargs="?", type=Path, help="deck .html to open")
    ap.add_argument("--port", type=int, default=serve.DEFAULT_PORT)
    ap.add_argument("--root", type=Path, default=None,
                    help="folder to serve (default: the deck's own folder)")
    ap.add_argument("--browser", help="path to a Chrome/Chromium/Edge binary")
    ap.add_argument("--no-inject", action="store_true",
                    help="serve decks untouched instead of adding framework tags")
    args = ap.parse_args()

    try:
        root, deck = serve.resolve_deck(args.root, args.deck)
    except FileNotFoundError as e:
        print(f"error: {e} not found", file=sys.stderr)
        return 1
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        return 1

    try:
        binary = args.browser or find_chrome()
    except ChromeNotFound as e:
        print(f"error: {e}", file=sys.stderr)
        print("Falling back to tools/serve.py would open a normal browser tab.",
              file=sys.stderr)
        return 1

    httpd, port = start_server(root, args.port, not args.no_inject)
    url = panel_url(port, deck)

    print()
    print("  html-presenter")
    print("  " + "-" * 44)
    print(f"  serving : {root}")
    print(f"  panel   : {url}")
    print(f"  browser : {binary}")
    print(f"  profile : {profile_dir()}")
    print()
    print("  Close the app window to stop, or press Ctrl+C here.")
    print()

    started = time.monotonic()
    try:
        proc = launch(binary, url)
        proc.wait()
        if time.monotonic() - started < HANDOFF_SECONDS:
            # Another copy of this profile was already running and took the
            # window. Nothing of ours to wait on, so hold the server open.
            print("  (window handed to a running instance; Ctrl+C to stop)")
            while True:
                time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        httpd.server_close()

    print("\nStopped.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
