// LAST BELL — The Halloween Shift (HallPass Fright Fest 2026): event configuration.
//
// Everything seasonal lives in halloween/. Normal LAST BELL never loads anything here except this file
// (the menu asks halloweenAvailable()).
//
// HALLPASS IS THE AUTHORITY on whether the event exists (docs/event-theme-sdk.md in the HallPass repo). The game
// keeps no calendar: at boot it asks HallPass.getEvent() (loadHallPassEvent) and caches the answer, and
// halloweenAvailable() / eventPhase() read that cache synchronously. No event, null, a timeout, an old SDK or no
// SDK at all means NO Halloween: no menu entry, no mode, no halloween/ assets fetched. ?halloween=1 only forces it
// on on localhost (dev); ?halloween=0 forces it off anywhere. HALLOWEEN.enabled = false is a dev kill switch.
// Scores only count while the phase is 'live' (after the event's opensAt).

export const HALLOWEEN = {
  enabled: true,
  id: 'fright-fest-2026', // HallPass's permanent event key
  title: 'The Halloween Shift',
  // no dates here on purpose: the window (startAt / opensAt / endAt) comes from HallPass.getEvent()
  // the Fright Fest board (HallPass must provision it; see docs/halloween/hallpass-request.md)
  board: 'last-bell-halloween-shift',
  standingsUrl: 'https://hallpass.games/fright-fest',
  // one school for everyone (a compact ground floor, picked with _dev/hw-seed-scan.mjs)
  seed: 2026118, // _dev/hw-seed-scan.mjs: 13x11, items 33 m apart, route bound 26 s, 19 doorways
  difficulty: 'normal',
  timeLimit: 480, // 8:00 on the clock (Normal's 7:00 plus a minute for the dark)
  // gameplay-affecting blackouts: identical rules for every run (halloween/lighting.js, director.js)
  blackout: {
    // playtest (26 Oct): "more frequent blackouts + jumpscares": three a run instead of two, a little shorter each
    firstAfter: 65, // s after the intro announcement ends (when the haunts start; ~86 s on the run clock)
    gap: 100, // s from the end of one to the start of the next
    max: 3, // per run
    dark: 18, // s of full darkness (the same for every variant)
    restore: 3, // s for the lights to come back
    retry: 4, // s between safety re-checks when a blackout is held back
    latest: 60, // never start one with less than this left on the clock
    maxDelay: 45, // a blackout held back longer than this is skipped (it still counts towards max)
  },
  memoryKey: 'lastbell.halloween.memory.v1',
  bestKey: 'lastbell.halloween.best.v1',
  settingsKey: 'lastbell.halloween.settings.v1',
};

const params = (() => {
  try {
    return new URLSearchParams(location.search);
  } catch {
    return new URLSearchParams();
  }
})();

// ------------------------------------------------------------------------------------ the HallPass answer
// null = HallPass said nothing (not reached, timed out, SDK older than 1.7, no SDK): treated as "no event".
let EVENT = null;
let clockOffset = 0; // HallPass's clock minus the device clock (ms), from the answer's serverTime
const listeners = new Set();

function setEvent(ev) {
  const was = halloweenAvailable();
  EVENT = ev && typeof ev === 'object' ? ev : null;
  const t = EVENT ? Date.parse(EVENT.serverTime) : NaN;
  clockOffset = Number.isFinite(t) ? t - Date.now() : 0;
  if (halloweenAvailable() !== was) for (const fn of [...listeners]) fn(halloweenAvailable());
}

/** HallPass's idea of "now" (ms): the device clock corrected by the last answer's serverTime. */
export function eventNow() {
  return Date.now() + clockOffset;
}

/** Called when availability flips (HallPass.on('event')). Returns an unsubscribe function. */
export function onHalloweenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Ask HallPass whether the event is on, and keep following it. Resolves (never rejects) within `timeoutMs`:
 * with the answer, or with null. The SDK script is deferred, so this waits for it to appear first.
 */
export async function loadHallPassEvent(timeoutMs = 2500) {
  const t0 = Date.now();
  const left = () => Math.max(0, timeoutMs - (Date.now() - t0));
  const answer = (async () => {
    try {
      while (!(window.HallPass && typeof HallPass.supports === 'function' && HallPass.supports('event'))) {
        if (!left() || (window.HallPass && HallPass.mode === 'inert')) return null;
        await new Promise((r) => setTimeout(r, 50));
      }
      return await HallPass.getEvent();
    } catch {
      return null;
    }
  })();
  const ev = await Promise.race([answer, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
  setEvent(ev);
  try {
    // sticky: fires now with the current state, and again whenever the dashboard switch or the window changes
    if (ev && window.HallPass && typeof HallPass.on === 'function') HallPass.on('event', (e) => setEvent(e));
  } catch {
    /* the answer we have stands */
  }
  return EVENT;
}

/** 'off' | 'practice' | 'live' | 'ended' now (ms, HallPass-corrected). 'practice' = before the event's opensAt. */
export function eventPhase(now = eventNow()) {
  if (!HALLOWEEN.enabled) return 'off';
  const ev = EVENT;
  if (!ev || !ev.active) return ev && ev.phase === 'ended' ? 'ended' : halloweenAvailable() ? 'practice' : 'off'; // forced on locally: never ranked
  if (ev.endAt && now >= Date.parse(ev.endAt)) return 'ended';
  if (ev.opensAt && now < Date.parse(ev.opensAt)) return 'practice';
  return 'live';
}

/** "28 Oct" style label for when ranked runs open (HallPass's opensAt), or '' if unknown. */
export function rankedOpensLabel() {
  const t = EVENT && EVENT.opensAt ? Date.parse(EVENT.opensAt) : NaN;
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
}

export const LOCAL_DEV = (() => {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  } catch {
    return false;
  }
})();

/**
 * Should the menu offer The Halloween Shift? Only while HallPass says the event is on. ?halloween=0 forces it off;
 * ?halloween=1 forces it on on localhost only (so the look can be worked on out of season). Never true on a null /
 * missing answer. (There is no player opt-out setting; if one is added it may only ever switch this OFF.)
 */
export function halloweenAvailable() {
  if (!HALLOWEEN.enabled) return false;
  const p = params.get('halloween');
  if (p === '0') return false;
  if (LOCAL_DEV && p === '1') return true;
  return !!(EVENT && EVENT.active);
}

/** The dev-only Horror Director panel: localhost + ?hwdebug=1, never anywhere else. */
export const DEBUG_PANEL = LOCAL_DEV && params.get('hwdebug') === '1';
