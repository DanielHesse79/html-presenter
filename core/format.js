/**
 * format.js — time rendering shared by the panel and the legacy presenter.
 *
 * Every number an operator reads mid-talk is tabular and fixed-width, so the
 * layout never jitters as digits change.
 */

const pad = (n) => String(n).padStart(2, '0');

/** mm:ss, or h:mm:ss once a talk runs past the hour. */
export function clock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Magnitude only — the caller supplies the "ahead"/"behind" word. */
export function magnitude(seconds) {
  return clock(Math.abs(seconds));
}

/** Minutes as typed into a budget field: 1.5 rather than 1.50, 2 rather than 2.0. */
export function minutes(value) {
  const m = Number(value) || 0;
  return String(Math.round(m * 100) / 100);
}
