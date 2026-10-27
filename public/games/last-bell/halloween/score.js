// LAST BELL — The Halloween Shift: the run record, plausibility checks, the local best and the board.
//
// Ranking rules (the same for everyone): one event school (HALLOWEEN.seed), Normal difficulty, ground floor
// only, solo, an 8 minute clock, the blackout rules in config.js. Score = seconds left at the escape, like
// the normal board (higher is better); the slip shows the completion time too.
//
// Browser times are not trusted. The game measures game time (frame dt, clamped) AND the wall time that
// passed while the run was being played (performance.now, pauses excluded) and flags a run when:
//   speed     game time ran faster than real time (a speed hack / timer tamper)
//   route     faster than the straight-line lower bound for the item route at sprint speed (impossible)
//   debug     ?debug, ?hwdebug, the debug panel or a forced haunt was used
//   rules     wrong seed / difficulty / floor / co-op (should be impossible from the menu)
//   phase     outside the Fright Fest window (practice runs are fine, just unranked)
//   hidden    the tab was hidden while the clock ran (should be impossible: the game pauses on blur)
// Flags are attached to the submission as metadata for HallPass's review; a flagged run is still shown
// locally. NOTHING is posted to the normal "last-bell" board, and nothing is posted at all unless the SDK
// says it supports named boards (feature-detected; see docs/halloween/hallpass-request.md).

import { HALLOWEEN, eventPhase } from './config.js';
import { ITEM_IDS } from '../config.js';

const SPRINT = 4.6; // config.js PLAYER.sprintSpeed (m/s)

function sdk() {
  try {
    return window.HallPass || null;
  } catch {
    return null;
  }
}

/** Does this SDK accept a named board? Never guessed from the version alone. */
export function boardSupport(hp = sdk()) {
  try {
    if (!hp?.submitScore) return false;
    if (typeof hp.supports === 'function') return !!hp.supports('leaderboard.boards');
    return !!(hp.capabilities?.leaderboard?.boards || hp.capabilities?.boards);
  } catch {
    return false;
  }
}

export class RunScore {
  constructor(game) {
    this.game = game;
    this.rec = null;
  }

  /** Called when the clock starts (end of the intro). */
  begin({ debugUsed = false } = {}) {
    const g = this.game;
    const w = g.world;
    this.rec = {
      mode: 'halloween',
      event: HALLOWEEN.id,
      v: 1,
      seed: g.seed,
      difficulty: g.settings?.difficulty,
      floor: g.startFloor ?? 0,
      coop: !!g.coop?.active,
      phase: eventPhase(),
      startedAt: Date.now(),
      gameTime: 0,
      wallTime: 0,
      hiddenTime: 0,
      debug: !!debugUsed || !!g.debug,
      forced: 0,
      lowerBound: this._lowerBound(w),
      result: null,
      timeLeft: null,
      runToken: null,
    };
    this._last = performance.now();
    // a run token, if the platform hands them out (feature-detected, optional)
    try {
      const hp = sdk();
      const p = hp?.runStart?.({ game: 'last-bell', board: HALLOWEEN.board, seed: g.seed });
      if (p?.then) p.then((t) => this.rec && (this.rec.runToken = t?.token || t || null)).catch(() => {});
    } catch {}
    return this.rec;
  }

  /** Every playing frame. */
  tick(dt) {
    const r = this.rec;
    if (!r || r.result) return;
    const now = performance.now();
    const real = Math.min(1, (now - this._last) / 1000); // a long gap = a pause / hitch, not play
    this._last = now;
    r.gameTime += dt;
    r.wallTime += real;
    if (document.hidden) r.hiddenTime += real;
  }

  /** The game was paused (menu, blur): the wall clock must not count the gap. */
  resume() {
    this._last = performance.now();
  }

  markDebug(kind = 'debug') {
    if (!this.rec) return;
    this.rec.debug = true;
    if (kind === 'forced') this.rec.forced++;
  }

  /** Straight-line lower bound: spawn → the three items in the best order → the exit, at sprint speed. */
  _lowerBound(w) {
    try {
      const s = w.playerSpawn?.position, e = w.exit?.position, it = w.itemSpawns;
      if (!s || !e || !it) return 30;
      const pts = ITEM_IDS.map((id) => it[id]).filter(Boolean);
      const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      let best = Infinity;
      const perm = (rest, from, acc) => {
        if (!rest.length) return (best = Math.min(best, acc + d(from, e)));
        rest.forEach((p, i) => perm(rest.filter((_, j) => j !== i), p, acc + d(from, p)));
      };
      perm(pts, s, 0);
      return Math.max(20, best / SPRINT);
    } catch {
      return 30;
    }
  }

  flags() {
    const r = this.rec;
    const f = [];
    if (!r) return ['none'];
    if (r.gameTime > r.wallTime * 1.04 + 1) f.push('speed');
    if (r.result === 'escaped' && r.gameTime < r.lowerBound * 0.9) f.push('route');
    if (r.debug) f.push('debug');
    if (r.seed !== HALLOWEEN.seed || r.difficulty !== HALLOWEEN.difficulty || r.floor !== 0 || r.coop) f.push('rules');
    if (r.phase !== 'live') f.push('phase');
    if (r.hiddenTime > 2) f.push('hidden');
    return f;
  }

  /** The run ended. Returns { rec, flags, ranked, best, newBest, submitted }. */
  finish(result, timeLeft) {
    const r = this.rec;
    if (!r || r.result) return null;
    r.result = result;
    r.timeLeft = Math.max(0, Math.round(timeLeft ?? 0));
    r.endedAt = Date.now();
    const flags = this.flags();
    // practice outside the window is allowed but never ranked; any other flag also keeps it off the board
    const ranked = result === 'escaped' && flags.length === 0;
    const out = { rec: r, flags, ranked, best: this.best(), newBest: false, submitted: 'no' };
    if (result === 'escaped' && !flags.some((x) => x !== 'phase')) {
      const prev = out.best;
      if (!prev || r.timeLeft > prev.timeLeft) {
        out.best = { timeLeft: r.timeLeft, time: +r.gameTime.toFixed(1), at: r.endedAt, ranked };
        out.newBest = true;
        this._saveBest(out.best);
      }
    }
    if (ranked) out.submitted = this._submit(r, flags);
    this.rec = null;
    return out;
  }

  _submit(r, flags) {
    const hp = sdk();
    if (!boardSupport(hp)) return 'unsupported';
    try {
      const p = hp.submitScore(r.timeLeft, {
        board: HALLOWEEN.board,
        promptHandle: false,
        meta: { event: r.event, v: r.v, seed: r.seed, time: +r.gameTime.toFixed(2), wall: +r.wallTime.toFixed(2), bound: +r.lowerBound.toFixed(1), flags, token: r.runToken },
      });
      if (p?.catch) p.catch(() => {});
      return 'sent';
    } catch {
      return 'error';
    }
  }

  best() {
    try {
      return JSON.parse(localStorage.getItem(HALLOWEEN.bestKey) || 'null');
    } catch {
      return null;
    }
  }

  _saveBest(b) {
    try {
      localStorage.setItem(HALLOWEEN.bestKey, JSON.stringify(b));
    } catch {}
  }
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
