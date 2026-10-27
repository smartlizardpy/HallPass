// LAST BELL — The Halloween Shift: the HorrorDirector.
//
// One conductor for the ghost, the lights, the sounds, doors, posters / boards / clocks, the blood and the
// heads. It never fires random jump scares on a timer; it moves through tension states and spends a budget:
//
//   CALM → UNEASE → DREAD → PEAK → RECOVERY      (with detours: UNEASE can fall back to CALM, DREAD can end
//                                               in nothing at all, CALM can skip straight to DREAD)
//
// Each state lasts a random while (longer on a 'quiet' run, shorter on a 'restless' one: memory.js alternates
// them) and allows certain sequences (sequences.js). Budget refills over time; a sequence costs budget. A
// sequence is an async script over a ctx whose waits run on game time and reject when it is aborted, so a
// chase, a capture or the end of the run cleans everything up (ctx.onAbort). Silence is a sequence too.
//
// Picking: weight × novelty (this run + previous runs, memory.js) × how the player reacted before (ignored
// sounds, spots they keep checking, walking up to the ghost, turning around a lot) × randomness, only among
// sequences whose gates pass (no chase, no puzzle open, the Caretaker not close for big ones), whose
// cooldowns are over and that are compatible with what is already running (one foreground + 2 background,
// exclusive channels, notAfter rules).
//
// Acts (the run's arc, on top of the phases): I "something's wrong" (sounds, changes, one far glimpse), II "it's
// watching" (sightings, each closer), III "it's here" (rules break: close range, behind you, the charge). The act
// follows the clock and the player's progress, whichever is further, so a fast run still reaches act III.
//
// Startle craft (docs/halloween/scare-research.md): a loud hit only from DREAD / PEAK (fear-potentiated startle),
// at most one per STING_GAP s, always after 0.8-2 s of dead silence (hush) and never with a cue sound in the
// 0.03-0.5 s before it (prepulse inhibition shrinks a startle); then a bodycam stutter and a small zoom kick.
// After a major the guard drops: sometimes an aftershock lands 6-14 s into the calm. 15-60 s after the player
// shakes off a chase they startle hardest: the director leans into DREAD then.
//
// Blackouts: fixed rules from config.js (the same for every ranked run): first after N s, then every gap s,
// at most `max`, each exactly `dark` s, postponed (retry) while unsafe and skipped if postponed > latest,
// ended early if a chase starts. Variants (gradual / sudden / partial / false recovery) only change how it
// looks and sounds. The Caretaker's light rule sees one fixed level during the dark (world.getLightLevel,
// mode.js), never the variant or the local haunt dimming.

import { SEQUENCES, BLACKOUT_VARIANTS } from './sequences.js';
import { HauntMemory } from './memory.js';

export const PHASES = ['CALM', 'UNEASE', 'DREAD', 'PEAK', 'RECOVERY'];
// longer quiet and longer dread, fewer but bigger peaks (constant small cues numb people)
// playtest (26 Oct): "more frequent blackouts + jumpscares": shorter calms, more budget, hits closer together
const PHASE_LEN = { CALM: [16, 32], UNEASE: [26, 46], DREAD: [24, 48], PEAK: [10, 24], RECOVERY: [12, 24] };
const GAIN = { CALM: 0.06, UNEASE: 0.08, DREAD: 0.11, PEAK: 0, RECOVERY: 0.03 }; // budget per second
const EVERY = { CALM: [12, 24], UNEASE: [9, 18], DREAD: [7, 13], PEAK: [1, 2], RECOVERY: [16, 28] }; // tries
const STING_GAP = 32; // s between loud hits (was 45)
const AFTERSHOCK = [0, 0, 0.18, 0.35]; // chance per act that a major is followed by a second scare in the calm
const NEXT = {
  CALM: [['UNEASE', 0.8], ['DREAD', 0.16], ['CALM', 0.04]],
  UNEASE: [['DREAD', 0.65], ['CALM', 0.15], ['UNEASE', 0.2]],
  DREAD: [['PEAK', 0.66], ['RECOVERY', 0.24], ['UNEASE', 0.1]],
  PEAK: [['RECOVERY', 1]],
  RECOVERY: [['CALM', 0.6], ['UNEASE', 0.4]],
};
export const INTENSITY = {
  mild: { gain: 0.7, heads: 0, majorGap: 60, censor: 'all', posterCap: 2 },
  standard: { gain: 1, heads: 2, majorGap: 36, censor: 'big', posterCap: 3 },
  intense: { gain: 1.25, heads: 3, majorGap: 28, censor: 'big', posterCap: 3 },
};
const BUDGET_MAX = 10;
const RESERVE = 2.5; // DREAD's minor haunts leave this much for the peak

export const ABORT = Object.freeze({ aborted: true });

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
}

class Ctx {
  constructor(dir, def, slot) {
    this.dir = dir;
    this.def = def;
    this.slot = slot;
    this.aborted = false;
    this.reason = null;
    this.cleanups = [];
    this.t0 = dir.time;
    this.spot = null;
    this.pose = null;
    this.res = null;
  }
  /** Game-time wait; rejects with ABORT once aborted. */
  wait(sec) {
    if (this.aborted) return Promise.reject(ABORT);
    return new Promise((res, rej) => this.dir._waits.push({ ctx: this, at: this.dir.time + Math.max(0, sec), res, rej }));
  }
  /** Resolves true as soon as pred() is true, false after `timeout` s. */
  until(pred, timeout = 30) {
    if (this.aborted) return Promise.reject(ABORT);
    if (pred()) return Promise.resolve(true);
    return new Promise((res, rej) => this.dir._waits.push({ ctx: this, at: this.dir.time + timeout, pred, res, rej }));
  }
  onAbort(fn) {
    this.cleanups.push(fn);
  }
  check() {
    if (this.aborted) throw ABORT;
  }
}

export class HorrorDirector {
  /** parts: { gaze, lights, spotsCat, memory, watcher, pane, posters, decor, blood, heads, cfg } */
  constructor(game, parts) {
    this.game = game;
    Object.assign(this, parts);
    this.catalog = SEQUENCES;
    this.intensity = 'standard';
    this.int = INTENSITY.standard;
    this.reducedFlash = false;
    this.enabled = true;
    this.auto = true; // false (debug tour): only forced haunts and blackouts run
    this.forceAct = 0; // debug: pin the act (0 = follow the run)
    this.stingGap = STING_GAP; // debug (look-around tour): shorter
    this._waits = [];
    this.fg = null;
    this.bg = new Set();
    this.log = [];
    this.time = 0;
    this.started = false;
  }

  // ------------------------------------------------------------------------------- run lifecycle
  begin(seed) {
    this.abortAll('restart');
    this.rng = rngFrom((seed ^ Date.now()) >>> 0); // haunts differ run to run; blackout rules do not
    this.run = this.memory.beginRun({ seed, rng: this.rng });
    this.flavor = this.run.flavor;
    this.time = 0;
    this.budget = this.flavor === 'quiet' ? 1.5 : 3;
    this.phase = 'CALM';
    this._enter('CALM');
    this.nextTry = 14 + this.rng() * 8; // a breath at the start
    this.lastEnd = {};
    this.lastMajorAt = -999;
    this.lastMotif = null;
    this.majors = 0;
    this.headsUsed = 0;
    this.turns = 0;
    this._lastTurnSeen = -99;
    this.watcherApproached = 0;
    this.eventSpots = [];
    this.changes = [];
    this._noticeAt = -99;
    this.dripSites = [];
    this.log = [];
    this._checkAcc = 0;
    this.dark = false;
    const B = this.cfg.blackout;
    this.bo = { count: 0, skipped: 0, dueAt: B.firstAfter, nextAt: B.firstAfter, active: false, variants: [] };
    this.forced = null;
    this._timers = [];
    this.lastStingAt = -999;
    this.lastCueAt = -999;
    this.aftershockAt = null;
    this.chaseEndedAt = null;
    this._wasChase = false;
    this.once = new Set(); // one-per-run beats (behind you, the charge, it notices you)
    this.signatureDone = false;
    this.watcherBeats = 0;
    this.kinds = { blood: 0, head: 0 }; // first blood / first head: promised early (see _score)
    this.bigHaunts = 0; // major haunts run (not blackouts): the first one is promised by ~2.5 min (update)
    this.reciting = false;
    this._swell = null;
    this.started = true;
    this.watcher.onApproach = () => {
      if (this.time - (this._approachNoted ?? -99) > 5) {
        this._approachNoted = this.time;
        this.watcherApproached++;
        this.memory.walkedUp();
      }
    };
  }

  end(result) {
    if (!this.started) return;
    this.abortAll('end');
    this._timers = [];
    this.started = false;
    this.memory.endRun({ result });
  }

  setIntensity(level) {
    this.intensity = INTENSITY[level] ? level : 'standard';
    this.int = INTENSITY[this.intensity];
    if (this.posters) this.posters.mild = this.intensity === 'mild';
    if (this.blood) this.blood.censor = this.int.censor;
  }

  // ------------------------------------------------------------------------------- helpers for sequences
  get pp() {
    return this.game.player.position;
  }
  range(a, b) {
    return a + (b - a) * this.rng();
  }
  pick(list) {
    return list.length ? list[Math.floor(this.rng() * list.length)] : null;
  }
  /** Weighted pick of [item, weight] pairs. */
  weighted(pairs) {
    const total = pairs.reduce((s, p) => s + p[1], 0);
    let r = this.rng() * total;
    for (const p of pairs) if ((r -= p[1]) <= 0) return p[0];
    return pairs.at(-1)?.[0] ?? null;
  }
  sound(id, pos, opts = {}) {
    this.lastCueAt = this.time;
    return this.game.audio?.play?.(id, { position: pos, ...opts }) || null;
  }

  // ------------------------------------------------------------------------------- the run's arc + startle craft
  /** 1 | 2 | 3: the run's act, by the clock or by objectives done (whichever is further). */
  get act() {
    if (this.forceAct) return this.forceAct;
    const t = this.time;
    let a = t < 110 ? 1 : t < 255 ? 2 : 3;
    try {
      const done = this.game.objectives?.().filter((o) => o.done).length || 0;
      if (done >= 3) a = 3;
      else if (done >= 2) a = Math.max(a, 2);
    } catch { /* objectives unavailable */ }
    return a;
  }
  /** May a loud hit land now? (never on mild, never twice within STING_GAP, only once tension is up) */
  canSting(phaseOk = true) {
    // never while the player is reciting (recite.js): the prayer is never the set-up for a jump
    return this.intensity !== 'mild' && !this.reciting && this.time - this.lastStingAt >= this.stingGap && phaseOk;
  }
  /** Dead silence before a hit: the bed drops out fast, held for a random 0.8-2 s (never a learnable beat). */
  async hush(ctx, min = 0.8, max = 2) {
    this.duck(0.03, 0.12);
    ctx.onAbort(() => this.duck(1, 1.5));
    await ctx.wait(this.range(min, max));
  }
  /**
   * The hit. Waits out any cue played 0.03-0.5 s ago (a soft sound just before a loud one shrinks the startle),
   * then the sting (non-positional unless pos), a bodycam stutter, a tear and a small zoom kick.
   */
  async sting(ctx, { id = 'hw_sting', pos = null, volume = 1, glitch = 0.9, hold = 0.11, kick = 7, react = true } = {}) {
    const since = this.time - this.lastCueAt;
    if (since > 0.03 && since < 0.5) await ctx.wait(0.5 - since + 0.05);
    this.lastStingAt = this.time;
    this.game.audio?.play?.(id, pos ? { position: pos, volume } : { volume });
    this.lastCueAt = this.time;
    this.jolt({ glitch, hold, kick });
    if (react) this.react(0.35);
  }
  /**
   * The boy's reaction (playtest: a scare with no reaction reads as a bug): a gasp, then the heart. Every hit gets
   * one; sightings get one from _stare. At most one every 6 s so they never stack.
   */
  react(delay = 0.3, { gasp = 0.8, heart = 0.7 } = {}) {
    if (this.time - (this._lastReact ?? -99) < 6) return;
    this._lastReact = this.time;
    const a = this.game.audio;
    a?.play?.('hw_gasp', { volume: gasp, delay });
    a?.play?.('hw_heart', { volume: heart, delay: delay + 0.35 });
  }
  /**
   * The bodycam flinch: on a hit the view jerks up and to one side and settles back over ~0.4 s (the boy flinches;
   * it ends where it started, so aim is never moved). Not with reduced effects.
   */
  flinch(k = 1) {
    const p = this.game.player;
    if (!p || this.reducedFlash || p.settings?.reducedEffects || !(k > 0)) return;
    const s = this.rng() < 0.5 ? -1 : 1;
    this._flinch = { t: 0, ay: 0.05 * k * s, ap: 0.075 * k, ox: 0, op: 0 };
  }
  _flinchStep(dt) {
    const f = this._flinch, p = this.game.player;
    if (!f || !p) return;
    f.t += dt;
    // a fast jerk (40 ms), a shaky settle
    const t = f.t, up = Math.min(1, t / 0.04), env = up * Math.exp(-Math.max(0, t - 0.04) / 0.13);
    const shake = 1 + 0.35 * Math.sin(t * 70) * Math.exp(-t / 0.2);
    const ny = f.ay * env * shake, np = f.ap * env;
    p.yaw += ny - f.ox;
    p.pitch += np - f.op;
    f.ox = ny;
    f.op = np;
    if (t > 0.9) {
      p.yaw -= f.ox;
      p.pitch -= f.op;
      this._flinch = null;
    }
  }
  /** Screen side of a hit (respects reduced effects: no stutter, no zoom, a quarter of the tear). */
  jolt({ glitch = 0.9, hold = 0.11, kick = 7 } = {}) {
    const pf = this.game.postfx;
    if (pf) {
      pf.pulseGlitch(glitch);
      if (!this.reducedFlash && !pf.reduced && hold) pf.hold = hold;
    }
    const p = this.game.player;
    if (p && kick && !this.reducedFlash && !p.settings?.reducedEffects && typeof p._fov === 'number') p._fov -= kick;
    if (kick >= 4) this.flinch(Math.min(1.4, kick / 7));
  }
  duck(level, tau = 0.8) {
    this.game.audio?.seasonDuck?.(level, tau);
  }
  roomAt(p) {
    return this.game.world.getRoomAt(p.x, p.z) || null;
  }
  get room() {
    return this.gaze.room;
  }
  dist(a, b = this.pp) {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }
  /** Is pos in front of the player's view direction (cos of the angle on the ground ≥ dot)? */
  inFront(pos, dot = 0.3) {
    const f = this.gaze.forward;
    const dx = pos.x - this.gaze.eye.x, dz = pos.z - this.gaze.eye.z;
    const l = Math.hypot(dx, dz) || 1;
    const fl = Math.hypot(f.x, f.z) || 1;
    return (dx * f.x + dz * f.z) / (l * fl) >= dot;
  }
  /** Spots of the given kinds, filtered: { min, max, placeable, los, front, behind, notRoom, room }. */
  spots(kinds, o = {}) {
    const out = [];
    const list = (Array.isArray(kinds) ? kinds : [kinds]).flatMap((k) => this.spotsCat.of(k));
    const w = this.game.world;
    for (const s of list) {
      const d = this.dist(s.pos);
      if (o.min != null && d < o.min) continue;
      if (o.max != null && d > o.max) continue;
      if (o.notRoom != null && s.roomId === o.notRoom) continue;
      if (o.room != null && s.roomId !== o.room) continue;
      if (o.front != null && !this.inFront(s.pos, o.front)) continue;
      if (o.behind && this.inFront(s.pos, -0.35)) continue;
      if (o.doorOpen && !s.door?.isOpen) continue;
      if (o.los && !w.lineOfSight(this.gaze.eye, { x: s.pos.x, y: 1.4, z: s.pos.z })) continue;
      if (o.placeable && !this.gaze.canPlace(s.pos)) continue;
      out.push(s);
    }
    return out;
  }
  /** Best of a list for anti-habituation: least used spots first, a little random. */
  freshest(list) {
    if (!list.length) return null;
    let best = null, bs = -1;
    for (const s of list) {
      const sc = this.memory.novelty('spot', s.id) * this.memory.checkFactor(s.id) * (0.7 + this.rng() * 0.6);
      if (sc > bs) {
        bs = sc;
        best = s;
      }
    }
    return best;
  }
  /** A walkable floor point `dist` m along the view (± jitter), in clear sight of the eye. */
  ahead(dist, { lateral = 0.6, back = false } = {}) {
    const w = this.game.world;
    const f = this.gaze.forward;
    const fl = Math.hypot(f.x, f.z) || 1;
    const fx = (back ? -f.x : f.x) / fl, fz = (back ? -f.z : f.z) / fl;
    for (let k = 0; k < 6; k++) {
      const d = dist * (1 - k * 0.08);
      const l = (this.rng() - 0.5) * 2 * lateral;
      const x = this.pp.x + fx * d - fz * l, z = this.pp.z + fz * d + fx * l;
      if (!w.isWalkable(x, z, 0.25, 0)) continue;
      if (!w.lineOfSight(this.gaze.eye, { x, y: 0.4, z })) continue;
      if (!w.lineOfSight(this.gaze.eye, { x, y: 3.0, z })) continue;
      return { x, y: 0, z };
    }
    return null;
  }
  /** After a sound at pos: did the player react (look towards it / walk to it) within sec? → memory. */
  async reaction(ctx, motif, pos, sec = 4) {
    const d0 = this.dist(pos);
    const ok = await ctx.until(() => this.gaze.facing(pos, 30) || this.dist(pos) < d0 - 2.5, sec);
    if (ok) this.memory.heardSound(motif);
    else this.memory.ignoredSound(motif);
    return ok;
  }
  /** Run fn after sec s of game time (pauses with the game; dropped when the run ends). */
  /**
   * Something in the school changed while you weren't looking (a poster, a board, a clock, a drawing). The first
   * time you look straight at it, a quiet swell: you notice (playtest: these went by unnoticed). The drawing that
   * now says "behind you" breathes on your neck a moment later.
   */
  noteChange(kind, pos) {
    (this.changes ||= []).push({ kind, x: pos.x, y: pos.y || 0, z: pos.z, at: this.time, look: 0 });
    if (this.changes.length > 12) this.changes.shift();
  }

  _noticeStep(dt) {
    const list = this.changes;
    if (!list?.length) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      if (this.time - c.at > 600) {
        list.splice(i, 1);
        continue;
      }
      // (tested a little out from the wall it hangs on, towards you: the wall blocks a ray to its own surface)
      const e = this.gaze.eye, f = this.gaze.forward;
      const hx = e.x - c.x, hz = e.z - c.z, hl = Math.hypot(hx, hz) || 1;
      const t = this.gaze.test({ x: c.x + (hx / hl) * 0.25, y: 0, z: c.z + (hz / hl) * 0.25 }, { heights: [c.y] });
      // looking at it (the angle to the thing itself, at its height: test() measures to 1.4 m)
      const vx = c.x - e.x, vy = c.y - e.y, vz = c.z - e.z, vl = Math.hypot(vx, vy, vz) || 1;
      const look = Math.acos(Math.max(-1, Math.min(1, (vx * f.x + vy * f.y + vz * f.z) / vl)));
      c.look = t.perceived && t.dist < 7 && look < 0.32 ? c.look + dt : Math.max(0, c.look - dt);
      if (c.look < 0.4) continue;
      list.splice(i, 1);
      // never over a big moment, a glimpse or the recitation; at most one every 25 s
      if (this.fg?.def.major || this._glimpsing || this.bo?.active || this.time - this._noticeAt < 25) continue;
      this._noticeAt = this.time;
      this.game.audio?.play?.('hw_swell', { volume: 0.32 });
      this._log?.('notice', c.kind);
      if (c.kind === 'drawing' && this.intensity !== 'mild') {
        this.later(1.4, () => {
          const e = this.gaze.eye, f = this.gaze.forward;
          this.sound('hw_breath', { x: e.x - f.x * 0.35, y: e.y, z: e.z - f.z * 0.35 }, { volume: 0.7 });
        });
      }
    }
  }

  later(sec, fn) {
    (this._timers ||= []).push({ at: this.time + sec, fn });
  }
  markSpot(id, pos) {
    if (!id) return;
    this.eventSpots.push({ id, x: pos.x, z: pos.z, at: this.time, checked: false });
    if (this.eventSpots.length > 30) this.eventSpots.shift();
  }
  info() {
    const g = this.game, e = g.enemy, p = g.player;
    const est = e?.enabled === false ? 'IDLE' : e?.state || 'IDLE';
    return {
      chase: est === 'CHASE' || est === 'CAPTURE',
      hunted: est === 'CHASE' || est === 'CAPTURE' || est === 'SEARCH',
      alert: est === 'SUSPICIOUS' || est === 'INVESTIGATE',
      caretakerDist: e?.position && p ? Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z) : 99,
      overlay: (g.overlays?.size || 0) > 0,
      hidden: !!p?.isHidden,
      moving: !!p?.isMoving,
    };
  }

  // ------------------------------------------------------------------------------- the frame
  update(dt) {
    if (!this.started || !this.enabled) return;
    this.time += dt;
    this._flinchStep(dt);
    this._noticeStep(dt);
    // waits
    if (this._waits.length) {
      const now = this.time;
      const keep = [];
      for (const w of this._waits) {
        if (w.ctx.aborted) w.rej(ABORT);
        else if (w.pred && w.pred()) w.res(true);
        else if (now >= w.at) w.res(w.pred ? false : true);
        else keep.push(w);
      }
      this._waits = keep;
    }
    if (this._timers?.length) {
      const due = this._timers.filter((t) => t.at <= this.time);
      if (due.length) {
        this._timers = this._timers.filter((t) => t.at > this.time);
        for (const t of due) {
          try {
            t.fn();
          } catch (err) {
            console.warn('[director] timer failed', err);
          }
        }
      }
    }
    // safety net: nothing a finished / aborted haunt showed may linger (each still leaves only when unseen)
    const running = [this.fg, this.boFg, ...this.bg].filter(Boolean);
    if (this.watcher.active && !this.watcher.pending && !running.some((c) => c.def.uses?.includes('watcher'))) this.watcher.vanish('unseen');
    if (this.pane?.mesh.visible && !running.some((c) => c.def.uses?.includes('pane'))) this.pane.hideWhenUnseen();
    const info = this.info();
    // a chase / capture ends every foreground haunt (and the blackout) immediately
    if (info.chase) {
      if (this.fg) this.abort(this.fg, 'chase');
      if (this.bo.active && this.boCtx) this.abort(this.boCtx, 'chase');
    }
    if (this._wasChase && !info.chase) this.chaseEndedAt = this.time;
    this._wasChase = info.chase;
    this._heuristics(dt);
    this._stare();
    if (this.auto) this._tickBlackout(info);
    if (this.bo.active || !this.auto) return;
    // while the player whispers Al-Fatiha nothing new starts (recite.js); the arc resumes a little after the amin
    if (this.reciting) {
      this.aftershockAt = null;
      this.nextTry = Math.max(this.nextTry, this.time + 10);
      return;
    }
    // the fear window after a chase: once he's gone and quiet, tension goes straight to dread
    const sc = this.chaseEndedAt != null ? this.time - this.chaseEndedAt : -1;
    if (sc > 15 && !info.hunted && !info.alert && info.caretakerDist > 14 && this.act >= 2) {
      this.chaseEndedAt = null;
      if (this.phase === 'CALM' || this.phase === 'UNEASE' || this.phase === 'RECOVERY') {
        this._enter('DREAD');
        this.nextTry = this.time + this.range(3, 8);
        this._log('fear-window', 'after chase');
      }
    } else if (sc > 60) this.chaseEndedAt = null;
    // a promise: the run's first big moment by about two and a half minutes (a blackout doesn't count)
    if (!this.bigHaunts && this.time > 150 && !this.fg && (this.phase === 'CALM' || this.phase === 'UNEASE' || (this.phase === 'RECOVERY' && this.phaseT > 12))) {
      this._enter('DREAD');
      this.nextTry = this.time + this.range(2, 5);
      this._log('promise', 'first peak');
    }
    // the second scare: lands in the calm after a peak, when the guard drops
    if (this.aftershockAt != null && this.time >= this.aftershockAt && !this.fg) {
      this.aftershockAt = null;
      const list = this.candidates(info, 'AFTER');
      if (list.length) {
        const c = this.weighted(list.map((c) => [c, c.score]));
        this._log('aftershock', c.def.id);
        this._run(c.def, c.plan);
      }
    }
    // tension
    this.budget = Math.min(BUDGET_MAX, this.budget + GAIN[this.phase] * this.int.gain * (this.flavor === 'restless' ? 1.25 : this.flavor === 'quiet' ? 0.75 : 1) * dt);
    this.phaseT += dt;
    if (this.phase === 'PEAK') {
      if (!this.fg && (this.peakDone || this.phaseT > this.phaseLen)) this._enter('RECOVERY');
    } else if (this.phaseT > this.phaseLen && !this.fg) this._enter(this._next());
    if (this.time >= this.nextTry) {
      this.nextTry = this.time + this.range(...EVERY[this.phase]) * (this.flavor === 'quiet' ? 1.25 : this.flavor === 'restless' ? 0.8 : 1);
      this._try(info);
    }
  }

  /** The next state. A run that hasn't peaked for a while leans towards DREAD → PEAK (never forced). */
  _next() {
    const since = this.time - Math.max(this.lastMajorAt, 0);
    let k = this.time > 120 && since > 150 ? 1 + (since - 150) / 60 : 1;
    if (!this.bigHaunts && this.time > 80) k = Math.max(k, 2.5); // the first big moment (a blackout doesn't count) shouldn't wait long
    if (this.act >= 3 && !this.signatureDone) k *= 1.8; // act III is heading for its one big moment
    return this.weighted(NEXT[this.phase].map(([p, w]) => [p, p === 'PEAK' || p === 'DREAD' ? w * k : w]));
  }

  _enter(p) {
    this.phase = p;
    this.phaseT = 0;
    const [a, b] = PHASE_LEN[p];
    const k = this.flavor === 'quiet' && (p === 'CALM' || p === 'RECOVERY') ? 1.3 : this.flavor === 'restless' && p !== 'PEAK' ? 0.8 : 1;
    this.phaseLen = (a + (b - a) * (this.rng?.() ?? 0.5)) * k;
    this.peakDone = false;
    if (p === 'PEAK') this.nextTry = this.time + 0.5;
    if (p === 'RECOVERY') this.nextTry = this.time + this.range(...EVERY.RECOVERY);
    this._log('phase', p);
  }

  _heuristics(dt) {
    const g = this.gaze;
    const hid = !!this.game.player?.isHidden;
    if (hid && !this._wasHidden) this.hiddenSince = this.time;
    this._wasHidden = hid;
    if (g.lastTurnAround !== this._lastTurnSeen && g.lastTurnAround > 0) {
      this._lastTurnSeen = g.lastTurnAround;
      this.turns++;
    }
    // spot checks: looking straight at a place where something happened before
    this._checkAcc += dt;
    if (this._checkAcc > 0.5) {
      this._checkAcc = 0;
      for (const s of this.eventSpots) {
        if (s.checked || this.time - s.at < 6) continue;
        if (this.dist(s) < 10 && this.gaze.facing(s, 12) && this.game.world.lineOfSight(this.gaze.eye, { x: s.x, y: 1.2, z: s.z })) {
          s.checked = true;
          this.memory.checked(s.id);
        }
      }
    }
  }

  /**
   * Looking at it has a cost: from act II, holding the Watcher in view starts a low rising swell and the bodycam
   * begins to struggle (a little tear that grows the longer you stare). Looking away ends both.
   */
  _stare() {
    const w = this.watcher;
    const on = w.active && w.seen && !this.bo.active && !this._glimpsing;
    // the boy reacts to every sighting (playtest: a figure that is just there and gone, with no reaction, reads as a
    // bug): a gasp, the heart, the bodycam struggling. Glimpses do their own (glimpse.js).
    if (on && w.appearedAt !== this._reactedTo) {
      this._reactedTo = w.appearedAt;
      if (this.time - (this._lastReact ?? -99) > 20) {
        this.react(0, { gasp: 0.75, heart: 0.6 });
        const pf = this.game.postfx;
        if (pf && !this.reducedFlash) pf.glitch = Math.max(pf.glitch, 0.35);
      }
    }
    if (on) {
      if (!this._swell && w.seenFor > 0.4) this._swell = this.game.audio?.play?.('hw_swell', { volume: this.act >= 2 ? 0.8 : 0.55 }) || { stop() {} };
      const pf = this.game.postfx;
      if (pf && !this.reducedFlash) pf.glitch = Math.max(pf.glitch, Math.min(this.act >= 2 ? 0.32 : 0.18, 0.05 + w.seenFor * 0.08));
    } else if (this._swell) {
      this._swell.stop(0.35);
      this._swell = null;
    }
  }

  /** Turnarounds per minute (this run). */
  get turny() {
    return this.turns / Math.max(1, this.time / 60);
  }

  // ------------------------------------------------------------------------------- choosing
  _gate(def, info) {
    if (info.chase) return false;
    if (def.blackout && !this.bo.active) return false;
    if (!def.blackout && this.bo.active && !def.bg) return false;
    if (def.bg) return !info.hunted;
    if (info.hunted || info.overlay) return false;
    if (def.hidden != null && def.hidden !== info.hidden) return false; // hiding-spot haunts only while hidden
    if (def.major && (info.alert || info.caretakerDist < 14 || (info.hidden && !def.hidden))) return false;
    if (!def.major && info.caretakerDist < 7) return false;
    if (def.needsMoving && !info.moving) return false;
    return def.gate ? def.gate(this, info) !== false : true;
  }

  _compatible(def) {
    const running = [this.fg, ...this.bg].filter(Boolean).map((c) => c.def);
    if (!def.bg && this.fg) return false;
    if (def.bg && this.bg.size >= 2) return false;
    for (const r of running) for (const ch of def.uses || []) if ((r.uses || []).includes(ch)) return false;
    for (const [key, sec] of Object.entries(def.notAfter || {})) {
      const t = this.lastEnd[key] ?? this._lastMotifAt?.[key];
      if (t != null && this.time - t < sec) return false;
    }
    return true;
  }

  _score(def, plan) {
    const m = this.memory;
    let s = (def.weight ?? 1) * m.novelty('seq', def.id);
    for (const mo of def.motifs || []) s *= m.ignoreFactor(mo) * Math.sqrt(m.novelty('motif', mo));
    if (plan?.spot?.id) s *= m.checkFactor(plan.spot.id) * Math.sqrt(m.novelty('spot', plan.spot.id));
    if (this.lastMotif && def.motifs?.includes(this.lastMotif)) s *= 0.35;
    // behaviour: players who keep checking behind them get it in front; those who never do, behind
    if (def.behind) s *= this.turny > 2.5 ? 0.45 : this.turny < 0.6 ? 1.5 : 1;
    if (def.watcher && m.p.approached > 2) s *= def.far ? 1.35 : 0.7;
    if (def.ambient && this.gaze.stillFor > 12) s *= 1.6;
    if (def.signature && this.act >= 3 && !this.signatureDone) s *= 4; // the run's climax: one of these, whichever is freshest
    // the arc needs it introduced before it breaks the rules: acts I-II lean towards a sighting until there's been one or two
    if (def.watcher && !def.major && this.act <= 2 && (this.watcherBeats || 0) < 2) s *= this.watcherBeats ? 1.8 : this.time > 60 ? 6 : 3;
    // promises: a player should meet the blood within the first minute or so, and a head early in act II
    const kinds = this.kinds || {};
    if (def.uses?.includes('blood') && !kinds.blood && this.time > 40) s *= def.bg ? 2 : 6;
    if (def.head && !kinds.head) s *= 5;
    return s * (0.6 + this.rng() * 0.8);
  }

  candidates(info = this.info(), phase = this.phase) {
    const out = [];
    for (const def of this.catalog) {
      if (!def.phases.includes(phase) && !(def.blackout && this.bo.active)) continue;
      if (!this._affordable(def, phase)) continue;
      // (the first head is promised: it may come before act II, from 80 s)
      if (def.act && this.act < def.act && !(def.head && !this.kinds?.head && this.time > 80)) continue;
      if (def.once && this.once.has(def.id)) continue;
      if (def.sting && !this.canSting()) continue; // a haunt built around a loud hit waits for the gap
      if (def.major && this.time - this.lastMajorAt < this.int.majorGap) continue;
      if (this.time - (this.lastEnd[def.id] ?? -999) < (def.cooldown ?? 45)) continue;
      if (def.max && this.memory.usedThisRun('seq', def.id) >= def.max) continue;
      if (def.head && this.headsUsed >= this.int.heads) continue;
      if (def.minTime && this.time < def.minTime) continue;
      if (def.intensity && !def.intensity.includes(this.intensity)) continue;
      if (!this._compatible(def) || !this._gate(def, info)) continue;
      let plan = null;
      try {
        plan = def.plan ? def.plan(this, info) : {};
      } catch (err) {
        console.warn('[director] plan failed', def.id, err);
      }
      if (!plan) continue;
      out.push({ def, plan, score: this._score(def, plan) });
    }
    return out;
  }

  /** Budget rule: majors may run a little into debt; DREAD keeps a reserve so the peak can afford one. */
  _affordable(def, phase = this.phase) {
    const c = def.cost || 0;
    if (phase === 'AFTER') return true; // the aftershock was paid for by the peak
    if (def.bg) return c <= this.budget + 2;
    if (def.major) return c <= this.budget + 1.5;
    if (phase === 'DREAD') return this.budget - c >= RESERVE;
    return c <= this.budget;
  }

  _try(info) {
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      return this.play(f.id, f.plan);
    }
    const list = this.candidates(info);
    // background haunts tick along on their own; the foreground pick follows the phase
    const bgs = list.filter((c) => c.def.bg);
    const fgs = list.filter((c) => !c.def.bg);
    if (bgs.length && this.rng() < (this.phase === 'CALM' ? 0.55 : 0.4)) {
      const c = this.weighted(bgs.map((c) => [c, c.score]));
      this._run(c.def, c.plan);
    }
    if (!fgs.length) {
      if (this.phase === 'PEAK' && this.phaseT > 8) this.peakDone = true; // nothing fits: the peak is a held breath
      return;
    }
    const pool = this.phase === 'PEAK' ? fgs.filter((c) => c.def.major) : fgs.filter((c) => !c.def.major || this.phase === 'DREAD' && c.def.dreadOk);
    if (!pool.length) return;
    const c = this.weighted(pool.map((c) => [c, c.score]));
    this._run(c.def, c.plan);
  }

  /** Debug / tests: run a sequence by id now (gates are skipped, plan must still succeed). */
  play(id, plan) {
    const def = this.catalog.find((d) => d.id === id);
    if (!def || !this.started) return false;
    const p = plan || def.plan?.(this, this.info()) || null;
    if (!p) return false;
    this._run(def, p, true);
    return true;
  }

  async _run(def, plan, forced = false) {
    const slot = def.bg ? 'bg' : def.blackout ? 'bo' : 'fg';
    const ctx = new Ctx(this, def, slot);
    ctx.spot = plan?.spot || null;
    if (slot === 'fg') this.fg = ctx;
    else if (slot === 'bg') this.bg.add(ctx);
    else this.boFg = ctx;
    if (!forced) this.budget = Math.max(-1.5, this.budget - (def.cost || 0));
    if (def.once) this.once.add(def.id);
    if (def.watcher) this.watcherBeats = (this.watcherBeats || 0) + 1;
    const kinds = (this.kinds ||= { blood: 0, head: 0 });
    if (def.uses?.includes('blood')) kinds.blood++;
    if (def.head) kinds.head++;
    if (def.major && !def.blackout) this.bigHaunts = (this.bigHaunts || 0) + 1;
    this._log('start', def.id, ctx.spot?.id);
    let res = 'done';
    try {
      res = (await def.run(this, ctx, plan)) ?? 'done';
    } catch (err) {
      if (err !== ABORT) console.warn('[director] sequence failed', def.id, err);
      res = err === ABORT ? 'aborted:' + (ctx.reason || '?') : 'error';
    } finally {
      for (const fn of ctx.cleanups.reverse()) {
        try {
          fn(res);
        } catch (err) {
          console.warn('[director] cleanup failed', def.id, err);
        }
      }
      if (this.fg === ctx) this.fg = null;
      if (this.boFg === ctx) this.boFg = null;
      this.bg.delete(ctx);
    }
    this.lastEnd[def.id] = this.time;
    this._lastMotifAt ||= {};
    for (const m of def.motifs || []) this._lastMotifAt[m] = this.time;
    if (def.motifs?.length && !def.bg) this.lastMotif = def.motifs[0];
    if (ctx.res) res = ctx.res;
    this.memory.event({ t: this.time, seq: def.id, spot: ctx.spot?.id, pose: ctx.pose, motifs: def.motifs, intensity: def.cost, major: !!def.major, res: String(res).split(':')[0] });
    if (def.major && !String(res).startsWith('aborted') && res !== 'skipped') {
      this.lastMajorAt = this.time;
      this.majors++;
      this.run.peaks?.push(this.time);
      if (this.phase === 'PEAK') this.peakDone = true;
      if (!forced && this.rng() < AFTERSHOCK[this.act]) this.aftershockAt = this.time + this.range(6, 14);
      if (def.signature) this.signatureDone = true;
    }
    this._log('end', def.id, res);
    return res;
  }

  abort(ctx, reason) {
    if (!ctx || ctx.aborted) return;
    ctx.aborted = true;
    ctx.reason = reason;
  }

  abortAll(reason) {
    for (const c of [this.fg, this.boFg, this.boCtx, ...this.bg]) this.abort(c, reason);
    // flush waits now so cleanups run before anything else happens
    const ws = this._waits;
    this._waits = [];
    for (const w of ws) w.rej(ABORT);
  }

  _log(kind, a, b) {
    this.log.push({ t: +this.time.toFixed(1), kind, a, b });
    if (this.log.length > 120) this.log.shift();
  }

  // ------------------------------------------------------------------------------- blackouts
  _boSafe(info) {
    return !info.hunted && !info.alert && !info.overlay && info.caretakerDist > 10 && !(this.fg?.def.major) && !this.heads?.falling;
  }

  _tickBlackout(info) {
    const B = this.cfg.blackout;
    const bo = this.bo;
    if (bo.active || bo.count >= B.max || this.time < bo.nextAt) return;
    if ((this.game.timeLeft ?? 999) < B.latest) {
      bo.count = B.max; // too late in the run: no more blackouts
      return;
    }
    if (!this._boSafe(info)) {
      bo.nextAt = this.time + B.retry;
      if (this.time - bo.dueAt > (B.maxDelay ?? 45)) {
        // postponed too long: this one is skipped (still counts), the next keeps the normal gap
        bo.count++;
        bo.skipped++;
        bo.dueAt = bo.nextAt = this.time + B.gap;
        this._log('blackout', 'skipped');
      }
      return;
    }
    // a minor foreground haunt gives way
    if (this.fg) this.abort(this.fg, 'blackout');
    this._blackout();
  }

  _pickVariant() {
    let list = BLACKOUT_VARIANTS.filter((v) => !(this.reducedFlash && v.flashy));
    // never the same as this run's last, and prefer the ones this profile has seen least
    const fresh = list.filter((v) => v.id !== this.bo.variants.at(-1));
    if (fresh.length) list = fresh;
    return this.weighted(list.map((v) => [v, (v.weight ?? 1) * this.memory.novelty('blackout', v.id) * (0.7 + this.rng() * 0.6)]));
  }

  async _blackout() {
    const B = this.cfg.blackout;
    const bo = this.bo;
    const v = this._pickVariant();
    bo.active = true;
    bo.variants.push(v.id);
    bo.startedAt = this.time;
    const ctx = new Ctx(this, { id: 'blackout:' + v.id, uses: ['lights'] }, 'bo');
    this.boCtx = ctx;
    this._log('blackout', v.id);
    let drone = null;
    let res = 'done';
    this.dark = true; // the Caretaker's fixed dark rule starts with the onset
    try {
      await v.onset(this, ctx);
      drone = this.game.audio?.seasonLoop?.('hw_drone', 0.32);
      this.duck(0.45, 1.2);
      // the dark lasts exactly B.dark s from the onset, whatever the variant does inside it
      const until = bo.startedAt + B.dark;
      const inner = this._boInner();
      if (inner) this._run(inner.def, inner.plan);
      if (v.during) await v.during(this, ctx, until);
      await ctx.wait(Math.max(0, until - this.time - 0.6));
      // the restore beat: what the lights reveal
      if (this.boFg) this.abort(this.boFg, 'restore');
      const reveal = this._boReveal();
      if (reveal) await reveal.def.run(this, ctx, reveal.plan).catch((e) => { if (e !== ABORT) throw e; });
      await ctx.wait(Math.max(0, until - this.time));
    } catch (err) {
      if (err !== ABORT) console.warn('[director] blackout failed', err);
      res = err === ABORT ? 'aborted:' + ctx.reason : 'error';
    } finally {
      if (this.boFg) this.abort(this.boFg, 'restore');
      for (const fn of ctx.cleanups.reverse()) {
        try {
          fn(res);
        } catch (err) {
          console.warn('[director] blackout cleanup failed', err);
        }
      }
      this.dark = false;
      this.lights.restoreAll(ctx.reason === 'chase' ? 0.6 : B.restore);
      this.duck(1, 1.5);
      drone?.stop(2);
      this.sound('hw_breaker', { x: this.pp.x + 14, y: 1.5, z: this.pp.z + 6 }, { volume: 0.5, rate: 1.15 });
      bo.active = false;
      bo.count++;
      bo.dueAt = bo.nextAt = this.time + B.gap;
      this.boCtx = null;
      this.memory.event({ t: this.time, seq: 'blackout', blackout: v.id, intensity: 3, major: true, res: String(res).split(':')[0] });
      this.lastMajorAt = this.time;
      this._enter('RECOVERY');
      this._log('blackout-end', v.id, res);
    }
  }

  _boInner() {
    const info = this.info();
    const list = this.candidates(info).filter((c) => c.def.blackout && !c.def.onRestore);
    return list.length && this.rng() < 0.85 ? this.weighted(list.map((c) => [c, c.score])) : null;
  }

  _boReveal() {
    const info = this.info();
    const list = this.candidates(info).filter((c) => c.def.onRestore);
    return list.length && this.rng() < 0.6 ? this.weighted(list.map((c) => [c, c.score])) : null;
  }

  // ------------------------------------------------------------------------------- dev / tests
  /** Debug: what the blackout scheduler is doing. */
  blackoutState() {
    const B = this.cfg.blackout;
    return { ...this.bo, dark: this.dark, rules: B, now: +this.time.toFixed(1) };
  }

  /** Debug: start a blackout now — still only when it is safe (no chase, no major haunt, no falling head). */
  forceBlackout() {
    if (!this.started || this.bo.active || !this._boSafe(this.info())) return false;
    this.bo.nextAt = this.time;
    this.bo.dueAt = this.time;
    this._blackout();
    return true;
  }

  /**
   * Headless: n simulated runs of 8 minutes on a scratch memory (never localStorage). Gates and spot
   * plans are assumed to pass; returns how often each sequence played and when the majors landed, to show
   * the variety the memory produces across runs on one profile.
   */
  static simulateRuns(n = 5, { seed = 1, intensity = 'standard', len = 480 } = {}) {
    const mem = new HauntMemory('sim', { getItem: () => null, setItem: () => {} });
    const runs = [];
    const fakeGaze = { lastTurnAround: -99, stillFor: 0, room: null };
    for (let r = 0; r < n; r++) {
      const d = Object.create(HorrorDirector.prototype);
      Object.assign(d, { catalog: SEQUENCES, memory: mem, gaze: fakeGaze, cfg: { blackout: { firstAfter: 9e9 } }, int: INTENSITY[intensity], intensity, _waits: [], bg: new Set(), log: [] });
      d.rng = rngFrom(seed * 977 + r * 131);
      d.run = mem.beginRun({ seed, rng: d.rng });
      d.flavor = d.run.flavor;
      Object.assign(d, { time: 0, budget: 3, lastEnd: {}, lastMajorAt: -999, majors: 0, headsUsed: 0, turns: 0, bo: { active: false }, fg: null, once: new Set(), forceAct: 0 });
      d._enter('CALM');
      d.nextTry = 15;
      const played = [];
      const info = { chase: false, hunted: false, alert: false, caretakerDist: 99, overlay: false, hidden: false, moving: true };
      for (let t = 0; t < len; t += 0.5) {
        d.time = t;
        d.budget = Math.min(BUDGET_MAX, d.budget + GAIN[d.phase] * d.int.gain * 0.5);
        d.phaseT += 0.5;
        if (d.fg && t >= d.fg.until) {
          if (d.fg.def.major) {
            d.lastMajorAt = t;
            if (d.phase === 'PEAK') d.peakDone = true;
          }
          d.lastEnd[d.fg.def.id] = t;
          d.fg = null;
        }
        if (d.phase === 'PEAK') {
          if (!d.fg && (d.peakDone || d.phaseT > d.phaseLen)) d._enter('RECOVERY');
        } else if (d.phaseT > d.phaseLen && !d.fg) d._enter(d._next());
        if (!d.bigHaunts && t > 150 && !d.fg && (d.phase === 'CALM' || d.phase === 'UNEASE' || (d.phase === 'RECOVERY' && d.phaseT > 12))) d._enter('DREAD');
        if (t < d.nextTry || d.fg) continue;
        d.nextTry = t + d.range(...EVERY[d.phase]);
        const list = [];
        for (const def of SEQUENCES) {
          if (def.bg || def.blackout || def.hidden || !def.phases.includes(d.phase)) continue;
          if (def.act && d.act < def.act && !(def.head && !d.kinds?.head && t > 80)) continue;
          if (def.once && d.once.has(def.id)) continue;
          if (!d._affordable(def)) continue;
          if (def.major && t - d.lastMajorAt < d.int.majorGap) continue;
          if (t - (d.lastEnd[def.id] ?? -999) < (def.cooldown ?? 45)) continue;
          if (def.max && mem.usedThisRun('seq', def.id) >= def.max) continue;
          if (def.head && d.headsUsed >= d.int.heads) continue;
          if (def.intensity && !def.intensity.includes(intensity)) continue;
          if (d.phase === 'PEAK' ? !def.major : def.major && !(d.phase === 'DREAD' && def.dreadOk)) continue;
          list.push([def, d._score(def, {})]);
        }
        if (!list.length) {
          if (d.phase === 'PEAK' && d.phaseT > 8) d.peakDone = true;
          continue;
        }
        const def = d.weighted(list);
        d.budget = Math.max(-1.5, d.budget - (def.cost || 0));
        if (def.head) d.headsUsed++;
        if (def.once) d.once.add(def.id);
        if (def.watcher) d.watcherBeats = (d.watcherBeats || 0) + 1;
        const kinds = (d.kinds ||= { blood: 0, head: 0 });
        if (def.uses?.includes('blood')) kinds.blood++;
        if (def.head) kinds.head++;
        if (def.major) d.bigHaunts = (d.bigHaunts || 0) + 1;
        d.fg = { def, until: t + (def.simLen || 12) };
        mem.event({ t, seq: def.id, motifs: def.motifs, major: !!def.major });
        played.push({ t, id: def.id, phase: d.phase });
      }
      mem.endRun({ result: 'sim' });
      runs.push({ flavor: d.flavor, events: played.length, majors: played.filter((p) => SEQUENCES.find((s) => s.id === p.id)?.major).map((p) => p.t), seq: played.map((p) => p.id), times: played.map((p) => p.t) });
    }
    // how different consecutive runs are, in order: 1 - longest common subsequence / longer run
    const lcs = (a, b) => {
      const m = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] + 1 : Math.max(m[i - 1][j], m[i][j - 1]);
      return m[a.length][b.length];
    };
    const diff = [];
    for (let i = 1; i < runs.length; i++) {
      const a = runs[i - 1].seq, b = runs[i].seq;
      diff.push(+(1 - lcs(a, b) / Math.max(1, a.length, b.length)).toFixed(2));
    }
    const opening = new Set(runs.map((r) => r.seq.slice(0, 3).join('>'))).size; // distinct first three beats
    return { runs, consecutiveDifference: diff, distinctOpenings: opening };
  }
}
