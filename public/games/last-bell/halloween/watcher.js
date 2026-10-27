// LAST BELL — The Halloween Shift: THE WATCHER.
//
// Not an enemy: it never chases, never touches, never blocks a path (no collider) and never tells the
// Caretaker anything. It appears where the HorrorDirector puts it, and the rule that keeps it believable:
// it only appears, moves or vanishes when the player can't perceive it (outside the view, behind a wall or
// a closed door, or lost in unlit darkness) — or under darkness the director deliberately makes for it.
//
//   const w = new Watcher(game, gaze); await w.load();
//   w.appear(spot | { pos, yaw }, { pose, face, manifest, force }) → bool   (false: it would pop into view)
//   w.setPose(name)      stand | stare | peek | distort | walk      (manifest / withdraw are one-shots)
//   w.withdraw()         natural movement back out of sight, then gone once unseen
//   w.vanish(how)        'unseen' (default: when nobody perceives it) | 'dark' (the director dims it away) | 'now'
//   w.walk(to, speed)    a slow crossing (a shape between lit areas), gone at the end once unseen
//   w.rush(to, speed)    the director's deliberate supernatural event: glides straight at `to` in the lunge
//                        pose, in plain view (only inside a scare that ends in darkness); stays at the end
//   poses for close encounters: lean (folded over, its face hanging at eye height ~0.9 m in front of its feet),
//   lunge (rushing, arms out), snap (one-shot: the head jerks sideways)
//   w.update(dt)         animation, head tracking, observation bookkeeping (10 Hz gaze tests)
// Observation: seen (perceived now), seenFor (s, current look), seenTotal, firstSeenAt, lastSeenAt, closest.
// Callbacks the director sets: onSeen(info), onApproach(info), onGone(info).

import * as THREE from '../lib/three/three.module.js';
import { loadGLB, cloneGLB, ps1ify } from '../assets.js';
import { BODY } from './visibility.js';

const URL = 'assets/characters/watcher.glb';
const LOOPS = new Set(['stand', 'stare', 'peek', 'distort', 'walk', 'lean', 'lunge']);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Watcher {
  constructor(game, gaze) {
    this.game = game;
    this.gaze = gaze;
    this.object = new THREE.Group();
    this.object.name = 'the-watcher';
    this.object.visible = false;
    this.model = null;
    this.mixer = null;
    this.clips = new Map();
    this.action = null;
    this.pose = 'stand';
    this.bones = {};
    this.spot = null;
    this.active = false;
    this.face = true; // turn the head towards the player
    this.pending = null; // { how, at }
    this.seen = false;
    this.seenFor = 0;
    this.seenTotal = 0;
    this.firstSeenAt = -1;
    this.lastSeenAt = -1;
    this.closest = Infinity;
    this.lastTest = null;
    this._acc = 0;
    this._walk = null;
    this.emissive = 0.05;
    this.enabled = true; // debug subsystem switch
    this.onSeen = null;
    this.onApproach = null;
    this.onGone = null;
    this._mats = [];
    this.placeholder = false;
  }

  async load() {
    try {
      const gltf = await loadGLB((this.game.assetBase || '') + URL);
      const model = cloneGLB(gltf.scene);
      ps1ify(model);
      model.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false;
          o.castShadow = false;
        }
        if (o.isBone) this.bones[o.name] = o;
      });
      model.rotation.y = Math.PI; // glTF front is +Z; the object faces -Z (yaw convention)
      this.model = model;
      this.mixer = new THREE.AnimationMixer(model);
      for (const c of gltf.animations || []) this.clips.set(c.name, c);
    } catch (err) {
      console.warn('[watcher] model missing, using the stand-in:', err?.message || err);
      this.model = this._buildPlaceholder();
      this.placeholder = true;
    }
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && !this._mats.includes(m)) this._mats.push(m);
    });
    this.object.add(this.model);
    if (!this.bones.head) this.bones.head = Object.values(this.bones).find((b) => /head/i.test(b.name || '')) || null;
    this._headRest = this.bones.head ? this.bones.head.quaternion.clone() : null;
    this.setEmissive(this.emissive);
    this.game.scene.add(this.object);
    return this;
  }

  /** A gaunt 2.9 m figure in a long grey smock, built from primitives (used until watcher.glb exists). */
  _buildPlaceholder() {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xcfd2cc, emissive: 0xcfd2cc, emissiveIntensity: 0.05 });
    const gown = new THREE.MeshLambertMaterial({ color: 0x8a8d88, emissive: 0x8a8d88, emissiveIntensity: 0.04 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x050505 });
    const hair = new THREE.MeshLambertMaterial({ color: 0x141414 });
    const part = (geo, mat, x, y, z, parent = g) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const hips = new THREE.Group();
    hips.position.y = 1.0;
    g.add(hips);
    part(new THREE.CylinderGeometry(0.2, 0.34, 1.75, 7, 1, true), gown, 0, 0.08, 0, hips).material.side = THREE.DoubleSide;
    const chest = new THREE.Group();
    chest.position.y = 0.95;
    hips.add(chest);
    part(new THREE.CylinderGeometry(0.15, 0.2, 0.5, 7), gown, 0, 0.2, 0, chest);
    const neck = new THREE.Group();
    neck.position.y = 0.5;
    chest.add(neck);
    part(new THREE.CylinderGeometry(0.045, 0.06, 0.42, 6), skin, 0, 0.2, 0, neck);
    const head = new THREE.Group();
    head.position.y = 0.42;
    neck.add(head);
    const skull = part(new THREE.SphereGeometry(0.115, 8, 6), skin, 0, 0.08, 0, head);
    skull.scale.set(0.85, 1.25, 0.95);
    part(new THREE.BoxGeometry(0.035, 0.035, 0.02), dark, -0.04, 0.11, -0.1, head);
    part(new THREE.BoxGeometry(0.035, 0.035, 0.02), dark, 0.04, 0.11, -0.1, head);
    part(new THREE.BoxGeometry(0.025, 0.09, 0.02), dark, 0, 0.0, -0.105, head);
    part(new THREE.BoxGeometry(0.24, 0.42, 0.06), hair, 0, -0.02, -0.06, head).rotation.x = 0.1;
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.17 * s, 0.38, 0);
      chest.add(sh);
      part(new THREE.CylinderGeometry(0.03, 0.026, 1.25, 5), skin, 0, -0.62, 0, sh);
      part(new THREE.BoxGeometry(0.05, 0.22, 0.03), skin, 0, -1.33, 0, sh);
      this.bones['upper_arm.' + (s < 0 ? 'R' : 'L')] = sh;
    }
    this.bones.hips = hips;
    this.bones.chest = chest;
    this.bones.neck = neck;
    this.bones.head = head;
    return g;
  }

  setEmissive(k) {
    this.emissive = k;
    for (const m of this._mats) {
      if (!m.emissive) continue;
      if (m.color && m.emissive.getHex() === 0) m.emissive.copy(m.color);
      m.emissiveIntensity = /dark|hair/.test(m.name || '') ? 0 : k;
    }
  }

  get position() {
    return this.object.position;
  }

  // --------------------------------------------------------------------------- appearing / poses
  /** Place it at a spot. Refuses (false) when that would pop it into the player's view, unless force. */
  appear(spot, { pose = 'stand', face = true, manifest = false, force = false, yaw } = {}) {
    if (!this.enabled || !this.model) return false;
    const pos = spot.pos || spot;
    if (!force && !this.gaze.canPlace(pos, BODY)) return false;
    this.object.position.set(pos.x, 0, pos.z);
    this.object.rotation.y = yaw ?? spot.yaw ?? this._yawToPlayer();
    this.spot = spot.id ? spot : null;
    this.face = face;
    this.active = true;
    this.object.visible = true;
    this.pending = null;
    this._walk = null;
    this.seen = false;
    this.seenFor = 0;
    this.seenTotal = 0;
    this.firstSeenAt = -1;
    this.lastSeenAt = -1;
    this.closest = Infinity;
    this.appearedAt = this.gaze.time;
    if (manifest) this.playOnce('manifest', pose);
    else this.setPose(pose, 0);
    return true;
  }

  _yawToPlayer() {
    const e = this.gaze.eye;
    return Math.atan2(-(e.x - this.object.position.x), -(e.z - this.object.position.z));
  }

  facePlayer() {
    this.object.rotation.y = this._yawToPlayer();
  }

  setPose(name, fade = 0.35) {
    this.pose = name;
    if (this.placeholder) return this._placeholderPose(name);
    const clip = this.clips.get(name) || this.clips.get('stand');
    if (!clip || !this.mixer) return;
    const act = this.mixer.clipAction(clip);
    act.reset();
    act.setLoop(LOOPS.has(name) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    act.clampWhenFinished = true;
    act.timeScale = name === 'walk' ? 1 : 0.9 + Math.random() * 0.2;
    if (this.action && this.action !== act && fade > 0) act.crossFadeFrom(this.action, fade, false);
    else if (this.action && this.action !== act) this.action.stop();
    act.play();
    this.action = act;
  }

  /** A one-shot (manifest / withdraw), then `then` (a loop pose, or 'gone'). */
  playOnce(name, then = 'stand') {
    this.pose = name;
    const clip = this.clips.get(name);
    if (this.placeholder || !clip || !this.mixer) {
      if (then === 'gone') this.vanish('unseen');
      else this.setPose(then, 0);
      return;
    }
    this.setPose(name, 0.15);
    const done = (e) => {
      if (e.action !== this.action) return;
      this.mixer.removeEventListener('finished', done);
      if (then === 'gone') this.vanish('unseen');
      else this.setPose(then, 0.3);
    };
    this.mixer.addEventListener('finished', done);
  }

  _placeholderPose(name) {
    const b = this.bones;
    if (!b.hips) return;
    b.hips.rotation.set(0, 0, 0);
    b.chest.rotation.set(0, 0, 0);
    b.neck.rotation.set(0, 0, 0);
    b.head.rotation.set(0, 0, 0);
    if (b['upper_arm.L']) b['upper_arm.L'].rotation.set(0, 0, 0);
    if (name === 'stare') { b.neck.rotation.z = 0.35; b.chest.rotation.x = 0.12; }
    if (name === 'peek') { b.hips.rotation.z = 0.55; b.neck.rotation.z = 0.6; }
    if (name === 'distort') { b.chest.rotation.x = -0.35; b.neck.rotation.z = 1.5; if (b['upper_arm.L']) b['upper_arm.L'].rotation.z = 2.7; }
  }

  // --------------------------------------------------------------------------- leaving
  withdraw() {
    if (!this.active) return;
    this.pending = null;
    this.playOnce('withdraw', 'gone');
    if (this.placeholder || !this.clips.get('withdraw')) this.vanish('unseen');
  }

  /** how: 'unseen' (when nobody perceives it), 'dark' (as soon as it is unlit), 'now' (director darkness). */
  vanish(how = 'unseen') {
    if (!this.active) return;
    if (how === 'now') {
      // in plain view it never just pops out (playtest: that reads as a rendering bug): the bodycam loses it
      if (this.seen && this.object.visible) {
        const pf = this.game.postfx;
        if (pf) {
          pf.pulseGlitch?.(0.55);
          if (!pf.reduced) pf.hold = Math.max(pf.hold || 0, 0.06);
        }
        this.game.audio?.play?.('hw_static', { volume: 0.22 })?.stop?.(0.25);
      }
      return this._gone('now');
    }
    this.pending = { how, since: this.gaze.time };
  }

  _gone(how) {
    const info = this.info(how);
    this.active = false;
    this.object.visible = false;
    this.pending = null;
    this._walk = null;
    this.action?.stop();
    this.action = null;
    this.spot = null;
    this.onGone?.(info);
  }

  rush(to, speed = 8) {
    if (!this.active) return;
    const from = this.object.position.clone();
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    this.object.rotation.y = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    this.face = false;
    this._walk = { from, to: new THREE.Vector3(to.x, 0, to.z), t: 0, dur: Math.max(0.15, d / speed), rush: true };
    if (this.pose !== 'lunge') this.setPose('lunge', 0.08);
  }

  /** Still gliding (rush) or walking? */
  get moving() {
    return !!this._walk;
  }

  walk(to, speed = 0.7) {
    if (!this.active) return;
    const from = this.object.position.clone();
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    this.object.rotation.y = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    this.face = false;
    this._walk = { from, to: new THREE.Vector3(to.x, 0, to.z), t: 0, dur: Math.max(0.5, d / speed) };
    this.setPose('walk', 0.3);
  }

  info(how) {
    return {
      how, spot: this.spot?.id || null, kind: this.spot?.kind || null, pose: this.pose,
      seenTotal: this.seenTotal, seenAt: this.firstSeenAt, closest: this.closest,
    };
  }

  // --------------------------------------------------------------------------- per frame
  update(dt) {
    if (!this.active) return;
    if (this._walk) {
      const w = this._walk;
      w.t += dt;
      const p = Math.min(1, w.t / w.dur);
      this.object.position.lerpVectors(w.from, w.to, w.rush ? p * p * (1.6 - 0.6 * p) : p); // a rush accelerates
      if (p >= 1) {
        this._walk = null;
        if (!w.rush) {
          this.setPose('stand', 0.4);
          this.vanish('unseen');
        }
      }
    }
    // the look-at is applied on top of the pose each frame: start from the rest pose so it never accumulates
    // (clips that key the head overwrite this anyway)
    const head = this.bones.head;
    if (head && this._headRest) head.quaternion.copy(this._headRest);
    this.mixer?.update(dt);
    if (this.face && head) this._lookAtEye(dt);
    // gaze bookkeeping at 10 Hz
    this._acc += dt;
    if (this._acc >= 0.1) {
      const step = this._acc;
      this._acc = 0;
      const t = this.gaze.test(this.object.position);
      this.lastTest = t;
      const was = this.seen;
      this.seen = t.perceived;
      if (t.dist < this.closest) this.closest = t.dist;
      if (this.seen) {
        this.seenFor += step;
        this.seenTotal += step;
        this.lastSeenAt = this.gaze.time;
        if (this.firstSeenAt < 0) this.firstSeenAt = this.gaze.time;
        if (!was) this.onSeen?.({ ...t, pose: this.pose, spot: this.spot });
      } else this.seenFor = 0;
      // too close: never let the player walk into it (or see it from inside)
      if (t.dist < 3.2 && this.game.player?.isMoving && (this.seen || t.dist < 1.3)) this.onApproach?.({ ...t, pose: this.pose, spot: this.spot });
      // pending exits
      const pd = this.pending;
      if (pd) {
        if (pd.how === 'unseen' && !t.perceived && (t.lit < 0.05 || !t.los || !t.inFrustum)) this._gone('unseen');
        else if (pd.how === 'dark' && !(t.los && t.lit > 0.05)) this._gone('dark');
      }
    }
  }

  /** Turn the head (and a little of the neck) towards the camera, around world up, after the clip pose. */
  _lookAtEye(dt) {
    const head = this.bones.head;
    const parent = head.parent;
    if (!parent) return;
    head.getWorldPosition(_v);
    _w.copy(this.gaze.eye).sub(_v);
    const objYaw = this.object.rotation.y;
    let want = Math.atan2(-_w.x, -_w.z) - objYaw;
    want = ((want + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    want = THREE.MathUtils.clamp(want, -1.1, 1.1);
    this._headYaw = (this._headYaw ?? 0) + (want - (this._headYaw ?? 0)) * Math.min(1, dt * 1.8);
    parent.getWorldQuaternion(_q2);
    _q.setFromAxisAngle(UP, this._headYaw);
    // local' = parentWorld⁻¹ · R_world · parentWorld · local
    const pw = _q2.clone();
    head.quaternion.premultiply(pw).premultiply(_q).premultiply(pw.invert());
  }

  hideNow() {
    if (this.active) this._gone('reset');
  }

  dispose() {
    this.hideNow();
    this.object.parent?.remove(this.object);
    this.mixer?.stopAllAction();
  }
}

/** A flat silhouette on an exterior window pane: someone standing outside in the dark. */
const PANE_IN = 0.14 + 0.07; // wall line + 7 cm into the room

export class PaneFigure {
  constructor(game, gaze) {
    this.game = game;
    this.gaze = gaze;
    // a pale face pressed to the glass, long black hair, two palms flat on the pane beside it, the body dark
    // below (playtest: an all-black silhouette behind dark glass was never seen)
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#0b0b0c'; // hair and body
    x.beginPath();
    x.ellipse(32, 24, 15, 17, 0, 0, Math.PI * 2);
    x.fill();
    x.fillRect(17, 24, 30, 50);
    x.beginPath();
    x.moveTo(15, 60); x.lineTo(49, 60); x.lineTo(53, 128); x.lineTo(11, 128); x.closePath();
    x.fill();
    x.fillStyle = '#c9c2b6'; // the face, flattened on the glass
    x.beginPath();
    x.ellipse(32, 28, 9.5, 13, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#e4ded3'; // where it touches the glass (forehead, nose, cheeks): paler
    x.fillRect(27, 18, 10, 4);
    x.fillRect(30, 26, 4, 7);
    x.fillStyle = '#060606'; // sockets and the open mouth
    x.fillRect(25, 23, 5, 4);
    x.fillRect(34, 23, 5, 4);
    x.beginPath();
    x.ellipse(32, 37, 3, 4.5, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#d2cbc0'; // palms on the glass, fingers up
    for (const [hx, flip] of [[8, 1], [56, -1]]) {
      x.fillRect(hx - 5, 40, 10, 11);
      for (let f = 0; f < 4; f++) x.fillRect(hx - 5 + f * 2.6, 31 - (f === 1 || f === 2 ? 2 : 0), 2, 10);
      x.fillRect(hx + flip * 5 - (flip > 0 ? 0 : 3), 43, 3, 6); // thumb
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    // both sides: which way a window's spot faces isn't reliable, and a culled back face was never seen
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.94, alphaTest: 0.3, depthWrite: false, fog: true, color: 0xbdb8b0, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.92), mat);
    this.mesh.name = 'pane-figure';
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    game.scene.add(this.mesh);
    this.spot = null;
  }

  show(spot) {
    const p = spot.pos;
    if (!this.gaze.canPlace(p, [1.0, 1.6])) return false;
    // the window model has the night painted on its glass, so outside it would be hidden: it goes just in front of
    // the painted glass, as if pressed against it (spot.pos is 0.14 m outside the wall line; yaw faces inwards)
    const ix = -Math.sin(spot.yaw), iz = -Math.cos(spot.yaw);
    this.mesh.position.set(p.x + ix * PANE_IN, 1.62, p.z + iz * PANE_IN); // the face about 1.85 m up, in the glass
    this.mesh.rotation.set(0, spot.yaw + Math.PI, 0); // the plane's front (+Z) faces into the building
    this.mesh.visible = true;
    this.spot = spot;
    return true;
  }

  hideWhenUnseen() {
    if (!this.mesh.visible) return true;
    const t = this.gaze.test(this.mesh.position.clone().setY(0), { heights: [1.1, 1.6] });
    if (t.los && t.inFrustum && t.dist < 26) return false;
    this.mesh.visible = false;
    this.spot = null;
    return true;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.map?.dispose();
    this.mesh.material.dispose();
  }
}
