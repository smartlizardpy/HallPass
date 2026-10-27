// LAST BELL — The Halloween Shift: the boy drops his torch (the slap).
//
// Playtest (26 Oct), on the slap: "could've been more realistic... played with the player's character's hands...
// drop the flashlight". On the hit his torch hand jerks up, the torch flies out of it, clatters onto the floor and
// spins, its beam sweeping the floor and the walls; he glances down at it, and a second and a half later the hand
// comes back up with it.
// The light never goes out (it only points the wrong way for a moment) and you can still move, so nothing about
// the route changes. It borrows the player's own objects (the viewmodel and the torch light) and puts them back
// exactly. It runs after player.update each frame (game.js), so its offsets to the viewmodel never build up.

import * as THREE from '../lib/three/three.module.js';
import { addVertexSnap, loadGLB } from '../assets.js';

const JERK = 0.16; // s: the hand jerks up, then lets go
const R = 0.035; // the torch's radius on the floor

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class TorchDrop {
  constructor(game) {
    this.game = game;
    this.s = null; // the drop in progress
    this.holder = new THREE.Group();
    this.holder.name = 'hw-dropped-torch';
    this.holder.visible = false;
    loadGLB((game.assetBase || '') + 'assets/items/flashlight.glb')
      .then((gltf) => this._build(gltf))
      .catch((err) => console.warn('[halloween] torch model', err));
  }

  /** Just the torch (the GLB carries the hand and sleeve too); its lens points down -Z, like in the hand. */
  _build(gltf) {
    const src = gltf.scene.getObjectByName('flashlight');
    if (!src) return;
    // the torch's own primitives: the node itself, or (several materials) its mesh children, not the hand node
    const parts = src.isMesh ? [src] : src.children.filter((o) => o.isMesh && !/hand/i.test(o.name));
    const mat = (m) => {
      const c = m.clone();
      addVertexSnap(c);
      if (/torch_plastic/i.test(m.name || '')) c.color?.setHex(0x4a4e55); // as in the hand (player.js)
      if (/lens|glow/i.test(m.name || '') && c.emissive) {
        c.emissive.setHex(0xfff0da);
        c.emissiveIntensity = 1.6;
      }
      return c;
    };
    for (const o of parts) {
      const m = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? o.material.map(mat) : mat(o.material));
      m.position.copy(o.position);
      m.quaternion.copy(o.quaternion);
      this.holder.add(m);
    }
  }

  get active() {
    return !!this.s;
  }

  /** The hit. Returns false when it can't (no torch in hand: hidden, off, already dropped). */
  drop({ hold = 1.5 } = {}) {
    const g = this.game, p = g.player;
    if (this.s || !p?.viewmodel?.visible || !p.flashlight || p.isHidden || !p.flashlightOn || !this.holder.children.length) return false;
    const reduced = !!p.settings?.reducedEffects;
    this.s = { t: 0, phase: 'jerk', hold, reduced, rot0: p.viewmodel.rotation.clone() };
    return true;
  }

  _letGo() {
    const g = this.game, p = g.player, s = this.s, cam = g.camera;
    s.phase = 'fall';
    s.t = 0;
    if (!this.holder.parent) g.scene.add(this.holder);
    // from the hand, flying a little forward and out of it
    p.viewmodel.getWorldPosition(_v);
    this.holder.position.copy(_v);
    cam.getWorldQuaternion(_q);
    this.holder.quaternion.copy(_q);
    this.holder.rotation.reorder('YXZ');
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
    fwd.y = 0;
    fwd.normalize();
    const side = Math.random() < 0.5 ? -1 : 1;
    s.v = new THREE.Vector3(fwd.x * 2.0 - fwd.z * 0.3 * side, 0.55, fwd.z * 2.0 + fwd.x * 0.3 * side); // lands ~1.8 m ahead
    s.po = 0; // how far he is looking down at it (added to the player's pitch, taken off again)
    s.spin = { yaw: (6 + Math.random() * 3) * side * (s.reduced ? 0.5 : 1), pitch: 7 + Math.random() * 3 };
    s.bounced = 0;
    // the light goes with it
    const L = p.flashlight;
    s.light = { parent: L.parent, pos: L.position.clone(), tParent: L.target.parent, tPos: L.target.position.clone() };
    this.holder.add(L);
    L.position.set(0, 0, -0.13);
    this.holder.add(L.target);
    L.target.position.set(0, 0, -6);
    p.viewmodel.visible = false;
    this.holder.visible = true;
    g.audio?.play?.('hw_scrape', { position: this.holder.position, volume: 0.25, rate: 2.2 }); // it slips out of the hand
  }

  _pickUp() {
    const g = this.game, p = g.player, s = this.s;
    if (s?.po) p.pitch -= s.po;
    if (s?.light) {
      const L = p.flashlight;
      s.light.parent.add(L);
      L.position.copy(s.light.pos);
      s.light.tParent.add(L.target);
      L.target.position.copy(s.light.tPos);
    }
    this.holder.visible = false;
    p.viewmodel.rotation.copy(s?.rot0 || new THREE.Euler());
    if (g.state === 'playing' || g.state === 'paused') p.viewmodel.visible = true;
    p._vmLower = 1; // it comes back up from below (player.js eases it back)
    this.s = null;
  }

  /** Put everything back now (the run ended, the menu...). */
  cancel() {
    if (!this.s) return;
    this._pickUp();
  }

  update(dt) {
    const s = this.s;
    if (!s) return;
    const g = this.game, p = g.player;
    s.t += dt;
    if (s.phase === 'jerk') {
      // the hand jerks up and back (the torch tips up), then lets go
      const u = Math.min(1, s.t / JERK), env = Math.sin(u * Math.PI * 0.5);
      p.viewmodel.position.y += 0.07 * env;
      p.viewmodel.position.z += 0.04 * env;
      p.viewmodel.rotation.set(s.rot0.x + 0.75 * env, s.rot0.y, s.rot0.z - 0.35 * env);
      if (u >= 1) this._letGo();
      return;
    }
    // fall, bounce, spin on the floor
    const h = this.holder, w = g.world;
    s.v.y -= 9.8 * dt;
    const nx = h.position.x + s.v.x * dt, nz = h.position.z + s.v.z * dt;
    if (w.isWalkable(nx, nz, 0.05, 0)) {
      h.position.x = nx;
      h.position.z = nz;
    } else {
      s.v.x *= -0.4;
      s.v.z *= -0.4;
    }
    h.position.y += s.v.y * dt;
    if (h.position.y <= R) {
      h.position.y = R;
      if (s.v.y < -0.5 && s.bounced < 2) {
        g.audio?.play?.('hw_thud', { position: h.position, volume: s.bounced ? 0.3 : 0.55, rate: 1.7 + s.bounced * 0.3 }); // clatter
        s.v.y = -s.v.y * 0.28;
        s.bounced++;
      } else s.v.y = 0;
      const k = Math.exp(-3 * dt); // it slides to a stop
      s.v.x *= k;
      s.v.z *= k;
      s.spin.pitch *= Math.exp(-14 * dt);
      s.spin.yaw *= Math.exp(-1.6 * dt); // keeps turning a while: the beam sweeps round the room
    }
    h.rotation.y += s.spin.yaw * dt;
    // tumbles in the air; on the floor it lies flat
    if (h.position.y > R + 0.01) h.rotation.x += s.spin.pitch * dt;
    else h.rotation.x += (0 - h.rotation.x) * Math.min(1, dt * 18);
    h.rotation.z += (Math.PI * 0.5 - h.rotation.z) * Math.min(1, dt * 10); // on its side
    // he looks down at it, then back up as he grabs it (in view: at eye level the floor this close is off-screen)
    const dip = s.reduced ? -0.3 : -0.5;
    const look = dip * Math.min(1, s.t / 0.35) * Math.min(1, Math.max(0, (s.hold - s.t) / 0.4));
    p.pitch += look - s.po;
    s.po = look;
    if (s.t >= s.hold) this._pickUp();
  }

  dispose() {
    this.cancel();
    this.holder.parent?.remove(this.holder);
  }
}
