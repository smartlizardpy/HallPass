// LAST BELL - corridor wayfinding signs. Owned by the main agent.
//
// School-style hanging signs at every corridor junction and corner, one face per corridor arm,
// facing whoever walks in from that arm. Each face lists destinations (main entrance, library,
// science lab, stores, toilets, and Room 000 once it exists) with arrows that follow the real walking
// route on the nav grid, so they stay truthful after the building rearranges itself.
// Items that are still missing get a taped paper sticker with a marker-drawn icon and arrow. Stickers
// only appear while the item is more than STICKER_MIN_DIST away, so they lead you to the right part of
// the school and the last few rooms still have to be searched.
//
// One canvas atlas + two merged meshes (faces, frames) -> 2 draw calls for every sign in the level.
// Rebuilt on generate, 'world:transform', 'world:room000' and 'item:collected'.

import * as THREE from './lib/three/three.module.js';
import { mergeGeometries } from './lib/three/addons/utils/BufferGeometryUtils.js';
import { CELL, WALL_HEIGHT } from './config.js';
import { NavPathfinder } from './enemy-nav.js';
import { addVertexSnap } from './assets.js';

const ATLAS_W = 2048;
const ATLAS_H = 1280;
const SLOT_W = 512;
const SLOT_H = 128;
const COLS = ATLAS_W / SLOT_W; // 4
const ROWS = ATLAS_H / SLOT_H; // 10 -> 40 faces max
// The ceiling is at 3.2 m and the caretaker is 2.65 m tall, so signs can't get taller than this:
// they get wide instead, with at most two lines of big type.
const SIGN_H = 0.44;
const SIGN_W = (SIGN_H * SLOT_W) / SLOT_H; // 1.76 m
const SIGN_BOTTOM = 2.72;
const SIGN_Y = SIGN_BOTTOM + SIGN_H / 2;
const ARM_OFFSET = 2.3; // from the junction centre towards its arm (clear of the EXIT signs at 1.3 m)
const MAX_LINES = 2;
const STICKER_MIN_DIST = 14; // m of walking: closer than this, you're in the item's area

const FONT = "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const PLATE = '#1d4536';
const INK = '#ece8dc';

const DIRS = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

// destinations by room type. prio: lower is listed first when a line is crowded.
const DESTS = {
  reception: { label: 'Main entrance', prio: 0 },
  room000: { label: 'Room 000', prio: 1 },
  library: { label: 'Library', prio: 2 },
  science_lab: { label: 'Science lab', prio: 2 },
  storage: { label: null, prio: 3 }, // uses the room's own name ("Caretaker's Store", "Store Room")
  toilets: { label: 'Toilets', prio: 4 },
};

// marker drawings of the items (same shapes as the HUD icons, 32x32 units)
const ICONS = {
  keycard: ['M13 9V5.5h6V9', 'M4.5 9h23v16h-23z', 'M8 13h6v8h-6z', 'M17 14.5h7M17 17.5h5M17 20.5h7'],
  fuse: ['M9.5 11.5h13v9h-13z', 'M6 12.5h3.5v7H6zM22.5 12.5H26v7h-3.5z', 'M2.5 16H6M26 16h3.5M13 14.5v3M16 14.5v3M19 14.5v3'],
  key: ['M13 16a4.5 4.5 0 1 1-9 0a4.5 4.5 0 1 1 9 0z', 'M10 16a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0z', 'M13 16h15M24.5 16v4.5M20.5 16v3'],
};
let _iconPaths = null;
const iconPaths = () => (_iconPaths ||= Object.fromEntries(Object.entries(ICONS).map(([k, v]) => [k, v.map((d) => new Path2D(d))])));

export class SignSystem {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.group.name = 'world-signs';
    world.root.add(this.group);
    this.pf = new NavPathfinder();
    this.faces = [];
    this.sites = [];

    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter; // chunky up close, like every other texture
    this.texture.minFilter = THREE.LinearMipmapLinearFilter; // but readable, not shimmering, from afar
    this.texture.anisotropy = 4;
    // a little self-illumination, like reflective sign paint, so they read in dark corridors
    this.faceMat = addVertexSnap(new THREE.MeshLambertMaterial({ map: this.texture, emissive: 0x262626, emissiveMap: this.texture }));
    this.frameMat = addVertexSnap(new THREE.MeshLambertMaterial({ color: 0x2b2d2c }));
    this.faceMesh = null;
    this.frameMesh = null;

    const ev = world.events;
    if (ev) {
      ev.on('world:transform', () => this.refresh());
      ev.on('world:room000', () => this.refresh());
      ev.on('item:collected', () => this.refresh());
    }
    // the condensed face comes from a web font: redraw once it is ready
    try {
      document.fonts?.load(`600 40px ${FONT}`).then(() => { if (this.faces.length) this._draw(); }, () => {});
    } catch { /* ignore */ }
  }

  clear() {
    for (const m of [this.faceMesh, this.frameMesh]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.faceMesh = this.frameMesh = null;
    this.faces = [];
    this.sites = [];
  }

  /** Recompute everything: sites (junctions can change after a seal), routes, stickers, meshes. */
  refresh() {
    const w = this.world;
    const nav = w.getNav?.();
    this.clear();
    if (!nav || !w.layout || !w.rooms?.length) return;
    try {
      this.pf.setNav(nav, w.doors);
      this.sites = this._findSites();
      this.faces = this._buildFaces();
      if (!this.faces.length) return;
      this._draw();
      this._buildMeshes();
    } catch (err) {
      console.warn('[signs] refresh failed', err);
      this.clear();
    }
  }

  // ------------------------------------------------------------------------------ layout queries
  _passableNear(x, z) {
    const pf = this.pf;
    const i = pf.index(x, z);
    return i >= 0 && pf.passable(i);
  }

  /** Corridor cells where corridors meet (3+ arms) or turn (2 perpendicular arms). */
  _findSites() {
    const w = this.world;
    const L = w.layout;
    const W = L.W;
    const corridor = new Set();
    for (const r of w.rooms) if (r.isCorridor) for (const c of r.cells) corridor.add(c.cz * W + c.cx);
    const sites = [];
    for (const key of corridor) {
      const cx = key % W;
      const cz = (key / W) | 0;
      const x = cx * CELL + CELL / 2;
      const z = cz * CELL + CELL / 2;
      const arms = [];
      for (const d of DIRS) {
        const nx = cx + d.x;
        const nz = cz + d.z;
        if (nx < 0 || nz < 0 || nx >= W || nz >= L.H || !corridor.has(nz * W + nx)) continue;
        // connected through the shared edge? (seals block it) - test a few points across the corridor
        const ex = x + (d.x * CELL) / 2;
        const ez = z + (d.z * CELL) / 2;
        let open = false;
        for (const s of [0, -0.8, 0.8]) if (this._passableNear(ex + d.z * s, ez + d.x * s)) open = true;
        if (open) arms.push(d);
      }
      const corner = arms.length === 2 && (arms[0].x + arms[1].x !== 0 || arms[0].z + arms[1].z !== 0);
      if (arms.length >= 3 || corner) sites.push({ x, z, arms });
    }
    return sites;
  }

  /** Walking distance (m) from every nav cell to the nearest walkable point inside `room`. */
  _field(room) {
    const pf = this.pf;
    const nav = pf.nav;
    const cols = nav.cols;
    const n = cols * nav.rows;
    const res = nav.res;
    const dist = new Float32Array(n).fill(Infinity);
    const q = new Int32Array(n);
    let head = 0;
    let tail = 0;
    const b = room.bounds;
    for (let z = b.minZ + res / 2; z < b.maxZ; z += res) {
      for (let x = b.minX + res / 2; x < b.maxX; x += res) {
        if (this.world.getRoomAt(x, z) !== room) continue;
        const i = pf.index(x, z);
        if (i < 0 || dist[i] === 0 || !pf.passable(i)) continue;
        dist[i] = 0;
        q[tail++] = i;
      }
    }
    while (head < tail) {
      const i = q[head++];
      const d = dist[i] + res;
      const c = i % cols;
      if (c > 0 && dist[i - 1] === Infinity && pf.passable(i - 1)) { dist[i - 1] = d; q[tail++] = i - 1; }
      if (c < cols - 1 && dist[i + 1] === Infinity && pf.passable(i + 1)) { dist[i + 1] = d; q[tail++] = i + 1; }
      if (i >= cols && dist[i - cols] === Infinity && pf.passable(i - cols)) { dist[i - cols] = d; q[tail++] = i - cols; }
      if (i + cols < n && dist[i + cols] === Infinity && pf.passable(i + cols)) { dist[i + cols] = d; q[tail++] = i + cols; }
    }
    return dist;
  }

  _sample(field, x, z) {
    let i = this.pf.index(x, z);
    if (i < 0 || !this.pf.passable(i)) i = this.pf.nearestPassable(x, z, 3);
    return i >= 0 ? field[i] : Infinity;
  }

  /** Which arm of `site` leads to the room, and how far it is. null if unreachable or right here. */
  _route(site, field) {
    const dJ = this._sample(field, site.x, site.z);
    if (!Number.isFinite(dJ) || dJ < 2.6) return null;
    let arm = null;
    let best = dJ;
    for (const a of site.arms) {
      const v = this._sample(field, site.x + a.x * 2.6, site.z + a.z * 2.6);
      if (v < best - 0.1) {
        best = v;
        arm = a;
      }
    }
    return arm ? { arm, d: dJ } : null; // no arm gets closer: the door is off this junction itself
  }

  // ------------------------------------------------------------------------------ faces
  _buildFaces() {
    const w = this.world;
    const have = new Set(w.game?.player?.inventory?.items || []);
    const dests = [];
    for (const room of w.rooms) {
      const def = DESTS[room.type];
      if (!def) continue;
      if (room.type === 'room000' && !w.room000Revealed) continue;
      dests.push({ room, label: def.label || room.name, prio: def.prio, field: this._field(room) });
    }
    const items = [];
    const ir = w.itemRooms || {};
    for (const id of ['keycard', 'fuse', 'key']) {
      if (have.has(id) || !ir[id]) continue;
      if (id === 'key' && !w.room000Revealed) continue;
      const d = dests.find((x) => x.room === ir[id]);
      items.push({ id, field: d ? d.field : this._field(ir[id]) });
    }

    const faces = [];
    for (const site of this.sites) {
      const routes = dests.map((d) => ({ d, r: this._route(site, d.field) }));
      const itemRoutes = items.map((it) => ({ it, r: this._route(site, it.field) }));
      for (const f of site.arms) {
        if (faces.length >= COLS * ROWS) break;
        const rel = (a) => {
          if (a === f) return null; // back the way you came
          if (a.x === -f.x && a.z === -f.z) return 'ahead';
          // viewer looks along v = -f; their left is (-f.z, f.x)
          return a.x === -f.z && a.z === f.x ? 'left' : 'right';
        };
        const lines = { ahead: [], left: [], right: [] };
        for (const { d, r } of routes) {
          if (!r) continue;
          const dir = rel(r.arm);
          if (dir) lines[dir].push({ label: d.label, prio: d.prio, dist: r.d, old: d.room.type === 'room000' });
        }
        let out = [];
        for (const dir of ['ahead', 'left', 'right']) {
          const seen = new Set();
          const l = lines[dir]
            .sort((a, b) => a.prio - b.prio || a.dist - b.dist)
            .filter((e) => !seen.has(e.label) && seen.add(e.label))
            .slice(0, 2);
          if (l.length) out.push({ dir, entries: l, rank: l[0].prio * 1000 + l[0].dist });
        }
        // the two most useful directions, kept in ahead/left/right order
        if (out.length > MAX_LINES) {
          const keep = new Set(out.slice().sort((a, b) => a.rank - b.rank).slice(0, MAX_LINES));
          out = out.filter((l) => keep.has(l));
        }
        const stickers = [];
        for (const { it, r } of itemRoutes) {
          if (!r || r.d < STICKER_MIN_DIST) continue;
          const dir = rel(r.arm);
          if (dir) stickers.push({ id: it.id, dir });
        }
        if (!out.length && !stickers.length) continue;
        faces.push({ x: site.x + f.x * ARM_OFFSET, z: site.z + f.z * ARM_OFFSET, n: f, lines: out, stickers: stickers.slice(0, 2), slot: faces.length });
      }
    }
    return faces;
  }

  // ------------------------------------------------------------------------------ drawing
  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
    for (const f of this.faces) {
      const sx = (f.slot % COLS) * SLOT_W;
      const sy = Math.floor(f.slot / COLS) * SLOT_H;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.beginPath();
      ctx.rect(0, 0, SLOT_W, SLOT_H);
      ctx.clip();
      this._drawFace(ctx, f);
      ctx.restore();
    }
    this.texture.needsUpdate = true;
  }

  _drawFace(ctx, f) {
    // plate: enamelled green with a white keyline and a bit of grime
    ctx.fillStyle = PLATE;
    ctx.fillRect(0, 0, SLOT_W, SLOT_H);
    const g = ctx.createLinearGradient(0, 0, 0, SLOT_H);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SLOT_W, SLOT_H);
    ctx.strokeStyle = 'rgba(236,232,220,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(7, 7, SLOT_W - 14, SLOT_H - 14);

    const right = f.stickers.length ? SLOT_W - 122 : SLOT_W - 22;
    const left = 20;
    const n = f.lines.length;
    const lineH = Math.min(62, (SLOT_H - 20) / Math.max(1, n));
    const top = (SLOT_H - lineH * n) / 2;
    f.lines.forEach((line, i) => {
      const cy = top + lineH * (i + 0.5);
      const text = line.entries.map((e) => e.label.toUpperCase()).join('  ·  ');
      const old = line.entries.some((e) => e.old);
      const arrowW = 40;
      const maxText = right - left - arrowW - 12;
      let size = Math.min(56, lineH * 0.9);
      ctx.font = `600 ${size}px ${FONT}`;
      while (size > 22 && ctx.measureText(text).width > maxText) {
        size -= 2;
        ctx.font = `600 ${size}px ${FONT}`;
      }
      ctx.fillStyle = old ? '#d8cda6' : INK; // Room 000's line looks like it has always been there
      ctx.textBaseline = 'middle';
      if (line.dir === 'right') {
        ctx.textAlign = 'right';
        ctx.fillText(text, right - arrowW - 12, cy + 1, maxText);
        arrow(ctx, right - arrowW / 2, cy, 'right', arrowW, ctx.fillStyle);
      } else {
        ctx.textAlign = 'left';
        arrow(ctx, left + arrowW / 2, cy, line.dir === 'ahead' ? 'up' : 'left', arrowW, ctx.fillStyle);
        ctx.fillText(text, left + arrowW + 12, cy + 1, maxText);
      }
    });

    if (f.stickers.length) this._drawSticker(ctx, f.stickers, SLOT_W - 114, 8);
  }

  /** Taped paper slip with marker drawings: one row per missing item, icon + arrow. */
  _drawSticker(ctx, stickers, x, y) {
    const w = 108;
    const h = 112;
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(-0.05);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 4, w, h);
    ctx.fillStyle = '#ebe5d1';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // tape
    ctx.save();
    ctx.rotate(0.12);
    ctx.fillStyle = 'rgba(250,246,226,0.62)';
    ctx.fillRect(-26, -h / 2 - 9, 52, 18);
    ctx.restore();
    const rows = stickers.length;
    const rowH = (h - 16) / rows;
    const paths = iconPaths();
    stickers.forEach((s, i) => {
      const cy = -h / 2 + 8 + rowH * (i + 0.5);
      const scale = Math.min(1.6, rowH / 32);
      // item icon in black marker
      ctx.save();
      ctx.translate(-w / 2 + 8, cy - 16 * scale);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#191919';
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const p of paths[s.id] || []) ctx.stroke(p);
      ctx.restore();
      // red marker arrow
      const ax = w / 2 - 22;
      arrow(ctx, ax, cy, s.dir === 'ahead' ? 'up' : s.dir, Math.min(36, rowH * 0.85), '#b3122e', true);
    });
    ctx.restore();
  }

  // ------------------------------------------------------------------------------ meshes
  _buildMeshes() {
    const faceGeos = [];
    const frameGeos = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const ceiling = WALL_HEIGHT;
    for (const f of this.faces) {
      const rot = Math.atan2(f.n.x, f.n.z); // +Z (plane front) turned to face the arm
      q.setFromAxisAngle(up, rot);
      const pos = new THREE.Vector3(f.x, SIGN_Y, f.z);
      // face quad, slightly in front of the backing box
      const face = new THREE.PlaneGeometry(SIGN_W, SIGN_H);
      const u0 = ((f.slot % COLS) * SLOT_W) / ATLAS_W;
      const u1 = u0 + SLOT_W / ATLAS_W;
      const vTop = 1 - (Math.floor(f.slot / COLS) * SLOT_H) / ATLAS_H;
      const vBot = vTop - SLOT_H / ATLAS_H;
      const uv = face.attributes.uv; // PlaneGeometry order: TL, TR, BL, BR
      uv.setXY(0, u0, vTop);
      uv.setXY(1, u1, vTop);
      uv.setXY(2, u0, vBot);
      uv.setXY(3, u1, vBot);
      face.translate(0, 0, 0.026);
      face.applyMatrix4(m.compose(pos, q, new THREE.Vector3(1, 1, 1)));
      faceGeos.push(face);
      // backing plate + two hanging rods
      const back = new THREE.BoxGeometry(SIGN_W + 0.05, SIGN_H + 0.05, 0.045);
      back.applyMatrix4(m.compose(pos, q, new THREE.Vector3(1, 1, 1)));
      frameGeos.push(back);
      const rodLen = Math.max(0.02, ceiling - (SIGN_Y + SIGN_H / 2));
      for (const s of [-1, 1]) {
        const rod = new THREE.BoxGeometry(0.025, rodLen, 0.025);
        rod.translate(s * SIGN_W * 0.36, SIGN_H / 2 + rodLen / 2, 0);
        rod.applyMatrix4(m.compose(pos, q, new THREE.Vector3(1, 1, 1)));
        frameGeos.push(rod);
      }
    }
    const faceGeo = mergeGeometries(faceGeos);
    const frameGeo = mergeGeometries(frameGeos.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of [...faceGeos, ...frameGeos]) g.dispose();
    this.faceMesh = new THREE.Mesh(faceGeo, this.faceMat);
    this.frameMesh = new THREE.Mesh(frameGeo, this.frameMat);
    this.faceMesh.name = 'sign-faces';
    this.frameMesh.name = 'sign-frames';
    this.group.add(this.faceMesh, this.frameMesh);
  }

  dispose() {
    this.clear();
    this.texture.dispose();
    this.faceMat.dispose();
    this.frameMat.dispose();
    this.world.root.remove(this.group);
  }
}

/** Block arrow (school sign style), or a rougher marker arrow on the paper slips. */
function arrow(ctx, cx, cy, dir, size, color, marker = false) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dir === 'left' ? Math.PI : dir === 'up' ? -Math.PI / 2 : 0);
  const s = size / 2;
  if (marker) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s, 1);
    ctx.lineTo(s * 0.9, -1);
    ctx.moveTo(s * 0.25, -s * 0.6);
    ctx.lineTo(s * 0.95, -1);
    ctx.lineTo(s * 0.2, s * 0.62);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(0, -s * 0.78);
    ctx.lineTo(0, -s * 0.3);
    ctx.lineTo(-s, -s * 0.3);
    ctx.lineTo(-s, s * 0.3);
    ctx.lineTo(0, s * 0.3);
    ctx.lineTo(0, s * 0.78);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
