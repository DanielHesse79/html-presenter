/**
 * deck-audio.js — per-slide media for <deck-stage>, with a master mixer.
 *
 * Sound clips attached with `data-sound`, and any <video> the slide author
 * marks `data-deck-play`, both start when their slide arrives and stop when
 * you move on. The file is still called deck-audio.js because that is what
 * the served decks load; the mixer below is the reason video lives here too,
 * since it already owns every media element in the deck.
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
  let seenSlideChange = false;

  let master = 1;
  // Preview iframes in the operator panel load this same deck. They must
  // never make a sound: the room would hear a clip before the slide it
  // belongs to has been shown. They must not run video either, for the
  // same reason plus a duller one: a thumbnail playing a second copy of
  // the clip, a beat out of step with the projector, is worse than a
  // still frame.
  const isPreview = new URLSearchParams(location.search).has('deck-preview');
  let muted = isPreview;

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

  /** Video the author asked this file to run, within one slide. */
  const managedVideo = (slide) => (slide
    ? Array.from(slide.querySelectorAll('video[data-deck-play]'))
    : []);

  function prepareVideo(deck) {
    deck.querySelectorAll('video').forEach((v) => {
      // A video marked `autoplay` inside a hidden slide starts on page
      // load and is over before the slide is ever shown. Nobody means
      // that, so read autoplay as "play when this slide arrives", which
      // is what it was trying to say. Take the attribute off, or the
      // browser fires it before the first slidechange lands.
      if (v.hasAttribute('autoplay')) {
        v.removeAttribute('autoplay');
        v.setAttribute('data-deck-play', '');
      }
      // A plain <video> is left alone: the deck author may want a scrub
      // bar and their own position kept across navigation.
      if (v.hasAttribute('data-deck-play')) v.pause();
    });
  }

  function rewind(media) {
    try { media.currentTime = 0; } catch (_) { /* not seekable yet */ }
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
          el.dataset.deckBaseMuted = String(el.muted);
        }
        el.volume = Number(el.dataset.deckBaseVolume) * master;
      });
    }
    // The master silences more than the author asked for, never less. A
    // `muted` written on a video is usually load-bearing: it is what lets
    // the clip start at all under the browser's autoplay policy, so
    // clearing it here would stop the video rather than unmute it.
    for (const el of allMedia()) {
      el.muted = muted || el.dataset.deckBaseMuted === 'true';
    }
  }

  function onSlideChange(e) {
    seenSlideChange = true;
    // The slide being left takes its video back to the first frame, so a
    // clip you return to later starts again rather than resuming halfway
    // through, which is almost never what you want in front of a room.
    managedVideo(e.detail && e.detail.previousSlide).forEach((v) => {
      v.pause();
      rewind(v);
    });
    enter(e.detail && e.detail.slide);
  }

  /** Start whatever the arriving slide carries. */
  function enter(slide) {
    const next = slide ? clips.get(slide) : null;

    if (playing && playing !== next) stop(playing);
    playing = next || null;
    // A newly revealed slide may carry its own <video>; sweep again so it
    // starts out at the master level rather than full blast.
    applyMaster();

    if (!isPreview) {
      managedVideo(slide).forEach((v) => {
        rewind(v);
        const pv = v.play();
        // Blocked playback fails quietly, as everywhere else here. A dialog
        // or a thrown error mid-talk is worse than a still first frame.
        if (pv && pv.catch) pv.catch(() => {});
      });
    }

    if (!next) return;

    rewind(next);
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
    prepareVideo(deck);
    applyMaster();
    deck.addEventListener('slidechange', onSlideChange);

    // deck-stage fires its first slidechange while the slots are being
    // assigned, which can be before this file has attached the listener
    // above. A deck opened straight onto a media slide would then sit
    // there silent and still, which is exactly what happens when the
    // panel reloads the projector onto the slide you were already on.
    // Catch up by hand, but only if the event really was missed.
    if (!seenSlideChange) enter(deck.querySelector('[data-deck-active]'));
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
