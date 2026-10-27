// LAST BELL — The Halloween Shift (HallPass Fright Fest 2026): event configuration.
//
// Everything seasonal lives in halloween/. Normal LAST BELL never loads anything here except this file
// (the menu asks halloweenAvailable()). To switch the event off: enabled = false (or ?halloween=0).
//
// The window mirrors HallPass's canonical event registry (Hallpass/app/lib/events/registry.ts, see
// Hallpass/artifacts/fright-fest-architecture.md): teaser 26 Oct, live 28 Oct 00:00 UTC → 3 Nov 00:00 UTC
// (exclusive). If HallPass moves the window, change it here too. Scores only count while 'live'.

export const HALLOWEEN = {
  enabled: true,
  id: 'fright-fest-2026', // HallPass's permanent event key
  title: 'The Halloween Shift',
  teaserFrom: Date.parse('2026-10-26T00:00:00Z'),
  startAt: Date.parse('2026-10-28T00:00:00Z'),
  endAt: Date.parse('2026-11-03T00:00:00Z'), // HallPass closes Fright Fest at 3 Nov 00:00 UTC (exclusive): the last day is Mon 2 Nov
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

/** 'off' | 'upcoming' | 'live' | 'ended' at time `now` (ms). */
export function eventPhase(now = Date.now()) {
  if (!HALLOWEEN.enabled) return 'off';
  if (now >= HALLOWEEN.endAt) return 'ended';
  if (now >= HALLOWEEN.startAt) return 'live';
  if (now >= HALLOWEEN.teaserFrom) return 'upcoming';
  return 'off';
}

/** Should the menu offer The Halloween Shift? ?halloween=1 / ?halloween=0 override the window. */
export function halloweenAvailable(now = Date.now()) {
  const p = params.get('halloween');
  if (p === '0') return false;
  if (p !== null && p !== '0') return HALLOWEEN.enabled;
  const ph = eventPhase(now);
  return ph === 'upcoming' || ph === 'live';
}

export const LOCAL_DEV = (() => {
  try {
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(location.hostname);
  } catch {
    return false;
  }
})();

/** The dev-only Horror Director panel: localhost + ?hwdebug=1, never anywhere else. */
export const DEBUG_PANEL = LOCAL_DEV && params.get('hwdebug') === '1';
