// LAST BELL — The Halloween Shift: decorations, the stair barricades and the room moods.
//
// Uses assets/environment/halloween_kit.glb (_blender/world/build_halloween_props.py). Everything static is
// merged per material (a handful of draw calls); lit jack-o'-lanterns and candles add 'glow' fixtures to the
// light pool (world-lights.js), so their orange light survives a blackout. Nothing here collides except the
// Stair A barricade (in front of a door that is locked anyway). Placement is deterministic per seed: on the
// event school every player sees the same school.
//
// Moods: most rooms are left alone or get one student-made touch; one entrance display; two rooms are wrong
// (a candle ring, every drawing of the same tall figure, heavy webs, handprints, a rewritten board).

import * as THREE from '../lib/three/three.module.js';
import { mergeGeometries } from '../lib/three/addons/utils/BufferGeometryUtils.js';
import { loadGLB, ps1ify } from '../assets.js';
import { CELL, WALL_HEIGHT, STAIRS } from '../config.js';
import { ET } from '../world-layout.js';

const KIT_URL = 'assets/environment/halloween_kit.glb';
const CEIL = WALL_HEIGHT;

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  const r = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => a + Math.floor(r() * (b - a + 1));
  r.chance = (p) => r() < p;
  r.pick = (l) => l[Math.floor(r() * l.length)];
  return r;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();

export class Decor {
  constructor(game) {
    this.game = game;
    this.kit = null; // name → [{ geometry, material }]
    this.group = new THREE.Group();
    this.group.name = 'hw-decor';
    this.glowMats = [];
    this.pending = new Map(); // material → [geometry in world space]
    this.dynamic = []; // separately animated objects
    this.drawings = []; // classroom display sheets { mesh, ctx, tex, figure }
    this.wrongRooms = [];
    this.barricadeOwner = 'hw:barricade';
    this.time = 0;
  }

  async load() {
    if (this.kit) return this;
    this.kit = new Map();
    try {
      const gltf = await loadGLB((this.game.assetBase || '') + KIT_URL);
      const root = gltf.scene;
      ps1ify(root);
      root.updateMatrixWorld(true);
      for (const node of root.children) {
        const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
        const parts = [];
        node.traverse((o) => {
          if (!o.isMesh) return;
          const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
          parts.push({ geometry: o.geometry.clone().applyMatrix4(rel), material: o.material, glow: /glow|flame/.test(o.material?.name || o.name) });
        });
        this.kit.set(node.name, parts);
      }
    } catch (err) {
      console.warn('[decor] halloween_kit.glb missing; pumpkins only', err?.message || err);
      const geo = new THREE.SphereGeometry(0.17, 8, 6).scale(1, 0.75, 1).translate(0, 0.13, 0);
      this.kit.set('pumpkin_a', [{ geometry: geo, material: new THREE.MeshLambertMaterial({ color: 0xc8631c }) }]);
    }
    // three glow materials (out of step), so the lanterns don't flicker in unison
    const base = [...this.kit.values()].flat().find((p) => p.glow)?.material;
    if (base) for (let i = 0; i < 3; i++) this.glowMats.push(Object.assign(base.clone(), { name: 'jack_glow_' + i }));
    return this;
  }

  has(name) {
    return this.kit?.has(name);
  }

  /** Queue a kit node at (x, y, z) with yaw (and optional pitch/roll/scale) into the merged batch. */
  put(name, x, y, z, yaw = 0, { rx = 0, rz = 0, scale = 1, glowIdx = -1 } = {}) {
    const parts = this.kit?.get(name);
    if (!parts) return false;
    _e.set(rx, yaw, rz, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(scale, scale, scale);
    _m.compose(_p.set(x, y, z), _q, _s);
    for (const pt of parts) {
      const mat = pt.glow && this.glowMats.length ? this.glowMats[(glowIdx >= 0 ? glowIdx : this.pending.size) % this.glowMats.length] : pt.material;
      if (!this.pending.has(mat)) this.pending.set(mat, []);
      this.pending.get(mat).push(pt.geometry.clone().applyMatrix4(_m));
    }
    return true;
  }

  _flush() {
    for (const [mat, geos] of this.pending) {
      const norm = geos.map((g) => {
        let h = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k);
        if (!h.attributes.normal) h.computeVertexNormals();
        if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
        return h;
      });
      const merged = mergeGeometries(norm, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = 'hw-decor:' + (mat.name || 'mat');
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    this.pending.clear();
  }

  // ------------------------------------------------------------------------------- build
  build(seed) {
    this.clear();
    const g = this.game;
    const w = g.world;
    const L = w.layout;
    const rnd = rngFrom(seed ^ 0x4a11);
    if (!this.group.parent) g.scene.add(this.group);
    this.glows = [];
    const glow = (x, y, z, power = 2.4, dist = 4.5, roomId = -1) => this.glows.push({ x, y, z, color: 0xff7a26, power, dist, roomId, flick: 7 + rnd() * 5 });
    const walk = (x, z, r = 0.3) => w.isWalkable(x, z, r, 0);
    const spawn = w.playerSpawn?.position;
    const exit = w.exit;
    const exitRoom = exit?.room?.id ?? w.getRoomAt(exit?.position?.x ?? 0, exit?.position?.z ?? 0)?.id ?? -1;

    // ---- the stairs: barricade at Stair A's ground-floor door, tape + notice on Stair B's chained gate
    this._barricades(rnd);

    // ---- the entrance display (inside, beside the doors, never in the way)
    if (exit) {
      const yaw = exit.yaw ?? 0;
      const out = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
      const inn = { x: -out.x, z: -out.z };
      const side = { x: -inn.z, z: inn.x };
      for (const s of [-1, 1]) {
        const bx = exit.position.x + inn.x * 1.2 + side.x * 2.1 * s, bz = exit.position.z + inn.z * 1.2 + side.z * 2.1 * s;
        if (!walk(bx, bz, 0.45)) continue;
        const face = Math.atan2(-inn.x, -inn.z) + Math.PI;
        if (s < 0) {
          this.put('hay_bale', bx, 0, bz, face);
          this.put('jack_a', bx - side.x * 0.15, 0.45, bz - side.z * 0.15, face + 0.25, { glowIdx: 0 });
          glow(bx, 0.75, bz, 2.6, 5, exitRoom);
          this.put('pumpkin_small', bx + side.x * 0.25, 0.45, bz + side.z * 0.25, face);
          this.put('pumpkin_a', bx + inn.x * 0.5 + side.x * 0.4, 0, bz + inn.z * 0.5 + side.z * 0.4, face + 1);
        } else {
          this.put('pumpkin_b', bx, 0, bz, face);
          this.put('pumpkin_rotten', bx + side.x * 0.35, 0, bz + side.z * 0.35, face + 2);
          this.put('candle', bx - side.x * 0.3, 0, bz - side.z * 0.3, 0);
          glow(bx, 0.3, bz, 1.4, 3, exitRoom);
        }
        this.put('leaves', bx + inn.x * 0.2, 0.004, bz + inn.z * 0.2, rnd() * 6.28);
      }
      // the student banner over the doors, inside
      this._banner(exit.position.x + inn.x * 0.35, 2.95, exit.position.z + inn.z * 0.35, Math.atan2(-inn.x, -inn.z) + Math.PI, 'HAPPY HALLOWEEN!', 'student');
      this.put('leaves', exit.position.x + inn.x * 1.6, 0.004, exit.position.z + inn.z * 1.6, rnd() * 6.28, { scale: 1.3 });
    }

    // ---- classroom doors: pumpkin clusters on the corridor side for some
    const doors = w.doors.filter((d) => (d.floor || 0) === 0 && d.kind === 'door' && d.roomB && !d.roomB.isCorridor && ['classroom', 'science_lab', 'library', 'reception'].includes(d.roomB.type));
    for (const d of doors) {
      if (!rnd.chance(0.42)) continue;
      const n = d.n; // into the room
      const t = { x: -n.z, z: n.x };
      const s = rnd.chance(0.5) ? 1 : -1;
      const x = d.position.x - n.x * 0.45 + t.x * 0.95 * s, z = d.position.z - n.z * 0.45 + t.z * 0.95 * s;
      if (!walk(x, z, 0.25)) continue;
      const face = Math.atan2(n.x, n.z); // facing out into the corridor
      const roll = rnd();
      if (roll < 0.35) {
        this.put(rnd.chance(0.6) ? 'jack_a' : 'jack_b', x, 0, z, face + rnd.range(-0.4, 0.4), { glowIdx: this.glows.length });
        glow(x, 0.3, z, 2.0, 4, d.roomA?.id ?? -1);
      } else this.put(rnd.pick(['pumpkin_a', 'pumpkin_b']), x, 0, z, rnd() * 6.28);
      if (rnd.chance(0.6)) this.put(rnd.pick(['pumpkin_small', 'pumpkin_small', 'pumpkin_rotten']), x + t.x * 0.3 * s, 0, z + t.z * 0.3 * s, rnd() * 6.28);
      if (rnd.chance(0.25)) this.put('leaves', x - n.x * 0.3, 0.004, z - n.z * 0.3, rnd() * 6.28, { scale: 0.7 });
    }

    // ---- corridors: bats, bunting
    for (const r of w.rooms) {
      if (!r.isCorridor) continue;
      for (const c of r.cells) {
        const cx = c.cx * CELL + CELL / 2, cz = c.cz * CELL + CELL / 2;
        if (spawn && Math.hypot(cx - spawn.x, cz - spawn.z) < 3) continue;
        if (rnd.chance(0.22)) {
          const n = rnd.int(2, 4);
          for (let i = 0; i < n; i++) this.put('paper_bat', cx + rnd.range(-1.4, 1.4), CEIL, cz + rnd.range(-1.4, 1.4), rnd() * 6.28, { rz: rnd.range(-0.2, 0.2) });
        }
        if (rnd.chance(0.14)) {
          // across the corridor: corridor along x → string along z
          const alongX = L.roomAt(c.cx + 1, c.cz) === r.id || L.roomAt(c.cx - 1, c.cz) === r.id;
          if (alongX) this.put('bunting', cx + rnd.range(-1, 1), CEIL - 0.25, c.cz * CELL + 0.05, -Math.PI / 2, { scale: 0.975 });
          else this.put('bunting', c.cx * CELL + 0.05, CEIL - 0.25, cz + rnd.range(-1, 1), 0, { scale: 0.975 });
        }
      }
    }

    // ---- rooms: cobwebs, displays, the two wrong rooms
    const rooms = w.rooms.filter((r) => !r.isCorridor && !['stairwell', 'room000'].includes(r.type));
    const far = rooms
      .filter((r) => ['classroom', 'science_lab', 'storage'].includes(r.type) && r !== w.itemRooms?.keycard && r !== w.itemRooms?.fuse && r !== w.playerSpawn?.room)
      .sort((a, b) => (spawn ? b.center.distanceTo(spawn) - a.center.distanceTo(spawn) : 0));
    this.wrongRooms = far.slice(0, 2).map((r) => r.id);
    for (const r of rooms) {
      const wrong = this.wrongRooms.includes(r.id);
      // ceiling-corner webs: corner at the origin, web towards +x, -y, -z → turn per corner
      const b = r.bounds;
      const corners = [[b.minX + 0.1, b.minZ + 0.1], [b.maxX - 0.1, b.minZ + 0.1], [b.minX + 0.1, b.maxZ - 0.1], [b.maxX - 0.1, b.maxZ - 0.1]];
      for (const [x, z] of corners) if (rnd.chance(wrong ? 0.95 : 0.3) && w.getRoomAt(x, z) === r) this.put('cobweb_corner', x, CEIL - 0.02, z, this._webYaw(x, z, b), { scale: wrong ? 1.5 : rnd.range(0.8, 1.2) });
      if (r.type === 'classroom' && (wrong || rnd.chance(0.35))) this._display(r, rnd, wrong);
      if (wrong) this._wrongRoom(r, rnd, glow);
      else if (r.type === 'reception' || r.type === 'library') {
        if (rnd.chance(0.7)) this._banner(r.center.x, 2.85, r.center.z, rnd.pick([0, Math.PI / 2]), 'HALLOWEEN DISCO  FRI 31st', 'torn');
        if (rnd.chance(0.6)) this.put('skeleton_paper', r.center.x + rnd.range(-1, 1), CEIL, r.center.z + rnd.range(-1, 1), rnd() * 6.28);
      }
    }
    // leaves blown in under a few exterior windows
    if (L?.edgeType) {
      for (let e = 0; e < L.edgeType.length; e++) {
        if (L.edgeType[e] !== ET.EXT_WINDOW || !rnd.chance(0.2)) continue;
        const info = L.edgeInfo(e);
        const inside = L.roomAt(info.ax, info.az) >= 0 ? { x: info.horiz ? 0 : -1, z: info.horiz ? -1 : 0 } : { x: info.horiz ? 0 : 1, z: info.horiz ? 1 : 0 };
        const x = info.mx + inside.x * 0.7, z = info.mz + inside.z * 0.7;
        if (walk(x, z, 0.2)) this.put('leaves', x, 0.004, z, rnd() * 6.28, { scale: 0.8 });
        if (rnd.chance(0.4)) this.put('cobweb_sheet', info.mx + inside.x * 0.12, 2.55, info.mz + inside.z * 0.12, Math.atan2(inside.x, inside.z), { scale: 0.9 });
      }
    }
    this._flush();
    w.lights.addGlows(this.glows);
    return this;
  }

  /** cobweb_corner spans +x, -z from its corner: aim it into the room from the nearest corner. */
  _webYaw(x, z, b) {
    const intoX = x < (b.minX + b.maxX) / 2 ? 1 : -1;
    const intoZ = z < (b.minZ + b.maxZ) / 2 ? 1 : -1;
    // local (+x, -z) → world (intoX, intoZ): yaw rotates +x to (cos, -sin)…
    // rotating by θ about Y sends local +x to (cos θ, -sin θ) and local -z to (-sin θ, -cos θ)
    if (intoX > 0 && intoZ < 0) return 0;
    if (intoX < 0 && intoZ < 0) return Math.PI / 2;
    if (intoX < 0 && intoZ > 0) return Math.PI;
    return -Math.PI / 2;
  }

  _barricades(rnd) {
    const w = this.game.world;
    const C = CELL;
    const doorAt = (cell, hall) => {
      const ex = (cell[0] + hall[0]) / 2 * C + C / 2, ez = (cell[1] + hall[1]) / 2 * C + C / 2;
      return w.doors.find((d) => (d.floor || 0) === 0 && Math.hypot(d.position.x - ex, d.position.z - ez) < 1.2) || null;
    };
    for (const id of ['A', 'B']) {
      const S = STAIRS[id];
      const ex = (S.door[0] + S.hall[0]) / 2 * C + C / 2, ez = (S.door[1] + S.hall[1]) / 2 * C + C / 2;
      const nx = Math.sign(S.hall[0] - S.door[0]), nz = Math.sign(S.hall[1] - S.door[1]); // out to the hall
      const face = Math.atan2(-nx, -nz) + Math.PI; // front (-Y in Blender = +Z here) towards the hall
      if (id === 'A') {
        const d = doorAt(S.door, S.hall);
        if (d) {
          d.close?.('world');
          w.setDoorLocked(d, true);
        }
        const bx = ex + nx * 0.45, bz = ez + nz * 0.45;
        this.put('stair_barricade', bx, 0, bz, face);
        const hw = 0.85, hd = 0.4;
        const col = nx !== 0
          ? { minX: bx - hd, maxX: bx + hd, minZ: bz - hw, maxZ: bz + hw, kind: 'prop', h: 2.0 }
          : { minX: bx - hw, maxX: bx + hw, minZ: bz - hd, maxZ: bz + hd, kind: 'prop', h: 2.0 };
        w.colliders?.set(this.barricadeOwner, [col]);
        w._rasterFloorRegion?.(0, bx - 2, bz - 2, bx + 2, bz + 2);
        this.put('pumpkin_rotten', bx + nx * 0.7 + (nz !== 0 ? 0.9 : 0), 0, bz + nz * 0.7 + (nx !== 0 ? 0.9 : 0), rnd() * 6);
      } else {
        // the chained gate stays; the caretaker taped it off too
        this._sign(ex + nx * 0.06, 1.25, ez + nz * 0.06, face, 'STAIRWELL CLOSED\nBY ORDER OF THE SITE MANAGER');
      }
    }
  }

  /** A printed notice on a plane (taped to the gate / a wall). */
  _sign(x, y, z, yaw, text) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = '#e9e2cc';
    g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#b3122e';
    g.fillRect(0, 0, 128, 14);
    g.fillStyle = '#1b1b1b';
    g.font = "700 13px 'Barlow Condensed', Arial Narrow, sans-serif";
    g.textAlign = 'center';
    text.split('\n').forEach((l, i) => g.fillText(l, 64, 36 + i * 16, 120));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.315), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    this.group.add(mesh);
    this.dynamic.push(mesh);
  }

  /** banner_board with painted text. style 'student' (glittery marker) or 'torn' (printed, ripped). */
  _banner(x, y, z, yaw, text, style) {
    const parts = this.kit.get('banner_board');
    if (!parts) return;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = style === 'torn' ? '#1c1714' : '#efe6cf';
    g.fillRect(0, 0, 512, 96);
    if (style === 'student') {
      const cols = ['#d0661e', '#1b1b1b', '#6b2a8a', '#2b6b2f'];
      g.font = "700 54px 'Marker Felt', 'Comic Sans MS', cursive";
      g.textBaseline = 'middle';
      let px = 30;
      for (const [i, ch] of [...text].entries()) {
        g.fillStyle = cols[i % cols.length];
        g.save();
        g.translate(px, 50 + Math.sin(i * 1.3) * 5);
        g.rotate(Math.sin(i * 2.1) * 0.12);
        g.fillText(ch, 0, 0);
        g.restore();
        px += g.measureText(ch).width + 2;
      }
      // a corner gone and a water stain
      g.fillStyle = 'rgba(90,70,40,0.25)';
      g.beginPath();
      g.ellipse(400, 60, 70, 30, 0.2, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillStyle = '#d0661e';
      g.font = "700 46px 'Barlow Condensed', Arial Narrow, sans-serif";
      g.textBaseline = 'middle';
      g.fillText(text, 24, 50);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(330, 0);
      for (let k = 0; k <= 8; k++) g.lineTo(330 + Math.sin(k * 1.7) * 18 + k * 4, k * 12);
      g.lineTo(512, 96);
      g.lineTo(512, 0);
      g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // glTF UVs
    const holder = new THREE.Group();
    holder.position.set(x, y, z);
    holder.rotation.y = yaw;
    for (const p of parts) {
      const isCloth = /banner|cloth/.test(p.material?.name || '');
      const mat = isCloth ? new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5, transparent: false }) : p.material;
      holder.add(new THREE.Mesh(p.geometry, mat));
    }
    this.group.add(holder);
    this.dynamic.push(holder);
  }

  /** A strip of paper drawings high on a classroom wall. One of them is the tall figure. */
  _display(room, rnd, wrong) {
    const spots = this._walls(room).filter((s) => s.kind === ET.WALL || s.kind === ET.EXT);
    if (!spots.length) return;
    const s = rnd.pick(spots);
    const n = rnd.int(4, 6);
    const figureAt = wrong ? -1 : rnd.int(0, n - 1);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * 0.48;
      const x = s.x + s.tx * off + s.nx * 0.02, z = s.z + s.tz * off + s.nz * 0.02;
      const kind = wrong || i === figureAt ? 'figure' : rnd.pick(['pumpkin', 'ghost', 'bat', 'cat', 'pumpkin']);
      this._drawing(x, 2.25 + rnd.range(-0.06, 0.06), z, Math.atan2(s.nx, s.nz), kind, rnd, rnd.range(-0.08, 0.08));
      this.drawings.at(-1).mesh.userData.edge = s.e;
    }
  }

  _drawing(x, y, z, yaw, kind, rnd, tilt) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 88;
    const g = c.getContext('2d');
    g.fillStyle = '#ece6d2';
    g.fillRect(0, 0, 64, 88);
    g.lineWidth = 3;
    g.lineCap = 'round';
    const crayon = (col) => (g.strokeStyle = g.fillStyle = col);
    if (kind === 'pumpkin') {
      crayon('#d0661e');
      g.beginPath(); g.ellipse(32, 52, 22, 17, 0, 0, Math.PI * 2); g.fill();
      crayon('#2b6b2f'); g.fillRect(30, 30, 5, 8);
      crayon('#1b1b1b');
      g.beginPath(); g.moveTo(22, 46); g.lineTo(27, 40); g.lineTo(30, 47); g.fill();
      g.beginPath(); g.moveTo(36, 47); g.lineTo(40, 40); g.lineTo(44, 46); g.fill();
      g.beginPath(); g.moveTo(20, 56); g.lineTo(44, 56); g.lineTo(38, 63); g.lineTo(26, 63); g.fill();
    } else if (kind === 'ghost') {
      crayon('#9aa3b0');
      g.beginPath(); g.moveTo(16, 74); g.lineTo(16, 34); g.arc(32, 34, 16, Math.PI, 0); g.lineTo(48, 74); g.lineTo(40, 66); g.lineTo(32, 74); g.lineTo(24, 66); g.closePath(); g.stroke();
      crayon('#1b1b1b'); g.fillRect(25, 32, 4, 6); g.fillRect(35, 32, 4, 6);
      crayon('#6b2a8a'); g.font = '700 10px cursive'; g.fillText('BOO!', 18, 16);
    } else if (kind === 'bat') {
      crayon('#1b1b1b');
      g.beginPath(); g.moveTo(32, 44); g.lineTo(6, 32); g.lineTo(14, 48); g.lineTo(32, 52); g.lineTo(50, 48); g.lineTo(58, 32); g.closePath(); g.fill();
    } else if (kind === 'cat') {
      crayon('#1b1b1b');
      g.beginPath(); g.ellipse(32, 58, 14, 16, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(32, 36, 10, 0, Math.PI * 2); g.fill();
      crayon('#d8c23a'); g.fillRect(27, 34, 3, 3); g.fillRect(34, 34, 3, 3);
    } else {
      // the tall figure, always drawn the same way by every child in this room
      crayon('#141414');
      g.beginPath(); g.ellipse(32, 12, 4, 5, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(32, 17); g.lineTo(32, 30); g.stroke();
      g.beginPath(); g.moveTo(26, 30); g.lineTo(38, 30); g.lineTo(41, 82); g.lineTo(23, 82); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(26, 31); g.lineTo(22, 66); g.moveTo(38, 31); g.lineTo(42, 66); g.stroke();
      crayon('#7a0b10'); g.font = '700 9px cursive'; g.fillText('my frend', 6, 86);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.41), new THREE.MeshLambertMaterial({ map: tex }));
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, yaw, tilt, 'YXZ');
    this.group.add(mesh);
    this.drawings.push({ mesh, ctx: g, tex, kind, canvas: c });
  }

  /** Wall segments of a room: [{ x, z (midpoint), nx, nz (into the room), tx, tz, kind }]. */
  _walls(room) {
    const L = this.game.world.layout;
    const out = [];
    for (const c of room.cells) {
      for (const e of L.cellEdges(c.cx, c.cz)) {
        if (L.roomAt(e.nx, e.nz) === room.id) continue;
        const kind = L.edgeType[e.e];
        out.push({ x: c.cx * CELL + CELL / 2 + e.dx * (CELL / 2 - 0.1), z: c.cz * CELL + CELL / 2 + e.dz * (CELL / 2 - 0.1), nx: -e.dx, nz: -e.dz, tx: -e.dz, tz: e.dx, kind, e: e.e, roomId: room.id });
      }
    }
    return out;
  }

  _wrongRoom(room, rnd, glow) {
    const w = this.game.world;
    // a ring of candles where the floor is clear
    const c = room.center;
    let placed = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = c.x + Math.cos(a) * 1.1, z = c.z + Math.sin(a) * 1.1;
      if (!w.isWalkable(x, z, 0.12, 0)) continue;
      this.put('candle', x, 0, z, rnd() * 6);
      placed++;
    }
    if (placed >= 3) glow(c.x, 0.25, c.z, 2.2, 5, room.id);
    this.put('ghost_sheet', c.x + rnd.range(-0.6, 0.6), CEIL, c.z + rnd.range(-0.6, 0.6), rnd() * 6);
    // handprints on the walls, low, like someone crawled
    for (const s of this._walls(room).filter(() => rnd.chance(0.35)).slice(0, 4)) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      g.fillStyle = '#5e0a0d';
      for (let i = 0; i < 3; i++) {
        g.save();
        g.translate(14 + i * 18, 36 + Math.sin(i) * 8);
        g.rotate(-0.4 + i * 0.3);
        g.beginPath(); g.ellipse(0, 6, 6, 7, 0, 0, Math.PI * 2); g.fill();
        for (let f = 0; f < 4; f++) { g.beginPath(); g.ellipse(-5 + f * 3.4, -5 - (f === 1 || f === 2 ? 2 : 0), 1.6, 5, 0, 0, Math.PI * 2); g.fill(); }
        g.restore();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      mesh.position.set(s.x + s.nx * 0.03 + s.tx * rnd.range(-1, 1), rnd.range(0.4, 1.1), s.z + s.nz * 0.03 + s.tz * rnd.range(-1, 1));
      mesh.rotation.y = Math.atan2(s.nx, s.nz);
      mesh.userData.edge = s.e;
      this.group.add(mesh);
      this.dynamic.push(mesh);
    }
  }

  /** The director: one of the ordinary drawings now shows the tall figure (only call when unseen). */
  corruptDrawing(ok = () => true) {
    const d = this.drawings.find((x) => x.kind !== 'figure' && ok(x));
    if (!d) return null;
    const g = d.ctx;
    g.fillStyle = '#ece6d2';
    g.fillRect(0, 0, 64, 88);
    g.fillStyle = g.strokeStyle = '#141414';
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(32, 12, 4, 5, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(26, 30); g.lineTo(38, 30); g.lineTo(41, 82); g.lineTo(23, 82); g.closePath(); g.fill();
    g.fillStyle = '#7a0b10';
    g.font = '700 9px cursive';
    g.fillText('behind you', 4, 86);
    d.tex.needsUpdate = true;
    d.kind = 'figure';
    return d;
  }

  /** After a world transform: wall-mounted pieces whose wall became a doorway / window go (unseen places only). */
  pruneWalls() {
    const L = this.game.world.layout;
    if (!L) return 0;
    const ok = (e) => e == null || e < 0 || L.edgeType[e] === ET.WALL || L.edgeType[e] === ET.EXT;
    let n = 0;
    for (const o of [...this.group.children]) {
      if (ok(o.userData?.edge)) continue;
      this.group.remove(o);
      o.geometry?.dispose();
      o.material?.map?.dispose();
      n++;
    }
    this.drawings = this.drawings.filter((d) => d.mesh.parent);
    this.dynamic = this.dynamic.filter((m) => m.parent);
    return n;
  }

  update(dt) {
    this.time += dt;
    for (let i = 0; i < this.glowMats.length; i++) {
      const m = this.glowMats[i];
      const t = this.time * (6 + i * 1.7) + i * 10;
      m.emissiveIntensity = 0.75 + 0.18 * Math.sin(t) + 0.08 * Math.sin(t * 2.3 + 1);
    }
  }

  clear() {
    for (const o of [...this.group.children]) {
      this.group.remove(o);
      o.traverse?.((m) => {
        if (!m.isMesh) return;
        if (m.geometry && !this._isKitGeo(m.geometry)) m.geometry.dispose();
        if (m.material?.map) m.material.map.dispose();
      });
    }
    this.dynamic = [];
    this.drawings = [];
    this.pending.clear();
    const w = this.game.world;
    w.lights?.clearGlows?.();
    w.colliders?.remove?.(this.barricadeOwner);
  }

  _isKitGeo(geo) {
    for (const parts of this.kit?.values() || []) for (const p of parts) if (p.geometry === geo) return true;
    return false;
  }

  dispose() {
    this.clear();
    this.group.parent?.remove(this.group);
  }
}
