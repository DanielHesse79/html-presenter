# html-presenter

Present HTML slide decks with a proper second-screen presenter view — speaker
notes, next-note preview, a per-slide time plan and a pace indicator — then
export the same deck to PDF or PowerPoint as a backup.

No build step, no framework, no browser dependencies. A deck is one HTML file.

## Quick start

```bash
python tools/serve.py examples/index.html
```

Press **P** in the deck and drag the presenter window to your second screen.

Point it at any deck, anywhere on disk — the deck does not need to know this
project exists:

```bash
python tools/serve.py ~/Desktop/my-deck.html
```

## Building decks with Claude

`templates/PROMPT.md` is a paste-able spec. Give it to Claude, describe your
talk, and you get back a single HTML file this presenter can run.
`templates/starter.html` is the same contract as a file you can edit by hand.

The contract is small:

```html
<script type="application/json" id="speaker-notes">
["What I say on slide 1.", "What I say on slide 2."]
</script>

<script type="application/json" id="deck-plan">
[1, 2]
</script>

<deck-stage width="1920" height="1080">
  <section data-label="Title">…</section>
  <section data-label="The point">…</section>
</deck-stage>
```

That is the whole thing. No script tags to wire up — `serve.py` injects the
framework into any deck that does not already load it.

## The time plan

`#deck-plan` is minutes per slide, in the same order as the slides. Fractions
are fine. From it the presenter shows:

- **This slide** — time spent against its budget, with a bar that turns red on overrun
- **Left in plan** — how much of the total remains
- **Pace** — *on plan*, *1:20 behind*, *0:30 ahead*

Pace holds steady while you are inside the current slide's budget and only
moves once you overrun, so it stays readable mid-talk instead of ticking every
second. Drop the block and you get a plain elapsed clock instead.

The clock survives a reload of the presenter window — losing it in front of an
audience is worse than the small amount of state kept to prevent that.

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

Navigation syncs both ways, so you can drive from whichever window your remote
is pointed at.

## Authoring reference

Slides are the direct element children of `<deck-stage>`.

- **`width` / `height`** set the design size. The deck is scaled to fit the
  viewport and letterboxed, so a 1920×1080 deck looks right on a 1366×768
  projector.
- **`data-label`** names the slide in the presenter view.
- **`#speaker-notes`** is a JSON array, one entry per slide, in order. Extra
  slides show *(no note for this slide)*.
- **`#deck-plan`** is a JSON array of minutes per slide. Optional.
- **`data-sound="clip.mp3"`** on a slide plays a clip on arrival and stops it
  on the way out. `data-sound-loop` and `data-sound-volume="0.6"` are supported.

Slides are hidden, never unmounted — videos, iframes and form state survive
navigation.

### Wiring the framework in by hand

If you would rather not use `serve.py`, load the scripts yourself and serve the
folder however you like:

```html
<script src="deck-stage.js"></script>
<script src="presenter.js" data-channel="deck-stage"
                           data-presenter="presenter.html"
                           data-target="7:00"></script>
<script src="deck-audio.js"></script>
```

`data-channel` isolates two decks served from one origin. `data-target` is a
fallback time goal for decks with no `#deck-plan`.

## Why it needs a server

Browsers give every `file://` URL its own opaque origin. Two windows opened
from the same file therefore land on *different* origins and cannot share a
`BroadcastChannel` — the deck and the presenter never see each other.

Serving over `http://localhost` puts both windows on one origin. `tools/serve.py`
binds localhost only, so nothing is exposed to the network. It also:

- mounts the framework at `/__deck/`, wherever the deck itself lives
- injects the script tags into decks that do not already load them
  (`--no-inject` turns this off)
- sends `Cache-Control: no-store`, so edit-and-reload actually reloads

Any static server works if your deck wires the scripts in itself.

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
full-bleed image, with speaker notes in PowerPoint's notes pane so Presenter
View works if the HTML deck fails you on stage. Animation, audio and
interactivity do not survive the trip.

Speaker notes never appear in the PDF — they live in a JSON `<script>` block
the browser does not paint.

## Files

| File | Role |
|------|------|
| `deck-stage.js` | The `<deck-stage>` web component: slides, keyboard nav, scaling, print layout |
| `presenter.js` | Broadcasts deck position and opens the presenter window |
| `presenter.html` | The second-screen view: notes, next note, time plan, pace, clock |
| `deck-audio.js` | Optional per-slide audio |
| `templates/PROMPT.md` | Paste into Claude to generate a conforming deck |
| `templates/starter.html` | Hand-editable deck skeleton |
| `tools/serve.py` | Localhost server, framework mount and injection |
| `tools/export_pdf.py` | Deck → PDF |
| `tools/export_pptx.py` | Deck → PPTX with notes |
| `tools/_chrome.py` | Finds a Chromium binary and drives headless print-to-PDF |

`deck-stage.js` shipped with the deck export this project grew out of; the rest
was written here.

## Browser support

Chrome, Edge, Firefox and Safari 15.4+. The presenter view needs
`BroadcastChannel` and a non-opaque origin; without them the deck itself still
works and `presenter.js` logs a warning instead of failing.
