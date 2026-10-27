// LAST BELL — The Halloween Shift: the haunt-spot catalogue for the current ground floor.
//
// Built once per run from the world (and again after every building change), so the director never searches
// the level at runtime. Kinds:
//   corridor   a corridor cell centre (corridor ends, turn-around reveals, beam-edge figures, crossings)
//   doorway    just inside a room beside an unlocked door, facing out: the 'peek' pose leans into the gap
//   doorframe  just inside a room, centred on the doorway, facing out (a figure framed in a dark room)
//   window     inside a room behind interior wired glass, facing the corridor (silhouette behind glass)
//   corner     a far corner of a room, facing its centre ("a room that was empty a moment ago")
//   pane       an exterior window pane (a flat silhouette decal, outside in the dark)
// Spot ids are stable for a given layout, so the long-term memory can recognise "the same doorway" across
// runs of the event school.

import * as THREE from '../lib/three/three.module.js';
import { CELL } from '../config.js';
import { ET } from '../world-layout.js';

const yawFacing = (dx, dz) => Math.atan2(-dx, -dz); // yaw whose forward is (dx, dz)

export class SpotCatalog {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.byId = new Map();
    this.byKind = new Map();
    this.version = 0;
  }

  build() {
    const w = this.game.world;
    const L = w.layout;
    const list = [];
    const add = (s) => {
      s.id = `${s.kind}:${s.key}`;
      if (this.byId.has(s.id)) return;
      list.push(s);
      this.byId.set(s.id, s);
    };
    this.byId.clear();
    const walk = (x, z, r = 0.42) => w.isWalkable(x, z, r, 0);
    const exitP = w.exit?.position;
    // corridors
    for (const r of w.rooms) {
      if (!r.isCorridor || (r.floor || 0) !== 0) continue;
      for (const c of r.cells) {
        const x = c.cx * CELL + CELL / 2, z = c.cz * CELL + CELL / 2;
        if (!walk(x, z)) continue;
        add({ kind: 'corridor', key: `${c.cx},${c.cz}`, pos: new THREE.Vector3(x, 0, z), yaw: 0, roomId: r.id });
      }
    }
    // doors: doorway (peek) + doorframe
    for (const d of w.doors) {
      if ((d.floor || 0) !== 0 || d.kind !== 'door' || d.isLocked || d.active === false) continue;
      const A = d.roomA, B = d.roomB;
      if (!A || !B || A.isCorridor === B.isCorridor) continue;
      const room = A.isCorridor ? B : A;
      if (room.type === 'stairwell' || room.type === 'room000') continue;
      // n points into room B; we want into `room`
      const sgn = room === B ? 1 : -1;
      const nx = d.n.x * sgn, nz = d.n.z * sgn;
      const yaw = yawFacing(-nx, -nz); // facing out of the room
      const lx = -Math.cos(yaw), lz = Math.sin(yaw); // the figure's left
      const base = d.position;
      const fx = base.x + nx * 0.7, fz = base.z + nz * 0.7;
      if (walk(fx, fz, 0.35)) add({ kind: 'doorframe', key: d.id, pos: new THREE.Vector3(fx, 0, fz), yaw, roomId: room.id, door: d });
      // stand to the figure's right of the opening, behind the wall, so leaning left fills the gap
      const px = base.x + nx * 0.55 - lx * 0.95, pz = base.z + nz * 0.55 - lz * 0.95;
      if (walk(px, pz, 0.3)) add({ kind: 'doorway', key: d.id, pos: new THREE.Vector3(px, 0, pz), yaw, roomId: room.id, door: d });
    }
    // interior windows (room ↔ corridor) and exterior panes
    if (L?.edgeType) {
      for (let e = 0; e < L.edgeType.length; e++) {
        const t = L.edgeType[e];
        if (t !== ET.WINDOW && t !== ET.EXT_WINDOW) continue;
        const info = L.edgeInfo(e);
        const ra = w.rooms[L.roomAt(info.ax, info.az)] || null;
        const rb = w.rooms[L.roomAt(info.bx, info.bz)] || null;
        // normal from A to B
        const nx = info.horiz ? 0 : 1, nz = info.horiz ? 1 : 0;
        if (t === ET.WINDOW) {
          if (!ra || !rb || ra.isCorridor === rb.isCorridor) continue;
          const room = ra.isCorridor ? rb : ra;
          const sgn = room === rb ? 1 : -1;
          const ix = nx * sgn, iz = nz * sgn;
          const yaw = yawFacing(-ix, -iz);
          for (const off of [-0.9, 0.9]) {
            const x = info.mx + ix * 0.85 + (info.horiz ? off : 0), z = info.mz + iz * 0.85 + (info.horiz ? 0 : off);
            if (walk(x, z, 0.3)) add({ kind: 'window', key: `${e}:${off > 0 ? 1 : 0}`, pos: new THREE.Vector3(x, 0, z), yaw, roomId: room.id, edge: e });
          }
        } else {
          const inside = ra || rb;
          if (!inside || (exitP && Math.hypot(info.mx - exitP.x, info.mz - exitP.z) < 5)) continue;
          const sgn = inside === rb ? 1 : -1; // into the building
          const ix = nx * sgn, iz = nz * sgn;
          add({ kind: 'pane', key: String(e), pos: new THREE.Vector3(info.mx - ix * 0.14, 0, info.mz - iz * 0.14), yaw: yawFacing(ix, iz), roomId: inside.id, edge: e, horiz: info.horiz });
        }
      }
    }
    // far corners of rooms
    for (const r of w.rooms) {
      if (r.isCorridor || (r.floor || 0) !== 0) continue;
      if (r.type === 'stairwell' || r.type === 'room000' || r.type === 'toilets') continue;
      const b = r.bounds;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      const corners = [[b.minX + 0.75, b.minZ + 0.75], [b.maxX - 0.75, b.minZ + 0.75], [b.minX + 0.75, b.maxZ - 0.75], [b.maxX - 0.75, b.maxZ - 0.75]];
      corners.forEach(([x, z], i) => {
        if (w.getRoomAt(x, z) !== r || !walk(x, z, 0.38)) return;
        add({ kind: 'corner', key: `${r.id}:${i}`, pos: new THREE.Vector3(x, 0, z), yaw: yawFacing(cx - x, cz - z), roomId: r.id });
      });
    }
    this.list = list;
    this.byKind.clear();
    for (const s of list) {
      if (!this.byKind.has(s.kind)) this.byKind.set(s.kind, []);
      this.byKind.get(s.kind).push(s);
    }
    this.version++;
    return this;
  }

  of(kind) {
    return this.byKind.get(kind) || [];
  }

  counts() {
    const o = {};
    for (const [k, v] of this.byKind) o[k] = v.length;
    return o;
  }
}
