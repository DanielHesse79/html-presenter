"""Locate a Chromium browser and drive its headless print-to-PDF.

Shared by export_pdf.py and export_pptx.py.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Checked in order. The first one that exists wins.
# deck-stage.js lives at the repository root, beside tools/.
FRAMEWORK_DIR = Path(__file__).resolve().parent.parent

CANDIDATES = {
    "win32": [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ],
    "darwin": [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    "linux": [
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
    ],
}

ON_PATH = ["google-chrome", "chromium", "chromium-browser", "chrome", "msedge"]


class ChromeNotFound(RuntimeError):
    pass


def find_chrome() -> str:
    """Return a path to a Chromium binary, or raise ChromeNotFound."""
    for path in CANDIDATES.get(sys.platform, []):
        if Path(path).exists():
            return path
    for name in ON_PATH:
        found = shutil.which(name)
        if found:
            return found
    raise ChromeNotFound(
        "No Chrome/Chromium/Edge found. Install one, or pass --chrome /path/to/binary."
    )


def ensure_deck_stage(html):
    """Wire deck-stage.js into a deck that relies on the server to inject it.

    Decks are meant to be portable: templates/PROMPT.md tells you not to put
    framework tags in one, because tools/serve.py mounts them at request time.
    The exporters read the file straight off disk, though, and with no
    deck-stage.js there is no print stylesheet, so the slides fall into normal
    flow and the PDF paginates wherever the text happens to run out.

    Only deck-stage.js is added. The operator link and the audio both need a
    real origin and a second window, and neither means anything to a printer.
    """
    if "<deck-stage" not in html:
        return html
    probe = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    if re.search(r"<script[^>]+deck-stage[.]js", probe, re.I):
        return html

    script = FRAMEWORK_DIR / "deck-stage.js"
    if not script.is_file():
        return html
    tag = '\n<script src="%s"></script>\n' % script.as_uri()
    lowered = html.lower()
    for close in ("</body>", "</html>"):
        at = lowered.rfind(close)
        if at != -1:
            return html[:at] + tag + html[at:]
    return html + tag


def print_to_pdf(
    html_path: Path,
    pdf_path: Path,
    *,
    width: int | None = None,
    height: int | None = None,
    chrome: str | None = None,
    wait_ms: int = 20000,
) -> Path:
    """Render an HTML file to PDF with headless Chrome.

    When width/height are given, an @page rule of that pixel size is injected
    into a temporary copy of the document so each slide lands on its own page
    at the authored size. Without them the document's own @page rule applies.
    """
    binary = chrome or find_chrome()
    source = html_path.read_text(encoding="utf-8")
    target = html_path

    body = ensure_deck_stage(source)
    if width and height:
        style = (
            "<style>"
            f"@page {{ size: {width}px {height}px; margin: 0; }}"
            "@media print { html, body { margin: 0 !important; padding: 0 !important;"
            " background: none !important; overflow: visible !important;"
            " height: auto !important; }"
            " * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }"
            "</style>"
        )
        if "<head>" not in body:
            raise ValueError(f"{html_path.name} has no <head> to inject the @page rule into.")
        body = body.replace("<head>", "<head>\n" + style, 1)

    tmp = None
    if body != source:
        # Written beside the source so relative asset paths still resolve.
        tmp = html_path.with_name(f".{html_path.stem}.print.tmp.html")
        tmp.write_text(body, encoding="utf-8")
        target = tmp

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf_path.unlink(missing_ok=True)

    # A throwaway profile keeps the run from touching (or waiting on) the
    # user's real browser session.
    with tempfile.TemporaryDirectory(prefix="deck-stage-") as profile:
        try:
            subprocess.run(
                [
                    binary,
                    "--headless=new",
                    "--disable-gpu",
                    "--no-first-run",
                    "--no-default-browser-check",
                    f"--user-data-dir={profile}",
                    "--no-pdf-header-footer",
                    f"--print-to-pdf={pdf_path}",
                    f"--virtual-time-budget={wait_ms}",
                    "--run-all-compositor-stages-before-draw",
                    target.resolve().as_uri(),
                ],
                check=True,
                capture_output=True,
            )
        finally:
            if tmp:
                tmp.unlink(missing_ok=True)

    if not pdf_path.exists():
        raise RuntimeError(f"Chrome exited without writing {pdf_path}")
    return pdf_path
