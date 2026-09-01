# Building a deck for html-presenter

Paste the block below into Claude, then describe your talk: subject, audience,
how long you have, and roughly how many slides. You get back a single
self-contained `.html` file you can present with:

```bash
python /path/to/html-presenter/tools/serve.py my-deck.html
```

The block is written to stand on its own, so it works anywhere Claude runs
(Cowork, Claude Code, the app) with no knowledge of this repository.

---

Build me a slide deck as **one self-contained HTML file**, following this
contract exactly. It will be shown by a presenter program that puts the slides
on a projector and an operator panel on my laptop, so a few of these rules are
about that panel rather than about the slides themselves.

## Structure

```html
<deck-stage width="1920" height="1080">
  <section data-label="Short slide name"> …slide markup… </section>
  <section data-label="Next slide">       …slide markup… </section>
</deck-stage>
```

- Every slide is a direct `<section>` child of `<deck-stage>`. Nothing else
  goes between them.
- `data-label` names the slide in my operator panel's rundown, where I use it
  to find and jump to slides mid-talk. Keep it under ~25 characters and make it
  something I would recognise under pressure ("The three costs", not "Slide 4").

## Speaker notes

A JSON array in `<head>`, one entry per slide, same order, same count as the
slides:

```html
<script type="application/json" id="speaker-notes">
["What I say on slide 1.", "What I say on slide 2."]
</script>
```

- Write these as things I will actually **say out loud**, not as bullet
  summaries of what is already on the slide.
- They are rendered as plain text at reading size. Markdown and HTML will show
  as literal characters, so do not use them. Line breaks *are* preserved, so
  use `\n` to separate beats within a long note.

## Time plan

A JSON array in `<head>`, minutes per slide, same order and count:

```html
<script type="application/json" id="deck-plan">
[1, 2, 2, 0.5]
</script>
```

Fractions are fine. The total must match the talk length I gave you. I can
retype any of these in the panel on the night, so treat them as a considered
opening bid rather than a guess.

## Design

- Design at exactly 1920×1080. It gets scaled to whatever screen it lands on.
- Inline all CSS in one `<style>` block. Use CSS custom properties for the
  palette, and pick one that suits the topic.
- Big type: headlines 90–200px, body 26–40px. It has to read from the back of
  a room.
- One idea per slide. Anything I would say out loud belongs in the speaker
  notes, not on the slide.
- **My panel also renders each slide as a live thumbnail about 300px wide.** A
  slide has to stay recognisable at that size, which means a clear headline and
  strong hierarchy. A slide that is a wall of even-weight text is useless to me
  as a thumbnail, and usually bad on a projector too.

## What not to do

These are the things that actually break the program:

- **No framework script tags.** Do not add `deck-stage.js`, `deck-audio.js` or
  `deck-agent.js`. My server mounts and injects them.
- **No external resources.** No CDN, no remote stylesheets, no hotlinked
  images, no analytics. I present on venue wifi or none at all. Inline
  everything, or embed images as `data:` URIs. System font stacks only, unless
  I explicitly give you a font to use.
- **Do not bind global arrow, space or letter keys.** The deck owns
  `←` `→` `Space` `PgUp` `PgDn` `Home` `End`, the digits, and `B` (blackout),
  `R` (restart) and `P` (panel). A `keydown` listener on `document` or `window`
  will fight my remote.
- **Do not use `location.hash` or `history`.** The deck keeps the current
  slide number in the fragment and will overwrite whatever you put there.
- **Avoid `position: fixed` inside a slide.** The deck lives inside a
  `transform: scale()` container, so a fixed element resolves against that
  container rather than the screen, which is rarely what you meant. Give the
  `<section>` `position: relative` and use `position: absolute` inside it.
- **Do not assume a slide stops when I leave it.** Slides are hidden, never
  unmounted, so form state and video positions survive navigation, but an
  autoplaying video or a `setInterval` also keeps running off-screen. If a
  slide starts something, stop it on the way out:

  ```html
  <script>
    document.querySelector('deck-stage').addEventListener('slidechange', (e) => {
      // e.detail.slide, e.detail.previousSlide, e.detail.index, e.detail.total
    });
  </script>
  ```

## Optional per-slide sound

Only if I ask for it:

```html
<section data-label="Applause" data-sound="assets/applause.mp3"
         data-sound-volume="0.6" data-sound-loop>
```

The clip plays when the slide arrives and stops when I move on.
`data-sound-volume` is the clip's own level; my panel has a master fader that
scales it, so set it relative to the other clips rather than to "loud enough".
Any `<video>` in a slide follows the same master fader.

## Before you finish

- Confirm that the slide count, the `#speaker-notes` count and the
  `#deck-plan` count are all the same number, and tell me what that number is.
- Tell me the plan total, and flag it if it does not match the talk length I
  asked for.
- Tell me if any `data-label` ran past ~25 characters, and what you shortened
  it to.
