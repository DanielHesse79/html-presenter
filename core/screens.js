/**
 * screens.js — find the projector.
 *
 * Chromium exposes the attached displays through `getScreenDetails()`, behind a
 * `window-management` permission. With it, opening the projector can put the
 * deck on the second screen at full size by itself, instead of asking someone
 * to drag a window across and press F11 while a room watches.
 *
 * The permission prompt is the cost, and it is worth it: the prompt appears
 * once per origin, the drag happens every single time.
 *
 * Everything here degrades. No API, permission refused, or only one display,
 * and the caller gets null and falls back to a normally-placed window. A
 * presenter tool must never depend on an optional browser capability.
 */

/** @typedef {{left:number, top:number, width:number, height:number, label:string}} Placement */

export function screensSupported() {
  return typeof window.getScreenDetails === 'function';
}

/**
 * Has the permission already been granted? Used to label the button honestly
 * without triggering a prompt.
 * @returns {Promise<'granted'|'denied'|'prompt'|'unknown'>}
 */
export async function permissionState() {
  if (!screensSupported()) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'window-management' });
    return status.state;
  } catch (_) {
    return 'unknown';
  }
}

/**
 * The screen to present on, or null to let the browser place the window.
 *
 * "The projector" is the display that is not the one this panel is on. Falling
 * back to isPrimary handles the case where the panel has already been moved to
 * the external screen: whatever the operator is looking at is not the projector.
 *
 * @param {boolean} allowPrompt pass false to stay silent when not yet granted
 * @returns {Promise<Placement|null>}
 */
export async function findProjectorScreen(allowPrompt = true) {
  if (!screensSupported()) return null;
  if (!allowPrompt && (await permissionState()) !== 'granted') return null;

  let details;
  try {
    details = await window.getScreenDetails();
  } catch (_) {
    return null;                 // refused, or dismissed
  }

  const screens = details.screens || [];
  if (screens.length < 2) return null;

  const here = details.currentScreen;
  const other = screens.find((s) => s !== here)
    || screens.find((s) => !s.isPrimary)
    || null;
  if (!other) return null;

  return {
    left: other.availLeft,
    top: other.availTop,
    width: other.availWidth,
    height: other.availHeight,
    label: other.label || 'second screen',
  };
}

/**
 * How many displays are attached, without asking for permission if it has not
 * been granted. Returns 1 when it cannot tell, which is the safe assumption:
 * the UI then promises nothing it might not deliver.
 */
export async function screenCount() {
  if (!screensSupported()) return 1;
  if ((await permissionState()) !== 'granted') return 1;
  try {
    const details = await window.getScreenDetails();
    return (details.screens || []).length || 1;
  } catch (_) {
    return 1;
  }
}
