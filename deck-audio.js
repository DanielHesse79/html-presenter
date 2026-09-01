/**
 * deck-audio.js — optional per-slide sound for <deck-stage>.
 *
 * Add a `data-sound` attribute to any slide and it plays when that slide
 * becomes active, then stops when you navigate away:
 *
 *   <section data-label="Wake up" data-sound="assets/clock-ticking.mp3">
 *   <section data-label="Coal"    data-sound="assets/steam-train.mp3"
 *            data-sound-volume="0.6" data-sound-loop>
 *
 * Load it after deck-stage.js:
 *
 *   <script src="deck-stage.js"></script>
 *   <script src="deck-audio.js"></script>
 *
 * ── Autoplay ────────────────────────────────────────────────────────────
 * Browsers block audio until the user has interacted with the page. Since
 * you reach a slide by pressing a key or clicking, that's usually already
 * satisfied — but a deck that deep-links straight onto a sound slide will
 * stay silent until the first keypress. Blocked playback fails quietly;
 * it never interrupts the talk with a dialog or a console error.
 */
(() => {
  const clips = new Map();   // slide element → HTMLAudioElement
  let playing = null;

  function prepare(deck) {
    deck.querySelectorAll('[data-sound]').forEach((slide) => {
      if (clips.has(slide)) return;
      const audio = new Audio(slide.dataset.sound);
      audio.preload = 'auto';
      audio.loop = slide.hasAttribute('data-sound-loop');
      const vol = parseFloat(slide.dataset.soundVolume);
      if (!Number.isNaN(vol)) audio.volume = Math.min(1, Math.max(0, vol));
      clips.set(slide, audio);
    });
  }

  function stop(audio) {
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch (_) { /* not seekable yet */ }
  }

  function onSlideChange(e) {
    const slide = e.detail && e.detail.slide;
    const next = slide ? clips.get(slide) : null;

    if (playing && playing !== next) stop(playing);
    playing = next || null;
    if (!next) return;

    try { next.currentTime = 0; } catch (_) { /* not seekable yet */ }
    const p = next.play();
    if (p && p.catch) {
      p.catch(() => { /* autoplay blocked — stay silent rather than throw */ });
    }
  }

  function init() {
    const deck = document.querySelector('deck-stage');
    if (!deck) return;
    prepare(deck);
    deck.addEventListener('slidechange', onSlideChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
