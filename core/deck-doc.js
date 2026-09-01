/**
 * deck-doc.js — read a deck's authored content out of its HTML.
 *
 * The channel carries position only. Everything the panel shows *about* the
 * deck (notes, the suggested time plan, the slide roster, which slides carry
 * sound, the design size) is read straight from the deck document over HTTP.
 *
 * That split is deliberate. It means the panel needs no handle on the deck
 * window, works before the projector window has even been opened, and
 * survives either side reloading.
 *
 * Slide labels are derived with the same fallback chain deck-stage.js uses at
 * runtime (data-label, then an existing data-screen-label with its leading
 * number stripped, then the first heading, then "Slide"). Re-deriving them
 * here rather than reading them back from a live deck keeps the panel
 * independent of whether the deck window is open yet.
 */

const DEFAULT_DESIGN = { width: 1920, height: 1080 };

/**
 * @typedef {{
 *   url: string, title: string,
 *   notes: string[], plan: number[] | null,
 *   slides: {index:number,label:string,hasSound:boolean}[],
 *   design: {width:number,height:number},
 * }} DeckDoc
 */

/** Strip the fragment: deck-stage rewrites #<slide> on every move, so an
 *  unstripped URL looks new on each navigation and would re-fetch forever. */
export function canonicalDeckUrl(rawUrl, base = location.href) {
  return new URL(rawUrl, base).href.split('#')[0];
}

/** @returns {Promise<DeckDoc>} */
export async function loadDeckDocument(rawUrl, base = location.href) {
  const url = canonicalDeckUrl(rawUrl, base);
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return parseDeckDocument(await res.text(), url);
}

/** @returns {DeckDoc} */
export function parseDeckDocument(html, url = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    url,
    title: (doc.title || '').trim(),
    notes: readJsonArray(doc, 'speaker-notes', []),
    plan: readPlan(doc),
    slides: readSlides(doc),
    design: readDesign(doc),
  };
}

function readJsonArray(doc, id, fallback) {
  const tag = doc.getElementById(id);
  if (!tag) return fallback;
  try {
    const parsed = JSON.parse(tag.textContent || 'null');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (err) {
    console.warn('[deck-doc] #' + id + ' is not valid JSON:', err);
    return fallback;
  }
}

/** null means "this deck has no plan" — the panel then shows a plain clock
 *  until the operator types budgets in itself. */
function readPlan(doc) {
  const tag = doc.getElementById('deck-plan');
  if (!tag) return null;
  try {
    const parsed = JSON.parse(tag.textContent || 'null');
    const list = Array.isArray(parsed) ? parsed : (parsed && parsed.slides);
    if (!Array.isArray(list) || !list.length) return null;
    return list.map((m) => Math.max(0, Number(m) || 0));
  } catch (err) {
    console.warn('[deck-doc] #deck-plan is not valid JSON:', err);
    return null;
  }
}

function readSlides(doc) {
  const stage = doc.querySelector('deck-stage');
  if (!stage) return [];
  const children = Array.from(stage.children).filter((el) => {
    const tag = el.tagName;
    return tag !== 'TEMPLATE' && tag !== 'SCRIPT' && tag !== 'STYLE';
  });
  return children.map((el, i) => ({
    index: i,
    label: deriveLabel(el),
    hasSound: el.hasAttribute('data-sound'),
  }));
}

function deriveLabel(el) {
  let label = el.getAttribute('data-label');
  if (!label) {
    const existing = el.getAttribute('data-screen-label');
    if (existing) label = existing.replace(/^\s*\d+\s*/, '').trim() || existing;
  }
  if (!label) {
    const h = el.querySelector('h1, h2, h3, [data-title]');
    if (h) label = (h.textContent || '').trim().slice(0, 40);
  }
  return label || 'Slide';
}

function readDesign(doc) {
  const stage = doc.querySelector('deck-stage');
  if (!stage) return { ...DEFAULT_DESIGN };
  const width = parseInt(stage.getAttribute('width'), 10) || DEFAULT_DESIGN.width;
  const height = parseInt(stage.getAttribute('height'), 10) || DEFAULT_DESIGN.height;
  return { width, height };
}
