/**
 * picker.js — choose what to present, without going back to the command line.
 *
 * A program you have to name a file to on a command line is not really a
 * program. The server already serves a folder, so it can also say what is in
 * it, and the panel can offer that list.
 *
 * A browser file picker cannot do this job: a file chosen through <input
 * type="file"> has no http address, and the whole two-window design rests on
 * both windows sharing one origin. So the choice has to be made from what the
 * server can already reach.
 *
 * Files that are not decks are listed too, greyed out and labelled. The file
 * missing its <deck-stage> is exactly the one someone is about to wonder why
 * they cannot pick, and saying so is better than a gap in the list.
 */

const ENDPOINT = 'decks.json';    // resolves against /__deck/panel.html

export function createPicker(mount, { onPick }) {
  let open = false;
  let loaded = false;

  const list = mount.querySelector('#picker-list');
  const status = mount.querySelector('#picker-status');
  const root = mount.querySelector('#picker-root');
  const closeBtn = mount.querySelector('#picker-close');

  closeBtn.addEventListener('click', () => api.close());
  mount.addEventListener('click', (e) => {
    if (e.target === mount && !closeBtn.hidden) api.close();
  });

  function size(bytes) {
    return bytes >= 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
      : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function render(data) {
    root.textContent = data.root || '';
    list.textContent = '';

    const usable = data.decks.filter((d) => d.isDeck);
    if (!data.decks.length) {
      status.textContent =
        'Nothing to present in this folder. Start the server in the folder your '
        + 'deck lives in, or name the deck on the command line.';
      return;
    }
    status.textContent = usable.length
      ? usable.length + (usable.length === 1 ? ' deck found' : ' decks found')
      : 'No deck here. These files have no <deck-stage>, so nothing can drive them.';

    for (const deck of data.decks) {
      const row = document.createElement('button');
      row.className = 'pick';
      row.type = 'button';
      row.disabled = !deck.isDeck;

      const name = document.createElement('span');
      name.className = 'pick-title';
      name.textContent = deck.title || deck.name;

      const meta = document.createElement('span');
      meta.className = 'pick-meta mono';
      const when = new Date(deck.modified * 1000).toLocaleDateString();
      meta.textContent = deck.isDeck
        ? `${deck.name} · ${size(deck.size)} · ${when}`
        : `${deck.name} · not a deck, no <deck-stage>`;

      row.append(name, meta);
      if (deck.isDeck) row.addEventListener('click', () => onPick(deck.path));
      list.appendChild(row);
    }
  }

  async function load() {
    status.textContent = 'Looking...';
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      render(await res.json());
      loaded = true;
    } catch (err) {
      status.textContent = 'Could not list the folder: ' + err.message;
    }
  }

  const api = {
    get isOpen() { return open; },

    /** `dismissable` is false before any deck is loaded: there is nothing behind. */
    show({ dismissable = true } = {}) {
      open = true;
      mount.hidden = false;
      closeBtn.hidden = !dismissable;
      if (!loaded) load();
    },

    close() {
      open = false;
      mount.hidden = true;
    },

    refresh() { loaded = false; if (open) load(); },
  };

  return api;
}
