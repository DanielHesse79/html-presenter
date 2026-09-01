/**
 * protocol.js — the wire format between a deck window and the operator panel.
 *
 * Kept deliberately small and in one place: this is the seam the whole
 * project turns on. Today it rides a BroadcastChannel between two browser
 * windows. In a packaged desktop app it may ride IPC instead, and nothing
 * outside core/transport.js should have to notice.
 *
 * Direction of travel:
 *
 *   deck  -> panel   STATE      position, audio and blackout status
 *   panel -> deck    HELLO      "I just booted, tell me where you are"
 *   panel -> deck    NAV        drive the deck
 *   panel -> deck    VOLUME     master volume, 0..1
 *   panel -> deck    MUTE       master mute
 *   panel -> deck    BLACKOUT   cut the projector to black
 *   panel -> deck    FULLSCREEN ask the projector to fill its screen
 *
 * Backwards compatibility: the STATE message keeps the exact field set the
 * legacy presenter.html reads (index, total, label, deckUrl, target), so a
 * deck running deck-agent.js still drives an old presenter window. New fields
 * are additive and optional.
 */

export const PROTOCOL_VERSION = 1;
export const DEFAULT_CHANNEL = 'deck-stage';

export const STATE = 'state';
export const HELLO = 'hello';
export const NAV = 'nav';
export const VOLUME = 'volume';
export const MUTE = 'mute';
export const BLACKOUT = 'blackout';
export const FULLSCREEN = 'fullscreen';

/** deck -> panel. `audio` and `blackout` are optional; a legacy deck omits them. */
export function stateMessage({
  index, total, label = '', deckUrl = '', target = '',
  audio = null, blackout = false,
}) {
  return {
    type: STATE, v: PROTOCOL_VERSION,
    index, total, label, deckUrl, target,
    audio, blackout,
  };
}

export function helloMessage() {
  return { type: HELLO, v: PROTOCOL_VERSION };
}

/** `dir` is 'next' | 'prev' | 'first' | 'last'; or pass an explicit index. */
export function navMessage(dir, index) {
  return typeof index === 'number'
    ? { type: NAV, v: PROTOCOL_VERSION, index }
    : { type: NAV, v: PROTOCOL_VERSION, dir };
}

export function volumeMessage(value) {
  return { type: VOLUME, v: PROTOCOL_VERSION, value: clamp01(value) };
}

export function muteMessage(on) {
  return { type: MUTE, v: PROTOCOL_VERSION, on: !!on };
}

export function blackoutMessage(on) {
  return { type: BLACKOUT, v: PROTOCOL_VERSION, on: !!on };
}

export function fullscreenMessage() {
  return { type: FULLSCREEN, v: PROTOCOL_VERSION };
}

export function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
