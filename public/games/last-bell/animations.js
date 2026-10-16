// LAST BELL — animation controller (S2). Thin, allocation-free wrapper around THREE.AnimationMixer.
//
//   const anim = new AnimationController(model, gltf.animations);
//   anim.play('walk', { fade: 0.3 });              // crossfade to a looping clip (no-op if already playing)
//   anim.syncToSpeed(actualMetresPerSecond);      // walk/run timeScale follows real ground speed
//   await anim.playOnce('capture');               // one-shot, resolves when finished (or at once if missing)
//   anim.onFootstep = (clipName) => { ... };      // fired at the foot-contact markers of walk/run/turns
//   anim.update(dt);
//
// Missing clips fall back along CLIP_INFO[name].fallback (e.g. run -> walk -> idle); if nothing is
// available, play() returns null and playOnce() resolves immediately, so gameplay never stalls.

import { AnimationMixer, LoopOnce, LoopRepeat } from './lib/three/three.module.js';

/** Per-clip metadata. speed = ground speed (m/s) at timeScale 1; steps = foot-contact times (0..1). */
export const CLIP_INFO = {
  idle: { loop: true, fallback: null },
  stare: { loop: true, fallback: 'idle' },
  walk: { loop: true, speed: 1.35, steps: [0.02, 0.52], fallback: 'idle' },
  run: { loop: true, speed: 4.4, steps: [0.02, 0.52], fallback: 'walk' },
  search: { loop: true, fallback: 'idle' },
  investigate: { loop: true, fallback: 'search' },
  turn_left: { loop: false, steps: [0.4, 0.62], fallback: null },
  turn_right: { loop: false, steps: [0.4, 0.62], fallback: null },
  capture: { loop: false, fallback: 'investigate' },
};

export class AnimationController {
  /**
   * @param {THREE.Object3D} root  object the clips are bound to (the glTF scene / clone)
   * @param {THREE.AnimationClip[]} clips
   * @param {object} [info] metadata table (defaults to CLIP_INFO)
   */
  constructor(root, clips = [], info = CLIP_INFO) {
    this.root = root;
    this.info = info;
    this.mixer = new AnimationMixer(root);
    this.actions = new Map();
    this.current = null; // name of the clip actually playing (after fallback)
    this.requested = null; // name last requested
    this.onFootstep = null;
    this._prevTime = 0;
    this._once = new Map(); // action -> resolve fn
    for (const clip of clips) this.addClip(clip);
    this.mixer.addEventListener('finished', (e) => {
      const resolve = this._once.get(e.action);
      if (resolve) {
        this._once.delete(e.action);
        resolve(true);
      }
    });
  }

  addClip(clip) {
    const action = this.mixer.clipAction(clip);
    const meta = this.info[clip.name] || { loop: true };
    if (meta.loop === false) {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(LoopRepeat, Infinity);
    }
    this.actions.set(clip.name, action);
  }

  has(name) {
    return this.actions.has(name);
  }

  get names() {
    return [...this.actions.keys()];
  }

  /** Resolve a clip name through the fallback chain. */
  resolve(name) {
    let n = name;
    for (let i = 0; i < 6 && n; i++) {
      if (this.actions.has(n)) return n;
      n = this.info[n]?.fallback ?? (n === 'idle' ? null : 'idle');
    }
    return null;
  }

  duration(name) {
    const n = this.resolve(name);
    return n ? this.actions.get(n).getClip().duration : 0;
  }

  /**
   * Crossfade to `name`. Options: fade (s), timeScale, restart (force from start even if playing),
   * loop (override). Returns the THREE.AnimationAction or null.
   */
  play(name, { fade = 0.3, timeScale, restart = false, loop } = {}) {
    this.requested = name;
    const n = this.resolve(name);
    if (!n) return null;
    const action = this.actions.get(n);
    if (loop !== undefined) {
      action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
    }
    if (timeScale !== undefined) action.timeScale = timeScale;
    if (this.current === n && !restart && action.isRunning()) return action;
    const prev = this.current ? this.actions.get(this.current) : null;
    action.enabled = true;
    action.reset();
    action.setEffectiveWeight(1);
    if (timeScale === undefined) action.timeScale = 1;
    action.play();
    if (prev && prev !== action) {
      prev.fadeOut(fade);
      action.fadeIn(fade);
    } else if (fade > 0 && !prev) {
      action.fadeIn(Math.min(fade, 0.2));
    }
    // resolve pending one-shot promises of the clip we leave
    if (prev && prev !== action) {
      const r = this._once.get(prev);
      if (r) {
        this._once.delete(prev);
        r(false);
      }
    }
    this.current = n;
    this._prevTime = 0;
    return action;
  }

  /** Play a one-shot; resolves true when finished, false if interrupted, immediately if missing. */
  playOnce(name, opts = {}) {
    const n = this.resolve(name);
    if (!n || this.info[n]?.loop !== false) {
      // missing (or fell back to a looping clip): play what we have and resolve after a plausible time
      if (n) this.play(n, opts);
      const ms = (opts.fallbackDuration ?? 0) * 1000;
      return new Promise((res) => (ms > 0 ? setTimeout(() => res(false), ms) : res(false)));
    }
    return new Promise((resolve) => {
      const action = this.play(n, { ...opts, restart: true });
      this._once.set(action, resolve);
    });
  }

  setTimeScale(ts) {
    if (!this.current) return;
    this.actions.get(this.current).timeScale = ts;
  }

  /** For clips with a `speed`, set timeScale so feet match the actual ground speed. */
  syncToSpeed(speed, min = 0.45, max = 1.7) {
    if (!this.current) return;
    const meta = this.info[this.current];
    if (!meta?.speed) return;
    const ts = speed / meta.speed;
    this.actions.get(this.current).timeScale = ts < min ? min : ts > max ? max : ts;
  }

  /** Normalised time (0..1) of the current clip. */
  get phase() {
    if (!this.current) return 0;
    const a = this.actions.get(this.current);
    const d = a.getClip().duration || 1;
    return (a.time % d) / d;
  }

  update(dt) {
    this.mixer.update(dt);
    if (!this.current || !this.onFootstep) return;
    const meta = this.info[this.current];
    if (!meta?.steps) return;
    const p = this.phase;
    const prev = this._prevTime;
    for (let i = 0; i < meta.steps.length; i++) {
      const s = meta.steps[i];
      const crossed = prev <= p ? prev < s && p >= s : prev < s || p >= s; // handles wrap-around
      if (crossed) this.onFootstep(this.current);
    }
    this._prevTime = p;
  }

  stopAll() {
    this.mixer.stopAllAction();
    for (const r of this._once.values()) r(false);
    this._once.clear();
    this.current = null;
  }
}
