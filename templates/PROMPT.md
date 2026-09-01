# Building a deck with Claude

Paste the block below into Claude, then describe your talk. You get back a
single self-contained `.html` file you can present with:

```bash
python /path/to/deck-stage/tools/serve.py my-deck.html
```

---

Build me a slide deck as **one self-contained HTML file**, following this contract exactly.

**Structure**

```html
<deck-stage width="1920" height="1080">
  <section data-label="Short slide name"> …slide markup… </section>
  <section data-label="Next slide">       …slide markup… </section>
</deck-stage>
```

- Every slide is a direct `<section>` child of `<deck-stage>`.
- `data-label` is a short name shown in my presenter view — keep it under ~25 characters.
- Do **not** add `<script src="deck-stage.js">`, `presenter.js` or `deck-audio.js`. My server injects those.

**Speaker notes** — a JSON array in `<head>`, one entry per slide, same order, same count as the slides:

```html
<script type="application/json" id="speaker-notes">
["What I say on slide 1.", "What I say on slide 2."]
</script>
```

Write these as things I will actually *say* out loud, not as bullet summaries of the slide.

**Time plan** — a JSON array in `<head>`, minutes per slide, same order and count:

```html
<script type="application/json" id="deck-plan">
[1, 2, 2, 0.5]
</script>
```

Fractions are fine. The total should match the talk length I give you.

**Design**

- Design at exactly 1920×1080. It gets scaled to whatever screen it lands on.
- Inline all CSS in one `<style>` block. No external stylesheets, no CDN, no build step.
- System fonts only, unless I give you a Google Fonts link to use.
- Big type: headlines 90–200px, body 26–40px. It has to read from the back of a room.
- One idea per slide. Anything I would say out loud goes in the speaker notes, not on the slide.
- Pick a palette that suits the topic and use CSS custom properties for it.

**Optional per-slide sound** — `<section data-sound="assets/clip.mp3">`, with
`data-sound-loop` and `data-sound-volume="0.6"` if useful. Only if I ask.

**Before you finish**

- Check that slides, notes and plan are all the same length, and say what that number is.
- Tell me the plan total, and flag it if it does not match the talk length I asked for.
