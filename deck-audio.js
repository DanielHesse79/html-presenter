/**
 * deck-audio.js — per-slide sound for <deck-stage>, with a master mixer.
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
 * ── The master mixer ────────────────────────────────────────────────────
 * The operator panel runs on the other screen and has to be able to pull the
 * sound down without touching the deck. This file therefore owns a master
 * volume and mute that multiply into every clip, and it exposes them on
 * `window.deckAudio` for deck-agent.js to drive over the channel.
 *
 * The per-slide `data-sound-volume` stays the clip's *authored* level. Master
 * scales it rather than replacing it, so pulling the master to 50% keeps the
 * quiet clip quiet relative to the loud one. Video elements inside slides are
 * swept on every slide change and follow the same master, since from the back
 * of the room there is no such thing as "deck audio" and "video audio".
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
  let deckEl = null;

  let master = 1;
  // Preview iframes in the operator panel load this same deck. They must
  // never make a sound: the room would hear a clip before the slide it
  // belongs to has been shown.
  let muted = new URLSearchParams(location.search).has('deck-preview');

  const authored = (slide) => {
    const vol = parseFloat(slide.dataset.soundVolume);
    return Number.isNaN(vol) ? 1 : Math.min(1, Math.max(0, vol));
  };

  function prepare(deck) {
    deck.querySelectorAll('[data-sound]').forEach((slide) => {
      if (clips.has(slide)) return;
      const audio = new Audio(slide.dataset.sound);
      audio.preload = 'auto';
      audio.loop = slide.hasAttribute('data-sound-loop');
      audio.volume = authored(slide) * master;
      audio.muted = muted;
      clips.set(slide, audio);
    });
  }

  function stop(audio) {
    if (!audio) return;
    audio.pause();
    try { audio.currentTime = 0; } catch (_) { /* not seekable yet */ }
  }

  /** Every media element the master should reach: prepared clips plus any
   *  <video>/<audio> the slide author put in the markup themselves. */
  function allMedia() {
    const list = Array.from(clips.values());
    if (deckEl) {
      deckEl.querySelectorAll('video, audio').forEach((el) => list.push(el));
    }
    return list;
  }

  function applyMaster() {
    for (const [slide, audio] of clips) audio.volume = authored(slide) * master;
    if (deckEl) {
      deckEl.querySelectorAll('video, audio').forEach((el) => {
        if (el.dataset.deckBaseVolume == null) {
          el.dataset.deckBaseVolume = String(el.volume);
        }
        el.volume = Number(el.dataset.deckBaseVolume) * master;
      });
    }
    for (const el of allMedia()) el.muted = muted;
  }

  function onSlideChange(e) {
    const slide = e.detail && e.detail.slide;
    const next = slide ? clips.get(slide) : null;

    if (playing && playing !== next) stop(playing);
    playing = next || null;
    // A newly revealed slide may carry its own <video>; sweep again so it
    // starts out at the master level rather than full blast.
    applyMaster();
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
    deckEl = deck;
    prepare(deck);
    applyMaster();
    deck.addEventListener('slidechange', onSlideChange);
  }

  // Control surface for deck-agent.js. Present even before the deck mounts,
  // so a volume command that arrives early is not dropped.
  window.deckAudio = {
    setMasterVolume(v) {
      const n = Number(v);
      master = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
      applyMaster();
    },
    setMuted(on) {
      muted = !!on;
      applyMaster();
    },
    get masterVolume() { return master; },
    get muted() { return muted; },
    /** True while a per-slide clip is actually sounding. */
    get playing() { return !!(playing && !playing.paused && !playing.ended); },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
