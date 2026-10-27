// LAST BELL — The Halloween Shift: the Horror Director debug panel. DEVELOPMENT ONLY.
//
// Loaded only when config.js DEBUG_PANEL is true: the page is on localhost AND has ?hwdebug=1. On a real
// HallPass page this file is never imported. Any run played with it loaded is flagged 'debug' and never
// ranked (score.js). Toggle with F8.
//
// Shows the tension state, budget, flavour, running haunts, the blackout scheduler, the last log lines and
// the anti-habituation memory; buttons force a haunt or a blackout, simulate runs, reset the memory, and
// switch subsystems off (watcher / lights / posters / blood).
//
// Look-around mode (for watching the scares, not playing): `&look=1`, or the "safe" box. The Caretaker is
// parked out of the building and the clock stands still; the tour plays the showcase scares one after
// another wherever the player is. Keys: H panel, N next scare, J blackout, O opening glimpse (F8 also toggles the panel).

import { HorrorDirector } from './director.js';
import { ScareGallery } from './gallery.js';
import { DEBUG_PANEL } from './config.js';

// the tour: the scares worth seeing, building up ('blackout' = a forced blackout). It plays the act III versions
// (closest, with the hits) and lets the hits come closer together than a real run would.
const TOUR = ['light_glimpse', 'whisper_behind', 'red_light', 'copy_steps', 'pane_face', 'bait_switch', 'watcher_peek', 'hum_wrong', 'ceiling_drip',
  'signal_lost', 'blood_reveal', 'head_drop', 'behind_you', 'blackout', 'watcher_reveal', 'locker', 'charge', 'watcher_window', 'head_behind'];
const LOOK = (() => {
  try {
    return new URLSearchParams(location.search).get('look') === '1';
  } catch {
    return false;
  }
})();
// `&gallery=1`: open the scare gallery as soon as the run starts
const GALLERY = (() => {
  try {
    return new URLSearchParams(location.search).get('gallery') === '1';
  } catch {
    return false;
  }
})();
// `&scare=<id>`: open straight into one scare from the gallery (gallery.js)
const SCARE = (() => {
  try {
    return new URLSearchParams(location.search).get('scare') || null;
  } catch {
    return null;
  }
})();
// `&safe=1`: a real run at real pacing (the director decides everything), just without the Caretaker and the clock
const SAFE = (() => {
  try {
    return new URLSearchParams(location.search).get('safe') === '1';
  } catch {
    return false;
  }
})();

export class HwDebug {
  constructor(mode) {
    if (!DEBUG_PANEL) throw new Error('debug panel is development-only');
    this.mode = mode;
    this.d = mode.director;
    const el = (this.el = document.createElement('aside'));
    el.className = 'hw-debug';
    el.hidden = true;
    el.innerHTML = `
      <header>Horror Director <small>dev only · F8</small></header>
      <pre class="hw-debug__state"></pre>
      <div class="hw-debug__row"><select class="hw-debug__seq"></select><button data-a="play">Play</button><button data-a="bo">Blackout</button></div>
      <div class="hw-debug__row">
        <label><input type="checkbox" data-sys="watcher" checked> watcher</label>
        <label><input type="checkbox" data-sys="lights" checked> lights</label>
        <label><input type="checkbox" data-sys="posters" checked> posters</label>
        <label><input type="checkbox" data-sys="blood" checked> blood</label>
        <label><input type="checkbox" data-sys="director" checked> director</label>
      </div>
      <div class="hw-debug__row">
        <label><input type="checkbox" data-sys="safe"${LOOK || SAFE ? ' checked' : ''}> safe (no Caretaker, clock stopped)</label>
        <button data-a="tour">${LOOK ? 'Stop tour' : 'Start tour'}</button><button data-a="next">Next scare</button><button data-a="gallery">Scare gallery (B)</button>
      </div>
      <div class="hw-debug__row"><button data-a="sim">Simulate 6 runs</button><button data-a="mem">Memory</button><button data-a="reset">Reset memory</button></div>
      <pre class="hw-debug__log"></pre>`;
    document.body.appendChild(el);
    const sel = el.querySelector('.hw-debug__seq');
    for (const def of this.d.catalog) sel.add(new Option(`${def.id}${def.major ? ' ★' : ''}${def.blackout ? ' (dark)' : ''}`, def.id));
    el.addEventListener('click', (e) => this._click(e));
    el.addEventListener('change', (e) => this._toggle(e));
    this._onKey = (e) => {
      if (e.repeat || e.target?.closest?.('input, textarea, select')) return;
      if (e.code === 'F8' || e.code === 'KeyH') {
        e.preventDefault();
        el.hidden = !el.hidden;
        if (!el.hidden) this.mode.game.player?.unlockPointer?.();
      } else if (e.code === 'KeyN') this._next();
      else if (e.code === 'KeyJ') this._click({ target: { dataset: { a: 'bo' } } });
      else if (e.code === 'KeyB') this.gallery.toggle();
      else if (e.code === 'KeyO') {
        // replay the opening glimpse from wherever the player is looking
        this.mode.markDebug('forced');
        this._out = this.mode.opening.arm({ now: true }) ? `opening armed (${this.mode.opening.variant}): look down the corridor` : 'opening: no dark-able corridor light 9-15 m ahead';
      }
    };
    addEventListener('keydown', this._onKey);
    this._acc = 0;
    this._out = '';
    this.safe = false;
    this.tour = null;
    this.gallery = new ScareGallery(this);
    this._scareLink = SCARE;
    this._galleryLink = GALLERY;
    if (SAFE && !LOOK) this._setSafe(true);
    if (LOOK) {
      this._setSafe(true);
      this.tour = { i: 0, wait: 2, busy: 0 };
      this.d.forceAct = 3;
      this.d.stingGap = 6;
    }
  }

  // ------------------------------------------------------------------ look-around mode
  _setSafe(on) {
    const g = this.mode.game;
    const e = g.enemy;
    this.safe = on;
    this.mode.markDebug('safe');
    if (!on && e && g.state === 'playing') {
      e.object.visible = true;
      e.spawn(g.world.enemySpawn.position, g.world.enemySpawn.yaw);
      e.enabled = true;
    }
    this._clock = null;
  }

  _safeTick() {
    const g = this.mode.game;
    if (g.state !== 'playing') return;
    const e = g.enemy;
    if (e) {
      e.enabled = false; // the run intro switches him on at 12.5 s; keep him off
      e.object.visible = false;
      e.object.position.set(0, -500, 0); // far from everything the director measures
    }
    this._clock ??= g.timeLeft;
    g.timeLeft = this._clock;
  }

  _setTour(on) {
    this.tour = on ? { i: this.tour?.i ?? 0, wait: 1, busy: 0 } : null;
    this.d.auto = !on;
    this.el.querySelector('[data-a="tour"]').textContent = on ? 'Stop tour' : 'Start tour';
    if (on) this.mode.markDebug('tour');
  }

  /** Play the next tour scare that fits where the player is standing. */
  _next() {
    const d = this.d;
    if (!d.started) return (this._out = 'scares start after the intro announcement');
    if (d.fg || d.boFg || d.bo.active) return (this._out = 'a scare is still playing');
    this.mode.markDebug('forced');
    const t = (this.tour ??= { i: 0, wait: 0, busy: 0, manual: true });
    const p = this.mode.game.player;
    for (let n = 0; n < TOUR.length; n++) {
      const id = TOUR[t.i++ % TOUR.length];
      const def = d.catalog.find((x) => x.id === id);
      if (def?.hidden && !p?.isHidden) continue; // the locker one needs you hiding
      if (def?.needsMoving && !p?.isMoving) continue; // the copycat footsteps need you walking
      if (id === 'blackout' ? d.forceBlackout() : d.play(id)) {
        this._out = `scare: ${id}`;
        t.wait = 5;
        return id;
      }
    }
    this._out = 'nothing fits here; walk somewhere else (a corridor works best)';
    t.wait = 3;
    return null;
  }

  _tourTick(dt) {
    const t = this.tour;
    const d = this.d;
    if (!t || t.manual || !d.started) return;
    d.auto = false;
    if (d.fg || d.boFg || d.bo.active) {
      t.busy += dt;
      if (t.busy > 60 && d.fg) d.abort(d.fg, 'tour'); // a haunt waiting for a look that never comes
      return;
    }
    t.busy = 0;
    if ((t.wait -= dt) <= 0) this._next();
  }

  _click(e) {
    const a = e.target?.dataset?.a;
    if (!a) return;
    const m = this.mode;
    if (a === 'tour') {
      this._setTour(!this.tour || this.tour.manual);
    } else if (a === 'next') {
      this._next();
    } else if (a === 'play') {
      m.markDebug('forced');
      const id = this.el.querySelector('.hw-debug__seq').value;
      this._out = this.d.play(id) ? `forced ${id}` : `${id}: no valid plan right now`;
    } else if (a === 'gallery') {
      this.el.hidden = true;
      this.gallery.show();
    } else if (a === 'bo') {
      m.markDebug('forced');
      this._out = this.d.forceBlackout() ? 'blackout forced' : 'not now (already dark, or unsafe: chase / major haunt / falling head)';
    } else if (a === 'sim') {
      const r = HorrorDirector.simulateRuns(6, { seed: m.game.seed, intensity: this.d.intensity });
      this._out = r.runs.map((x, i) => `#${i + 1} ${x.flavor.padEnd(8)} ${String(x.events).padStart(2)} haunts, majors @ ${x.majors.map((t) => t | 0).join(',') || '-'}\n   ${x.seq.join(' ')}`).join('\n') + `\nrun-to-run difference: ${r.consecutiveDifference.join(', ')}`;
    } else if (a === 'mem') {
      this._out = JSON.stringify(m.memory.summary(), null, 1).slice(0, 2500);
    } else if (a === 'reset') {
      m.memory.reset();
      this._out = 'memory reset';
    }
  }

  _toggle(e) {
    const sys = e.target?.dataset?.sys;
    if (!sys) return;
    const on = e.target.checked;
    const m = this.mode;
    this.mode.markDebug('toggle');
    if (sys === 'safe') this._setSafe(on);
    else if (sys === 'watcher') {
      m.watcher.enabled = on;
      if (!on) m.watcher.hideNow?.();
    } else if (sys === 'lights') {
      m.lights.enabled = on;
      if (!on) m.lights.restoreAll(0.3);
    } else if (sys === 'posters') m.posters.enabled = on;
    else if (sys === 'blood') m.blood.enabled = on;
    else if (sys === 'director') this.d.enabled = on;
  }

  update(dt) {
    if (this.safe) this._safeTick();
    // a deep link (&scare=<id>): once the run is going
    if (this._scareLink && this.mode.game.state === 'playing' && this.mode.game.time > 1.5) {
      const id = this._scareLink;
      this._scareLink = null;
      this.gallery.review.one(id); // plays it, then the rating card
    }
    if (this._galleryLink && this.mode.game.state === 'playing' && this.mode.game.time > 1) {
      this._galleryLink = false;
      this.gallery.show();
    }
    this._tourTick(dt);
    if (this.el.hidden) return;
    this._acc += dt;
    if (this._acc < 0.25) return;
    this._acc = 0;
    const d = this.d;
    if (!d.started) {
      this.el.querySelector('.hw-debug__state').textContent = 'waiting for the clock to start…';
      return;
    }
    const run = [d.fg, d.boFg, ...d.bg].filter(Boolean).map((c) => `${c.def.id}${c.aborted ? '(x)' : ''}`).join(', ') || '-';
    const bo = d.blackoutState();
    const g = d.gaze;
    const w = this.mode.watcher;
    this.el.querySelector('.hw-debug__state').textContent = [
      `t ${d.time.toFixed(0)}s  act ${d.act}  phase ${d.phase} (${d.phaseT.toFixed(0)}/${d.phaseLen.toFixed(0)})  budget ${d.budget.toFixed(1)}  flavour ${d.flavor}  intensity ${d.intensity}`,
      `last hit ${(d.time - d.lastStingAt).toFixed(0)}s ago  signature ${d.signatureDone ? 'done' : 'waiting'}  aftershock ${d.aftershockAt != null ? '@' + d.aftershockAt.toFixed(0) : '-'}  once ${[...d.once].join(',') || '-'}`,
      `running ${run}   majors ${d.majors}  heads ${d.headsUsed}/${d.int.heads}  turns/min ${d.turny.toFixed(1)}`,
      `blackout ${bo.active ? 'ACTIVE' : 'idle'}  done ${bo.count}/${bo.rules.max} (skipped ${bo.skipped})  next @ ${bo.nextAt.toFixed(0)}  dark-rule ${d.dark}`,
      `watcher ${w.active ? `${w.pose} seen ${w.seen} (${w.seenTotal.toFixed(1)}s) d ${w.lastTest?.dist?.toFixed(1) ?? '-'}` : 'hidden'}  room ${g.room?.id ?? '-'}  still ${g.stillFor.toFixed(0)}s`,
      `censor boxes ${this.mode.game.postfx?.redact?.length || 0}  posters ${JSON.stringify(this.mode.posters.counts())}`,
    ].join('\n');
    const log = d.log.slice(-12).map((l) => `${String(l.t).padStart(6)} ${l.kind} ${l.a ?? ''} ${l.b ?? ''}`).join('\n');
    this.el.querySelector('.hw-debug__log').textContent = (this._out ? this._out + '\n---\n' : '') + log;
  }

  dispose() {
    removeEventListener('keydown', this._onKey);
    this.gallery?.dispose();
    this.el.remove();
  }
}
