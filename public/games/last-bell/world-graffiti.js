// LAST BELL - an easter egg: one glow-in-the-dark spray tag, "EGEMEN WAS HERE", somewhere in the
// corridors. Owned by the main agent.
//
// Each layout puts it on a different bare stretch of corridor wall: plain wall only (no doors,
// windows, seals or Room 000's future door), and at least CLEAR metres from anything the room
// dressing hung or stood there (lockers, noticeboards, posters, alarms, clocks, benches...).
// The ink only shows in the dark: invisible while your torch is on, it glows up when the torch is
// off (or you are hiding in a locker). The first time you see it glowing: 'egg:found' {id:'egemen'}.

import * as THREE from './lib/three/three.module.js';
import { ET, RNG, hashSeed } from './world-layout.js';
import { addVertexSnap } from './assets.js';

const TEXT = ['EGEMEN', 'WAS HERE'];
const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const W = 1.5; // m
const H = 0.6;
const Y = 1.5; // centre height at eye level
const CLEAR = 1.4; // m from other wall things at eye level
// Corridor walls are mostly lined with lockers, so when there is no bare wall at eye level the tag
// goes up high, above the lockers, as if someone climbed up to spray it.
const HIGH_Y = 2.52;
const HIGH_SCALE = 0.8;
const HIGH_BOTTOM = HIGH_Y - (H * HIGH_SCALE) / 2;
const HIGH_CLEAR = 1.0;
const INK = '#9dff6b';
const FOUND_RANGE = 12; // m: seeing it glow from closer than this counts as finding it
const SPRAY = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive";

export class Graffiti {
  constructor(world) {
    this.world = world;
    this.mesh = null;
    this.spot = null;
    this.material = null;
    this.glow = 0;
    this.found = false;
  }

  clear() {
    if (!this.mesh) return;
    this.world.root.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
    this.spot = null;
  }

  /** Pick this layout's spot and paint the tag there (called after each generate). */
  place() {
    this.clear();
    const w = this.world;
    if (!w.layout || !w.dresser || !w.static) return;
    try {
      const spots = this._candidates();
      if (!spots.length) return;
      const rng = new RNG(hashSeed(w.layoutSeed >>> 0, 0xe9e3e));
      const spot = spots[Math.floor(rng.next() * spots.length)];
      this.spot = spot;
      this.glow = 0;
      this.found = false;
      if (!this.material) this.material = this._makeMaterial();
      const geo = new THREE.PlaneGeometry(W, H);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.name = 'graffiti-egemen';
      mesh.position.set(spot.x, spot.high ? HIGH_Y : Y, spot.z);
      if (spot.high) mesh.scale.setScalar(HIGH_SCALE);
      mesh.rotation.y = Math.atan2(spot.n.x, spot.n.z) + spot.tilt;
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.material.opacity = 0;
      this.mesh = mesh;
      w.root.add(mesh);
    } catch (err) {
      console.warn('[graffiti] could not place the tag', err);
      this.clear();
    }
  }

  /** Per frame (from world.update): the ink charges up in the dark and vanishes in torchlight. */
  update(dt, game) {
    const mesh = this.mesh;
    if (!mesh || !this.material) return;
    const p = game?.player;
    const dark = !!p && (!p.flashlightOn || p.isHidden);
    this.glow += ((dark ? 1 : 0) - this.glow) * Math.min(1, dt * (dark ? 0.9 : 6));
    this.material.opacity = this.glow;
    mesh.visible = this.glow > 0.01;
    if (this.found || this.glow < 0.6 || !game.camera) return;
    const cam = game.camera;
    cam.getWorldPosition(_eye);
    _to.copy(mesh.position).sub(_eye);
    const d = _to.length();
    if (d > FOUND_RANGE) return;
    cam.getWorldDirection(_fwd);
    if (_fwd.dot(_to) / d < 0.85) return;
    // a point just off the wall, so the wall the tag is painted on doesn't block the ray
    const n = this.spot.n;
    _tgt.set(mesh.position.x + n.x * 0.4, mesh.position.y, mesh.position.z + n.z * 0.4);
    if (this.world.lineOfSight && !this.world.lineOfSight(_eye, _tgt)) return;
    this.found = true;
    this.world.events?.emit('egg:found', { id: 'egemen', room: this.spot?.room });
  }

  _candidates() {
    const w = this.world;
    // Things that would clash: the dressing's placements (not the building shell, edges or
    // pillars) minus floor litter and ceiling fittings, plus hiding spots and doors. Each is tagged
    // with its room, so furniture on the far side of a wall doesn't block the corridor side.
    const things = [];
    const tall = []; // things that reach into the high band (clocks, the fire alarm's conduit...)
    const add = (x, z) => things.push(x, z, w.getRoomAt(x, z)?.id ?? -1);
    for (const [owner, list] of w.static.owners) {
      if (!String(owner).startsWith('room:')) continue;
      for (const p of list) {
        if (/^(ceiling_|decal_|papers_|light_)/.test(p.node)) continue;
        const e = p.m.elements;
        if (e[13] > 2.6) continue;
        add(e[12], e[14]);
        const sy = Math.hypot(e[4], e[5], e[6]);
        const top = e[13] + (w.kit.bbox?.(p.node)?.max.y ?? 0) * sy;
        if (top > HIGH_BOTTOM - 0.05 || p.node === 'fire_alarm') tall.push(e[12], e[14], w.getRoomAt(e[12], e[14])?.id ?? -1);
      }
    }
    for (const h of w.hidingSpots || []) add(h.position.x, h.position.z);
    const doors = [];
    for (const d of w.doors || []) if (d.position) doors.push(d.position.x, d.position.z);
    const clear = (x, z, roomId) => {
      for (let i = 0; i < things.length; i += 3) {
        if (things[i + 2] !== roomId) continue;
        if (Math.hypot(things[i] - x, things[i + 1] - z) < CLEAR) return false;
      }
      for (let i = 0; i < doors.length; i += 2) if (Math.hypot(doors[i] - x, doors[i + 1] - z) < CLEAR) return false;
      return true;
    };
    const clearHigh = (x, z, roomId) => {
      for (let i = 0; i < tall.length; i += 3) {
        if (tall[i + 2] !== roomId) continue;
        if (Math.hypot(tall[i] - x, tall[i + 1] - z) < HIGH_CLEAR) return false;
      }
      for (let i = 0; i < doors.length; i += 2) if (Math.hypot(doors[i] - x, doors[i + 1] - z) < HIGH_CLEAR + 0.2) return false;
      return true;
    };
    const out = [];
    const high = [];
    for (const room of w.rooms) {
      if (!room.isCorridor) continue;
      const inf = w.dresser.info(room.layout);
      for (const wall of inf.walls) {
        if (wall.type !== ET.WALL && wall.type !== ET.EXT) continue;
        for (const s of [1.2, 2.0, 2.8]) {
          const q = w.dresser.wallPoint(wall, s, 0.012);
          if (clear(q.x, q.z, room.id)) out.push({ x: q.x, z: q.z, n: wall.n, tilt: 0, room: room.name, high: false });
          else if (clearHigh(q.x, q.z, room.id)) high.push({ x: q.x, z: q.z, n: wall.n, tilt: 0, room: room.name, high: true });
        }
      }
    }
    return out.length ? out : high;
  }

  _makeMaterial() {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = Math.round((512 * H) / W);
    const draw = () => paint(cv.getContext('2d'), cv.width, cv.height);
    draw();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const m = addVertexSnap(new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false, // glow ink: readable from down a dark corridor
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    m.color.setRGB(1.3, 2.1, 1.1); // over 1 in the HDR buffer (green-weighted), so it glows after tone mapping
    return m;
  }

  dispose() {
    this.clear();
    if (this.material) {
      this.material.map?.dispose();
      this.material.dispose();
    }
  }
}

/** Spray-paint tag: glowing letters, overspray dots and a few drips. Deterministic. */
function paint(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  const lines = [
    { text: TEXT[0], size: 104, y: h * 0.56, rot: -0.06 },
    { text: TEXT[1], size: 62, y: h * 0.9, rot: -0.03 },
  ];
  for (const pass of ['glow', 'ink']) {
    for (const l of lines) {
      ctx.save();
      ctx.translate(w / 2, l.y);
      ctx.rotate(l.rot);
      let size = l.size;
      ctx.font = `bold ${size}px ${SPRAY}`;
      while (size > 20 && ctx.measureText(l.text).width > w * 0.92) {
        size -= 2;
        ctx.font = `bold ${size}px ${SPRAY}`;
      }
      if (pass === 'glow') {
        ctx.shadowColor = INK;
        ctx.shadowBlur = 22;
        ctx.fillStyle = 'rgba(157,255,107,0.55)';
      } else {
        ctx.fillStyle = INK;
      }
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
  }
  // drips under the big word
  ctx.fillStyle = INK;
  for (let i = 0; i < 9; i++) {
    const x = w * (0.18 + rnd() * 0.64);
    const y0 = h * (0.5 + rnd() * 0.06);
    const len = 8 + rnd() * 34;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(x, y0, 2.5, len);
    ctx.beginPath();
    ctx.arc(x + 1.25, y0 + len, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // overspray
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 260; i++) {
    const x = w * (0.08 + rnd() * 0.84);
    const y = h * (0.12 + rnd() * 0.8);
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}
