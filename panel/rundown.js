/**
 * rundown.js — the slide list: jump targets, editable budgets, measured times.
 *
 * This is where "lägga in tider" actually happens. The deck's #deck-plan is
 * only the opening bid; the operator retypes budgets here on the night and the
 * numbers take effect immediately. Nothing is written back to the deck file.
 *
 * Rows are built once and then updated in place. Rebuilding them on every tick
 * would blow away the caret of whichever budget field is being typed into,
 * which is exactly the field the operator is most likely to be using.
 */

import { clock, minutes } from '../core/format.js';

export function createRundown(mount, { onJump, onBudget }) {
  let rows = [];
  let budgets = [];

  const lastBudget = (i) => minutes(budgets[i] || 0);

  function buildRow(slide) {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.index = String(slide.index);

    const n = document.createElement('span');
    n.className = 'n mono';
    n.textContent = String(slide.index + 1).padStart(2, '0');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = slide.label;
    if (slide.hasSound) {
      const snd = document.createElement('span');
      snd.className = 'snd';
      snd.textContent = '♪';           // eighth note
      snd.title = 'This slide carries audio';
      label.appendChild(snd);
    }

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.25';
    input.title = 'Minutes budgeted for this slide';
    input.setAttribute('aria-label', 'Minutes for slide ' + (slide.index + 1));

    const actual = document.createElement('span');
    actual.className = 'actual mono';

    row.append(n, label, input, actual);

    // The input lives inside a clickable row, so its own events must not
    // navigate the deck out from under someone typing a number.
    const commit = () => onBudget(slide.index, input.value);
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();                  // never reaches the panel shortcuts
      // Commit explicitly rather than leaning on `change` firing from blur():
      // a budget the operator typed and pressed Enter on has to take effect,
      // and the two paths are idempotent anyway.
      if (e.key === 'Enter') { commit(); input.blur(); }
      if (e.key === 'Escape') { input.value = lastBudget(slide.index); input.blur(); }
    });
    row.addEventListener('click', () => onJump(slide.index));

    return { row, input, actual };
  }

  return {
    build(slides) {
      mount.textContent = '';
      rows = slides.map((slide) => {
        const parts = buildRow(slide);
        mount.appendChild(parts.row);
        return parts;
      });
    },

    /** Push budget values into the fields, skipping one being edited. */
    setBudgets(list) {
      budgets = list.slice();
      rows.forEach((r, i) => {
        if (document.activeElement === r.input) return;
        const value = minutes(budgets[i] || 0);
        if (r.input.value !== value) r.input.value = value;
      });
    },

    /** Per-tick refresh: highlight, measured time, overrun colour. */
    update(session, index) {
      rows.forEach((r, i) => {
        r.row.toggleAttribute('data-current', i === index);
        const spent = session.actualSeconds(i);
        const budget = session.budgetSeconds(i);
        r.actual.textContent = spent >= 1 ? clock(spent) : '';
        r.actual.toggleAttribute('data-over', budget > 0 && spent > budget);
      });
    },

    /** Keep the active slide in view without fighting a manual scroll. */
    scrollTo(index) {
      const r = rows[index];
      if (r) r.row.scrollIntoView({ block: 'nearest' });
    },
  };
}
