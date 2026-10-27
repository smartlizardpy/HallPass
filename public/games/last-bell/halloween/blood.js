// LAST BELL — The Halloween Shift: blood. Low-res, nearest-filtered, like the rest of the school.
//
// Wall runs: each decal is generated per seed into a small RGBA DataTexture (~80 px per metre): a splash
// (overlapping blobs + spatter), runs that wander, bead and taper as they go down, a bulb where each one
// stops, darker dried edges, a one-pixel wet highlight, and for big ones a pool along the skirting. The
// alpha channel holds each pixel's ARRIVAL time (splash first, run tips last), and the material's
// alphaTest walks down it: the drips run down the wall at no cost (no redraws, no recompiles).
//
// Ceiling drips: a stain overhead, drops that fall (gravity), a quiet patter and a pool that slowly grows.
//
// Censoring: big blood is mosaicked on screen like redacted bodycam footage (Bodycam / Unrecord censor
// faces this way): while a big decal is in view and not behind a wall, its screen box goes to
// game.postfx.redact (postfx.js). Scare intensity 'mild' censors every decal. Severed heads (heads.js)
// register as censor spheres and are always censored, first.
//
//   blood.wall(spot, { size: 'small'|'big', seed, progress, speed }) → decal   spot: { x, z, nx, nz, tx, tz }
//   blood.hand(spot, { height, seed, left }) → a handprint that smears down     blood.lens({ n, big }) → drops on the bodycam lens
//   blood.ceiling(x, z, seed) → drip      blood.splat(x, z, size, seed) → floor splat
//   blood.censorSphere(obj, r) / uncensor(obj)                                  blood.update(dt, gaze)

import * as THREE from '../lib/three/three.module.js';
import { addVertexSnap } from '../assets.js';
import { WALL_HEIGHT } from '../config.js';

const PPM = 80; // texture pixels per metre
const C_CORE = [104, 9, 12];
const C_DARK = [62, 6, 7];
const C_WET = [150, 24, 28];
const C_DRY = [48, 14, 10];

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
}

/** RGBA bytes (row 0 = bottom, for a DataTexture with flipY false) for a w × h metre run. */
function paintRun(wm, hm, big, seed) {
  const W = Math.max(16, Math.round(wm * PPM)), H = Math.max(24, Math.round(hm * PPM));
  const rnd = rngFrom(seed);
  const arr = new Float32Array(W * H).fill(Infinity); // arrival 0..1
  const kind = new Uint8Array(W * H); // 0 none, 1 core, 2 edge, 3 wet, 4 dried spatter
  const set = (x, y, t, k) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (t < arr[i]) arr[i] = t;
    if (k === 1 || kind[i] === 0 || (k === 3 && kind[i] === 1)) kind[i] = k;
  };
  const disc = (cx, cy, r, t0, tr = 0.08) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d > r) continue;
        set(x, y, t0 + (d / Math.max(1, r)) * tr, d > r - 1.2 ? 2 : 1);
      }
    }
  };
  // splash: where it hit, in the upper part
  const cx = W * (0.35 + rnd() * 0.3);
  const cy = H * (big ? 0.16 + rnd() * 0.08 : 0.12 + rnd() * 0.06);
  const R = Math.min(W, H) * (big ? 0.2 : 0.24);
  disc(cx, cy, R, 0, 0.1);
  const blobs = big ? 9 : 5;
  for (let k = 0; k < blobs; k++) {
    const a = rnd() * Math.PI * 2, d = R * (0.5 + rnd() * 0.7);
    disc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, R * (0.25 + rnd() * 0.35), 0.02 + rnd() * 0.05, 0.06);
  }
  // spatter flung outwards
  for (let k = 0; k < (big ? 40 : 16); k++) {
    const a = rnd() * Math.PI * 2, d = R * (1.2 + rnd() * 1.6);
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
    if (rnd() < 0.7) set(x, y, 0.03 + rnd() * 0.05, rnd() < 0.5 ? 4 : 1);
    else disc(x, y, 0.8 + rnd() * 1.2, 0.04, 0.02);
  }
  // runs from the bottom of the splash
  const runs = big ? 6 + ((rnd() * 4) | 0) : 2 + ((rnd() * 3) | 0);
  const floorY = H - 1;
  for (let k = 0; k < runs; k++) {
    let x = cx + (rnd() - 0.5) * R * 1.7;
    let y = cy + R * (0.4 + rnd() * 0.5);
    let w = (big ? 1.6 : 1.1) + rnd() * (big ? 2.2 : 1.2);
    const toFloor = big && rnd() < 0.55;
    const len = toFloor ? floorY - y : (H - y) * (0.25 + rnd() * 0.6);
    const t0 = 0.12 + rnd() * 0.12;
    const speed = 0.55 + rnd() * 0.45; // slower runs arrive later
    let vx = 0;
    const y0 = y;
    while (y < y0 + len) {
      const u = (y - y0) / len;
      const t = Math.min(0.98, t0 + u * (1 - t0) / speed * 0.8);
      const bead = Math.sin(u * 40 + k) > 0.92 ? 0.8 : 0; // a bead where the run hesitated
      const ww = Math.max(0.6, w * (1 - u * 0.55) + bead);
      for (let dx = -Math.ceil(ww); dx <= Math.ceil(ww); dx++) {
        const d = Math.abs(dx) / ww;
        if (d > 1) continue;
        set(x + dx, y, t, d > 0.7 ? 2 : dx === -1 && ww > 1.4 ? 3 : 1);
      }
      vx = vx * 0.85 + (rnd() - 0.5) * 0.18;
      x += vx;
      y += 1;
    }
    // the bulb where it stopped (or where it met the floor)
    disc(x, Math.min(floorY - 1, y), Math.max(1.2, w * 0.85), Math.min(0.99, t0 + (1 - t0) / speed * 0.8), 0.01);
    if (toFloor) disc(x, floorY, w * 2.2, 0.97, 0.02);
  }
  // write RGBA, bottom row first
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = ((H - 1 - y) * W + x) * 4;
      const k = kind[i];
      if (!k) continue;
      const c = k === 1 ? C_CORE : k === 2 ? C_DARK : k === 3 ? C_WET : C_DRY;
      const n = 0.88 + rnd() * 0.24;
      data[o] = Math.min(255, c[0] * n);
      data[o + 1] = Math.min(255, c[1] * n);
      data[o + 2] = Math.min(255, c[2] * n);
      data[o + 3] = Math.max(32, Math.round(255 * (1 - 0.86 * Math.min(1, arr[i]))));
    }
  }
  return { data, W, H };
}

/** A round pool / ceiling stain, RGBA bytes. */
function paintStain(px, seed, wet = true) {
  const rnd = rngFrom(seed);
  const data = new Uint8Array(px * px * 4);
  const c = px / 2;
  const lobes = Array.from({ length: 6 }, () => [rnd() * Math.PI * 2, 0.75 + rnd() * 0.3]);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const a = Math.atan2(dy, dx);
      let r = 0.62;
      for (const [la, lr] of lobes) r = Math.max(r, lr * Math.max(0, Math.cos(a - la)) ** 6);
      const d = Math.hypot(dx, dy) / c;
      if (d > r) continue;
      const o = (y * px + x) * 4;
      const col = d > r - 0.12 ? C_DARK : wet && d < 0.25 && rnd() < 0.2 ? C_WET : C_CORE;
      data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
    }
  }
  return data;
}

/** A handprint (palm, five fingers) with drag marks under it; alpha = arrival (print first, drags last). */
function paintHand(wm, hm, seed, left) {
  const W = Math.max(16, Math.round(wm * PPM)), H = Math.max(24, Math.round(hm * PPM));
  const rnd = rngFrom(seed);
  const data = new Uint8Array(W * H * 4);
  const put = (x, y, col, arrival) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    const a = Math.round(255 * (1 - 0.86 * Math.min(1, arrival)));
    if (data[o + 3] >= a && data[o + 3] > 0) return;
    data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = a;
  };
  const blob = (cx, cy, rx, ry, arrival) => {
    for (let y = -ry; y <= ry; y++) {
      for (let x = -rx; x <= rx; x++) {
        const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
        if (d > 1 + (rnd() - 0.5) * 0.25) continue;
        put(cx + x, cy + y, d > 0.72 ? C_DARK : rnd() < 0.08 ? C_WET : C_CORE, arrival);
      }
    }
  };
  const s = W / 27; // pixels per hand unit
  const pcx = W / 2, pcy = H * 0.52; // palm centre (rows grow upwards)
  const mir = left ? -1 : 1;
  blob(pcx, pcy, 6.5 * s, 7 * s, 0); // palm
  blob(pcx - mir * 6.5 * s, pcy - 1 * s, 3 * s, 4.5 * s, 0); // thumb pad
  // fingers: [x offset, length, tilt]
  const fingers = [[-4.6, 7, -0.25], [-1.6, 9.5, -0.08], [1.4, 10, 0.04], [4.2, 8.6, 0.16]];
  for (const [fx, len, tilt] of fingers) {
    for (let k = 0; k <= len; k += 0.5) {
      const x = pcx + mir * (fx + Math.sin(tilt) * k) * s, y = pcy + (6.5 + k) * s;
      blob(x, y, 1.45 * s, 1.45 * s, 0);
    }
  }
  // thumb
  for (let k = 0; k <= 6; k += 0.5) blob(pcx - mir * (7.5 + k * 0.55) * s, pcy + (1 + k * 0.7) * s, 1.6 * s, 1.6 * s, 0);
  // drag marks: the hand slides down, leaving streaks under the palm and fingertips
  const streaks = 3 + ((rnd() * 3) | 0);
  for (let i = 0; i < streaks; i++) {
    const x0 = pcx + (rnd() - 0.5) * 11 * s;
    const len = (0.25 + rnd() * 0.45) * pcy;
    for (let k = 0; k < len; k++) {
      const u = k / len;
      put(x0 + Math.sin(k * 0.3 + i) * 0.6, pcy - 5 * s - k, u > 0.85 ? C_DARK : C_CORE, 0.35 + 0.65 * u);
      if (u < 0.6) put(x0 + 1, pcy - 5 * s - k, C_CORE, 0.35 + 0.65 * u);
    }
    blob(x0, pcy - 5 * s - len, 1.2 * s, 1.5 * s, 1); // the bead where it stops
  }
  return { data, W, H };
}

/** A drag smear, rows along the drag (row 0 = where it starts): streaks that dry out one by one, ragged edges. u0-u1: where this piece sits along the whole trail. */
function paintSmear(W, H, seed, u0, u1) {
  const rnd = rngFrom(seed);
  const data = new Uint8Array(W * H * 4);
  const col = Array.from({ length: W }, () => rnd());
  for (let x = 1; x < W - 1; x++) col[x] = (col[x - 1] + col[x] * 2 + col[x + 1]) / 4;
  for (let y = 0; y < H; y++) {
    const v = u0 + (u1 - u0) * (y / H); // along the whole trail
    const half = (W / 2) * (0.85 + 0.15 * Math.sin(y * 0.5 + seed)) * (1 - 0.25 * v);
    for (let x = 0; x < W; x++) {
      const off = Math.abs(x + 0.5 - W / 2);
      if (off > half) continue;
      const edge = off / half;
      const k = col[x];
      if (k < v * 0.75 + edge * 0.35 - 0.05 && rnd() < 0.9) continue; // this streak has run dry
      if (rnd() < 0.03 + v * 0.12) continue;
      const c = edge > 0.78 || rnd() < v * 0.5 ? C_DRY : k > 0.8 && rnd() < 0.25 ? C_WET : rnd() < 0.35 ? C_DARK : C_CORE;
      const o = (y * W + x) * 4;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
  }
  return data;
}

function texFrom(data, W, H) {
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

function decalMaterial(map, alphaTest = 0.5) {
  const m = new THREE.MeshLambertMaterial({ map, alphaTest, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  addVertexSnap(m);
  return m;
}

const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _e = new THREE.Vector3();
const _h = new THREE.Vector3();
const _q = new THREE.Vector3();
const _pl = new THREE.Plane();
const _ray = new THREE.Ray();
const _cornerSeen = new Array(49).fill(false);
const WALL_CORNERS = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]; // × (w, h): wall decals grow up from their base
const FLAT_CORNERS = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]; // pools and splats: centred unit planes
const _corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

export class Blood {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'hw-blood';
    this.decals = [];
    this.drips = [];
    this.splats = [];
    this.spheres = new Map(); // object3D → radius (always censored)
    this.censor = 'big'; // 'big' | 'all' (scare intensity: standard+intense | mild)
    this.enabled = true;
  }

  /** A run on a wall. spot: { x, z, nx, nz (into the room), tx, tz }, bottom at the floor. */
  /**
   * True when nothing stands against this stretch of wall (lockers, shelves, boards...): blood painted
   * behind furniture is hidden by it, and its censor blocks would cover the furniture instead.
   * half = half the decal width plus any slide along the wall.
   */
  wallClear(spot, half = 0.7, along = 0) {
    const cols = this.game.world.colliders;
    if (!cols) return true;
    const tx = spot.tx || 0, tz = spot.tz || 0;
    const cx = spot.x + tx * along, cz = spot.z + tz * along;
    const ax = cx + spot.nx * 0.02, az = cz + spot.nz * 0.02; // at the wall face
    const bx = cx + spot.nx * 0.8, bz = cz + spot.nz * 0.8; // a step out into the room
    const ex = Math.abs(tx) * half, ez = Math.abs(tz) * half;
    // tall furniture (lockers, shelves) and wall boards; a low desk or bin only hides the foot of a run,
    // and the censor keeps track of what stands in front
    if (cols.forEach(Math.min(ax, bx) - ex, Math.min(az, bz) - ez, Math.max(ax, bx) + ex, Math.max(az, bz) + ez, (c) => c.kind === 'prop' && (c.h >= 1.0 || c.noLos))) return false;
    // things mounted on the wall with no collider (noticeboards, boards, shelves): from the room's dressing
    const w = this.game.world;
    const list = spot.roomId != null ? w.static?.owners?.get('room:' + spot.roomId) : null;
    for (const pl of list || []) {
      const e = pl.m.elements;
      const rx = e[12] - cx, rz = e[14] - cz;
      const out = rx * spot.nx + rz * spot.nz; // how far out from the wall
      if (out < -0.25 || out > 0.45) continue;
      let bb = null;
      try {
        bb = w.kit?.bbox?.(pl.node);
      } catch {
        /* unknown node */
      }
      const reach = bb ? Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 0.5 : 0.6;
      if (Math.abs(rx * tx + rz * tz) > half + reach) continue;
      if (/^poster/.test(pl.node)) continue; // flat on the wall: blood runs over it
      if (e[13] + (bb ? bb.max.y : 1) < 0.8) continue; // below the run (skirting, bins)
      if (e[13] + (bb ? bb.min.y : 0) > 2.05) continue; // above it (clocks, pipes)
      return false;
    }
    return true;
  }

  /** A clear place along this 4 m stretch of wall (offset from its middle, metres), or null. */
  clearAlong(spot, half = 0.7, rng = Math.random) {
    const lim = 2 - half - 0.15;
    const offs = [0, 0.6, -0.6, 1.2, -1.2].filter((o) => Math.abs(o) <= lim);
    for (let i = offs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [offs[i], offs[j]] = [offs[j], offs[i]];
    }
    for (const o of offs) if (this.wallClear(spot, half, o)) return o;
    return null;
  }

  wall(spot, { size = 'small', seed = 1, progress = 1, speed = 0.12, along = 0 } = {}) {
    if (!this.enabled) return null;
    if (!this.group.parent) this.game.scene.add(this.group);
    const big = size === 'big';
    const wm = big ? 1.2 : 0.7, hm = big ? 2.0 : 1.2; // (playtest: small ones were too small to notice)
    const { data, W, H } = paintRun(wm, hm, big, seed);
    const tex = texFrom(data, W, H);
    const mat = decalMaterial(tex, 0.999);
    const geo = new THREE.PlaneGeometry(wm, hm);
    const bottom = big ? 0.01 : 0.55 + (seed % 7) * 0.06;
    geo.translate(0, hm / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(spot.x + spot.nx * 0.025 + (spot.tx || 0) * along, bottom, spot.z + spot.nz * 0.025 + (spot.tz || 0) * along);
    mesh.rotation.y = Math.atan2(spot.nx, spot.nz);
    mesh.name = 'hw-blood-' + size;
    this.group.add(mesh);
    const d = { mesh, mat, tex, big, w: wm, h: hm, progress: 0, target: 1, speed, bottom, seen: false, edge: spot.e ?? -1 };
    this._setProgress(d, progress);
    this.decals.push(d);
    return d;
  }

  /** A run of blood down a vertical face (a desk's end) from height `top`, `len` long; it runs in at `speed`. */
  streak(spot, { top = 0.77, len = 0.5, w = 0.28, seed = 1, progress = 1, speed = 0.12 } = {}) {
    if (!this.enabled) return null;
    if (!this.group.parent) this.game.scene.add(this.group);
    const { data, W, H } = paintRun(w, len, false, seed);
    const tex = texFrom(data, W, H);
    const mat = decalMaterial(tex, 0.999);
    const geo = new THREE.PlaneGeometry(w, len);
    geo.translate(0, len / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    const bottom = top - len * 0.93; // the splash at the top sits on the edge
    mesh.position.set(spot.x + spot.nx * 0.012, bottom, spot.z + spot.nz * 0.012);
    mesh.rotation.y = Math.atan2(spot.nx, spot.nz);
    mesh.name = 'hw-blood-streak';
    this.group.add(mesh);
    const d = { mesh, mat, tex, big: false, w, h: len, progress: 0, target: 1, speed, bottom, seen: false, edge: -1 };
    this._setProgress(d, progress);
    this.decals.push(d);
    return d;
  }

  _setProgress(d, p) {
    d.progress = Math.max(0, Math.min(1, p));
    d.mat.alphaTest = Math.max(0.12, 1 - 0.86 * d.progress - 0.004);
    d.mesh.visible = d.progress > 0.001;
  }

  /**
   * A bloody handprint slapped on a wall at `height` (its centre), smearing down after it lands: the palm and
   * fingers arrive at once, the drag marks below follow over ~1.5 s (speed). Never censored (it's a hand, not gore).
   */
  hand(spot, { height = 1.35, seed = 1, speed = 0.6, left = false } = {}) {
    if (!this.enabled) return null;
    if (!this.group.parent) this.game.scene.add(this.group);
    const wm = 0.34, hm = 0.62;
    const { data, W, H } = paintHand(wm, hm, seed, left);
    const tex = texFrom(data, W, H);
    const mat = decalMaterial(tex, 0.999);
    const geo = new THREE.PlaneGeometry(wm, hm);
    geo.translate(0, hm / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    const bottom = height - 0.42;
    mesh.position.set(spot.x + spot.nx * 0.026, bottom, spot.z + spot.nz * 0.026);
    mesh.rotation.y = Math.atan2(spot.nx, spot.nz);
    mesh.rotation.z = ((seed % 9) - 4) * 0.04;
    mesh.name = 'hw-blood-hand';
    this.group.add(mesh);
    const d = { mesh, mat, tex, big: false, hand: true, w: wm, h: hm, progress: 0, target: 1, speed, bottom, seen: false, edge: spot.e ?? -1 };
    this._setProgress(d, 0.45); // the print itself, at once
    this.decals.push(d);
    return d;
  }

  /**
   * Blood on the bodycam lens: a few out-of-focus drops land on the glass and run down it, then dry off over
   * ~8 s. A DOM overlay over the game view (it isn't in the world, it's on the camera).
   */
  lens({ n = 2, big = false } = {}) {
    if (typeof document === 'undefined') return;
    let root = document.querySelector('.hw-lens');
    if (!root) {
      root = document.createElement('div');
      root.className = 'hw-lens';
      document.body.appendChild(root);
    }
    for (let i = 0; i < n; i++) {
      const drop = document.createElement('div');
      drop.className = 'hw-lens__drop' + (big ? ' hw-lens__drop--big' : '');
      drop.style.left = `${8 + Math.random() * 78}%`;
      drop.style.top = `${4 + Math.random() * 38}%`;
      drop.style.setProperty('--s', String((big ? 1.6 : 1) * (0.7 + Math.random() * 0.7)));
      drop.style.setProperty('--run', `${18 + Math.random() * 30}vh`);
      drop.style.animationDelay = `${i * (0.08 + Math.random() * 0.25)}s`;
      root.appendChild(drop);
      setTimeout(() => drop.remove(), 9500);
    }
  }

  /**
   * A drag trail on the floor from (ax, az) to (bx, bz): streaky smears end to end (something was pulled that way),
   * narrowing, drying and breaking up towards the end, with a few drops beside it. Never censored.
   */
  trail(ax, az, bx, bz, seed = 1) {
    if (!this.enabled) return [];
    if (!this.group.parent) this.game.scene.add(this.group);
    const rnd = rngFrom(seed);
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1) return [];
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const out = [];
    let t = 0, i = 0;
    while (t < len - 0.3) {
      const u = t / len;
      const l = Math.min(len - t, 0.8 + rnd() * 0.5), w = (0.5 - 0.22 * u) * (0.9 + rnd() * 0.2);
      const wob = Math.sin(t * 0.9 + seed) * 0.1;
      const cx = ax + ux * (t + l / 2) - uz * wob, cz = az + uz * (t + l / 2) + ux * wob;
      const rot = Math.atan2(-ux, -uz) + (rnd() - 0.5) * 0.12;
      const W = Math.max(8, Math.round(w * 40)), H = Math.max(12, Math.round(l * 40));
      const tex = texFrom(paintSmear(W, H, seed + i * 31, u, Math.min(1, (t + l) / len)), W, H);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, l), decalMaterial(tex));
      mesh.rotation.set(-Math.PI / 2, 0, rot);
      mesh.position.set(cx, 0.005 + (i % 4) * 0.0004, cz);
      this.group.add(mesh);
      const d = { mesh, size: 0.01, big: false }; // size: never censored
      this.splats.push(d);
      out.push(d);
      // drops flicked off to the side
      if (rnd() < 0.6) out.push(this.splat(cx + (rnd() - 0.5) * 0.9, cz + (rnd() - 0.5) * 0.9, 0.07 + rnd() * 0.08, seed + i * 7));
      t += l + (u > 0.5 ? rnd() * 0.6 : rnd() * 0.12); // gaps open up
      i++;
    }
    for (const d of out) d.big = false;
    return out;
  }

  /**
   * A ceiling stain over (x, z) that drips into a growing pool. o.from: where the drops start (a desk edge: no
   * stain overhead, o.stain false); o.every: seconds between drops; o.max: the pool's largest size (over 0.55 m it
   * is censored).
   */
  ceiling(x, z, seed = 1, { from = WALL_HEIGHT - 0.04, stain: withStain = true, every = 0, max = 1.3 } = {}) {
    if (!this.enabled) return null;
    if (!this.group.parent) this.game.scene.add(this.group);
    let stain = null;
    if (withStain) {
      const stainTex = texFrom(paintStain(24, seed), 24, 24);
      stain = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), decalMaterial(stainTex));
      stain.rotation.x = Math.PI / 2; // facing down
      stain.position.set(x, WALL_HEIGHT - 0.012, z);
    }
    const poolTex = texFrom(paintStain(32, seed + 9), 32, 32);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMaterial(poolTex));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.006, z);
    pool.scale.setScalar(0.08);
    const drop = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.035), new THREE.MeshLambertMaterial({ color: 0x7a0c10, emissive: 0x3a0306 }));
    drop.visible = false;
    this.group.add(...[stain, pool, drop].filter(Boolean));
    const d = { x, z, stain, pool, drop, poolSize: 0.08, t: 0.6, y: 0, vy: 0, falling: false, seed, big: false, w: 0.9, h: 0.02, mesh: pool, from, every, max };
    this.drips.push(d);
    return d;
  }

  /** A splash on the floor (size in metres). Big ones (> 0.5 m) are censored. */
  splat(x, z, size = 0.4, seed = 1, rot = 0, y = 0) {
    if (!this.group.parent) this.game.scene.add(this.group);
    const tex = texFrom(paintStain(24, seed, true), 24, 24);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMaterial(tex));
    mesh.rotation.set(-Math.PI / 2, 0, rot);
    mesh.position.set(x, y + 0.005 + (this.splats.length % 5) * 0.0004, z);
    mesh.scale.setScalar(size);
    this.group.add(mesh);
    const d = { mesh, size, big: size > 0.5 };
    this.splats.push(d);
    return d;
  }

  censorSphere(obj, r = 0.2) {
    this.spheres.set(obj, r);
  }

  uncensor(obj) {
    this.spheres.delete(obj);
  }

  /** Remove one decal / drip / splat (director clean-up when unseen). */
  remove(d) {
    const meshes = [d.mesh, d.stain, d.drop, d.pool].filter(Boolean);
    for (const m of new Set(meshes)) {
      this.group.remove(m);
      m.geometry?.dispose();
      m.material?.map?.dispose();
      m.material?.dispose();
    }
    this.decals = this.decals.filter((x) => x !== d);
    this.drips = this.drips.filter((x) => x !== d);
    this.splats = this.splats.filter((x) => x !== d);
  }

  update(dt, gaze) {
    for (const d of this.decals) if (d.progress < d.target) this._setProgress(d, d.progress + d.speed * dt);
    for (const d of this.drips) {
      if (d.falling) {
        d.vy -= 9.8 * dt;
        d.y += d.vy * dt;
        d.drop.position.y = d.y;
        if (d.y <= 0.03) {
          d.falling = false;
          d.drop.visible = false;
          d.poolSize = Math.min(d.max ?? 1.3, d.poolSize + 0.02);
          d.pool.scale.setScalar(d.poolSize);
          d.big = d.poolSize > 0.55;
          if (gaze && Math.hypot(gaze.eye.x - d.x, gaze.eye.z - d.z) < 12) this.game.audio.play?.('hw_drip', { position: _v.set(d.x, 0.05, d.z), volume: 0.6 });
        }
      } else if ((d.t -= dt) <= 0) {
        const u = (d.seed * 7919 + d.poolSize * 1e3) % 1;
        d.t = d.every ? d.every * (0.75 + u * 0.5) : 0.45 + u * 0.8;
        d.falling = true;
        d.y = d.from ?? WALL_HEIGHT - 0.04;
        d.vy = 0;
        d.drop.position.set(d.x, d.y, d.z);
        d.drop.visible = true;
      }
    }
    this._censor(gaze);
  }

  /** Screen boxes of the big blood in view → game.postfx.redact. */
  _censor(gaze) {
    const pf = this.game.postfx;
    if (!pf) return;
    if (!gaze) {
      pf.redact = null;
      return;
    }
    const cam = this.game.camera;
    const eye = cam.getWorldPosition(_e);
    const out = [];
    // a box over the censored surface (a plane), with a 6x6 mask of the cells nothing stands in front of
    const add = (minX, minY, maxX, maxY, plane, area, blocks = 10) => {
      if (maxX < 0 || minX > 1 || maxY < 0 || minY > 1) return;
      const box = { minX, minY, maxX, maxY, area, blocks };
      if (!this._mask(box, plane, cam, eye)) return; // nothing of it in sight (behind a wall, lockers...)
      out.push(box);
    };
    // severed heads first: a circle of blocks around the sphere's screen footprint
    for (const [obj, r] of this.spheres) {
      if (!obj.visible || !obj.parent) continue;
      obj.getWorldPosition(_v);
      if (_v.distanceTo(eye) > 24) continue;
      const c = _corners[0].copy(_v).project(cam);
      if (c.z > 1) continue;
      const right = _corners[1].setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar(r * 1.25).add(_v).project(cam);
      const up = _corners[2].setFromMatrixColumn(cam.matrixWorld, 1).multiplyScalar(r * 1.25).add(_v).project(cam);
      const cx = c.x * 0.5 + 0.5, cy = c.y * 0.5 + 0.5;
      const rx = Math.max(0.012, Math.abs(right.x - c.x) * 0.5), ry = Math.max(0.02, Math.abs(up.y - c.y) * 0.5);
      _pl.setFromNormalAndCoplanarPoint(_n.copy(eye).sub(_v).normalize(), _v);
      // finer blocks than blood (playtest: at 10 a head was a blob; at 16 the shape reads, hair, pale face, red neck)
      add(cx - rx, cy - ry, cx + rx, cy + ry, _pl, 9, 16);
    }
    // a decal: wall decals grow up from a bottom-centre origin, floor pools / splats are centred
    const consider = (mesh, w, h, flat) => {
      mesh.updateMatrixWorld();
      _v.set(0, flat ? 0 : h * 0.5, 0).applyMatrix4(mesh.matrixWorld);
      if (_v.distanceTo(eye) > 20) return;
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      const sx = flat ? 1 : w, sy = flat ? 1 : h; // pools / splats are unit planes scaled by their mesh
      for (const [ox, oy] of flat ? FLAT_CORNERS : WALL_CORNERS) {
        const c = _s.set(ox * sx, oy * sy, 0).applyMatrix4(mesh.matrixWorld).project(cam);
        if (c.z > 1) return; // part of it is behind the camera: skip
        const x = c.x * 0.5 + 0.5, y = c.y * 0.5 + 0.5;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      _n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
      _pl.setFromNormalAndCoplanarPoint(_n, _t.setFromMatrixPosition(mesh.matrixWorld));
      // its back: you are on the other side of the wall it is on (playtest: the censor showed through the wall,
      // because _clear tests to a point nudged towards the eye, which from behind is through the wall)
      if (_pl.distanceToPoint(eye) < 0.02) return;
      const pad = 0.012;
      add(minX - pad, minY - pad, maxX + pad, maxY + pad, _pl, (maxX - minX) * (maxY - minY));
    };
    for (const d of this.decals) {
      if (!d.mesh.visible || d.progress < 0.2) continue;
      if (this.censor === 'big' && !d.big) continue;
      consider(d.mesh, d.w, d.h, false);
    }
    for (const d of this.drips) if (this.censor === 'all' || d.big) consider(d.pool, d.poolSize, d.poolSize, true);
    for (const d of this.splats) if (this.censor === 'all' || d.big) consider(d.mesh, d.size, d.size, true);
    out.sort((a, b) => b.area - a.area);
    pf.redact = out.length ? out.slice(0, 4) : null;
  }

  /**
   * Which of the box's 6x6 cells show any of the censored surface: the eye's rays through each cell's
   * corners and centre meet the plane, and a cell counts when any of them gets there with nothing (wall,
   * closed door, window frame, lockers, shelves...) in between. Erring that way keeps the edges censored.
   * Sets box.mask = [bits 0-17, bits 18-35] for postfx; returns false when no cell is in sight.
   */
  _mask(box, plane, cam, eye) {
    const N = 6;
    const seen = (fu, fv) => {
      const u = box.minX + (box.maxX - box.minX) * fu, v = box.minY + (box.maxY - box.minY) * fv;
      _ray.origin.copy(eye);
      _ray.direction.set(u * 2 - 1, v * 2 - 1, 0.5).unproject(cam).sub(eye).normalize();
      const hit = _ray.intersectPlane(plane, _h);
      return !hit || this._clear(eye, hit); // no hit (a ray along the surface): censor, the safe side
    };
    const corner = _cornerSeen;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) corner[j * (N + 1) + i] = seen(i / N, j / N);
    let lo = 0, hi = 0;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const c = j * (N + 1) + i;
        if (!(corner[c] || corner[c + 1] || corner[c + N + 1] || corner[c + N + 2] || seen((i + 0.5) / N, (j + 0.5) / N))) continue;
        const k = j * N + i;
        if (k < 18) lo += 2 ** k;
        else hi += 2 ** (k - 18);
      }
    }
    box.mask = [lo, hi];
    return lo + hi > 0;
  }

  /** Nothing between the eye and p: the sight grid for walls / doors / windows, then props right up to p. */
  _clear(eye, p) {
    const len = _q.copy(eye).sub(p).length();
    if (len < 0.05) return true;
    // the grid's wall cells are coarse: test to a point a little in front of the surface
    _q.multiplyScalar(Math.min(0.4, len * 0.5) / len).add(p);
    if (!this.game.world.lineOfSight(eye, _q)) return false;
    // tall solid props (lockers, shelves, cabinets): the grid ignores the ones near either end, so test them
    // exactly. Desks, chairs and benches have legs you can see past: they never hide blood (the safe side)
    const cols = this.game.world.colliders;
    if (!cols) return true;
    const dx = p.x - eye.x, dz = p.z - eye.z, dy = p.y - eye.y;
    return !cols.forEach(Math.min(eye.x, p.x), Math.min(eye.z, p.z), Math.max(eye.x, p.x), Math.max(eye.z, p.z), (c) => {
      if (c.kind !== 'prop' || c.noLos || c.h < 1.0) return false;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) {
        if (eye.x < c.minX || eye.x > c.maxX) return false;
      } else {
        let a = (c.minX - eye.x) / dx, b = (c.maxX - eye.x) / dx;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (Math.abs(dz) < 1e-9) {
        if (eye.z < c.minZ || eye.z > c.maxZ) return false;
      } else {
        let a = (c.minZ - eye.z) / dz, b = (c.maxZ - eye.z) / dz;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, b);
      }
      if (t0 > t1) return false;
      return Math.min(eye.y + dy * t0, eye.y + dy * t1) < c.h - 0.02; // passes below the prop's top
    });
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.geometry?.dispose();
      o.material?.map?.dispose();
      o.material?.dispose();
    }
    this.decals = [];
    this.drips = [];
    this.splats = [];
    this.spheres.clear();
    if (this.game.postfx) this.game.postfx.redact = null;
    if (typeof document !== 'undefined') document.querySelector('.hw-lens')?.replaceChildren();
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}
