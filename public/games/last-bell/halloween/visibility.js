// LAST BELL — The Halloween Shift: what the player can see (in-game camera only, never a real camera).
//
//   const gaze = new Gaze(game, lighting);
//   gaze.update(dt)                      every frame (cheap: matrices, yaw history, room visits)
//   gaze.test(pos, { heights, margin })  → { state: 'hidden'|'edge'|'partial'|'full', frac, angle, dist,
//                                            inFrustum, los, lit, perceived }
//   gaze.canPlace(pos, heights)          true when something can appear at pos without popping into view:
//                                        outside the (widened) view, behind a wall, or unlit far darkness
//   gaze.couldSee(pos)                   line of sight from the eye, ignoring where the camera points
//   gaze.turnedAround(window)            the camera swung > ~125° within `window` seconds
//
// Visibility = view frustum (angles in camera space, with a margin) × occlusion (world.lineOfSight from the
// eye to 2-3 sample heights: feet, chest, head) × light (torch cone, fixtures, ambient). Interior wired glass
// is see-through between 1.0 and 2.28 m (world.lineOfSight), so a figure behind classroom glass shows only
// from the waist up. Rooms visited, time spent and recent turns are gameplay signals for the director.

import * as THREE from '../lib/three/three.module.js';

const _v = new THREE.Vector3();
const _e = new THREE.Vector3();
const _inv = new THREE.Matrix4();
export const BODY = [0.35, 1.4, 2.5]; // the Watcher: feet, chest, head (it is ~2.9 m tall)

export class Gaze {
  constructor(game, lighting = null) {
    this.game = game;
    this.lighting = lighting;
    this.forward = new THREE.Vector3(0, 0, -1);
    this.eye = new THREE.Vector3();
    this.yawHist = new Float32Array(64); // ~3 s of yaw at 20 Hz
    this.timeHist = new Float32Array(64);
    this.hi = 0;
    this._acc = 0;
    this.time = 0;
    this.turnRate = 0; // rad/s, smoothed
    this.lastTurnAround = -99;
    this.visits = new Map(); // roomId → { n, last, total }
    this.room = null;
    this.stillFor = 0; // s the player hasn't moved
    this.tanH = 1;
    this.tanV = 1;
  }

  reset() {
    this.visits.clear();
    this.room = null;
    this.time = 0;
    this.lastTurnAround = -99;
    this.yawHist.fill(0);
    this.timeHist.fill(-99);
  }

  update(dt) {
    const g = this.game;
    const cam = g.camera;
    this.time += dt;
    cam.updateMatrixWorld();
    cam.getWorldPosition(this.eye);
    cam.getWorldDirection(this.forward);
    _inv.copy(cam.matrixWorld).invert();
    this._inv = _inv;
    const vf = THREE.MathUtils.degToRad(cam.fov) / 2;
    this.tanV = Math.tan(vf);
    this.tanH = this.tanV * cam.aspect;
    // yaw history (20 Hz)
    this._acc += dt;
    if (this._acc >= 0.05) {
      this._acc = 0;
      const yaw = Math.atan2(-this.forward.x, -this.forward.z);
      const prev = this.yawHist[(this.hi + 63) % 64];
      let d = yaw - prev;
      d = ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.turnRate += (Math.abs(d) / 0.05 - this.turnRate) * 0.25;
      this.yawHist[this.hi] = yaw;
      this.timeHist[this.hi] = this.time;
      this.hi = (this.hi + 1) % 64;
      if (this.turnedAround(1.4)) this.lastTurnAround = this.time;
    }
    // room visits
    const p = g.player?.position;
    if (p) {
      const r = g.world.getRoomAt?.(p.x, p.z) || null;
      if (r !== this.room) {
        this.room = r;
        if (r) {
          const v = this.visits.get(r.id) || { n: 0, last: 0, total: 0 };
          v.n++;
          v.last = this.time;
          this.visits.set(r.id, v);
        }
      } else if (r) this.visits.get(r.id).total += dt;
      this.stillFor = g.player.isMoving ? 0 : this.stillFor + dt;
    }
  }

  /** The camera swung more than ~125° within `win` seconds. */
  turnedAround(win = 1.4) {
    const now = this.time;
    const cur = this.yawHist[(this.hi + 63) % 64];
    let maxD = 0;
    for (let k = 1; k < 64; k++) {
      const i = (this.hi + 63 - k) % 64;
      if (now - this.timeHist[i] > win) break;
      let d = cur - this.yawHist[i];
      d = Math.abs(((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (d > maxD) maxD = d;
    }
    return maxD > 2.2;
  }

  /** Camera-space view test for one point. margin widens (>0) or narrows (<0) the frustum. */
  _inView(p, margin = 0) {
    _v.copy(p).applyMatrix4(this._inv || _inv);
    if (_v.z > -0.05) return false; // behind the camera
    const z = -_v.z;
    return Math.abs(_v.x) <= this.tanH * (1 + margin) * z && Math.abs(_v.y) <= this.tanV * (1 + margin) * z;
  }

  couldSee(pos, h = 1.4) {
    _e.set(pos.x, (pos.y || 0) + h, pos.z);
    return this.game.world.lineOfSight(this.eye, _e);
  }

  /** How lit a point is for the player's eyes (0..1): torch cone + room lights + ambient. */
  lightAt(p, dist) {
    const pl = this.game.player;
    let lit = this.lighting ? this.lighting.levelAt(p.x, p.z) : 0.6;
    if (pl?.flashlightOn && !pl.isHidden && pl.flashlight) {
      const fl = pl.flashlight;
      _v.copy(p).sub(this.eye);
      const d = _v.length() || 1;
      const cos = _v.dot(this.forward) / d;
      const ang = Math.acos(Math.min(1, cos));
      if (ang < fl.angle * 1.05 && d < fl.distance * 0.85) {
        const k = (1 - d / (fl.distance * 0.85)) * (ang < fl.angle * (1 - fl.penumbra * 0.6) ? 1 : 0.45);
        lit = Math.max(lit, 0.25 + 0.75 * k);
      }
    }
    if (dist < 2.2) lit = Math.max(lit, 0.2); // close enough to make out a shape anyway
    return lit;
  }

  /** Full visibility report for a figure standing at pos (feet). */
  test(pos, { heights = BODY, margin = 0 } = {}) {
    const world = this.game.world;
    let inF = 0, vis = 0;
    let angle = 0;
    for (let i = 0; i < heights.length; i++) {
      _e.set(pos.x, (pos.y || 0) + heights[i], pos.z);
      const f = this._inView(_e, margin);
      if (f) inF++;
      if (f && world.lineOfSight(this.eye, _e)) vis++;
    }
    _e.set(pos.x, (pos.y || 0) + 1.4, pos.z);
    _v.copy(_e).sub(this.eye);
    const dist = Math.hypot(_v.x, _v.z);
    angle = this.forward.angleTo(_v.normalize());
    const frac = vis / heights.length;
    const lit = vis ? this.lightAt(_e, dist) : 0;
    let state = 'hidden';
    if (vis) {
      const halfH = Math.atan(this.tanH);
      state = angle > halfH * 0.72 ? 'edge' : frac < 0.67 ? 'partial' : 'full';
    }
    // perceived: in view, not occluded, and lit enough to register (fog swallows it past ~26 m)
    const perceived = vis > 0 && lit > 0.07 && dist < 30;
    return { state, frac, angle, dist, inFrustum: inF > 0, los: vis > 0, lit, perceived };
  }

  /** Can something appear here right now without popping into view? */
  canPlace(pos, heights = BODY) {
    const world = this.game.world;
    for (let i = 0; i < heights.length; i++) {
      _e.set(pos.x, (pos.y || 0) + heights[i], pos.z);
      if (!this._inView(_e, 0.18)) continue; // well outside the view (turning reveals it already there)
      if (!world.lineOfSight(this.eye, _e)) continue; // behind a wall or a closed door
      // in view: only acceptable when it is lost in darkness and out of the torch beam
      _v.copy(_e).sub(this.eye);
      const d = Math.hypot(_v.x, _v.z);
      if (d < 4 || this.lightAt(_e, d) > 0.05) return false;
    }
    return true;
  }

  /** Is the player looking roughly towards pos (within `deg` of the view centre)? */
  facing(pos, deg = 25) {
    _v.set(pos.x - this.eye.x, 0, pos.z - this.eye.z).normalize();
    _e.set(this.forward.x, 0, this.forward.z).normalize();
    return _v.dot(_e) > Math.cos(THREE.MathUtils.degToRad(deg));
  }
}
