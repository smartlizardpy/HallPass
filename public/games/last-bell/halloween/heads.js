// LAST BELL — The Halloween Shift: the falling head.
//
// A low-poly severed head (pale skin, long dark hair, a red stump) built from primitives with the PS1 vertex
// snap. It is ALWAYS mosaic-censored on screen (blood.censorSphere), so the player never sees it clearly,
// only the shape and the colours: round, pale, hair, red. The director decides when one falls.
//
//   heads.hatch(x, z)     a ceiling tile knocked aside: a black gap overhead (stays for the run)
//   heads.drop(x, z, { roll })  fall from the ceiling with gravity, a heavy wet hit, a bounce, a short roll
//                         leaving a smear, then rest; returns the head. onLand(head) fires on impact.
//   heads.place(x, z)     just lying there (used when the lights come back)
//   heads.removeUnseen()  each resting head goes as soon as nobody can see it
//
// No collider, no Caretaker noise: purely a scare, so it can't change a run.

import * as THREE from '../lib/three/three.module.js';
import { addVertexSnap, loadGLB } from '../assets.js';
import { WALL_HEIGHT } from '../config.js';

const R = 0.13; // collision radius (floor contact)

function mat(color, emissive = 0) {
  const m = new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: emissive ? 1 : 0 });
  addVertexSnap(m);
  return m;
}

let MATS = null;
function mats() {
  return (MATS ||= {
    skin: mat(0xc2b2a2, 0x0d0a09),
    hair: mat(0x15100c),
    socket: mat(0x1e0d0b),
    stump: mat(0x5e0a0c, 0x120102),
    wet: mat(0x8c1218, 0x1c0204),
    hatch: new THREE.MeshBasicMaterial({ color: 0x030303 }),
  });
}

// The modelled head (_blender/items/build_head.py → assets/environment/hw_head.glb): skull, jaw, half-shut eyes,
// open mouth, wet hair, a cut neck; all its colour is in vertex colours. Until it loads (or if it can't), the
// primitive head below stands in, and heads already out are swapped over when it arrives.
const HEAD_URL = 'assets/environment/hw_head.glb';
let MODEL = null;
let modelLoad = null;

function loadModel(base, onReady) {
  modelLoad ||= loadGLB(base + HEAD_URL)
    .then((gltf) => {
      // a little under white: up close the torch washed the dead skin out to white
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xb8b0a6, emissive: 0x050403 });
      addVertexSnap(mat);
      const g = new THREE.Group();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
        g.add(new THREE.Mesh(geo, mat));
      });
      MODEL = g.children.length ? g : null;
      return MODEL;
    })
    .catch((err) => {
      console.warn('[halloween] head model', err);
      return null;
    });
  return modelLoad.then((m) => m && onReady?.());
}

/** The head's meshes: the model if it has loaded, else the primitive one. */
function fillHead(g, rnd) {
  if (MODEL) {
    for (const m of MODEL.children) g.add(new THREE.Mesh(m.geometry, m.material));
    g.userData.model = true;
    return g;
  }
  return buildPrimitive(g, rnd);
}

function buildHead(rnd) {
  const g = new THREE.Group();
  g.name = 'hw-head';
  return fillHead(g, rnd);
}

function buildPrimitive(g, rnd) {
  const M = mats();
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };
  add(new THREE.SphereGeometry(0.105, 8, 6).scale(0.88, 1.12, 1), M.skin, 0, 0.02, 0);
  add(new THREE.SphereGeometry(0.11, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.92, 1.12, 1.04), M.hair, 0, 0.03, -0.005);
  // long hair, matted, falling back and to one side
  for (let i = 0; i < 5; i++) {
    const a = -1.1 + i * 0.55;
    add(new THREE.BoxGeometry(0.06, 0.3 + rnd() * 0.12, 0.02), M.hair, Math.sin(a) * 0.08, -0.09, -Math.cos(a) * 0.08, -0.25 - rnd() * 0.2, a, 0);
  }
  // face: sockets, nose, open mouth
  add(new THREE.BoxGeometry(0.035, 0.022, 0.02), M.socket, -0.035, 0.035, 0.09);
  add(new THREE.BoxGeometry(0.035, 0.022, 0.02), M.socket, 0.035, 0.035, 0.09);
  add(new THREE.BoxGeometry(0.022, 0.035, 0.03), M.skin, 0, 0.0, 0.1);
  add(new THREE.BoxGeometry(0.045, 0.03, 0.02), M.socket, 0, -0.045, 0.088);
  // the neck stump
  add(new THREE.CylinderGeometry(0.048, 0.055, 0.07, 7), M.skin, 0, -0.12, -0.01);
  add(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 7), M.stump, 0, -0.158, -0.01);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.014, 6), M.wet, 0, -0.162, -0.01);
  return g;
}

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
}

export class Heads {
  constructor(game, blood, gaze) {
    this.game = game;
    this.blood = blood;
    this.gaze = gaze;
    this.group = new THREE.Group();
    this.group.name = 'hw-heads';
    this.list = [];
    this.hatches = [];
    this.seed = 1;
    this.onLand = null;
    // heads already out (the desk one, set on the run's first frame) get the model when it arrives
    loadModel(game.assetBase || '', () => {
      for (const h of this.list) {
        if (h.obj.userData.model) continue;
        h.obj.clear();
        fillHead(h.obj, h.rnd);
      }
    });
  }

  _ensure() {
    if (!this.group.parent) this.game.scene.add(this.group);
  }

  hatch(x, z) {
    this._ensure();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), mats().hatch);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, WALL_HEIGHT - 0.01, z);
    m.renderOrder = 2;
    this.group.add(m);
    this.hatches.push(m);
    return m;
  }

  _make(x, y, z) {
    this._ensure();
    const rnd = rngFrom(++this.seed * 7919);
    const obj = buildHead(rnd);
    obj.position.set(x, y, z);
    this.group.add(obj);
    this.blood.censorSphere(obj, 0.165); // just the head (bigger, and the desk round it became a beige blob)
    const h = { obj, vx: 0, vy: 0, vz: 0, spin: new THREE.Vector3(), state: 'rest', bounces: 0, smearAcc: 0, rnd, landedAt: -1, leaving: false };
    this.list.push(h);
    return h;
  }

  drop(x, z, { roll = null, from = WALL_HEIGHT - 0.12 } = {}) {
    const h = this._make(x, from, z);
    h.state = 'fall';
    h.spin.set((h.rnd() - 0.5) * 7, (h.rnd() - 0.5) * 4, (h.rnd() - 0.5) * 7);
    h.roll = roll || { x: (h.rnd() - 0.5) * 1.2, z: (h.rnd() - 0.5) * 1.2 };
    return h;
  }

  place(x, z, yaw = 0) {
    const h = this._make(x, R, z);
    h.obj.rotation.set(0, yaw, Math.PI / 2 * (h.rnd() < 0.5 ? 1 : -1));
    this.blood.splat(x, z, 0.55, this.seed, h.rnd() * 6);
    h.landedAt = this.gaze.time;
    return h;
  }

  /** A head left sitting upright on its neck on a surface (a teacher's desk) whose top is at height y. It stays. */
  placeAt(x, y, z, yaw = 0) {
    const h = this._make(x, y + 0.161, z); // the stump (0.16 below the centre in the model) on the surface
    h.obj.rotation.set(-0.06, yaw, (h.rnd() - 0.5) * 0.12, 'YXZ'); // a slight tilt: it was put there, not dropped
    h.landedAt = this.gaze.time;
    h.keep = true;
    return h;
  }

  update(dt) {
    const w = this.game.world;
    for (const h of this.list) {
      const o = h.obj;
      if (h.state === 'fall' || h.state === 'bounce') {
        h.vy -= 9.8 * dt;
        o.position.y += h.vy * dt;
        o.position.x += h.vx * dt;
        o.position.z += h.vz * dt;
        o.rotation.x += h.spin.x * dt;
        o.rotation.y += h.spin.y * dt;
        o.rotation.z += h.spin.z * dt;
        if (o.position.y <= R) {
          o.position.y = R;
          if (h.state === 'fall') {
            h.landedAt = this.gaze.time;
            this.blood.splat(o.position.x, o.position.z, 0.62, this.seed + 3, h.rnd() * 6);
            if (h.onLand) h.onLand(h); // its own (the desk head toppling)
            else this.onLand?.(h);
            h.state = 'bounce';
            h.vy = 1.1;
            h.vx = h.roll.x;
            h.vz = h.roll.z;
            h.spin.multiplyScalar(0.5);
          } else {
            h.state = 'roll';
            h.vy = 0;
            this.game.audio.play?.('hw_thud', { position: o.position, volume: 0.35, rate: 0.75 });
          }
        }
      } else if (h.state === 'roll') {
        const sp = Math.hypot(h.vx, h.vz);
        if (sp < 0.05) {
          h.state = 'rest';
          // it settles on its side
          o.rotation.x = 0;
          o.rotation.z = Math.PI / 2 * Math.sign(o.rotation.z || 1);
          continue;
        }
        const nx = o.position.x + h.vx * dt, nz = o.position.z + h.vz * dt;
        if (!w.isWalkable(nx, nz, R, 0)) {
          h.vx *= -0.3;
          h.vz *= -0.3;
        } else {
          o.position.x = nx;
          o.position.z = nz;
        }
        // rolling: spin about the axis perpendicular to the motion
        o.rotation.x += (h.vz / R) * dt;
        o.rotation.z -= (h.vx / R) * dt;
        const k = Math.max(0, 1 - 2.2 * dt);
        h.vx *= k;
        h.vz *= k;
        h.smearAcc += sp * dt;
        if (h.smearAcc > 0.14) {
          h.smearAcc = 0;
          this.blood.splat(o.position.x, o.position.z, 0.2 + h.rnd() * 0.1, this.seed + this.list.length * 5 + ((h.rnd() * 99) | 0), h.rnd() * 6);
        }
      }
      if (h.leaving && h.state === 'rest') {
        const t = this.gaze.test(o.position, { heights: [0.1] });
        if (!t.los || !t.inFrustum || t.lit < 0.04) this._remove(h);
      }
    }
  }

  /** Let every resting head go the moment it can't be seen. */
  removeUnseen() {
    for (const h of this.list) if (!h.keep) h.leaving = true;
  }

  get falling() {
    return this.list.some((h) => h.state !== 'rest');
  }

  _remove(h) {
    this.group.remove(h.obj);
    this.blood.uncensor(h.obj);
    h.obj.traverse((m) => m.geometry?.dispose());
    this.list = this.list.filter((x) => x !== h);
  }

  clear() {
    for (const h of [...this.list]) this._remove(h);
    for (const m of this.hatches) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.hatches = [];
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}
