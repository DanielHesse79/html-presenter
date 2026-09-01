/**
 * presenter.js — second-screen speaker notes for <deck-stage>.
 *
 * Drop this next to deck-stage.js and add one tag to your deck:
 *
 *   <script src="deck-stage.js"></script>
 *   <script src="presenter.js"></script>
 *
 * Press P (or N) in the deck to open the presenter window, then drag it to
 * your second screen. Slide changes sync both ways.
 *
 * Notes live in the deck as a JSON array, one entry per slide:
 *
 *   <script type="application/json" id="speaker-notes">
 *   ["Note for slide 1", "Note for slide 2", ...]
 *   </script>
 *
 * ── Why BroadcastChannel ────────────────────────────────────────────────
 * An earlier version chained window.opener + postMessage + a 250 ms poll.
 * That breaks the moment either window reloads, and needs the presenter to
 * reach into the deck's DOM across windows. BroadcastChannel is built for
 * exactly this: same-origin, many-to-many, no handle to the other window.
 * Either side can reload, or be opened straight from its URL, and they find
 * each other again on the next heartbeat.
 *
 * ── Requires a real origin ──────────────────────────────────────────────
 * Browsers give every file:// URL its own opaque origin, so two windows on
 * the same file never share a channel. Serve the folder over http://
 * instead — `python tools/serve.py` does it in one command.
 *
 * Config via attributes on the <script> tag:
 *   data-channel="deck-stage"     channel name (change to isolate two decks)
 *   data-presenter="presenter.html"  path to the presenter window
 *   data-target="7:00"            elapsed-time goal shown in the presenter
 */
(() => {
  const script = document.currentScript;
  const cfg = (name, fallback) =>
    (script && script.dataset[name]) || fallback;

  const CHANNEL = cfg('channel', 'deck-stage');
  const PRESENTER_URL = cfg('presenter', 'presenter.html');
  const TARGET = cfg('target', '');
  const HEARTBEAT_MS = 2000;

  if (typeof BroadcastChannel === 'undefined') {
    console.warn(
      '[presenter] BroadcastChannel unavailable — presenter view disabled. ' +
      'Serve the deck over http:// rather than opening the file directly.'
    );
    return;
  }

  const bus = new BroadcastChannel(CHANNEL);
  let presenterWindow = null;

  const deck = () => document.querySelector('deck-stage');

  /** Current deck position, or null if the deck hasn't mounted yet. */
  function state() {
    const d = deck();
    if (!d) return null;
    const index = typeof d.index === 'number' ? d.index : 0;
    const slide = d.children[index] || null;
    const label = slide
      ? (slide.dataset.screenLabel || slide.dataset.label || '')
      : '';
    return {
      type: 'state',
      index,
      total: d.length || 0,
      label,
      // Without the hash: deck-stage rewrites it to #<slide> on every move, and
      // a URL that changes each slide would make the presenter re-fetch notes
      // on every navigation.
      deckUrl: location.origin + location.pathname + location.search,
      target: TARGET,
    };
  }

  function publish() {
    const s = state();
    if (s) bus.postMessage(s);
  }

  bus.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) return;

    // A presenter window just booted (or reloaded) and wants the position.
    if (msg.type === 'hello') {
      publish();
      return;
    }

    // The presenter is driving navigation.
    if (msg.type === 'nav') {
      const d = deck();
      if (!d) return;
      if (msg.dir === 'next') d.next();
      else if (msg.dir === 'prev') d.prev();
      else if (msg.dir === 'first') d.reset();
      else if (typeof msg.index === 'number') d.goTo(msg.index);
    }
  });

  // deck-stage dispatches `slidechange` on itself; it bubbles and composes.
  document.addEventListener('slidechange', publish);

  // Heartbeat: lets a presenter opened later (or after a deck reload) catch up
  // without either side holding a reference to the other.
  setInterval(publish, HEARTBEAT_MS);

  function openPresenter() {
    if (presenterWindow && !presenterWindow.closed) {
      presenterWindow.focus();
      publish();
      return;
    }
    const url = PRESENTER_URL +
      '?deck=' + encodeURIComponent(location.pathname + location.search) +
      '&channel=' + encodeURIComponent(CHANNEL);
    const w = Math.min(1000, Math.floor(screen.availWidth * 0.6));
    const h = Math.min(920, Math.floor(screen.availHeight * 0.85));
    presenterWindow = window.open(
      url, 'deck-presenter',
      `width=${w},height=${h},left=40,top=40,resizable=yes,scrollbars=yes`
    );
    if (!presenterWindow) {
      console.warn('[presenter] Popup blocked — allow popups for this origin.');
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      openPresenter();
    }
  });

  // Expose for custom UI (a toolbar button, say).
  window.openPresenterView = openPresenter;

  publish();
})();
