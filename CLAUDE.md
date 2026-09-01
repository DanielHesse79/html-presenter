# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A presenter program for HTML slide decks. The laptop runs an operator panel
(clock, editable time plan, notes, live thumbnails, master volume, blackout);
the second screen runs nothing but slides. Plus PDF/PPTX export.

It is a **viewer, not an editor**: nothing is ever written back to a deck file.
The measured-rehearsal plan is offered as text to copy, and that is as close to
editing as the program gets. Hold that line when adding features.

No build step, no package manager, no runtime dependencies. The browser files
are plain ES modules and classic scripts; the tools are stdlib Python 3.

## Commands

```bash
python tools/serve.py examples/index.html        # serve + open the operator panel
python tools/serve.py ~/Desktop/my-deck.html     # any deck, anywhere on disk
python tools/serve.py --root ~/talks             # name none, pick one in the panel
python tools/serve.py deck.html --port 9000 --no-open --deck-first --no-inject

python tools/export_pdf.py  my-deck.html --size 1280x720
python tools/export_pptx.py my-deck.html --scale 2   # pip install python-pptx PyMuPDF
```

There is no test suite, linter, or build. Verification is manual: serve a deck,
check that the panel and the projector window stay in sync, that a budget
retyped in the rundown moves the totals and the pace, and that `export_pdf.py`
still emits one page per slide at the design size.

## The deck contract

A deck is one HTML file that does not know this project exists:

```html
<script type="application/json" id="speaker-notes">["say this", "then this"]</script>
<script type="application/json" id="deck-plan">[1, 2.5]</script>
<deck-stage width="1920" height="1080">
  <section data-label="Title">…</section>
</deck-stage>
```

`#speaker-notes` and `#deck-plan` are arrays **parallel to the slides**: same
order, same length. `#deck-plan` is minutes per slide and is optional. Slides
are the direct element children of `<deck-stage>`.

`templates/PROMPT.md` is the paste-able spec that generates conforming decks;
keep it in sync with any change to this contract.

## Architecture

```
core/protocol.js    message types            ─┐
core/transport.js   BroadcastChannel adapter  ├─ shared by both windows
core/deck-doc.js    parses a deck's HTML      │
core/session.js     clock, plan, pace         │
core/format.js      time rendering           ─┘

deck-agent.js       projector window: reports position, obeys commands
panel.html          operator panel shell
panel/main.js       panel orchestration
panel/rundown.js    slide list with editable budgets
panel/preview.js    live thumbnails
```

### Who owns what

This split is the load-bearing idea:

- The **deck file** owns content: slides, labels, notes, a *suggested* plan.
- The **session** (panel window) owns everything that changes while presenting:
  clock, the budgets retyped on the night, volume, mute, blackout, and what
  each slide actually took.
- The **channel** carries position and audio status only.

So the panel works before the projector window exists, survives either side
reloading, and never needs a handle on the other window.

### The transport seam

`core/transport.js` is the only file that knows *how* messages cross windows.
Everything else speaks `core/protocol.js` and calls `send`/`on`. Swapping
BroadcastChannel for Electron IPC or a WebSocket is a change to that one file.
Keep it that way.

Messages (`protocol.js` is the authority):

- `state` — deck → panel, on `slidechange`, `blackoutchange` and a 2 s heartbeat
- `hello` — panel → deck, every 1.5 s until a state arrives
- `nav` / `volume` / `mute` / `blackout` — panel → deck commands

The panel marks itself disconnected after 6 s of silence. On (re)connect it
**pushes** its volume, mute and blackout to the deck rather than trusting the
deck to remember.

The `state` message keeps the exact field set the legacy `presenter.html`
reads (`index`, `total`, `label`, `deckUrl`, `target`), so the old presenter
view still works against `deck-agent.js`. New fields must stay additive.

**A server is required.** Every `file://` URL gets its own opaque origin, so two
windows on the same file land on different origins and never share a channel.
`tools/serve.py` binds localhost only.

### Notes travel by HTTP fetch, not over the channel

The panel takes `deckUrl` from a state message, `fetch`es the deck document, and
parses `#speaker-notes`, `#deck-plan`, the slide roster and the design size out
of it with `DOMParser` (`core/deck-doc.js`). The fragment is stripped first:
`deck-stage` rewrites `#<slide>` on every move, so an unstripped URL would look
new on each navigation.

Slide labels are re-derived in `deck-doc.js` with the same fallback chain
`deck-stage.js` uses at runtime (`data-label` → `data-screen-label` minus its
leading number → first heading → `"Slide"`). That duplication is deliberate: it
keeps the panel independent of whether a deck window is open yet.

### Decks stay portable; the server wires them up

`serve.py` mounts the framework at `/__deck/` regardless of where the deck
lives, and injects `deck-stage.js`, `deck-audio.js` and `deck-agent.js` into any
served HTML containing `<deck-stage>` that does not already load them. The check
strips HTML comments first, so prose mentioning `deck-stage.js` does not count.
A deck loading the legacy `presenter.js` is skipped entirely — injecting the
agent on top would put two publishers on one channel.

`/__deck/decks.json` lists the HTML files in the served tree and flags which
contain a `<deck-stage>`, which is what `panel/picker.js` offers. Results are
cached on (path, mtime, size) because a folder of decks with embedded images
runs to megabytes each. A browser file picker cannot replace this: a file
chosen through `<input type="file">` has no http address, and the two-window
design needs both windows on one origin.

Adding a new browser-side file means updating `FRAMEWORK_FILES` (single files)
or `FRAMEWORK_DIRS` (whole directories) in `serve.py`. `framework_path()`
resolves and containment-checks the request, so subdirectories are allowed but
traversal is not.

### `<deck-stage>` (deck-stage.js)

A shadow-DOM web component whose slides stay in **light DOM** via `<slot>`, so
the deck author's own CSS still applies. Key decisions:

- Slides are hidden (`visibility`/`opacity`), never unmounted — videos, iframes
  and form state survive navigation.
- The canvas is a fixed design size scaled with `transform: scale()` and
  letterboxed. This is what makes thumbnails free: size an iframe small and the
  real slide renders inside it.
- `@page` is a no-op inside shadow DOM, so `_syncPrintPageRule()` injects a
  `<style id="deck-stage-print-page">` into `document.head`. That plus the
  `@media print` block is what makes Save-as-PDF emit one slide per page.
- No cross-load position state: it reads `#<n>` from the hash on mount and
  `history.replaceState`s it on every move.
- `blackout` (property, `toggleBlackout()`, `B` key) raises an opaque layer
  above the slides but below the control pill, and emits `blackoutchange`.
- The `preview` attribute hides the control pill and tap zones.

`slidechange` and `blackoutchange` are composed, bubbling CustomEvents. They are
the integration point — hang new features off them rather than reaching into
internals.

### Thumbnails and the two preview guards

`panel/preview.js` renders the current and next slide by loading **the deck
itself** into iframes. Those iframes get the framework injected like any other
served HTML, so two guards stop a preview behaving like a second deck:

1. the `deck-preview` URL parameter — `deck-agent.js` checks it before joining
   the channel, and `deck-audio.js` checks it before making a sound
2. the `preview` attribute on `<deck-stage>`

Navigation is a direct same-origin call into the iframe's `deck-stage.goTo()`,
not a reload.

### The session clock (core/session.js)

Time is **accrued**, not derived from a start timestamp: each tick adds the
wall-clock delta to the elapsed total and to the current slide's actual.
Pausing stops accruing. A pausable clock and per-slide rehearsal timings then
fall out of one mechanism instead of three sets of bookkeeping.

Drift is `elapsed - (cumulative(index) + min(spent, budget))`. Clamping `spent`
to the budget is the point: pace holds steady while you are inside a slide's
budget and only moves once you overrun, so it is readable at a glance mid-talk.

State is persisted to `localStorage` under `deck-stage:session:<deckUrl>`, and
discarded when the slide count no longer matches (the deck was edited, so the
old numbers no longer line up with the slides).

### Export

Both exporters go through headless Chrome print-to-PDF in `tools/_chrome.py`,
which finds Chrome/Chromium/Edge by platform table then `PATH`.
`ensure_deck_stage()` adds `deck-stage.js` to decks that rely on the server to
inject it — without it there is no print stylesheet and the PDF paginates
wherever the text runs out. Any modified document is written to a temp copy
**beside the original** so relative asset paths still resolve, and deleted
afterwards.

`export_pptx.py` is PDF → PyMuPDF raster → one full-bleed image per blank slide,
with notes in the notes pane. A static fallback for when the HTML deck fails on
stage, not a conversion.

## Conventions

- Comments explain *why*, often at length, at the top of each file. Match that:
  the reasoning behind a non-obvious choice is the point.
- Everything degrades rather than throws: no `BroadcastChannel` logs a warning
  and the deck still works; blocked autoplay fails silently; a failed deck fetch
  retries on the heartbeat without clobbering notes already held.
- Never block the panel with a modal. `alert`/`prompt`/`confirm` freeze the
  console mid-talk; put the message in the banner instead.
- `.gitattributes` normalises to LF in the repository. Do not commit CRLF.
