# html-presenter

Present HTML slide decks with a real operator panel on the laptop: a large
clock, an editable per-slide time plan, speaker notes, live thumbnails, master
volume and a blackout key. Then export the same deck to PDF or PowerPoint as a
backup.

It is a viewer, not an editor. Nothing it does is ever written back to your
deck. No build step, no framework, no runtime dependencies. A deck is one HTML
file.

## Quick start

```bash
python tools/serve.py examples/index.html
```

The operator panel opens on your laptop. Press **Open projector**, drag that
window to the second screen, and put it fullscreen with F11.

Point it at any deck, anywhere on disk. The deck does not need to know this
project exists:

```bash
python tools/serve.py ~/Desktop/my-deck.html
```

Or name no deck at all, and pick one in the panel:

```bash
python tools/serve.py --root ~/talks
```

The picker lists every HTML file in the folder and says which ones are decks,
so a file missing its `<deck-stage>` shows up greyed out with the reason rather
than silently going missing. Click the deck's name in the panel header to get
back to the list.

## The operator panel

The laptop screen is the console. The projector shows nothing but slides.

| Zone | What it gives you |
|------|-------------------|
| **Clock** | Elapsed time, large. Pausable. Plan total, and whether you are ahead or behind |
| **Rundown** | Every slide, with its budget in an editable field and the time it actually took. Click a row to jump |
| **Notes** | The current note at reading size, the next one previewed underneath |
| **Thumbnails** | What is on screen now and what comes next, rendered live from the deck itself |
| **Transport** | Navigate, pause, reset, black out the projector, master volume, mute |

The panel survives its own reload and the deck's. Budgets, clock and volume are
kept per deck, so reopening a talk picks up where you left it.

### Time

`#deck-plan` in the deck file is only the opening bid. Retype any budget in the
rundown and it takes effect immediately: the total, the pace and the per-slide
bar all follow. **Deck plan** puts the file's own numbers back.

Pace holds steady while you are inside the current slide's budget and only
moves once you overrun, so it stays readable mid-talk instead of ticking every
second.

### Rehearsal

The panel times every slide as you go. After a run-through, **Copy measured**
gives you a ready-made `#deck-plan` array built from what actually happened.
Paste it into the deck yourself if you want it: the program never edits your
file.

### Sound

`data-sound` on a slide plays a clip on arrival and stops it on the way out.
The panel's master volume scales every clip and every `<video>` in the deck,
without disturbing the levels you authored per clip. The lamp beside the fader
lights while a clip is sounding.

## Presenting

| Key | In the deck | In the operator panel |
|-----|-------------|-----------------------|
| `→` `Space` `PgDn` | next slide | next slide |
| `←` `PgUp` | previous slide | previous slide |
| `Home` / `End` | first / last slide | first / last slide |
| `1`–`9` | jump to slide | — |
| `B` | black out the projector | black out the projector |
| `R` | back to slide 1 | reset the clock and the measured run |
| `P` | open the operator panel | pause / resume the clock |
| `M` | — | mute |
| `F` | — | fullscreen |

Navigation syncs both ways, so you can drive from whichever window your remote
is pointed at.

## Building decks with Claude

`templates/PROMPT.md` is a paste-able spec. Give it to Claude, describe your
talk, and you get back a single HTML file this program can run.
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

That is the whole thing. No script tags to wire up: `serve.py` injects the
framework into any deck that does not already load it.

## Authoring reference

Slides are the direct element children of `<deck-stage>`.

- **`width` / `height`** set the design size. The deck is scaled to fit the
  viewport and letterboxed, so a 1920×1080 deck looks right on a 1366×768
  projector.
- **`data-label`** names the slide in the rundown.
- **`#speaker-notes`** is a JSON array, one entry per slide, in order. Extra
  slides show *(no note for this slide)*.
- **`#deck-plan`** is a JSON array of minutes per slide. Optional; the panel
  lets you type budgets in with or without it.
- **`data-sound="clip.mp3"`** on a slide plays a clip on arrival and stops it
  on the way out. `data-sound-loop` and `data-sound-volume="0.6"` are supported.

Slides are hidden, never unmounted, so videos, iframes and form state survive
navigation.

### Wiring the framework in by hand

If you would rather not use `serve.py`, load the scripts yourself and serve the
folder however you like:

```html
<script src="deck-stage.js"></script>
<script src="deck-audio.js"></script>
<script type="module" src="deck-agent.js" data-panel="panel.html"></script>
```

`data-channel` on the agent isolates two decks served from one origin.
`data-target` is a fallback time goal for decks with no `#deck-plan`.

`presenter.js` and `presenter.html` are the earlier, notes-only presenter view.
They still work and are still served, for decks that wire them up by hand. A
deck that loads `presenter.js` is left alone by the injector, so the two never
end up on the channel at once.

## Why it needs a server

Browsers give every `file://` URL its own opaque origin. Two windows opened
from the same file therefore land on *different* origins and cannot share a
`BroadcastChannel` — the deck and the panel never see each other.

Serving over `http://localhost` puts both windows on one origin.
`tools/serve.py` binds localhost only, so nothing is exposed to the network. It
also:

- mounts the framework at `/__deck/`, wherever the deck itself lives
- injects the script tags into decks that do not already load them
  (`--no-inject` turns this off)
- sends `Cache-Control: no-store`, so edit-and-reload actually reloads
- opens the panel rather than the deck (`--deck-first` flips that)

Any static server works if your deck wires the scripts in itself.

## Exporting

```bash
python tools/export_pdf.py  my-deck.html                  # one slide per page
python tools/export_pptx.py my-deck.html                  # + notes in the notes pane
python tools/export_pdf.py  my-deck.html --size 1280x720
```

Both drive headless Chrome (or Chromium, or Edge — the first one found) and
add `deck-stage.js` to decks that rely on the server to inject it, so a
portable deck exports correctly straight off disk. `export_pptx.py`
additionally needs:

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
| `deck-stage.js` | The `<deck-stage>` web component: slides, keyboard nav, scaling, blackout, print layout |
| `deck-audio.js` | Per-slide audio and the master mixer |
| `deck-agent.js` | The deck side of the link: reports position, carries out the panel's commands |
| `panel.html` | The operator panel |
| `core/` | Protocol, transport, deck parsing and the session clock. Shared by both windows |
| `panel/` | Panel views: rundown, thumbnails, wiring |
| `presenter.js`, `presenter.html` | The earlier notes-only presenter view, still supported |
| `templates/PROMPT.md` | Paste into Claude to generate a conforming deck |
| `templates/starter.html` | Hand-editable deck skeleton |
| `tools/serve.py` | Localhost server, framework mount and injection |
| `tools/export_pdf.py` | Deck → PDF |
| `tools/export_pptx.py` | Deck → PPTX with notes |
| `tools/_chrome.py` | Finds a Chromium binary and drives headless print-to-PDF |

`deck-stage.js` shipped with the deck export this project grew out of; the rest
was written here.

## Browser support

Chrome, Edge, Firefox and Safari 15.4+. The panel needs `BroadcastChannel`, ES
modules and a non-opaque origin; without them the deck itself still works and
the agent logs a warning instead of failing.
