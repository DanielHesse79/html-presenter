/**
 * main.js — the operator panel.
 *
 * This window is the console. It holds the clock, the budgets, the volume and
 * the notes; the projector window holds nothing but the slides. That split is
 * why the panel can be opened before the deck, survive the deck reloading, and
 * keep running while the projector window is closed and reopened.
 *
 * What comes from where:
 *   deck file (over HTTP)   slides, labels, notes, the authored plan
 *   channel (from the deck) which slide is up, whether audio is sounding
 *   this window             clock, edited budgets, volume, blackout, measured run
 *
 * Nothing here writes to the deck file. The measured run is offered as text to
 * copy, and that is as close to editing as this program gets.
 */

import { createTransport } from '../core/transport.js';
import {
  DEFAULT_CHANNEL, STATE,
  helloMessage, navMessage, volumeMessage, muteMessage, blackoutMessage,
} from '../core/protocol.js';
import { loadDeckDocument } from '../core/deck-doc.js';
import { createSession } from '../core/session.js';
import { clock, magnitude } from '../core/format.js';
import { createPreview } from './preview.js';
import { createRundown } from './rundown.js';

const TICK_MS = 250;
const HELLO_MS = 1500;      // keep announcing until the deck answers
const STALE_MS = 6000;      // no heartbeat for this long means disconnected
const RELOAD_FLOOR_MS = 5000;
const VOLUME_GRACE_MS = 800; // ignore the deck's echo while the slider is moving

const el = (id) => document.getElementById(id);
const ui = {
  banner: el('banner'), dot: el('dot'), title: el('deck-title'),
  cur: el('cur'), total: el('total'), openProjector: el('open-projector'),
  rows: el('rundown-rows'), planTotal: el('plan-total'),
  restorePlan: el('restore-plan'), copyPlan: el('copy-plan'),
  elapsed: el('elapsed'), planOf: el('plan-of'), pace: el('pace'),
  paused: el('paused-badge'), edited: el('edited-badge'),
  slideFill: el('slide-fill'), slideSpent: el('slide-spent'),
  slideBudget: el('slide-budget'), planLeft: el('plan-left'),
  label: el('slide-label'), note: el('note'),
  nextNote: el('next-note'), nextLabel: el('next-label'), nextText: el('next-text'),
  previewNow: el('preview-now'), previewNext: el('preview-next'),
  prev: el('prev'), next: el('next'),
  pause: el('pause'), reset: el('reset'), blackout: el('blackout'),
  mixer: el('mixer'), mute: el('mute'), volume: el('volume'),
  volRead: el('vol-read'), audioLed: el('audio-led'),
  fullscreen: el('fullscreen'),
};

const params = new URLSearchParams(location.search);
const CHANNEL = params.get('channel') || DEFAULT_CHANNEL;
const deckParam = params.get('deck');

let deckDoc = null;
let session = createSession({ slideCount: 0 });
let index = 0;
let live = null;       // null so the first setLive() always paints
let lastSeen = 0;
let pushedOnConnect = false;
let lastReloadAt = 0;
let volumeTouchedAt = 0;
let projectorWindow = null;

const previewNow = createPreview(ui.previewNow);
const previewNext = createPreview(ui.previewNext);
const rundown = createRundown(ui.rows, {
  onJump: (i) => bus.send(navMessage(null, i)),
  onBudget: (i, value) => {
    session.setBudgetMinutes(i, value);
    session.save();
    // Feed the clamped value back so Escape reverts to what was actually
    // stored, not to what was last loaded from the deck.
    rundown.setBudgets(session.state.budgets);
    renderPlanTotals();
  },
});

const bus = createTransport(CHANNEL);

// ── Boot ─────────────────────────────────────────────────────────────────

if (!bus.ok) {
  banner('No BroadcastChannel here. Serve the deck over http:// rather than ' +
         'opening it as a file, then reload this panel.');
}

if (!deckParam) {
  banner('No deck given. Start the panel with: python tools/serve.py my-deck.html');
  ui.title.textContent = 'No deck';
  ui.openProjector.disabled = true;
} else {
  loadDeck(deckParam).catch((err) => {
    console.error('[panel] could not load the deck:', err);
    banner('Could not read the deck: ' + err.message);
  });
}

async function loadDeck(url) {
  lastReloadAt = Date.now();
  const doc = await loadDeckDocument(url);
  const first = !deckDoc;
  deckDoc = doc;

  ui.title.textContent = doc.title || doc.url.split('/').pop();
  ui.total.textContent = String(doc.slides.length);

  session.setKey(doc.url);
  session.setSlideCount(doc.slides.length);
  session.setAuthoredPlan(doc.plan);
  // Budgets typed on a previous run beat the file; the file only fills in when
  // there is nothing stored for this deck yet.
  if (!session.restore()) session.restoreAuthoredPlan();

  rundown.build(doc.slides);
  rundown.setBudgets(session.state.budgets);

  if (first) {
    previewNow.setDeck(doc.url, doc.design);
    previewNext.setDeck(doc.url, doc.design);
    ui.volume.value = String(Math.round(session.state.volume * 100));
    syncMixer();
  }

  renderPlanTotals();
  renderPosition();
}

// ── Channel ──────────────────────────────────────────────────────────────

bus.on(STATE, (msg) => {
  lastSeen = Date.now();
  setLive(true);

  // The panel is the source of truth for volume and blackout, so a deck that
  // has just connected (or reconnected after a reload) gets told what it
  // should be doing rather than being trusted to remember.
  if (!pushedOnConnect) {
    pushMixer();
    bus.send(blackoutMessage(session.state.blackout));
    pushedOnConnect = true;
  }

  if (typeof msg.index === 'number' && msg.index !== index) {
    index = msg.index;
    session.setIndex(index);
    renderPosition();
    rundown.scrollTo(index);
  }

  if (msg.audio) {
    ui.audioLed.toggleAttribute('data-playing', !!msg.audio.playing);
    if (Date.now() - volumeTouchedAt > VOLUME_GRACE_MS) {
      session.setVolume(msg.audio.volume);
      session.setMuted(msg.audio.muted);
      ui.volume.value = String(Math.round(session.state.volume * 100));
      syncMixer();
    }
  }

  if (typeof msg.blackout === 'boolean') {
    session.setBlackout(msg.blackout);
    syncBlackout();
  }

  // A slide count that no longer matches means the deck was edited and
  // reloaded. Re-read it so the notes and the rundown catch up.
  if (deckDoc && typeof msg.total === 'number' && msg.total > 0
      && msg.total !== deckDoc.slides.length
      && Date.now() - lastReloadAt > RELOAD_FLOOR_MS) {
    loadDeck(deckDoc.url).catch(() => {});
  }
});

const sayHello = () => bus.send(helloMessage());
sayHello();
setInterval(() => { if (Date.now() - lastSeen > HELLO_MS) sayHello(); }, HELLO_MS);
setInterval(() => setLive(Date.now() - lastSeen < STALE_MS), 1000);

function setLive(now) {
  if (now === live) return;
  live = now;
  ui.dot.toggleAttribute('data-live', now);
  if (now) {
    clearBanner();
  } else {
    pushedOnConnect = false;
    if (bus.ok && deckParam) {
      banner('No projector window is reporting in. Press Open projector, or ' +
             'check that the deck window is still open.');
    }
  }
}

function banner(text) { ui.banner.textContent = text; ui.banner.hidden = false; }
function clearBanner() { ui.banner.hidden = true; }

// ── Rendering ────────────────────────────────────────────────────────────

function renderPosition() {
  const slides = deckDoc ? deckDoc.slides : [];
  const notes = deckDoc ? deckDoc.notes : [];
  ui.cur.textContent = slides.length ? String(index + 1) : '—';

  const slide = slides[index];
  ui.label.textContent = slide ? slide.label : '';

  const note = notes[index];
  ui.note.textContent = note || '(no note for this slide)';
  ui.note.classList.toggle('empty', !note);

  const upcoming = notes[index + 1];
  if (upcoming && index + 1 < slides.length) {
    ui.nextText.textContent = upcoming;
    ui.nextLabel.textContent = slides[index + 1]
      ? slides[index + 1].label
      : 'slide ' + (index + 2);
    ui.nextNote.hidden = false;
  } else {
    ui.nextNote.hidden = true;
  }

  previewNow.show(index, slides.length);
  previewNext.show(index + 1, slides.length);
}

function renderPlanTotals() {
  const total = session.planTotalSeconds();
  ui.planTotal.textContent = total > 0 ? clock(total) : '—';
  ui.planOf.textContent = total > 0 ? 'of ' + clock(total) + ' planned' : 'no plan set';

  const authored = session.state.authored;
  const budgets = session.state.budgets;
  const edited = !!authored && budgets.some((m, i) => (authored[i] || 0) !== (m || 0));
  ui.edited.hidden = !edited;
  ui.restorePlan.disabled = !authored;
}

function renderTimer() {
  ui.elapsed.textContent = clock(session.elapsedSeconds);
  document.body.toggleAttribute('data-paused', session.state.paused);
  ui.paused.hidden = !session.state.paused;
  ui.pause.textContent = session.state.paused ? 'Resume' : 'Pause';
  ui.pause.toggleAttribute('data-on', session.state.paused);
  ui.copyPlan.disabled = !session.hasRecording();

  const budget = session.budgetSeconds(index);
  const spent = session.visitSeconds;
  ui.slideSpent.textContent = clock(spent);
  ui.slideBudget.textContent = clock(budget);
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  ui.slideFill.style.width = pct + '%';
  ui.slideFill.toggleAttribute('data-over', budget > 0 && spent > budget);

  if (session.hasPlan()) {
    ui.planLeft.textContent = clock(session.remainingInPlanSeconds()) + ' left in plan';
    const { state, drift } = session.pace();
    ui.pace.hidden = false;
    ui.pace.dataset.state = state;
    ui.pace.textContent = state === 'on'
      ? 'on plan'
      : magnitude(drift) + (state === 'behind' ? ' behind' : ' ahead');
  } else {
    ui.planLeft.textContent = '';
    ui.pace.hidden = true;
  }
}

function syncMixer() {
  const pct = Math.round(session.state.volume * 100);
  ui.volRead.textContent = session.state.muted ? 'off' : String(pct);
  ui.mixer.toggleAttribute('data-muted', session.state.muted);
  ui.mute.toggleAttribute('data-on', session.state.muted);
  ui.mute.textContent = session.state.muted ? 'Unmute' : 'Mute';
}

function syncBlackout() {
  const on = session.state.blackout;
  document.body.toggleAttribute('data-blackout', on);
  ui.blackout.toggleAttribute('data-on', on);
  ui.blackout.textContent = on ? 'Restore' : 'Black';
  previewNow.setBlackout(on);
}

setInterval(() => {
  session.tick();
  renderTimer();
  rundown.update(session, index);
}, TICK_MS);

// ── Controls ─────────────────────────────────────────────────────────────

function pushMixer() {
  bus.send(volumeMessage(session.state.volume));
  bus.send(muteMessage(session.state.muted));
}

function setBlackout(on) {
  session.setBlackout(on);
  syncBlackout();
  bus.send(blackoutMessage(on));
}

function openProjector() {
  if (projectorWindow && !projectorWindow.closed) {
    projectorWindow.focus();
    return;
  }
  if (!deckDoc) return;
  const u = new URL(deckDoc.url);
  u.searchParams.set('deck-channel', CHANNEL);
  const w = Math.min(1280, Math.floor(screen.availWidth * 0.6));
  const h = Math.round(w * 9 / 16) + 40;
  projectorWindow = window.open(
    u.href, 'deck-projector',
    `width=${w},height=${h},left=60,top=60,resizable=yes,scrollbars=no`
  );
  if (!projectorWindow) {
    banner('The projector window was blocked. Allow popups for this address, ' +
           'then press Open projector again.');
    return;
  }
  // Drag it to the second screen and press F11. The Window Management API
  // could place and fullscreen it directly, but it needs a permission prompt
  // that is worse than one keystroke on the night.
  projectorWindow.focus();
}

ui.openProjector.addEventListener('click', openProjector);
ui.prev.addEventListener('click', () => bus.send(navMessage('prev')));
ui.next.addEventListener('click', () => bus.send(navMessage('next')));
ui.pause.addEventListener('click', () => { session.togglePause(); renderTimer(); });
ui.reset.addEventListener('click', () => { session.resetClock(); renderTimer(); });
ui.blackout.addEventListener('click', () => setBlackout(!session.state.blackout));

ui.mute.addEventListener('click', () => {
  session.setMuted(!session.state.muted);
  syncMixer();
  bus.send(muteMessage(session.state.muted));
});

ui.volume.addEventListener('input', () => {
  volumeTouchedAt = Date.now();
  session.setVolume(Number(ui.volume.value) / 100);
  if (session.state.muted) { session.setMuted(false); bus.send(muteMessage(false)); }
  syncMixer();
  bus.send(volumeMessage(session.state.volume));
});

ui.restorePlan.addEventListener('click', () => {
  session.restoreAuthoredPlan();
  session.save();
  rundown.setBudgets(session.state.budgets);
  renderPlanTotals();
});

ui.copyPlan.addEventListener('click', async () => {
  const text = JSON.stringify(session.planFromActuals());
  const original = ui.copyPlan.textContent;
  try {
    await navigator.clipboard.writeText(text);
    ui.copyPlan.textContent = 'Copied';
  } catch (_) {
    // Clipboard access can be refused. Never answer that with a modal dialog:
    // a prompt() freezes the panel until someone dismisses it, which is the
    // last thing you want two minutes into a talk. Show it instead.
    banner('Copy was blocked. Measured plan: ' + text);
    setTimeout(clearBanner, 20000);
    ui.copyPlan.textContent = original;
    return;
  }
  setTimeout(() => { ui.copyPlan.textContent = original; }, 1400);
});

ui.fullscreen.addEventListener('click', toggleFullscreen);
function toggleFullscreen() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen();
  else document.exitFullscreen();
}

// ── Keyboard ─────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

  switch (e.key) {
    case 'ArrowRight': case 'PageDown': case ' ':
      e.preventDefault(); bus.send(navMessage('next')); break;
    case 'ArrowLeft': case 'PageUp':
      e.preventDefault(); bus.send(navMessage('prev')); break;
    case 'Home':
      e.preventDefault(); bus.send(navMessage('first')); break;
    case 'End':
      e.preventDefault(); bus.send(navMessage('last')); break;
    case 'p': case 'P':
      e.preventDefault(); session.togglePause(); renderTimer(); break;
    case 'b': case 'B':
      e.preventDefault(); setBlackout(!session.state.blackout); break;
    case 'm': case 'M':
      e.preventDefault(); ui.mute.click(); break;
    case 'r': case 'R':
      e.preventDefault(); session.resetClock(); renderTimer(); break;
    case 'f': case 'F':
      e.preventDefault(); toggleFullscreen(); break;
    default:
      break;
  }
});

// A talk that is still running should not be closed by a stray Ctrl+W.
window.addEventListener('beforeunload', (e) => {
  if (session.elapsedSeconds > 30 && !session.state.paused) {
    e.preventDefault();
    e.returnValue = '';
  }
});

setLive(false);
renderTimer();
syncMixer();
syncBlackout();
