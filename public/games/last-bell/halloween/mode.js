// LAST BELL — The Halloween Shift: the mode. game.js loads this module on demand and calls:
//
//   setupRun()        after the world is built for a Halloween run: barricades, decorations, posters, the
//                     Watcher, the HorrorDirector, the blood and the heads, the Caretaker's fixed light rule
//   onIntro(introEnd) the clock starts at game.time = introEnd (the director and the score start then)
//   update(dt)        every playing frame
//   onEscaped(stats) / onRunEnd(reason) / onCaptured()
//   teardown()        back to normal LAST BELL: everything removed, every system multiplier back to 1
//   applySettings(s)  scare intensity, reduced effects
//
// Nothing here changes the Caretaker: he only sees world.getLightLevel, which is a fixed 0.5 (his default)
// except during a blackout's fixed window (0.2 everywhere, every run). Haunts make no 'noise' events.

import { HALLOWEEN, DEBUG_PANEL, eventPhase, rankedOpensLabel } from './config.js';
import { Gaze } from './visibility.js';
import { SpotCatalog } from './spots.js';
import { HorrorLights } from './lighting.js';
import { HauntMemory } from './memory.js';
import { Watcher, PaneFigure } from './watcher.js';
import { Posters } from './posters.js';
import { Decor } from './decor.js';
import { Blood } from './blood.js';
import { Heads } from './heads.js';
import { TorchDrop } from './torchdrop.js';
import { HorrorDirector } from './director.js';
import { Opening } from './opening.js';
import { headOnDesk, nearestDeskRoom, tickDeskHeads } from './tableau.js';
import { Recite } from './recite.js';

const HW_BUILD = '26 Oct a'; // shown on the debug HUD label, so a stale browser cache is obvious
import { RunScore, fmtTime } from './score.js';
import { registerHalloweenSounds } from './sfx.js';
import { ET } from '../world-layout.js';

const DARK_LIGHT = 0.2; // world.getLightLevel during a blackout (every run, every variant)
const NORMAL_LIGHT = 0.5; // enemy.js's own default when the world has no light rule

export class HalloweenMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    registerHalloweenSounds(game.audio);
    this.lights = new HorrorLights(game);
    this.gaze = new Gaze(game, this.lights);
    this.spotsCat = new SpotCatalog(game);
    this.memory = new HauntMemory(HALLOWEEN.memoryKey);
    this.watcher = new Watcher(game, this.gaze);
    this.build = HW_BUILD; // the scare review stamps ratings with it
    this.opening = new Opening(this); // the first seconds: a dead tube at the end of the corridor blinks once
    this.recite = new Recite(this); // the player whispers Al-Fatiha after seeing the Watcher
    this.pane = new PaneFigure(game, this.gaze);
    this.posters = new Posters(game);
    this.decor = new Decor(game);
    this.blood = new Blood(game);
    this.heads = new Heads(game, this.blood, this.gaze);
    this.score = new RunScore(game);
    this.director = new HorrorDirector(game, {
      gaze: this.gaze, lights: this.lights, spotsCat: this.spotsCat, memory: this.memory, watcher: this.watcher, pane: this.pane,
      posters: this.posters, decor: this.decor, blood: this.blood, heads: this.heads, cfg: HALLOWEEN,
    });
    this.torch = this.director.torch = new TorchDrop(game); // the slap makes the boy drop his torch
    this.ready = Promise.all([this.watcher.load(), this.decor.load()]).catch((err) => console.warn('[halloween] assets', err));
    this._offs = [];
    this.debugUsed = false;
    this.applySettings(game.settings || {});
    if (!document.getElementById('hw-css')) {
      const link = Object.assign(document.createElement('link'), { id: 'hw-css', rel: 'stylesheet', href: 'halloween/halloween.css' });
      document.head.appendChild(link);
    }
    if (DEBUG_PANEL) import('./debug.js').then((m) => (this.debug = new m.HwDebug(this))).catch((err) => console.warn('[halloween] debug panel', err));
  }

  // ------------------------------------------------------------------------------- run
  setupRun() {
    const g = this.game;
    const w = g.world;
    this.teardown(true);
    this.active = true;
    this.introEnd = null;
    this.started = false;
    this.scoring = false;
    this.finished = false;
    this.lights.attach();
    this.opening.cancel();
    this.recite.reset();
    this._openArmed = false;
    // Halloween night (the same for every run): the fittings a little low, darker ambient, more fog
    this.lights.baseLevel = 0.8;
    this.lights.baseAmbient = 0.7;
    this.lights.baseFog = 1.2;
    this.lights.normal(null, 0);
    this.lights.ambient(0.7, 0);
    this.lights.fog(1.2, 0);
    this.gaze.reset();
    this.spotsCat.build();
    this.posters.build();
    this.blood.clear();
    this.heads.clear();
    this.torch.cancel();
    this.watcher.hideNow?.();
    this.pane.hideWhenUnseen();
    this._prevLight = Object.prototype.hasOwnProperty.call(w, 'getLightLevel') ? w.getLightLevel : undefined;
    w.getLightLevel = () => (this.director.dark ? DARK_LIGHT : NORMAL_LIGHT);
    const seed = g.seed;
    this.ready.then(() => this.active && this.decor.build(seed));
    // transforms: the catalogues follow the building
    const on = (ev, fn) => {
      g.events.on(ev, fn);
      this._offs.push(() => g.events.off?.(ev, fn));
    };
    on('world:transform', () => this._onTransform());
    on('game:state', ({ state, prev }) => {
      if (state === 'playing' && prev !== 'playing') this.score.resume();
    });
    this._hud(true);
    this._slipReset();
  }

  onIntro(introEnd) {
    this.introEnd = introEnd;
  }

  /**
   * The head on the teacher's desk in the room you start in, bleeding off the edge onto the floor (the drag trail
   * runs out of the same door). Not in the scare gallery's own staging, which places its own.
   */
  _deskHead() {
    const d = this.director, w = this.game.world;
    if (!d?.heads || !d.blood?.enabled || d.int?.heads === 0) return; // milder scares: no heads at all
    const sp = w.playerSpawn;
    const room = sp?.room?.id ?? sp?.room;
    try {
      if (!headOnDesk(d, room, 2026)) {
        const r = nearestDeskRoom(d, this.game.player.position, { max: 18 });
        if (r) headOnDesk(d, r.id, 2027);
      }
    } catch (err) {
      console.warn('[halloween] desk head', err);
    }
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.gaze.update(dt);
    if (!this._openArmed && g.state === 'playing') {
      this._openArmed = true; // the run's first frame: the player is standing where the run starts
      this.opening.arm();
      this._deskHead();
    }
    this.opening.update(dt);
    if (this.director?.heads) tickDeskHeads(this.director, dt);
    // a clear look at the Watcher (not the opening's own blink, which reports itself)
    const w = this.watcher;
    if (w.active && w.seen && w.seenFor > 0.3 && this.opening.state !== 'blink' && !this.director._glimpsing) this.recite.saw('watcher');
    this.recite.update(dt);
    this.lights.update(dt);
    this.watcher.update(dt);
    this.posters.update(dt);
    this.decor.update(dt);
    this.heads.update(dt);
    this.torch.update(dt);
    this.blood.update(dt, this.gaze);
    // the score clock runs with the game clock (from the first frame); the haunts wait for the intro
    if (!this.scoring && !this.finished) {
      this.scoring = true;
      this.score.begin({ debugUsed: this.debugUsed || DEBUG_PANEL });
    }
    if (this.scoring && !this.finished) this.score.tick(dt);
    if (!this.started && this.introEnd != null && g.time >= this.introEnd) {
      this.started = true;
      this.director.begin(g.seed);
      this._hud(true);
    }
    if (this.started && !this.finished) this.director.update(dt);
    this._flushAcc = (this._flushAcc || 0) + dt;
    if (this._flushAcc > 10) {
      this._flushAcc = 0;
      this.memory.flushIfDirty();
    }
    this.debug?.update?.(dt);
  }

  _onTransform() {
    if (!this.active) return;
    this.spotsCat.build();
    this.posters.rebuild();
    this.lights.attach();
    this.decor.pruneWalls();
    // blood on a wall that is now a doorway / window goes (the transform only touches unseen places)
    const L = this.game.world.layout;
    for (const d of [...this.blood.decals]) {
      if (d.edge >= 0 && L && ![ET.WALL, ET.EXT].includes(L.edgeType[d.edge])) this.blood.remove(d);
    }
  }

  onCaptured() {
    if (!this.active) return;
    this.director.abortAll('captured');
    this.watcher.hideNow?.();
    this.game.audio?.seasonDuck?.(1, 0.3);
  }

  onEscaped() {
    if (!this.active || this.finished) return;
    this._finish('escaped');
  }

  onRunEnd(reason) {
    if (!this.active || this.finished) return;
    this._finish(reason === 'time' ? 'time' : 'caught');
  }

  _finish(result) {
    this.finished = true;
    const out = this.scoring ? this.score.finish(result, this.game.timeLeft) : null;
    this.director.end(result);
    this.opening.cancel();
    this.recite.stop();
    this.lights.restoreAll(1);
    this.game.audio?.seasonDuck?.(1, 0.5);
    this._slip(result, out);
  }

  teardown(keepHud = false) {
    const g = this.game;
    if (!this.active && keepHud) return;
    if (this.started && !this.finished) this.director.end('quit');
    this.director.abortAll('teardown');
    this.opening.cancel();
    this.recite.stop();
    this.active = false;
    this.started = false;
    this.scoring = false;
    for (const off of this._offs) off();
    this._offs = [];
    this.watcher.hideNow?.();
    if (this.pane.mesh) this.pane.mesh.visible = false;
    this.posters.clear();
    this.decor.clear();
    this.blood.clear();
    this.heads.clear();
    this.torch.cancel();
    this.lights.detach();
    g.audio?.seasonDuck?.(1, 0.1);
    if (g.world) {
      if (this._prevLight === undefined) delete g.world.getLightLevel;
      else g.world.getLightLevel = this._prevLight;
    }
    this._prevLight = undefined;
    if (g.postfx) g.postfx.redact = null;
    this.memory.flushIfDirty();
    if (!keepHud) {
      this._hud(false);
      this._slipReset();
    }
  }

  applySettings(s) {
    this.director.setIntensity(s.scareIntensity || 'standard');
    this.director.reducedFlash = !!s.reducedEffects;
    this.lights.reduced = !!s.reducedEffects;
  }

  /** Debug panel actions mark the run (never ranked). */
  markDebug(kind) {
    this.debugUsed = true;
    this.score.markDebug(kind);
    this._hud(true);
  }

  // ------------------------------------------------------------------------------- HUD + slips
  _rankLabel() {
    const ph = eventPhase();
    if (this.debugUsed || DEBUG_PANEL || this.game.debug) return `Debug · not ranked · build ${HW_BUILD}`;
    if (this.game.seed !== HALLOWEEN.seed) return 'Custom school · not ranked';
    if (ph !== 'live') return ph === 'practice' && rankedOpensLabel() ? `Practice · ranked runs open ${rankedOpensLabel()}` : 'Practice';
    return 'Ranked run';
  }

  _hud(on) {
    const hud = document.getElementById('hud');
    let chip = document.getElementById('hw-chip');
    if (!on) return chip?.remove();
    if (!hud) return;
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'hw-chip';
      chip.className = 'hw-chip';
      chip.setAttribute('aria-live', 'off');
      hud.appendChild(chip);
    }
    chip.innerHTML = `<span class="hw-chip__title">The Halloween Shift</span><span class="hw-chip__rank">${this._rankLabel()}</span>`;
  }

  _slipReset() {
    for (const el of document.querySelectorAll('.hw-result')) el.remove();
    for (const el of document.querySelectorAll('.slip--hw')) el.classList.remove('slip--hw');
  }

  _slip(result, out) {
    this._slipReset();
    const screen = document.getElementById(result === 'escaped' ? 'screen-victory' : 'screen-gameover');
    const art = screen?.querySelector('.slip');
    if (!art) return;
    art.classList.add('slip--hw');
    const sec = document.createElement('section');
    sec.className = 'hw-result';
    const rec = out?.rec;
    const rows = [];
    if (rec) {
      rows.push(['Time', fmtTime(rec.gameTime)]);
      if (result === 'escaped') rows.push(['Left on the clock', fmtTime(rec.timeLeft)]);
    }
    const best = out?.best || this.score.best();
    if (best) rows.push(['Your best', `${fmtTime(best.timeLeft)} left${out?.newBest ? ' · new best' : ''}`]);
    const flags = out?.flags || [];
    let rank;
    if (result !== 'escaped') rank = 'Escape to post a time.';
    else if (out?.ranked) rank = out.submitted === 'sent' ? 'Ranked · sent to the Fright Fest board.' : 'Ranked · saved here (the Fright Fest board isn’t open to this game yet).';
    else if (flags.length === 1 && flags[0] === 'phase') rank = eventPhase() === 'practice' && rankedOpensLabel() ? `Practice run · ranked runs open ${rankedOpensLabel()}.` : 'Practice run · the event is over.';
    else rank = 'Not ranked · ' + flags.map((f) => ({ speed: 'timer check failed', route: 'impossible route time', debug: 'debug tools used', rules: 'not the event school', phase: 'outside the event', hidden: 'tab hidden' })[f] || f).join(', ') + '.';
    sec.innerHTML = `
      <h3 class="hw-result__title">The Halloween Shift</h3>
      <dl class="hw-result__stats">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <p class="hw-result__rank">${rank}</p>
      <a class="hw-result__link" href="${HALLOWEEN.standingsUrl}" target="_blank" rel="noopener">Fright Fest standings ↗</a>`;
    const stamp = art.querySelector('.slip__stamp');
    art.insertBefore(sec, stamp || art.querySelector('.slip__actions'));
  }
}
