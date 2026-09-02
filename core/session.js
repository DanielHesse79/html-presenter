/**
 * session.js — the operator's running state, as pure logic with no DOM.
 *
 * The split this file exists to enforce: the *deck file* owns the content
 * (slides, notes, a suggested plan). The *session* owns everything that
 * changes while you present: the clock, the budgets you retype on the night,
 * the volume, what actually took how long. The session is never written back
 * to the deck. This is a viewer, not an editor.
 *
 * Time is accrued, not derived from a start timestamp. Each tick adds the
 * wall-clock delta since the previous tick to the elapsed total and to the
 * current slide's actual. Pausing simply stops accruing. That is what makes a
 * pausable clock and per-slide rehearsal timings fall out of one mechanism
 * instead of three sets of bookkeeping.
 */

const STORE_PREFIX = 'deck-stage:session:';
const SAVE_INTERVAL_MS = 1000;
const MAX_BUDGET_MINUTES = 600;

/** Below this much drift, the pace chip reads "on plan" rather than a number. */
export const ON_PLAN_TOLERANCE_S = 15;

export function createSession({ key = 'default', slideCount = 0, authoredPlan = null } = {}) {
  const state = {
    key,
    slideCount,
    budgets: [],        // minutes per slide, operator-editable
    appendix: [],       // parallel: slide is backup material, not the talk
    returnIndex: 0,     // last place in the running order, for coming back
    authored: null,     // the deck's own plan, kept so it can be restored
    elapsedMs: 0,
    actualsMs: [],      // accrued per slide, across revisits (rehearsal)
    visitMs: 0,         // time on the current slide since arriving at it
    index: 0,
    paused: false,
    away: false,        // stepped off the deck to show something else
    awayMs: 0,          // time spent off it this session, booked to no slide
    thisAwayMs: 0,      // and how long the current detour has run
    volume: 1,
    muted: false,
    blackout: false,
  };

  let lastTickAt = Date.now();
  let lastSaveAt = 0;
  let dirty = false;

  // -- Plan ---------------------------------------------------------------

  function fitLength(list, n, fill = 0) {
    const out = list ? list.slice(0, n) : [];
    while (out.length < n) out.push(fill);
    return out;
  }

  function setSlideCount(n) {
    state.slideCount = n;
    state.budgets = fitLength(state.budgets, n);
    state.actualsMs = fitLength(state.actualsMs, n);
    state.appendix = fitLength(state.appendix, n, false);
    dirty = true;
  }

  const isAppendix = (i) => !!state.appendix[i];

  /**
   * Which slides sit outside the running order.
   *
   * Appendix slides carry no budget, and that single rule is what keeps
   * them out of the arithmetic: cumulativeSeconds() and planTotalSeconds()
   * already sum budgets, so zeroing these means the plan simply does not
   * see them. Backup material you may never show must not move the totals
   * or the pace of the talk you are actually giving.
   */
  function setAppendix(flags) {
    state.appendix = fitLength(
      flags ? flags.map(Boolean) : [], state.slideCount, false);
    state.budgets = state.budgets.map((m, i) => (state.appendix[i] ? 0 : m));
    dirty = true;
  }

  function setAuthoredPlan(minutes) {
    state.authored = minutes ? minutes.slice() : null;
    dirty = true;
  }

  /** Replace the working budgets with the deck's authored plan. */
  function restoreAuthoredPlan() {
    state.budgets = fitLength(state.authored, state.slideCount)
      .map((m, i) => (isAppendix(i) ? 0 : m));
    dirty = true;
  }

  function setBudgetMinutes(i, minutes) {
    if (i < 0 || i >= state.slideCount || isAppendix(i)) return;
    const m = Number(minutes);
    state.budgets[i] = Number.isFinite(m)
      ? Math.min(MAX_BUDGET_MINUTES, Math.max(0, m))
      : 0;
    dirty = true;
  }

  const budgetSeconds = (i) => (state.budgets[i] || 0) * 60;

  const planTotalSeconds = () =>
    state.budgets.reduce((sum, m) => sum + (m || 0) * 60, 0);

  /** Seconds scheduled before slide i. */
  function cumulativeSeconds(i) {
    let sum = 0;
    for (let n = 0; n < i && n < state.budgets.length; n++) {
      sum += (state.budgets[n] || 0) * 60;
    }
    return sum;
  }

  const hasPlan = () => state.budgets.some((m) => m > 0);

  // -- Clock --------------------------------------------------------------

  function tick(now = Date.now()) {
    const delta = Math.max(0, now - lastTickAt);
    lastTickAt = now;
    if (!state.paused) {
      state.elapsedMs += delta;
      if (state.away) {
        // Off the deck the clock still runs, because the time is real and
        // the room is still watching. Only the booking changes: these
        // minutes belong to the detour, not to whichever slide happens to
        // be up behind it, or the measured plan would later claim that
        // slide takes eight minutes.
        state.awayMs += delta;
        state.thisAwayMs += delta;
      } else {
        state.visitMs += delta;
        if (state.index >= 0 && state.index < state.slideCount) {
          state.actualsMs[state.index] = (state.actualsMs[state.index] || 0) + delta;
        }
      }
      dirty = true;
    }
    if (dirty && now - lastSaveAt > SAVE_INTERVAL_MS) save(now);
  }

  function setIndex(i) {
    if (i === state.index) return;
    // Coming back from the appendix resumes the slide rather than
    // restarting it. Without this the pace lurches the moment you return:
    // the minutes already spent on that slide would stop counting against
    // its budget, and a figure that jumps is the one thing the clamp in
    // driftSeconds() exists to prevent.
    const resuming = isAppendix(state.index) && i === state.returnIndex;
    state.index = i;
    if (!isAppendix(i)) state.returnIndex = i;
    // Otherwise pace measures this visit, not the running total.
    state.visitMs = resuming ? (state.actualsMs[i] || 0) : 0;
    dirty = true;
  }

  /**
   * Step off the deck, or come back.
   *
   * visitMs is deliberately left alone across both edges: the slide is
   * still up, you are simply not talking to it, so it resumes rather than
   * restarts. driftSeconds() then keeps climbing while you are away, with
   * no special case, because elapsed grows and the clamped spend does not.
   */
  function setAway(on) {
    // Restart the detour's own clock on the way out. On stage the number
    // that matters is how long you have been gone this time, not the
    // running total for the talk, which belongs in the rehearsal record.
    if (on && !state.away) state.thisAwayMs = 0;
    state.away = !!on;
    dirty = true;
  }

  function pause() { state.paused = true; dirty = true; }
  function resume() { state.paused = false; lastTickAt = Date.now(); dirty = true; }
  function togglePause() { if (state.paused) resume(); else pause(); }

  /** Zero the clock and every recorded actual. Budgets are kept. */
  function resetClock() {
    state.elapsedMs = 0;
    state.visitMs = 0;
    state.awayMs = 0;
    state.thisAwayMs = 0;
    state.actualsMs = fitLength([], state.slideCount);
    lastTickAt = Date.now();
    dirty = true;
  }

  // -- Pace ---------------------------------------------------------------

  /**
   * Drift against the plan, in seconds. Positive is behind.
   *
   * Time spent on the current slide is clamped to that slide's budget. That
   * clamp is the whole point: while you are still inside a slide's budget the
   * number holds steady at whatever it was on arrival, and only starts moving
   * once you overrun. A figure that ticks up every second is unreadable from
   * the corner of your eye mid-sentence.
   */
  function driftSeconds() {
    // Out in the appendix, measure against the slide the talk was left on.
    // The clock keeps running while the plan stands still, so the number
    // climbs in real time: that is the point. It is telling you what this
    // question is costing, and it is the figure you will be facing when
    // you come back.
    const away = isAppendix(state.index);
    const i = away ? state.returnIndex : state.index;
    if (!hasPlan() || i < 0 || i >= state.slideCount) return 0;
    const spent = away
      ? (state.actualsMs[i] || 0) / 1000
      : state.visitMs / 1000;
    const owed = cumulativeSeconds(i) + Math.min(spent, budgetSeconds(i));
    return state.elapsedMs / 1000 - owed;
  }

  function pace() {
    const drift = driftSeconds();
    if (Math.abs(drift) < ON_PLAN_TOLERANCE_S) return { state: 'on', drift };
    return { state: drift > 0 ? 'behind' : 'ahead', drift };
  }

  /** Seconds of plan left after the current slide's budget is used up. */
  function remainingInPlanSeconds() {
    const away = isAppendix(state.index);
    const i = away ? state.returnIndex : state.index;
    if (!hasPlan()) return 0;
    const raw = away ? (state.actualsMs[i] || 0) / 1000 : state.visitMs / 1000;
    const spent = Math.min(raw, budgetSeconds(i));
    return Math.max(0, planTotalSeconds() - cumulativeSeconds(i) - spent);
  }

  // -- Rehearsal ----------------------------------------------------------

  /**
   * The measured run as a #deck-plan array, rounded to quarter-minutes.
   * Offered for the operator to copy; nothing writes it back to the deck.
   */
  function planFromActuals() {
    // Parallel to every slide, appendix included, because #deck-plan has to
    // stay the same length as the slides. Backup material contributes 0.
    return state.actualsMs
      .slice(0, state.slideCount)
      .map((ms, i) => (isAppendix(i)
        ? 0
        : Math.max(0.25, Math.round((ms / 1000 / 60) * 4) / 4)));
  }

  const hasRecording = () => state.actualsMs.some((ms) => ms > 1000);

  // -- Mixer and projector flags ------------------------------------------

  function setVolume(v) {
    const n = Number(v);
    state.volume = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
    dirty = true;
  }
  function setMuted(on) { state.muted = !!on; dirty = true; }
  function setBlackout(on) { state.blackout = !!on; dirty = true; }

  // -- Persistence --------------------------------------------------------
  // Keyed by deck, so reopening the same talk restores the budgets you typed
  // and the clock you were running. Losing either mid-talk is worse than the
  // small amount of state kept here.

  function save(now = Date.now()) {
    lastSaveAt = now;
    dirty = false;
    try {
      localStorage.setItem(STORE_PREFIX + state.key, JSON.stringify({
        slideCount: state.slideCount,
        budgets: state.budgets,
        elapsedMs: state.elapsedMs,
        actualsMs: state.actualsMs,
        paused: state.paused,
        away: state.away,
        awayMs: state.awayMs,
        thisAwayMs: state.thisAwayMs,
        returnIndex: state.returnIndex,
        volume: state.volume,
        muted: state.muted,
      }));
    } catch (_) { /* private mode, quota, or no storage: run without it */ }
  }

  function restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_PREFIX + state.key) || 'null');
    } catch (_) {
      return false;
    }
    // A different slide count means the deck was edited; the old numbers no
    // longer line up with the slides, so start clean rather than mislead.
    if (!saved || saved.slideCount !== state.slideCount) return false;
    state.budgets = fitLength(saved.budgets, state.slideCount);
    state.elapsedMs = Number(saved.elapsedMs) || 0;
    state.actualsMs = fitLength(saved.actualsMs, state.slideCount);
    state.paused = !!saved.paused;
    state.away = !!saved.away;
    state.awayMs = Number(saved.awayMs) || 0;
    state.thisAwayMs = Number(saved.thisAwayMs) || 0;
    state.returnIndex = Number(saved.returnIndex) || 0;
    setVolume(saved.volume == null ? 1 : saved.volume);
    state.muted = !!saved.muted;
    lastTickAt = Date.now();
    return true;
  }

  function clear() {
    try { localStorage.removeItem(STORE_PREFIX + state.key); } catch (_) {}
  }

  function setKey(k) { state.key = k; }

  if (authoredPlan) setAuthoredPlan(authoredPlan);
  setSlideCount(slideCount);
  if (authoredPlan) restoreAuthoredPlan();

  return {
    state,
    setKey, setSlideCount, setAuthoredPlan, restoreAuthoredPlan, setAppendix,
    setBudgetMinutes, budgetSeconds, planTotalSeconds, cumulativeSeconds, hasPlan,
    tick, setIndex, pause, resume, togglePause, resetClock, setAway,
    driftSeconds, pace, remainingInPlanSeconds,
    planFromActuals, hasRecording,
    setVolume, setMuted, setBlackout,
    save, restore, clear,
    get elapsedSeconds() { return state.elapsedMs / 1000; },
    get visitSeconds() { return state.visitMs / 1000; },
    get awaySeconds() { return state.awayMs / 1000; },
    get thisAwaySeconds() { return state.thisAwayMs / 1000; },
    actualSeconds(i) { return (state.actualsMs[i] || 0) / 1000; },
    isAppendix,
    get inAppendix() { return isAppendix(state.index); },
    get returnIndex() { return state.returnIndex; },
  };
}
