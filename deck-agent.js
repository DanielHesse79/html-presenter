/**
 * deck-agent.js — the deck side of the operator link.
 *
 * Runs in the projector window. Reports where the deck is, and carries out
 * what the operator panel asks for: navigate, set the master volume, mute,
 * black out the projector.
 *
 * This supersedes presenter.js, which only ever published position. That file
 * is still shipped and still works, for decks that wire it up by hand; a deck
 * that loads it is left alone by the server's injection so the two never end
 * up publishing on the same channel at once.
 *
 * Wiring, if you are not using tools/serve.py:
 *
 *   <script src="deck-stage.js"></script>
 *   <script src="deck-audio.js"></script>
 *   <script type="module" src="deck-agent.js" data-panel="panel.html"></script>
 *
 * Config, in precedence order:
 *   ?deck-channel=NAME in the deck URL   (how the panel isolates two decks)
 *   ?deck-fullscreen     set by the panel when it placed this window itself
 *   data-channel / data-panel / data-target on the script tag
 *   defaults: channel "deck-stage", panel.html beside this file, no target
 *
 * ── Preview mode ────────────────────────────────────────────────────────
 * The panel renders live thumbnails by loading the deck into hidden iframes.
 * Those iframes get the framework injected too, so without a guard every
 * preview would be a second publisher on the channel fighting the real deck.
 * A `deck-preview` parameter in the URL makes this file do nothing at all.
 */

import { createTransport } from './core/transport.js';
import {
  DEFAULT_CHANNEL, STATE, HELLO, NAV, VOLUME, MUTE, BLACKOUT, FULLSCREEN,
  stateMessage,
} from './core/protocol.js';

const HEARTBEAT_MS = 2000;

const params = new URLSearchParams(location.search);

// A preview iframe is a passenger, never a publisher.
if (!params.has('deck-preview')) {
  boot();
}

function boot() {
  // Module scripts do not set document.currentScript, so the tag has to be
  // found by src. Absent one (someone bundled this), the defaults hold.
  const tag = document.querySelector('script[src*="deck-agent.js"]');
  const data = (tag && tag.dataset) || {};

  const CHANNEL = params.get('deck-channel') || data.channel || DEFAULT_CHANNEL;
  const PANEL_URL = data.panel || new URL('panel.html', import.meta.url).href;
  const TARGET = data.target || '';

  const bus = createTransport(CHANNEL);
  const deck = () => document.querySelector('deck-stage');
  let panelWindow = null;

  // ── Publishing ─────────────────────────────────────────────────────────

  function audioState() {
    const a = window.deckAudio;
    if (!a) return null;
    return { volume: a.masterVolume, muted: a.muted, playing: a.playing };
  }

  function publish() {
    const d = deck();
    if (!d) return;
    const index = typeof d.index === 'number' ? d.index : 0;
    const slide = d.children[index] || null;
    bus.send(stateMessage({
      index,
      total: d.length || 0,
      label: slide ? (slide.dataset.screenLabel || slide.dataset.label || '') : '',
      // Without the fragment: deck-stage rewrites #<slide> on every move, and a
      // URL that changed each slide would make the panel re-fetch the document
      // on every navigation.
      deckUrl: location.origin + location.pathname + location.search,
      target: TARGET,
      audio: audioState(),
      blackout: !!d.blackout,
    }));
  }

  document.addEventListener('slidechange', publish);
  document.addEventListener('blackoutchange', publish);
  // Lets a panel opened later, or one that reloaded, catch up without either
  // side holding a reference to the other.
  setInterval(publish, HEARTBEAT_MS);

  // ── Commands ───────────────────────────────────────────────────────────

  bus.on(HELLO, publish);

  bus.on(NAV, (msg) => {
    const d = deck();
    if (!d) return;
    if (typeof msg.index === 'number') d.goTo(msg.index);
    else if (msg.dir === 'next') d.next();
    else if (msg.dir === 'prev') d.prev();
    else if (msg.dir === 'first') d.reset();
    else if (msg.dir === 'last') d.goTo(d.length - 1);
  });

  bus.on(VOLUME, (msg) => {
    if (window.deckAudio) window.deckAudio.setMasterVolume(msg.value);
    publish();
  });

  bus.on(MUTE, (msg) => {
    if (window.deckAudio) window.deckAudio.setMuted(msg.on);
    publish();
  });

  bus.on(BLACKOUT, (msg) => {
    const d = deck();
    if (d) d.blackout = msg.on;      // deck-stage emits blackoutchange, which publishes
  });


  // -- Filling the screen -------------------------------------------------
  //
  // The panel can place this window on the projector, but only this document
  // can take it fullscreen, and only with user activation. A window opened
  // from a click usually still carries that activation, so the first attempt
  // often succeeds. When it does not, the request is armed on the next click
  // or keypress in here rather than being dropped: one keystroke is a far
  // better failure mode than a browser toolbar across the top of a talk.

  let armed = null;

  function disarm() {
    if (!armed) return;
    document.removeEventListener('pointerdown', armed);
    document.removeEventListener('keydown', armed);
    armed = null;
  }

  function armForGesture() {
    if (armed) return;
    armed = () => { disarm(); enterFullscreen(); };
    document.addEventListener('pointerdown', armed);
    document.addEventListener('keydown', armed);
  }

  function enterFullscreen() {
    if (document.fullscreenElement) return;
    const el = document.documentElement;
    if (!el.requestFullscreen) return;
    let p;
    try { p = el.requestFullscreen(); } catch (_) { armForGesture(); return; }
    if (p && p.catch) p.catch(() => armForGesture());
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else enterFullscreen();
  }

  function exitFullscreen() {
    // Disarm first. A request still waiting on the next click would fire
    // mid-demo and yank the deck back over whatever you stepped away to
    // show, which is the one thing this must never do.
    disarm();
    if (document.fullscreenElement) {
      try { document.exitFullscreen(); } catch (_) { /* already out */ }
    }
  }

  bus.on(FULLSCREEN, (msg) => {
    if (msg && msg.on === false) exitFullscreen();
    else enterFullscreen();
  });

  // The panel adds deck-fullscreen when it has placed this window itself.
  if (params.has('deck-fullscreen')) {
    if (document.readyState === 'complete') enterFullscreen();
    else window.addEventListener('load', enterFullscreen, { once: true });
  }

  // ── Opening the panel from the deck ────────────────────────────────────
  // The normal flow is the other way round: you start the panel and it opens
  // the projector. This is the fallback for when you already have a deck open.

  function openPanel() {
    if (panelWindow && !panelWindow.closed) {
      panelWindow.focus();
      publish();
      return;
    }
    const url = PANEL_URL +
      '?deck=' + encodeURIComponent(location.pathname + location.search) +
      '&channel=' + encodeURIComponent(CHANNEL);
    const w = Math.min(1440, Math.floor(screen.availWidth * 0.7));
    const h = Math.min(980, Math.floor(screen.availHeight * 0.9));
    panelWindow = window.open(
      url, 'deck-operator-panel',
      `width=${w},height=${h},left=40,top=40,resizable=yes,scrollbars=yes`
    );
    if (!panelWindow) {
      console.warn('[deck-agent] Popup blocked — allow popups for this origin.');
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openPanel();
    }
    if (e.key === 'f' || e.key === 'F') {
      e.preventDefault();
      toggleFullscreen();
    }
  });

  window.openOperatorPanel = openPanel;

  publish();
}
