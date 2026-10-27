// LAST BELL - Floor 2 wayfinding (beta report, 2026-10-18: "the rooms' names are not written upstairs").
//
// The ground floor has a name plate beside every door and hanging signs at the junctions; upstairs had
// neither, while the checklist hints name rooms ("In the Staffroom"). This adds:
//   - a name plate on the corridor side of every upstairs door (stairwells excluded: they have their own
//     LOCKED / OPEN plate), in the ground floor's style (cream plate, black capitals), a little bigger;
//   - a green hanging sign at each end of the Spine pointing down it to the Security Office and Staffroom.
// One canvas texture per kind, merged into two meshes (2 draw calls). Built after world.generate(), from
// floor2.reset() (like the Art room); purely visual, nothing goes over the network.
//
//   const s = new Floor2Signs(game);   s.dispose();

import * as THREE from './lib/three/three.module.js';
import { mergeGeometries } from './lib/three/addons/utils/BufferGeometryUtils.js';
import { FLOOR_Y, WALL_HEIGHT } from './config.js';
import { ET } from './world-layout.js';
import { addVertexSnap } from './assets.js';

const Y2 = FLOOR_Y[1];
const PLATE_W = 0.78, PLATE_H = 0.17, PLATE_Y = 1.55; // bottom edge above the floor (ground floor: 0.38 x 0.10 at 1.62)
const SLOT_W = 320, SLOT_H = 70;
const HANG_W = 1.7, HANG_H = 0.5, HANG_BOTTOM = 2.6;
const SPINE_X = 26; // the Spine's centre line (cells 6, x 24-28)
const JUNCTIONS = [
  // z: the hall's centre line. Arrow side seen by someone walking west (face +x) / east (face -x)
  { z: 10, west: 'left', east: 'right' }, // North Hall: the Spine runs south (+z): on a westbound walker's left
  { z: 34, west: 'right', east: 'left' }, // South Hall: the Spine runs north
];
const HANG_LINES = ['SECURITY OFFICE', 'STAFFROOM'];

const label = (name) => name.toUpperCase().replace(/’/g, "'");

export class Floor2Signs {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'floor2-signs';
    this._disposables = [];
    try {
      this._build();
    } catch (err) {
      console.warn('[floor2-signs] not built:', err?.message || err);
    }
  }

  _build() {
    const w = this.game.world;
    const F = w?.floor2;
    const L = F?.layout;
    if (!F || !L) return;
    // ---- door plates
    const plates = [];
    const seen = new Set();
    for (const d of L.doors) {
      if (d.pair && d.offset > 0) continue; // double doors: one plate
      const room = F.rooms[d.room];
      const other = F.rooms[d.corridor];
      if (!room || !other || room.isCorridor || !other.isCorridor || room.type === 'stairwell') continue;
      if (L.edgeType[d.edge] !== ET.DOOR && L.edgeType[d.edge] !== ET.OPENING) continue;
      const key = d.room + ':' + d.edge;
      if (seen.has(key)) continue;
      seen.add(key);
      const ei = L.edgeInfo(d.edge);
      // the normal points into the corridor (the side people read it from)
      const towardsB = L.roomAt(ei.bx, ei.bz) === d.corridor;
      const n = ei.horiz ? { x: 0, z: towardsB ? 1 : -1 } : { x: towardsB ? 1 : -1, z: 0 };
      const along = L.wideEdges?.has(d.edge) ? 3.58 : 3.28; // clear of the door frame
      const t = ei.horiz ? { x: 1, z: 0 } : { x: 0, z: 1 };
      plates.push({
        text: label(room.name),
        x: ei.x0 + t.x * along + n.x * 0.112,
        z: ei.z0 + t.z * along + n.z * 0.112,
        n,
      });
    }
    if (plates.length) this._plates(plates);
    // ---- hanging signs at the two Spine junctions
    this._hanging();
    w.floorGroup?.(1)?.add(this.group);
  }

  _canvasTex(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this._disposables.push(tex);
    return tex;
  }

  _material(tex) {
    const m = addVertexSnap(new THREE.MeshLambertMaterial({ name: 'm_f2_signs', map: tex, fog: true }));
    this._disposables.push(m);
    return m;
  }

  /** A quad of size w x h, centred at (x, y, z), facing normal n (x/z), using atlas rect uv = [u0, v0, u1, v1]. */
  _quad(wd, ht, x, y, z, n, uv) {
    const g = new THREE.PlaneGeometry(wd, ht);
    const a = g.attributes.uv;
    for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) ? uv[2] : uv[0], a.getY(i) ? uv[3] : uv[1]);
    g.rotateY(Math.atan2(n.x, n.z));
    g.translate(x, y, z);
    return g;
  }

  _plates(list) {
    const names = [...new Set(list.map((p) => p.text))];
    const cols = 2, rows = Math.ceil(names.length / cols);
    const canvas = document.createElement('canvas');
    canvas.width = SLOT_W * cols;
    canvas.height = SLOT_H * rows;
    const ctx = canvas.getContext('2d');
    const uvOf = new Map();
    names.forEach((name, i) => {
      const cx = (i % cols) * SLOT_W, cy = Math.floor(i / cols) * SLOT_H;
      // dark rim, cream face with a little grime, black capitals
      ctx.fillStyle = '#1d1d1b';
      ctx.fillRect(cx, cy, SLOT_W, SLOT_H);
      const grd = ctx.createLinearGradient(cx, cy, cx + SLOT_W, cy + SLOT_H);
      grd.addColorStop(0, '#d9d2b8');
      grd.addColorStop(0.5, '#e4ddc4');
      grd.addColorStop(1, '#c8c0a3');
      ctx.fillStyle = grd;
      ctx.fillRect(cx + 4, cy + 4, SLOT_W - 8, SLOT_H - 8);
      ctx.fillStyle = '#141412';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 40;
      do {
        ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
        size -= 1;
      } while (ctx.measureText(name).width > SLOT_W - 20 && size > 12);
      ctx.fillText(name, cx + SLOT_W / 2, cy + SLOT_H / 2 + 1);
      const u0 = cx / canvas.width, u1 = (cx + SLOT_W) / canvas.width;
      const v1 = 1 - cy / canvas.height, v0 = 1 - (cy + SLOT_H) / canvas.height;
      uvOf.set(name, [u0, v0, u1, v1]);
    });
    const geos = list.map((p) => this._quad(PLATE_W, PLATE_H, p.x, Y2 + PLATE_Y + PLATE_H / 2, p.z, p.n, uvOf.get(p.text)));
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    this._disposables.push(geo);
    const mesh = new THREE.Mesh(geo, this._material(this._canvasTex(canvas)));
    mesh.name = 'f2-door-plates';
    this.group.add(mesh);
    this.plates = list;
  }

  _hanging() {
    const faces = [];
    for (const j of JUNCTIONS) {
      faces.push({ arrow: j.west, x: SPINE_X, z: j.z, n: { x: 1, z: 0 } });
      faces.push({ arrow: j.east, x: SPINE_X, z: j.z, n: { x: -1, z: 0 } });
    }
    const FW = 512, FH = 150;
    const canvas = document.createElement('canvas');
    canvas.width = FW;
    canvas.height = FH * faces.length;
    const ctx = canvas.getContext('2d');
    const geos = [];
    faces.forEach((f, i) => {
      const cy = i * FH;
      ctx.fillStyle = '#e9e6dc';
      ctx.fillRect(0, cy, FW, FH);
      ctx.fillStyle = '#1f5b3c';
      ctx.fillRect(6, cy + 6, FW - 12, FH - 12);
      ctx.fillStyle = '#f2efe6';
      ctx.textBaseline = 'middle';
      // a big arrow on the side the Spine is, two lines of names beside it
      const AW = 120, left = f.arrow === 'left';
      const ax = left ? 18 : FW - 18 - AW, ay = cy + FH / 2;
      ctx.beginPath();
      if (left) { ctx.moveTo(ax, ay); ctx.lineTo(ax + 56, ay - 46); ctx.lineTo(ax + 56, ay - 20); ctx.lineTo(ax + AW, ay - 20); ctx.lineTo(ax + AW, ay + 20); ctx.lineTo(ax + 56, ay + 20); ctx.lineTo(ax + 56, ay + 46); }
      else { ctx.moveTo(ax + AW, ay); ctx.lineTo(ax + AW - 56, ay - 46); ctx.lineTo(ax + AW - 56, ay - 20); ctx.lineTo(ax, ay - 20); ctx.lineTo(ax, ay + 20); ctx.lineTo(ax + AW - 56, ay + 20); ctx.lineTo(ax + AW - 56, ay + 46); }
      ctx.closePath();
      ctx.fill();
      const tx0 = left ? 18 + AW + 16 : 22, tw = FW - AW - 18 - 16 - 22;
      ctx.textAlign = 'center';
      let size = 50;
      do {
        ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
        size -= 1;
      } while (Math.max(...HANG_LINES.map((l) => ctx.measureText(l).width)) > tw && size > 14);
      HANG_LINES.forEach((l, k) => ctx.fillText(l, tx0 + tw / 2, cy + FH / 2 + (k - (HANG_LINES.length - 1) / 2) * (size + 10)));
      const uv = [0, 1 - (cy + FH) / canvas.height, 1, 1 - cy / canvas.height];
      // two faces back to back, 4 cm apart (the dark frame sits between them)
      geos.push(this._quad(HANG_W, HANG_H, f.x + f.n.x * 0.02, Y2 + HANG_BOTTOM + HANG_H / 2, f.z + f.n.z * 0.02, f.n, uv));
    });
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    this._disposables.push(geo);
    const mesh = new THREE.Mesh(geo, this._material(this._canvasTex(canvas)));
    mesh.name = 'f2-hanging-signs';
    this.group.add(mesh);
    // the frame edge and the two rods up to the ceiling (plain dark)
    const dark = addVertexSnap(new THREE.MeshLambertMaterial({ name: 'm_f2_sign_rod', color: 0x2a2a28, fog: true }));
    this._disposables.push(dark);
    const parts = [];
    const top = Y2 + HANG_BOTTOM + HANG_H;
    const rodLen = Math.max(0.05, Y2 + WALL_HEIGHT - top);
    for (const j of JUNCTIONS) {
      const rim = new THREE.BoxGeometry(0.03, HANG_H + 0.03, HANG_W + 0.03);
      rim.translate(SPINE_X, Y2 + HANG_BOTTOM + HANG_H / 2, j.z);
      parts.push(rim);
      for (const s of [-1, 1]) {
        const rod = new THREE.BoxGeometry(0.02, rodLen, 0.02);
        rod.translate(SPINE_X, top + rodLen / 2, j.z + s * HANG_W * 0.4);
        parts.push(rod);
      }
    }
    const pg = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    parts.forEach((p) => p.dispose());
    this._disposables.push(pg);
    const rods = new THREE.Mesh(pg, dark);
    rods.name = 'f2-hanging-rods';
    this.group.add(rods);
  }

  dispose() {
    this.group.removeFromParent();
    for (const d of this._disposables) d.dispose?.();
    this._disposables = [];
  }
}
