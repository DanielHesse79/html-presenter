# deck-stage

Present HTML slide decks with a proper second-screen presenter view — speaker
notes, next-note preview, slide counter and a talk timer — then export the same
deck to PDF or PowerPoint as a backup.

No build step, no framework, no dependencies in the browser. A deck is one HTML
file plus three scripts.

```
examples/index.html      ← a four-slide deck you can run right now
```

## Quick start

```bash
python tools/serve.py examples/index.html
```

Then press **P** in the deck and drag the presenter window to your second screen.

## Presenting

| Key | In the deck | In the presenter window |
|-----|-------------|-------------------------|
| `→` `Space` `PgDn` | next slide | next slide |
| `←` `PgUp` | previous slide | previous slide |
| `Home` / `End` | first / last slide | `Home` → first slide |
| `1`–`9` | jump to slide | — |
| `R` | back to slide 1 | reset the clock |
| `P` / `N` | open presenter view | — |
| `F` | — | fullscreen |

Navigation syncs in both directions, so you can drive the talk from whichever
window your remote or trackpad is pointed at.

## Authoring a deck

Slides are the direct element children of `<deck-stage>`:

```html
<script type="application/json" id="speaker-notes">
["Note for slide 1", "Note for slide 2"]
</script>

<script src="deck-stage.js"></script>
<script src="presenter.js"></script>
<script src="deck-audio.js"></script>   <!-- optional -->

<deck-stage width="1920" height="1080">
  <section data-label="Title">…</section>
  <section data-label="Agenda" data-sound="assets/chime.mp3">…</section>
</deck-stage>
```

- **`width` / `height`** set the design size. The deck is scaled to fit the
  viewport and letterboxed, so a 1920×1080 deck looks right on a 1366×768
  projector.
- **`data-label`** names the slide in the presenter view and in exports.
- **`#speaker-notes`** is a plain JSON array, one entry per slide, in order.
  Extra slides simply show *(no note for this slide)*.
- **`data-sound`** plays a clip on arrival and stops it on the way out.
  `data-sound-loop` and `data-sound-volume="0.6"` are supported.

Slides are hidden, never unmounted — videos, iframes and form state survive
navigation.

### Configuring the presenter

Options go on the `presenter.js` tag:

```html
<script src="presenter.js"
        data-channel="deck-stage"        <!-- isolate two decks on one origin -->
        data-presenter="presenter.html"  <!-- path to the presenter window -->
        data-target="7:00"></script>     <!-- time goal shown by the clock -->
```

## Why it needs a server

Browsers give every `file://` URL its own opaque origin. Two windows opened from
the same file therefore land on *different* origins and cannot share a
`BroadcastChannel` — the deck and the presenter never see each other.

Serving the folder over `http://localhost` puts both windows on one origin and
everything connects. `tools/serve.py` binds localhost only, so nothing is
exposed to the network.

Any static server works — `python -m http.server`, `npx serve`, whatever you
already use.

## Exporting

```bash
python tools/export_pdf.py  my-deck.html                  # one slide per page
python tools/export_pptx.py my-deck.html                  # + notes in the notes pane
python tools/export_pdf.py  my-deck.html --size 1280x720
```

Both drive headless Chrome (or Chromium, or Edge — the first one found).
`export_pptx.py` additionally needs:

```bash
pip install python-pptx PyMuPDF
```

The PPTX is a **static fallback**, not a conversion: each slide becomes a
full-bleed image, and speaker notes are written into PowerPoint's notes pane so
Presenter View works if the HTML deck fails you on stage. Animation, audio and
interactivity do not survive the trip.

Speaker notes never appear in the PDF — they live in a JSON `<script>` block the
browser does not paint.

## Files

| File | Role |
|------|------|
| `deck-stage.js` | The `<deck-stage>` web component: slides, keyboard nav, scaling, print layout |
| `presenter.js` | Broadcasts deck position and opens the presenter window |
| `presenter.html` | The second-screen view: notes, next note, counter, clock |
| `deck-audio.js` | Optional per-slide audio |
| `tools/serve.py` | Localhost server, so the two windows share an origin |
| `tools/export_pdf.py` | Deck → PDF |
| `tools/export_pptx.py` | Deck → PPTX with notes |
| `tools/_chrome.py` | Finds a Chromium binary and drives headless print-to-PDF |

`deck-stage.js` shipped with the deck export this project grew out of; the rest
was written here.

## Browser support

Chrome, Edge, Firefox and Safari 15.4+. The presenter view needs
`BroadcastChannel` and a non-opaque origin; without them the deck itself still
works and `presenter.js` logs a warning instead of failing.
