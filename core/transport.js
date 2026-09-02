/**
 * transport.js — the one place that knows *how* messages cross windows.
 *
 * Everything above this file speaks protocol.js and calls send/on. Swapping
 * BroadcastChannel for Electron IPC, a WebSocket, or a Tauri event bus is a
 * change to this file alone.
 *
 * Why BroadcastChannel today: it is same-origin, many-to-many, and needs no
 * handle on the other window. Either side can reload, or be opened cold from
 * its own URL, and they find each other again on the next heartbeat. An
 * earlier version of this project chained window.opener + postMessage + a
 * poll, which broke the moment either window reloaded.
 *
 * Why it needs a real origin: browsers give every file:// URL its own opaque
 * origin, so two windows on the same file never share a channel. Serve over
 * http://localhost instead — tools/serve.py does it in one command.
 */

import { DEFAULT_CHANNEL } from './protocol.js';

/**
 * @returns {{
 *   ok: boolean,
 *   send: (msg: object) => void,
 *   on: (type: string, fn: (msg: object) => void) => () => void,
 *   close: () => void,
 * }}
 */
export function createTransport(channelName = DEFAULT_CHANNEL) {
  const handlers = new Map();   // type -> Set<fn>

  if (typeof BroadcastChannel === 'undefined') {
    console.warn(
      '[transport] BroadcastChannel unavailable. The operator panel needs the ' +
      'deck served over http:// rather than opened as a file:// URL.'
    );
    return {
      ok: false,
      send() {},
      on() { return () => {}; },
      close() {},
    };
  }

  const bus = new BroadcastChannel(channelName);

  bus.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg.type !== 'string') return;
    const set = handlers.get(msg.type);
    if (!set) return;
    for (const fn of set) {
      try { fn(msg); } catch (err) { console.error('[transport] handler threw:', err); }
    }
  });

  return {
    ok: true,

    send(msg) {
      try { bus.postMessage(msg); } catch (err) {
        console.warn('[transport] send failed:', err);
      }
    },

    /** Subscribe to one message type. Returns an unsubscribe function. */
    on(type, fn) {
      let set = handlers.get(type);
      if (!set) { set = new Set(); handlers.set(type, set); }
      set.add(fn);
      return () => set.delete(fn);
    },

    close() {
      handlers.clear();
      bus.close();
    },
  };
}
