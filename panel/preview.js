/**
 * preview.js — live thumbnails of the current and next slide.
 *
 * The thumbnail is the deck itself, loaded into an iframe at thumbnail size.
 * <deck-stage> already scales its canvas to fit whatever viewport it lands in
 * and letterboxes the remainder, so a 320px-wide iframe renders the real slide
 * with the real fonts and the real layout. Nothing has to be rasterised, and
 * the preview cannot drift from what the projector shows.
 *
 * Two guards keep a preview from behaving like a second deck:
 *
 *   - the `deck-preview` URL parameter, which deck-agent.js checks before it
 *     joins the channel and deck-audio.js checks before it makes a sound
 *   - the `preview` attribute on <deck-stage>, which hides the control pill
 *     and the mobile tap zones
 *
 * Navigation is a direct same-origin call into the iframe's own deck-stage
 * rather than a reload, so moving a slide costs nothing and never flickers.
 */

const PREVIEW_PARAM = 'deck-preview';
const READY_RETRIES = 40;      // ~40 frames, then give up quietly

export function createPreview(mount) {
  let iframe = null;
  let design = { width: 1920, height: 1080 };
  let wanted = 0;
  let ready = false;

  function stage() {
    try {
      const doc = iframe && iframe.contentDocument;
      return (doc && doc.querySelector('deck-stage')) || null;
    } catch (_) {
      return null;    // cross-origin, or the document was swapped mid-read
    }
  }

  /** The element may not be upgraded the instant `load` fires. */
  function whenReady(fn, tries = READY_RETRIES) {
    const el = stage();
    if (el && typeof el.goTo === 'function') { fn(el); return; }
    if (tries <= 0) return;
    requestAnimationFrame(() => whenReady(fn, tries - 1));
  }

  function srcFor(url, index) {
    const u = new URL(url, location.href);
    u.searchParams.set(PREVIEW_PARAM, '1');
    u.hash = String(index + 1);      // deck-stage reads #<1-based> on mount
    return u.href;
  }

  return {
    /** (Re)point the thumbnail at a deck. Safe to call again on reload. */
    setDeck(url, deckDesign) {
      if (deckDesign) design = deckDesign;
      mount.style.aspectRatio = design.width + ' / ' + design.height;
      ready = false;
      if (iframe) iframe.remove();
      iframe = document.createElement('iframe');
      iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.setAttribute('scrolling', 'no');
      iframe.addEventListener('load', () => {
        whenReady((el) => {
          el.setAttribute('preview', '');
          ready = true;
          el.goTo(wanted);
        });
      });
      iframe.src = srcFor(url, wanted);
      mount.appendChild(iframe);
    },

    /** Move the thumbnail. Out-of-range shows the end-of-deck placeholder. */
    show(index, total) {
      const empty = index < 0 || (total > 0 && index >= total);
      mount.classList.toggle('empty', empty);
      if (empty || !iframe) return;
      wanted = index;
      if (ready) whenReady((el) => el.goTo(index), 2);
    },

    setBlackout(on) {
      mount.toggleAttribute('data-blackout', !!on);
    },
  };
}
