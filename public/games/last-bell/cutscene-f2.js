// LAST BELL - cutscene-f2.js: the opening of the upstairs (Second Floor) start, about 19 s, skippable.
//
//   1. Wake up     black, then the view blinks open from the desk and tilts up to seated eye height
//   2. Announcer   announcement_floor2_b plays while the camera looks slowly round the empty classroom
//   3. The lock    North Hall: the Stairwell A grille rolls DOWN (the world's own shutter animation), the lamp lights
//   4. Her         a far corridor shot: the lunch monitor standing still, lights flicker, on the last one she is gone
//   5. Back        the camera returns to the player's real pose and control comes back
//
// Everything is local: each client plays it by itself, nothing goes over the network, skipping is per player.
// The real Assistant is never touched (she stays asleep and in her room): shot 4 uses a decoy clone of her model.
// Her wake rule and the PA schedule are game.js's; the game gets `onEnd({ skipped, c })` when this finishes.
//
//   const cut = new FloorTwoCutscene(game);
//   cut.start({ onEnd })   -> true when it is playing (false: not available, caller carries on without it)
//   cut.update(dt)         every frame while playing (game.js, right after player.update, before world.update)
//   cut.skip() / cut.abort()   skip = fade out then onEnd; abort = silent restore (new run, back to the menu)
//   cut.active
//   FloorTwoCutscene.LENGTH    nominal length in s (game.js schedules host timers from it, never from a skip)
//
// URL: ?cutscene=0 turns it off; ?autostart (the test shortcut) skips it unless ?cutscene=1.

import * as THREE from './lib/three/three.module.js';
import { cloneGLB } from './assets.js';
import { AnimationController, CLIP_INFO } from './animations.js';

const T = {
  bellFade: 0.6, // black until here, then the eyes open
  announce: 4.8, // announcement_floor2 starts
  cut1: 9.8, // classroom -> grille (a dip through black)
  cut2: 13.9, // grille -> corridor
  fadeOut: 18.2, // start of the fade to black
  end: 18.9,
};
const FLICKERS = [15.3, 16.0, 16.7]; // the last one takes her away
const SKIP_GRACE = 0.35; // s: the click that started the run is not a skip

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const ease = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const dip = (c, centre, half) => Math.max(0, 1 - Math.abs(c - centre) / half);

export class FloorTwoCutscene {
  static LENGTH = T.end + 0.1;

  constructor(game) {
    this.game = game;
    this.active = false;
    this._h = null;
    this._decoy = null;
  }

  /** Should this run play it? (menu start upstairs; not the autostart test shortcut unless ?cutscene=1) */
  static wanted() {
    let q = null;
    try { q = new URLSearchParams(location.search); } catch { return true; }
    const v = q.get('cutscene');
    if (v === '0') return false;
    if (q.has('autostart') && v !== '1') return false;
    return true;
  }

  start({ onEnd } = {}) {
    const g = this.game;
    if (this.active) this.abort();
    const sp = g.world?.floor2?.playerSpawn;
    if (!FloorTwoCutscene.wanted() || !sp || !g.camera) return false;
    this.onEnd = onEnd || null;
    this.c = 0;
    this.endAt = T.end;
    this.fadeFrom = T.fadeOut;
    this.reduced = !!g.settings?.reducedEffects || !!matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.skipped = false;
    this._said = false;
    this._annAt = null;
    this._landed = false;
    this._flick = 0;
    this._gone = false;
    this._shot = 0;
    this.spawn = { x: sp.position.x, y: sp.position.y, z: sp.position.z, yaw: sp.yaw };
    this._plan();
    this.active = true;
    // the player: no input, no torch model, no HUD (restored in _finish)
    g.player.enabled = false;
    g.player.setViewmodelVisible?.(false);
    g.ui.hideHUD?.();
    g.postfx.fade = 1;
    this._ui();
    this._listen();
    return true;
  }

  // ------------------------------------------------------------------------------------------------ plan
  _plan() {
    const g = this.game;
    const w = g.world;
    const f2 = w.floor2;
    const Y = this.spawn.y;
    // shot 3: Stair A's grille, from the North Hall side, a bit to the side so the plate is in frame
    const a = f2?.anchor?.('stair-a-door');
    this.grille = null;
    if (a && w.stairs?.shutter) {
      const n = a.normal || { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
      const plate = w.stairs.toWorld(w.stairs.frames.A, 1.4, 4.17);
      this.grille = {
        n,
        door: { x: a.position.x, z: a.position.z },
        target: { x: (a.position.x + plate.x) / 2, y: Y + 1.45, z: (a.position.z + plate.z) / 2 },
      };
    }
    // shot 4: a straight stretch of the North Hall, her at the far end facing the camera
    const hall = f2?.rooms?.find((r) => r.name === 'North Hall') || f2?.rooms?.find((r) => r.isCorridor);
    this.hall = null;
    if (hall?.bounds) {
      const b = hall.bounds;
      const z = (b.minZ + b.maxZ) / 2;
      const herX = b.maxX - 8;
      this.hall = { z, herX, camX: herX - 12 };
    }
  }

  // ------------------------------------------------------------------------------------------------ frame
  update(dt) {
    if (!this.active) return;
    const g = this.game;
    if (g.state !== 'playing' && g.state !== 'paused') return this.abort();
    if (g.state === 'paused') return;
    dt = Math.min(dt, 0.1);
    this.c += dt;
    const c = this.c;
    g.ui.hideHUD?.(); // a resume mid-cutscene would show it again
    if (g.player.enabled) g.player.enabled = false; // co-op / overlays may have re-enabled it

    // sounds and beats
    if (!this._said && c >= T.announce) this._announce();
    // shot switches (during the black of each dip)
    const shot = c < T.cut1 ? 1 : c < T.cut2 ? 2 : 3;
    if (shot !== this._shot) this._enterShot(shot);
    if (shot === 2) this._grilleBeat();
    if (shot === 3) this._flickerBeat(c);
    this._decoy?.anim.update(dt);

    // camera
    this._camera(c);
    // fade
    let fade = this._fade(c);
    if (c > this.fadeFrom) fade = Math.max(fade, ease((c - this.fadeFrom) / Math.max(0.05, this.endAt - this.fadeFrom)));
    g.postfx.fade = fade;
    if (c >= this.endAt) this._finish();
  }

  _fade(c) {
    if (c < T.bellFade) return 1;
    let f;
    if (this.reduced || c > 3.2) f = 0;
    else if (c < 1.8) f = lerp(1, 0.45, ease((c - T.bellFade) / 1.2)); // eyes open...
    else if (c < 2.2) f = lerp(0.45, 0.85, ease((c - 1.8) / 0.4)); // ...a blink...
    else f = lerp(0.85, 0, ease((c - 2.2) / 1.0)); // ...and open
    if (this.reduced && c < 3.0) f = lerp(1, 0, ease((c - T.bellFade) / 2.4));
    const half = this.reduced ? 0.55 : 0.4;
    return Math.max(f, dip(c, T.cut1, half), dip(c, T.cut2, half));
  }

  _camera(c) {
    const g = this.game;
    const cam = g.camera;
    const s = this.spawn;
    let x = s.x, y, z = s.z, yaw = s.yaw, pitch = 0, roll = 0;
    if (c < T.cut1) {
      // wake (head on the desk, tilting up) and then the slow look round the classroom, at seated eye height
      const k = ease(c / 4.0);
      y = s.y + lerp(0.66, 1.15, k);
      pitch = lerp(-0.8, 0, k);
      roll = this.reduced ? 0 : lerp(0.5, 0, k);
      const look = ease((c - 3.2) / (T.cut1 - 3.2));
      yaw = s.yaw + lerp(-0.45, 0.85, look);
      pitch += Math.sin(c * 0.7) * 0.02;
    } else if (c < T.cut2) {
      const gr = this.grille;
      const k = clamp01((c - T.cut1) / (T.cut2 - T.cut1));
      if (gr) {
        const d = lerp(3.2, 2.7, k);
        x = gr.door.x + gr.n.x * d;
        z = gr.door.z + gr.n.z * d;
        y = s.y + 1.55;
        yaw = yawTo(gr.target.x - x, gr.target.z - z);
        pitch = Math.atan2(gr.target.y - y, Math.hypot(gr.target.x - x, gr.target.z - z));
        if (this._shake > 0 && !this.reduced) {
          this._shake = Math.max(0, this._shake - 1 / 30);
          y += Math.sin(c * 90) * 0.025 * this._shake * 6;
        }
      } else y = s.y + 1.15;
    } else {
      const h = this.hall;
      const k = clamp01((c - T.cut2) / (T.fadeOut - T.cut2));
      if (h) {
        x = h.camX + k * 0.8;
        z = h.z;
        y = s.y + 1.55;
        yaw = -Math.PI / 2;
        pitch = -0.02;
      } else y = s.y + 1.15;
    }
    cam.position.set(x, y, z);
    cam.rotation.set(pitch, yaw, roll, 'YXZ');
  }

  // ------------------------------------------------------------------------------------------------ beats
  _announce() {
    const g = this.game;
    this._said = true;
    this._annAt = g.time;
    g.announce('announcement_floor2_b');
  }

  /** game.time when the PA notice has finished (the caller shows its follow-up thought after this). */
  announceEndsAt() {
    const g = this.game;
    const dur = Number(g.audio?.speechDuration?.('announcement_floor2_b')) || 12;
    return (this._annAt ?? g.time) + 1.5 + dur;
  }

  _enterShot(shot) {
    const g = this.game;
    const st = g.world.stairs;
    this._shot = shot;
    if (shot === 2 && this.grille && st) {
      // the grille starts rolled up and comes down through the world's own animation (visual only)
      this._lamp = st.shutter?.lamp || null;
      st._anim.A = 1;
      st._pose();
      if (this._lamp) this._lamp.visible = false;
      this._landed = false;
      this._shake = 0;
      g.audio?.play?.('chain_lift', { position: new THREE.Vector3(this.grille.door.x, this.spawn.y + 1.5, this.grille.door.z), volume: 0.9 });
    }
    if (shot === 3) {
      this._restoreGrille(); // already down; make sure the lamp is back for good
      this._spawnDecoy();
    }
  }

  _grilleBeat() {
    const st = this.game.world.stairs;
    if (this._landed || !st) return;
    if (st._anim.A <= 0.001) {
      this._landed = true;
      this._shake = 1;
      if (this._lamp) this._lamp.visible = true; // the red lamp lights
      this.game.audio?.play?.('door_locked', { position: new THREE.Vector3(this.grille.door.x, this.spawn.y + 1.5, this.grille.door.z) });
      this.game.audio?.play?.('bang_distant', { volume: 0.5 });
    }
  }

  _flickerBeat(c) {
    const g = this.game;
    while (this._flick < FLICKERS.length && c >= FLICKERS[this._flick]) {
      const last = this._flick === FLICKERS.length - 1;
      g.events.emit('lights:flicker', { intensity: this.reduced ? 0.25 : 0.65, duration: this.reduced ? 0.5 : 0.3 });
      if (last && this._decoy) {
        this._decoy.root.visible = false;
        this._gone = true;
      }
      this._flick = this.reduced ? FLICKERS.length : this._flick + 1; // reduced: one gentle dip is enough
    }
    // reduced: a single dip, so she goes at the first one
    if (this.reduced && this._flick >= 1 && !this._gone && this._decoy && c >= FLICKERS[0] + 0.25) {
      this._decoy.root.visible = false;
      this._gone = true;
    }
  }

  _spawnDecoy() {
    const g = this.game;
    const a = g.assistant;
    const h = this.hall;
    if (!h || !a?.model || !a._ready) return;
    try {
      const root = new THREE.Group();
      const model = cloneGLB(a.model);
      root.add(model);
      const clips = [...a.anim.actions.values()].map((act) => act.getClip());
      const anim = new AnimationController(model, clips, CLIP_INFO);
      anim.play(anim.has('stare') ? 'stare' : 'idle', { fade: 0 });
      root.position.set(h.herX, this.spawn.y, h.z);
      root.rotation.y = Math.PI / 2; // faces -x: at the camera
      g.scene.add(root);
      this._decoy = { root, anim };
    } catch (err) {
      console.warn('[cutscene] decoy failed:', err?.message || err);
      this._decoy = null;
    }
  }

  _restoreGrille() {
    const st = this.game.world.stairs;
    if (!st) return;
    st._anim.A = st.state.A === 'open' ? 1 : 0;
    st._pose();
    const lamp = st.shutter?.lamp;
    if (lamp) lamp.visible = true;
  }

  // ------------------------------------------------------------------------------------------------ skip / end
  skip() {
    if (!this.active || this.skipped) return;
    this.skipped = true;
    this.fadeFrom = this.c;
    this.endAt = this.c + 0.35;
    // the PA notice is the point of the scene: if she has not spoken yet, she does now
    if (!this._said) this._announce();
  }

  abort() {
    if (!this.active) return;
    this._cleanup();
    this.onEnd = null;
  }

  _finish() {
    const g = this.game;
    const info = { skipped: this.skipped, c: Math.round(this.c * 10) / 10 };
    const cb = this.onEnd;
    this.onEnd = null;
    this._cleanup();
    // control back, at the real pose, from black
    g._restoreControl?.(false);
    g.player.update(0, g);
    g.postfx.fade = 1;
    g._tween?.(0.7, (p) => (g.postfx.fade = 1 - p));
    cb?.(info);
  }

  /** Restore everything the cutscene touched. */
  _cleanup() {
    const g = this.game;
    this.active = false;
    this._unlisten();
    this._restoreGrille();
    if (this._decoy) {
      this._decoy.root.removeFromParent();
      this._decoy = null;
    }
    this._ui(false);
    if (g.state === 'playing' || g.state === 'paused') {
      g.player.setViewmodelVisible?.(true);
      g.ui.showHUD?.();
    }
  }

  // ------------------------------------------------------------------------------------------------ input + overlay
  _listen() {
    const t0 = performance.now();
    const grace = () => performance.now() - t0 < SKIP_GRACE * 1000;
    const wasLocked = !!this.game.player.isLocked;
    this._h = {
      key: (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey || ['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
        if (/^F\d+$/.test(e.code)) return;
        e.stopImmediatePropagation(); // Esc / P must not open the pause menu now
        e.preventDefault();
        if (e.repeat || grace()) return;
        this.skip();
        // Esc also releases the mouse: ask for it back with the usual overlay
        if (e.code === 'Escape' && wasLocked && !this.game.touch?.active) this._needRelock = true;
      },
      ptr: () => {
        if (!grace()) this.skip();
      },
    };
    window.addEventListener('keydown', this._h.key, true);
    window.addEventListener('pointerdown', this._h.ptr, true);
  }

  _unlisten() {
    if (!this._h) return;
    window.removeEventListener('keydown', this._h.key, true);
    window.removeEventListener('pointerdown', this._h.ptr, true);
    this._h = null;
    if (this._needRelock) {
      this._needRelock = false;
      setTimeout(() => {
        const g = this.game;
        if (g.state === 'playing' && g.player.enabled && !g.player.isLocked) g.ui.showResumeOverlay?.();
      }, 250);
    }
  }

  _ui(on = true) {
    if (!on) {
      this._bars?.remove();
      this._bars = null;
      return;
    }
    const root = document.getElementById('ui') || document.body;
    const bars = document.createElement('div');
    bars.className = 'cutscene-bars';
    bars.setAttribute('aria-hidden', 'true');
    const top = document.createElement('i');
    const bottom = document.createElement('i');
    const hint = document.createElement('span');
    hint.className = 'cutscene-skip';
    hint.textContent = this.game.touch?.active ? 'Tap to skip' : 'Press any key or click to skip';
    bars.append(top, bottom, hint);
    root.append(bars);
    this._bars = bars;
  }
}
