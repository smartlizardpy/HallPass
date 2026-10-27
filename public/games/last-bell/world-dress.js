// LAST BELL - room dressing: turns layout data into kit placements, colliders, hide spots, boards,
// light fixtures, item surfaces and notes. Owned by S1 (World).
//
// Conventions: kit props face +Z (three) -> rotY = atan2(dir.x, dir.z) makes a prop face `dir`.
// Wall props have their origin on the back plane, free-standing props at the base centre.
import { ET } from './world-layout.js';
import { placeMatrix } from './world-kit.js';
import { pickPosterDesign } from './world-election.js';

import { CELL, WALL_HEIGHT } from './config.js';

const CAMPAIGN_POSTER_SCALE = 1.35; // 0.6 m -> 0.81 m

const FACE = 0.1; // half wall thickness: inner faces sit at edge line +- FACE
const M = 0.13; // margin from the wall centre line to usable floor

export const ROOM_TINT = {
  corridor: [1.0, 1.0, 1.0],
  classroom: [1.02, 0.98, 0.88],
  science_lab: [0.9, 1.0, 0.96],
  library: [0.96, 0.88, 0.8],
  toilets: [1.0, 1.0, 1.0],
  stairwell: [0.82, 0.84, 0.86],
  reception: [1.0, 0.95, 0.86],
  storage: [0.78, 0.78, 0.74],
  room000: [0.62, 0.4, 0.36],
  // upstairs (Floor 2) rooms
  art: [1.04, 1.0, 0.9],
  staffroom: [1.0, 0.93, 0.84],
  principal: [0.92, 0.84, 0.74],
  office: [1.0, 0.95, 0.86],
  security: [0.84, 0.9, 0.88],
  computer_lab: [0.98, 0.96, 0.86],
  maintenance: [0.74, 0.76, 0.74],
};
const FLOOR = {
  corridor: 'floor_chequer', classroom: 'floor_lino', science_lab: 'floor_lino', library: 'floor_carpet',
  toilets: 'floor_tiles', stairwell: 'floor_concrete', reception: 'floor_chequer', storage: 'floor_concrete',
  room000: 'floor_boards',
  art: 'floor_lino', staffroom: 'floor_carpet', principal: 'floor_carpet', office: 'floor_carpet',
  security: 'floor_lino', computer_lab: 'floor_carpet', maintenance: 'floor_concrete',
};
export { FLOOR as FLOOR_NODE };
const PLAIN = new Set([ET.WALL, ET.EXT, ET.HIDDEN, ET.SEAL]);

export const CHALK_NORMAL = [
  'HOMEWORK: P.33\nEX. 1-12', 'SPELLING TEST\nFRIDAY', '3 x 11 = 33\n33 x 3 = ?', 'TOPIC:\nTHE WATER CYCLE',
  'QUIET READING\nUNTIL THE BELL', 'DATE: 13th\nTERM 3', 'FRACTIONS\n1/3 + 1/3 = ?', 'NO PHONES\nIN CLASS',
];
export const CHALK_CREEPY = [
  'THE BELL IS\nFOR YOU', 'ROOM 000', 'WHERE DID\nEVERYONE GO', "DON'T LET HIM\nHEAR YOU", '3:33 3:33\n3:33 3:33',
  'STAY IN\nYOUR SEAT', 'HE IS STILL\nHERE', 'I WILL NOT LEAVE\nI WILL NOT LEAVE\nI WILL NOT LEAVE', 'NOBODY\nGOES HOME',
  'COUNT THE\nDOORS AGAIN', 'ABSENT\nABSENT\nABSENT',
];
export const CHALK_LAB = ['H2O + ? = 000', 'EXPERIMENT 3:\nDO NOT OPEN', 'FUSE BOX = ?', 'CONDUCTORS\n& INSULATORS'];
export const NOTES = [
  'A crumpled note: "The bell rings for one of us. Yesterday it rang for Daniel. He didn\'t come back."',
  'Scrawled in pencil: "DO NOT GO TO ROOM 000. IT IS NOT ON THE MAP."',
  'A memo: "Caretaker locks the main doors at 3:33. Exit needs the security keycard, a fuse for the door motor, and the access key."',
  'A register page. Every name is marked ABSENT. The last line has your name on it.',
  'Torn page: "If the corridors change, it\'s him. He moves the walls while you aren\'t looking."',
  'A child\'s handwriting: "When he hums, hide. Lockers are safe if he doesn\'t see you get in."',
  'Staff notice: "Spare fuses are kept in the store rooms or the science lab prep bench."',
  'Sticky note: "Keycard left at the library desk / reception. DO NOT lose it again."',
  'Exam paper. Every answer is "000".',
];

export function rotFor(dx, dz) { return Math.atan2(dx, dz); }
/** World XZ of a point given in a prop's local frame (local +X = (cos r, -sin r), +Z = (sin r, cos r)). */
export function lp(x, z, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return { x: x + c * lx + s * lz, z: z - s * lx + c * lz };
}

export class Occ {
  constructor(minX, minZ, maxX, maxZ) {
    this.res = 0.25;
    this.ox = minX;
    this.oz = minZ;
    this.w = Math.ceil((maxX - minX) / this.res);
    this.h = Math.ceil((maxZ - minZ) / this.res);
    this.g = new Uint8Array(this.w * this.h);
  }
  _r(x0, z0, x1, z1) {
    return [
      Math.max(0, Math.floor((x0 - this.ox) / this.res)), Math.max(0, Math.floor((z0 - this.oz) / this.res)),
      Math.min(this.w - 1, Math.ceil((x1 - this.ox) / this.res) - 1), Math.min(this.h - 1, Math.ceil((z1 - this.oz) / this.res) - 1),
    ];
  }
  mark(x0, z0, x1, z1, v = 1) {
    const [a, b, c, d] = this._r(x0, z0, x1, z1);
    for (let z = b; z <= d; z++) for (let x = a; x <= c; x++) this.g[z * this.w + x] = Math.max(this.g[z * this.w + x], v);
  }
  free(x0, z0, x1, z1) {
    if (x0 < this.ox - 1e-6 || z0 < this.oz - 1e-6 || x1 > this.ox + this.w * this.res + 1e-6 || z1 > this.oz + this.h * this.res + 1e-6) return false;
    const [a, b, c, d] = this._r(x0, z0, x1, z1);
    for (let z = b; z <= d; z++) for (let x = a; x <= c; x++) if (this.g[z * this.w + x]) return false;
    return true;
  }
}

export class Dresser {
  constructor(world) {
    this.world = world;
    this.kit = world.kit;
    this.L = world.layout;
  }

  // ------------------------------------------------------------------------------- primitives
  out() {
    return { placements: [], colliders: [], hides: [], boards: [], surfaces: [], notes: [], fixtures: [], spawns: [], signs: [], edgeUse: new Set() };
  }

  /** Rotated footprint AABB of a node. */
  footprint(node, x, z, rotY, pad = 0, rx = 0, rz = 0) {
    const b = this.kit.bbox(node);
    let x0 = b.min.x, x1 = b.max.x, z0 = b.min.z, z1 = b.max.z;
    if (rx || rz) {
      // conservative: use the largest horizontal extent of the bbox for tilted props
      const r = Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z), b.max.y * Math.max(Math.abs(Math.sin(rx)), Math.abs(Math.sin(rz))));
      x0 = -r; x1 = r; z0 = -r; z1 = r;
    }
    const c = Math.cos(rotY), s = Math.sin(rotY);
    let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
    for (const [px, pz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      const wx = px * c + pz * s;
      const wz = -px * s + pz * c;
      if (wx < mnx) mnx = wx;
      if (wx > mxx) mxx = wx;
      if (wz < mnz) mnz = wz;
      if (wz > mxz) mxz = wz;
    }
    return { minX: x + mnx - pad, maxX: x + mxx + pad, minZ: z + mnz - pad, maxZ: z + mxz + pad };
  }

  put(o, node, x, y, z, rotY, opt = {}) {
    if (!this.kit.has(node)) return null;
    const m = placeMatrix(x, y, z, rotY, opt.rx || 0, opt.rz || 0, opt.scale || 1);
    o.placements.push({ node, m, tint: opt.tint || null, uvTo: opt.uvTo || null });
    const fp = this.footprint(node, x, z, rotY, 0, opt.rx || 0, opt.rz || 0);
    if (opt.collide) {
      const c = { ...this.footprint(node, x, z, rotY, opt.pad || 0, opt.rx || 0, opt.rz || 0), kind: opt.kind || 'prop' };
      c.h = opt.h != null ? opt.h : (opt.rx || opt.rz) ? 0.6 : this.kit.bbox(node).max.y * (opt.scale || 1) + y;
      if (opt.noLos) c.noLos = true;
      o.colliders.push(c);
    }
    if (opt.occ) opt.occ.mark(fp.minX - (opt.gap || 0), fp.minZ - (opt.gap || 0), fp.maxX + (opt.gap || 0), fp.maxZ + (opt.gap || 0));
    return fp;
  }

  fits(occ, node, x, z, rotY, gap = 0.05, rx = 0, rz = 0) {
    const fp = this.footprint(node, x, z, rotY, gap, rx, rz);
    return occ.free(fp.minX, fp.minZ, fp.maxX, fp.maxZ);
  }

  // ------------------------------------------------------------------------------- room geometry
  info(room) {
    const C = CELL;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const c of room.cells) {
      minX = Math.min(minX, c.cx * C); maxX = Math.max(maxX, c.cx * C + C);
      minZ = Math.min(minZ, c.cz * C); maxZ = Math.max(maxZ, c.cz * C + C);
    }
    const walls = [];
    for (const c of room.cells) {
      for (const n of this.L.cellEdges(c.cx, c.cz)) {
        if (this.L.roomAt(n.nx, n.nz) === room.id) continue;
        const nx = -n.dx, nz = -n.dz; // into the room
        const ei = this.L.edgeInfo(n.e);
        const t = ei.horiz ? { x: 1, z: 0 } : { x: 0, z: 1 };
        const p0 = ei.horiz ? { x: ei.x0, z: ei.z0 + nz * FACE } : { x: ei.x0 + nx * FACE, z: ei.z0 };
        const side = n.dz === -1 ? 'N' : n.dz === 1 ? 'S' : n.dx === -1 ? 'W' : 'E';
        walls.push({ e: n.e, type: this.L.edgeType[n.e], n: { x: nx, z: nz }, t, p0, side, cell: c, nbr: this.L.roomAt(n.nx, n.nz), mid: { x: ei.mx, z: ei.mz } });
      }
    }
    return { minX, maxX, minZ, maxZ, walls, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }

  wallPoint(w, s, off = 0) {
    return { x: w.p0.x + w.t.x * s + w.n.x * off, z: w.p0.z + w.t.z * s + w.n.z * off };
  }

  /** Mark door clearance zones (inside the room) in an occupancy grid. */
  markDoors(occ, inf, depth = 1.6, half = 1.0) {
    for (const w of inf.walls) {
      const opening = w.type === ET.NONE && w.nbr >= 0; // corridor junction mouth
      if (w.type !== ET.DOOR && w.type !== ET.OPENING && w.type !== ET.ENTRANCE && w.type !== ET.HIDDEN && !opening) continue;
      const c = this.wallPoint(w, 2, 0);
      const hw = w.type === ET.ENTRANCE ? 1.6 : opening ? 2.0 : half;
      const ax = w.t.x ? hw : depth, az = w.t.z ? hw : depth;
      const x0 = c.x - (w.t.x ? ax : (w.n.x < 0 ? ax : 0));
      const x1 = c.x + (w.t.x ? ax : (w.n.x > 0 ? ax : 0));
      const z0 = c.z - (w.t.z ? az : (w.n.z < 0 ? az : 0));
      const z1 = c.z + (w.t.z ? az : (w.n.z > 0 ? az : 0));
      occ.mark(x0, z0, x1, z1, 2);
    }
  }

  /** Keep an L-shaped 'walkway' free from every door to the room centre (nav stays connected). */
  reserveWalkways(occ, inf, width) {
    const hw = width / 2;
    for (const w of inf.walls) {
      if (w.type !== ET.DOOR && w.type !== ET.OPENING && w.type !== ET.HIDDEN && w.type !== ET.ENTRANCE) continue;
      const a = this.wallPoint(w, 2, 0.5);
      const b = { x: inf.cx, z: inf.cz };
      // leg 1 along the door normal, leg 2 parallel to the wall
      if (w.n.x !== 0) {
        occ.mark(Math.min(a.x, b.x) - hw, a.z - hw, Math.max(a.x, b.x) + hw, a.z + hw, 2);
        occ.mark(b.x - hw, Math.min(a.z, b.z) - hw, b.x + hw, Math.max(a.z, b.z) + hw, 2);
      } else {
        occ.mark(a.x - hw, Math.min(a.z, b.z) - hw, a.x + hw, Math.max(a.z, b.z) + hw, 2);
        occ.mark(Math.min(a.x, b.x) - hw, b.z - hw, Math.max(a.x, b.x) + hw, b.z + hw, 2);
      }
    }
  }

  frame(inf, side) {
    const { minX, maxX, minZ, maxZ } = inf;
    const m = M;
    switch (side) {
      case 'N': return { f: { x: 0, z: -1 }, lat: maxX - minX - 2 * m, dep: maxZ - minZ - 2 * m, w: (u, v) => [minX + m + u, minZ + m + v], swap: false };
      case 'S': return { f: { x: 0, z: 1 }, lat: maxX - minX - 2 * m, dep: maxZ - minZ - 2 * m, w: (u, v) => [maxX - m - u, maxZ - m - v], swap: false };
      case 'W': return { f: { x: -1, z: 0 }, lat: maxZ - minZ - 2 * m, dep: maxX - minX - 2 * m, w: (u, v) => [minX + m + v, maxZ - m - u], swap: true };
      default: return { f: { x: 1, z: 0 }, lat: maxZ - minZ - 2 * m, dep: maxX - minX - 2 * m, w: (u, v) => [maxX - m - v, minZ + m + u], swap: true };
    }
  }

  /** Pick the "front" side: the side with the most plain wall, fewest doors. */
  pickFront(inf, rng, avoidSide = null, force = null) {
    const sides = {};
    for (const w of inf.walls) {
      const s = (sides[w.side] = sides[w.side] || { plain: [], doors: 0, all: [] });
      s.all.push(w);
      if (PLAIN.has(w.type)) s.plain.push(w);
      if (w.type === ET.DOOR || w.type === ET.OPENING || w.type === ET.HIDDEN) s.doors++;
    }
    let best = null;
    let bestScore = -Infinity;
    if (force && sides[force]?.plain.length) best = force; // Floor 2: the authored rooms say where the board goes
    else for (const [k, s] of Object.entries(sides)) {
      if (!s.plain.length || k === avoidSide) continue;
      const score = s.plain.length * 2 - s.doors * 3 + rng.next() * 0.5;
      if (score > bestScore) { bestScore = score; best = k; }
    }
    if (!best) best = Object.keys(sides)[0];
    const s = sides[best];
    // plain edge nearest to the middle of that side
    let wbest = null;
    let wd = Infinity;
    for (const w of s.plain) {
      const d = Math.abs(w.mid.x - inf.cx) + Math.abs(w.mid.z - inf.cz);
      if (d < wd) { wd = d; wbest = w; }
    }
    return { side: best, wall: wbest, walls: s.all };
  }

  /** Try to put a wall prop of width `wd` somewhere on a plain wall. Returns placement info or null. */
  wallSlot(inf, occ, rng, node, wd, depth, opts = {}) {
    const cands = inf.walls.filter((w) => (opts.types || PLAIN).has(w.type) && (!opts.sides || opts.sides.includes(w.side)) && !(opts.avoid && opts.avoid.has(w.e)));
    rng.shuffle(cands);
    for (const w of cands) {
      const tries = opts.centered ? [2] : [2, 1.0 + wd / 2, 3.0 - wd / 2, 0.35 + wd / 2, 3.65 - wd / 2].filter((s) => s - wd / 2 >= 0.3 && s + wd / 2 <= 3.7);
      for (const s of tries) {
        // opts.standOff: for furniture whose origin is its centre, test the fit where it will stand
        const p = this.wallPoint(w, s, opts.standOff ?? 0.01);
        const rot = rotFor(w.n.x, w.n.z);
        if (!this.fits(occ, node, p.x, p.z, rot, 0.04)) continue;
        return { w, s, p, rot };
      }
    }
    return null;
  }

  // ------------------------------------------------------------------------------- edges / vertices
  dressEdge(e) {
    const o = this.out();
    const L = this.L;
    const t = L.edgeType[e];
    if (t === ET.NONE) return o;
    const ei = L.edgeInfo(e);
    const [ra, rb] = L.edgeRooms(e);
    const sides = [];
    if (ra >= 0) sides.push({ room: L.rooms[ra], nx: ei.horiz ? 0 : -1, nz: ei.horiz ? -1 : 0 });
    if (rb >= 0) sides.push({ room: L.rooms[rb], nx: ei.horiz ? 0 : 1, nz: ei.horiz ? 1 : 0 });
    const wide = !!(L.wideEdges && L.wideEdges.has(e)); // the library's double doors (2.4 m opening)
    for (const s of sides) {
      const tiled = s.room.type === 'toilets';
      if (s.room.type === 'stairwell' && s.room.farEdge === e) continue; // drawn by the stair model
      let node;
      switch (t) {
        case ET.DOOR:
        case ET.OPENING: node = wide && this.kit.has('wall_face_door_double') ? 'wall_face_door_double' : tiled ? 'wall_face_door_tiled' : 'wall_face_door'; break;
        case ET.WINDOW: node = 'wall_face_window'; break;
        case ET.EXT_WINDOW: node = 'wall_face_ext_window'; break;
        case ET.ENTRANCE: node = 'wall_face_entrance'; break;
        default: node = tiled ? 'wall_face_tiled' : 'wall_face';
      }
      const tint = ROOM_TINT[s.room.type] || ROOM_TINT.corridor;
      this.put(o, node, ei.mx, 0, ei.mz, rotFor(s.nx, s.nz), { tint });
      if (t === ET.EXT_WINDOW) this.put(o, 'window_night', ei.mx, 0, ei.mz, rotFor(s.nx, s.nz), { tint: [1, 1, 1] });
    }
    if (t === ET.WINDOW) this.put(o, 'window_wire', ei.mx, 0, ei.mz, ei.horiz ? 0 : Math.PI / 2);
    // colliders
    const T = FACE;
    const box = (a0, a1, kind) => {
      if (ei.horiz) o.colliders.push({ minX: a0, maxX: a1, minZ: ei.mz - T, maxZ: ei.mz + T, kind, h: 99 });
      else o.colliders.push({ minX: ei.mx - T, maxX: ei.mx + T, minZ: a0, maxZ: a1, kind, h: 99 });
    };
    const a0 = (ei.horiz ? ei.x0 : ei.z0) - T;
    const a1 = (ei.horiz ? ei.x1 : ei.z1) + T;
    const mid = ei.horiz ? ei.mx : ei.mz;
    if (t === ET.DOOR || t === ET.OPENING) {
      const hw = wide ? 1.2 : 0.6;
      box(a0, mid - hw, 'wall');
      box(mid + hw, a1, 'wall');
    } else if (t === ET.ENTRANCE) {
      box(a0, mid - 1.0, 'wall');
      box(mid + 1.0, a1, 'wall');
      box(mid - 1.0, mid + 1.0, 'entrance');
    } else if (t === ET.WINDOW || t === ET.EXT_WINDOW) {
      const hw = t === ET.WINDOW ? 1.4 : 1.5;
      box(a0, mid - hw, 'wall');
      box(mid + hw, a1, 'wall');
      box(mid - hw, mid + hw, 'window');
    } else box(a0, a1, 'wall');
    return o;
  }

  /** Vertex (grid corner) pillars. vx in [0,W], vz in [0,H]. */
  dressVertex(vx, vz) {
    const o = this.out();
    const L = this.L;
    const inc = [];
    const solidE = (e) => e >= 0 && L.edgeType[e] !== ET.NONE;
    const n = vz > 0 ? L.vEdge(vx, vz - 1) : -1; // edge going -z from the vertex
    const s = vz < L.H ? L.vEdge(vx, vz) : -1;
    const w = vx > 0 ? L.hEdge(vx - 1, vz) : -1;
    const e = vx < L.W ? L.hEdge(vx, vz) : -1;
    for (const ed of [n, s, w, e]) inc.push(solidE(ed));
    const cnt = inc.filter(Boolean).length;
    if (!cnt) return o;
    const straightV = inc[0] && inc[1] && !inc[2] && !inc[3];
    const straightH = !inc[0] && !inc[1] && inc[2] && inc[3];
    if (straightV || straightH) {
      const a = straightV ? n : w;
      const b = straightV ? s : e;
      const ta = L.edgeType[a], tb = L.edgeType[b];
      const plainish = (tt) => tt === ET.WALL || tt === ET.HIDDEN || tt === ET.EXT;
      // collinear plain walls: no pillar (keeps long walls clean); structural pillars on corridor/ext runs
      if (plainish(ta) && plainish(tb) && ta !== ET.EXT && tb !== ET.EXT) return o;
    }
    const x = vx * CELL, z = vz * CELL;
    // tint by the darkest adjacent room
    const rooms = [L.roomAt(vx - 1, vz - 1), L.roomAt(vx, vz - 1), L.roomAt(vx - 1, vz), L.roomAt(vx, vz)].filter((r) => r >= 0).map((r) => L.rooms[r]);
    let tint = [1, 1, 1];
    if (rooms.some((r) => r.isCorridor)) tint = ROOM_TINT.corridor;
    else if (rooms.length) tint = ROOM_TINT[rooms[0].type];
    this.put(o, 'pillar', x, 0, z, 0, { tint });
    o.colliders.push({ minX: x - 0.16, maxX: x + 0.16, minZ: z - 0.16, maxZ: z + 0.16, kind: 'wall', h: 99 });
    return o;
  }

  // ------------------------------------------------------------------------------- floors, ceilings, fixtures
  dressShell(room, rng) {
    const o = this.out();
    if (room.type === 'stairwell') return o; // world-stairs.js: landings, ceilings and fittings
    const floor = FLOOR[room.type] || 'floor_lino';
    const C = CELL;
    for (const c of room.cells) {
      const x = c.cx * C + C / 2, z = c.cz * C + C / 2;
      const isStairs = room.stairs && room.stairs.cx === c.cx && room.stairs.cz === c.cz;
      const v = 0.9 + rng.next() * 0.16;
      if (!isStairs) {
        this.put(o, floor, x, 0, z, rng.int(0, 3) * Math.PI / 2, { tint: [v, v, v * 0.98] });
        const dmg = rng.chance(room.isCorridor || room.type === 'storage' ? 0.22 : 0.1);
        const cv = room.type === 'room000' ? 0.45 : 0.9 + rng.next() * 0.12;
        this.put(o, dmg ? 'ceiling_tile_damaged' : 'ceiling_tile', x, WALL_HEIGHT, z, rng.int(0, 3) * Math.PI / 2, { tint: [cv, cv, cv * 0.97] });
      }
      if (isStairs || room.type === 'room000') continue;
      if (room.type === 'stairwell' && !(room.landing && room.landing.cx === c.cx && room.landing.cz === c.cz)) continue;
      // fluorescent fixture at the cell centre, aligned with corridor direction
      let rot = rng.chance(0.5) ? 0 : Math.PI / 2;
      if (room.isCorridor) {
        const r = room.rect;
        rot = (r.x1 - r.x0) >= (r.z1 - r.z0) ? 0 : Math.PI / 2;
      }
      const pBroken = room.isCorridor ? 0.16 : room.type === 'storage' ? 0.3 : room.type === 'reception' ? 0.05 : 0.12;
      const pFlicker = room.type === 'toilets' || room.type === 'stairwell' ? 0.6 : 0.1;
      const roll = rng.next();
      const state = roll < pBroken ? 'broken' : roll < pBroken + pFlicker ? 'flicker' : 'ok';
      this.put(o, state === 'broken' && rng.chance(0.6) ? 'light_fixture_broken' : 'light_fixture', x, WALL_HEIGHT, z, rot);
      o.fixtures.push({ x, y: WALL_HEIGHT, z, rot, state, roomId: room.id, kind: 'panel' });
    }
    if (room.type === 'room000') {
      const inf = this.info(room);
      this.put(o, 'bulb_red', inf.cx, WALL_HEIGHT, inf.cz, 0);
      o.fixtures.push({ x: inf.cx, y: WALL_HEIGHT - 1.0, z: inf.cz, rot: 0, state: 'ok', roomId: room.id, kind: 'bulb' });
    }
    return o;
  }

  // ------------------------------------------------------------------------------- per room type
  dressRoom(room, rng, variant = 'normal') {
    const o = this.out();
    const inf = this.info(room);
    const occ = new Occ(inf.minX, inf.minZ, inf.maxX, inf.maxZ);
    this.markDoors(occ, inf);
    // classrooms (desk block + aisle ring) and the library (aisles between shelf rows) have their own walkways
    if (['science_lab', 'toilets', 'reception', 'storage'].includes(room.type)) this.reserveWalkways(occ, inf, 1.2);
    switch (room.type) {
      case 'corridor': this.corridor(room, rng, o, inf, occ); break;
      case 'classroom': this.classroom(room, rng, o, inf, occ, variant); break;
      case 'science_lab': this.lab(room, rng, o, inf, occ); break;
      case 'library': this.library(room, rng, o, inf, occ); break;
      case 'toilets': this.toilets(room, rng, o, inf, occ); break;
      case 'stairwell': this.stairwell(room, rng, o, inf, occ); break;
      case 'reception': this.reception(room, rng, o, inf, occ); break;
      case 'storage': this.storage(room, rng, o, inf, occ); break;
      case 'room000': this.room000(room, rng, o, inf, occ); break;
      default: break;
    }
    // door number plates on the room side are skipped (corridor side handled by the corridor dresser)
    return o;
  }

  // common little things -------------------------------------------------------------------
  scatter(o, rng, inf, occ, node, n, opts = {}) {
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 8; tries++) {
        const x = rng.range(inf.minX + 0.6, inf.maxX - 0.6);
        const z = rng.range(inf.minZ + 0.6, inf.maxZ - 0.6);
        const rot = rng.range(0, Math.PI * 2);
        if (opts.needFree && !this.fits(occ, node, x, z, rot, 0.05)) continue;
        this.put(o, node, x, opts.y || 0, z, rot, { collide: !!opts.collide, occ: opts.collide ? occ : null });
        break;
      }
    }
  }

  board(o, w, s, text, style = 'chalk', occ = null) {
    const p = this.wallPoint(w, s, 0.0);
    const rot = rotFor(w.n.x, w.n.z);
    this.put(o, 'chalkboard', p.x, 0.92, p.z, rot, { collide: false, occ });
    o.colliders.push({ ...this.footprint('chalkboard', p.x, p.z, rot), kind: 'prop', h: 0.95, noLos: true });
    o.boards.push({ node: 'chalkboard_surface', m: placeMatrix(p.x, 0.92, p.z, rot, 0, 0, 1), text, style });
  }

  clock(o, inf, occ, rng, sides) {
    const slot = this.wallSlot(inf, occ, rng, 'wall_clock', 0.4, 0.06, { sides });
    if (!slot) return;
    this.put(o, 'wall_clock', slot.p.x, 2.32, slot.p.z, slot.rot);
  }

  posters(o, inf, occ, rng, n) {
    for (let k = 0; k < n; k++) {
      const w = rng.pick(inf.walls);
      if (!PLAIN.has(w.type)) continue;
      const s = rng.range(0.6, 3.4);
      const p = this.wallPoint(w, s, 0.002);
      rng.int(0, 3); // was the kit poster pick (kept for identical dressing)
      const design = pickPosterDesign(p.x, p.z);
      this.put(o, 'poster_0', p.x, design.campaign ? Math.max(1.3, rng.range(1.35, 1.6)) : rng.range(1.35, 1.6), p.z, rotFor(w.n.x, w.n.z) + rng.range(-0.05, 0.05) * 0, { tint: [0.9, 0.9, 0.85], uvTo: design.uvTo });
    }
  }

  radiators(o, inf, occ) {
    for (const w of inf.walls) {
      if (w.type !== ET.EXT_WINDOW) continue;
      const p = this.wallPoint(w, 2, 0.02);
      const rot = rotFor(w.n.x, w.n.z);
      if (!this.fits(occ, 'radiator', p.x, p.z, rot, 0.0)) continue;
      this.put(o, 'radiator', p.x, 0, p.z, rot, { collide: true, occ });
    }
  }

  extinguisher(o, inf, occ, rng) {
    const slot = this.wallSlot(inf, occ, rng, 'fire_extinguisher', 0.3, 0.2);
    if (slot) this.put(o, 'fire_extinguisher', slot.p.x, 0.32, slot.p.z, slot.rot, { collide: true, occ, h: 0.9 });
  }

  // corridor ---------------------------------------------------------------------------------
  /** Corridor cells where >= 3 corridor directions meet, or the corridor turns. */
  junctionInfo(room) {
    const L = this.L;
    const out = [];
    for (const c of room.cells) {
      const dirs = [];
      for (const n of L.cellEdges(c.cx, c.cz)) {
        const r = L.roomAt(n.nx, n.nz);
        if (r >= 0 && L.rooms[r].isCorridor && L.edgeType[n.e] === ET.NONE) dirs.push(n);
      }
      const turn = dirs.length === 2 && dirs[0].dx !== -dirs[1].dx;
      if (dirs.length >= 3 || turn) out.push({ c, dirs });
    }
    return out;
  }

  corridor(room, rng, o, inf, occ) {
    const L = this.L;
    const r = room.rect;
    const alongX = (r.x1 - r.x0) >= (r.z1 - r.z0);
    // per-corridor theme so no two runs look the same
    const theme = {
      lockerTint: rng.pick([[0.9, 1.0, 1.0], [1.0, 0.92, 0.86], [0.82, 0.9, 1.05], [0.95, 0.95, 0.9], [0.75, 0.85, 0.8]]),
      openLockers: rng.range(0.05, 0.3),
      density: rng.range(0.65, 0.95),
      pipeSide: rng.chance(0.5) ? 1 : -1,
      pipeNode: rng.chance(0.5) ? 'ceiling_pipes' : 'ceiling_pipes_b',
      posters: rng.range(0.3, 0.8),
      grime: rng.range(0.25, 0.6),
    };
    const lockerTint = () => { const v = 0.82 + rng.next() * 0.22; const t = theme.lockerTint; return [t[0] * v, t[1] * v, t[2] * v]; };
    const lockerNode = () => (rng.chance(theme.openLockers) ? 'locker_bank_open' : 'locker_bank');
    let hideCount = 0;
    for (const w of inf.walls) {
      const along = (w.t.x !== 0) === alongX; // wall parallel to the corridor axis
      const rot = rotFor(w.n.x, w.n.z);
      const nbr = w.nbr >= 0 ? L.rooms[w.nbr] : null;
      const P = (s, off = 0.01) => this.wallPoint(w, s, off);
      // skip: still draw the random numbers (keeps every seed's dressing identical) but hang nothing
      const poster = (s, y = 1.35, skip = false, nearDoor = false, avoid = null) => {
        rng.int(0, 3); // was the kit poster pick; kept so every seed's dressing stays identical
        let py = y + rng.range(-0.08, 0.08);
        if (skip) return;
        const q = P(s, 0.003);
        if (avoid && Math.hypot(q.x - avoid.x, q.z - avoid.z) < 0.85) return; // a room nameplate is there
        const design = pickPosterDesign(q.x, q.z);
        // campaign posters are printed bigger where the wall has room: not beside doors (room plates)
        // and not within ~0.3 m of a corner. They always clear the dado rail.
        let scale = 1;
        if (design.campaign) {
          py = Math.max(py, 1.3);
          const half = 0.3 * CAMPAIGN_POSTER_SCALE;
          if (!nearDoor && s - half >= 0.3 && s + half <= CELL - 0.3) scale = CAMPAIGN_POSTER_SCALE;
        }
        this.put(o, 'poster_0', q.x, py, q.z, rot, { tint: [0.85, 0.85, 0.8], scale, uvTo: design.uvTo });
      };
      // pipes along one side wall at the ceiling edge
      if (along && ((w.n.x + w.n.z) * theme.pipeSide > 0) && w.type !== ET.NONE) {
        const q = P(2, 0.0);
        this.put(o, theme.pipeNode, q.x, WALL_HEIGHT, q.z, rot);
      }
      if (w.type === ET.DOOR || w.type === ET.OPENING) {
        if (nbr && nbr.sign >= 0) o.signs.push({ e: w.e, roomId: nbr.id }); // plate is its own owner (world._signOwner)
        if (along) {
          // the room's nameplate hangs 3 m along this edge (world._signOwner): keep posters off it
          const ei = L.edgeInfo(w.e);
          const plate = nbr && nbr.sign >= 0 ? { x: ei.x0 + (ei.horiz ? 3 : 0), z: ei.z0 + (ei.horiz ? 0 : 3) } : null;
          const roll = rng.next();
          if (roll < 0.35) { const q = P(0.75); this.put(o, 'fire_alarm', q.x, 0, q.z, rot); }
          else if (roll < 0.6) poster(0.85, 1.35, false, true, plate);
          else if (roll < 0.75) { const q = P(0.7, 0.2); if (this.fits(occ, 'bin', q.x, q.z, 0, 0.0)) this.put(o, 'bin', q.x, 0, q.z, rng.range(0, 6), { collide: true, occ }); }
          if (rng.chance(theme.posters * 0.6)) poster(3.35, 1.05, false, true, plate);
        }
        continue;
      }
      if (w.type === ET.EXT_WINDOW) {
        if (along) { const q = P(2, 0.02); this.put(o, 'radiator', q.x, 0, q.z, rot, { collide: true, occ }); o.edgeUse.add(w.e); }
        continue;
      }
      if (w.type === ET.WINDOW) {
        o.edgeUse.add(w.e);
        const roll = rng.next();
        if (roll < 0.3) { const q = P(2, 0.2); this.put(o, 'bench', q.x, 0, q.z, rot, { collide: true, occ, h: 0.45 }); }
        else if (roll < 0.55) { const q = P(2, 0.02); this.put(o, 'radiator', q.x, 0, q.z, rot, { collide: true, occ }); }
        continue;
      }
      if (w.type === ET.HIDDEN) {
        // Room 000's future door: bare wall with faded marks, nothing in front
        if (rng.chance(0.6)) poster(2.0, 1.5);
        continue;
      }
      if (!PLAIN.has(w.type)) continue;
      if (!along) {
        // corridor end wall
        const roll = rng.next();
        if (roll < 0.35) { const q = P(2); this.put(o, 'noticeboard', q.x, 1.0, q.z, rot); }
        else if (roll < 0.55) { const q = P(2); this.put(o, 'wall_clock', q.x, 2.3, q.z, rot); }
        else if (roll < 0.75) { const q = P(1.0); this.put(o, 'fire_extinguisher', q.x, 0.32, q.z, rot, { collide: true, occ, h: 0.9 }); poster(2.6); }
        continue;
      }
      o.edgeUse.add(w.e);
      // segment recipes: mostly locker runs with gaps
      const recipe = rng.weighted(['lockers3', 'lockers_gap', 'lockers_hide', 'lockers_notice', 'notice_bench', 'coats', 'hide_pair', 'bare'],
        [0.2 * theme.density, 0.18, 0.2, 0.13, 0.1, 0.06, 0.08, 0.06 * (1.2 - theme.density)]);
      const bank = (s) => { const q = P(s); this.put(o, lockerNode(), q.x, 0, q.z, rot, { collide: true, occ, tint: lockerTint() }); };
      const gapThing = (s) => {
        const roll = rng.next();
        const alarm = roll >= 0.6 && roll < 0.8;
        if (roll < 0.35) { const q = P(s); this.put(o, 'fire_extinguisher', q.x, 0.32, q.z, rot, { collide: true, occ, h: 0.9 }); }
        else if (roll < 0.6) { const q = P(s, 0.2); this.put(o, 'bin', q.x, 0, q.z, rng.range(0, 6), { collide: true, occ }); }
        else if (alarm) { const q = P(s); this.put(o, 'fire_alarm', q.x, 0, q.z, rot); }
        poster(s, 1.45, alarm); // no poster over the alarm box and its conduit
      };
      switch (recipe) {
        case 'lockers3': bank(0.95); bank(2.15); if (rng.chance(0.7)) bank(3.35 - 0.05); break;
        case 'lockers_gap': {
          if (rng.chance(0.5)) { bank(0.95); bank(2.15); gapThing(3.25); } else { gapThing(0.75); bank(1.85); bank(3.05); }
          break;
        }
        case 'lockers_hide': {
          const left = rng.chance(0.5);
          if (left) { bank(0.95); this.hideLocker(o, w, 1.92, rot, occ); bank(2.88); }
          else { bank(1.12); this.hideLocker(o, w, 2.08, rot, occ); bank(3.05); }
          hideCount++;
          break;
        }
        case 'hide_pair': {
          this.hideLocker(o, w, 1.0, rot, occ); hideCount++;
          bank(2.0 + 0.3);
          if (rng.chance(0.5)) { this.hideLocker(o, w, 3.3, rot, occ); hideCount++; }
          break;
        }
        case 'lockers_notice': {
          if (rng.chance(0.5)) { bank(0.95); const q = P(2.65); this.put(o, 'noticeboard', q.x, 1.0, q.z, rot); }
          else { const q = P(1.35); this.put(o, 'noticeboard', q.x, 1.0, q.z, rot); bank(3.05); }
          break;
        }
        case 'notice_bench': {
          const q = P(2.0);
          this.put(o, 'noticeboard', q.x, 1.15, q.z, rot);
          const b2 = P(2.0, 0.2);
          this.put(o, 'bench', b2.x, 0, b2.z, rot, { collide: true, occ, h: 0.45 });
          if (rng.chance(0.4)) { const bp = P(2.4, 0.22); this.put(o, 'backpack', bp.x, 0.45, bp.z, rot + 0.5); }
          if (rng.chance(theme.posters)) poster(0.55);
          if (rng.chance(theme.posters)) poster(3.45);
          break;
        }
        case 'coats': {
          const q = P(1.6);
          this.put(o, 'coat_hooks', q.x, 0, q.z, rot, { collide: true, occ, h: 1.4 });
          gapThing(3.3);
          break;
        }
        default: {
          if (rng.chance(0.5)) poster(rng.range(0.8, 3.2));
          if (rng.chance(0.5)) gapThing(rng.pick([1.0, 3.0]));
        }
      }
      if (rng.chance(0.14)) { const q = P(2.0); this.put(o, 'wall_clock', q.x, 2.32, q.z, rot); }
    }
    room._hideCount = hideCount;
    // junctions: exit sign, scuffs and debris
    const junctions = this.junctionInfo(room);
    const jset = new Set(junctions.map((j) => j.c));
    for (const j of junctions) {
      const cx = j.c.cx * CELL + 2, cz = j.c.cz * CELL + 2;
      const off = alongX ? { x: rng.chance(0.5) ? 1.3 : -1.3, z: 0 } : { x: 0, z: rng.chance(0.5) ? 1.3 : -1.3 };
      this.put(o, 'exit_sign', cx + off.x, WALL_HEIGHT, cz + off.z, alongX ? Math.PI / 2 : 0);
      this.put(o, 'decal_scuffs', cx + rng.range(-0.6, 0.6), 0, cz + rng.range(-0.6, 0.6), rng.range(0, 6), { scale: rng.range(1.0, 1.5) });
      if (rng.chance(0.6)) this.put(o, rng.chance(0.5) ? 'papers_b' : 'papers_a', cx + rng.range(-1, 1), 0, cz + rng.range(-1, 1), rng.range(0, 6));
      if (rng.chance(0.35)) this.put(o, 'ceiling_debris', cx + rng.range(-1.2, 1.2), 0, cz + rng.range(-1.2, 1.2), rng.range(0, 6));
    }
    // keep a 1.4 m central walkway along the corridor axis free of clutter
    for (const c of room.cells) {
      const ccx = c.cx * CELL + 2, ccz = c.cz * CELL + 2;
      if (alongX) occ.mark(c.cx * CELL, ccz - 0.7, c.cx * CELL + CELL, ccz + 0.7, 2);
      else occ.mark(ccx - 0.7, c.cz * CELL, ccx + 0.7, c.cz * CELL + CELL, 2);
    }
    // floor clutter + grime along the run
    for (const c of room.cells) {
      const ccx = c.cx * CELL + 2, ccz = c.cz * CELL + 2;
      if (!jset.has(c) && rng.chance(theme.grime)) {
        this.put(o, 'decal_scuffs', ccx + rng.range(-1, 1), 0, ccz + rng.range(-1, 1), rng.range(0, 6), { scale: rng.range(0.7, 1.3) });
      }
      if (!rng.chance(0.24)) continue;
      const lateral = rng.chance(0.5) ? 1.25 : -1.25;
      const x = ccx + (alongX ? rng.range(-1.2, 1.2) : lateral);
      const z = ccz + (alongX ? lateral : rng.range(-1.2, 1.2));
      const what = rng.weighted(['papers_b', 'papers_a', 'ceiling_debris', 'mop', 'trolley', 'chair', 'wet', 'bin'], [0.24, 0.16, 0.12, 0.1, 0.08, 0.12, 0.1, 0.08]);
      const rot = rng.range(0, Math.PI * 2);
      if (what === 'papers_a' || what === 'papers_b' || what === 'ceiling_debris') this.put(o, what, x, 0, z, rot);
      else if (what === 'chair') {
        if (this.fits(occ, 'chair_orange', x, z, rot, 0.1, -Math.PI / 2)) this.put(o, rng.chance(0.5) ? 'chair_orange' : 'chair_blue', x, 0.21, z, rot, { rx: -Math.PI / 2, collide: true, occ, h: 0.5 });
      } else {
        const node = { mop: 'mop_bucket', trolley: 'cleaning_trolley', wet: 'wet_floor_sign', bin: 'bin' }[what];
        if (this.fits(occ, node, x, z, rot, 0.1)) {
          this.put(o, node, x, 0, z, rot, { collide: true, occ });
          if (what === 'mop' && rng.chance(0.7)) {
            const wx = x + (alongX ? 0.9 : 0), wz = z + (alongX ? 0 : 0.9);
            if (this.fits(occ, 'wet_floor_sign', wx, wz, rot, 0.05)) this.put(o, 'wet_floor_sign', wx, 0, wz, rot + 1, { collide: true, occ });
          }
        }
      }
    }
    // patrol points: every other cell centre + all junctions
    room.cells.forEach((c, i) => { if (i % 2 === 0 || jset.has(c)) o.spawns.push({ x: c.cx * CELL + 2, z: c.cz * CELL + 2, kind: 'patrol' }); });
  }

  hideLocker(o, w, s, rot, occ) {
    const p = this.wallPoint(w, s, 0.01);
    this.put(o, 'locker_tall', p.x, 0, p.z, rot, { collide: true, occ, tint: [0.9, 0.95, 0.95] });
    const nx = w.n.x, nz = w.n.z;
    const tx = Math.cos(rot), tz = -Math.sin(rot); // local +X in world
    const hinge = { x: p.x - tx * 0.29 + nx * 0.55, z: p.z - tz * 0.29 + nz * 0.55 };
    o.hides.push({
      type: 'locker',
      doorNode: 'locker_tall_door',
      pivots: [{ x: hinge.x, y: 0.1, z: hinge.z, rot, open: -1.9 }],
      position: { x: p.x + nx * 0.28, y: 1.55, z: p.z + nz * 0.28 },
      look: { x: nx, z: nz },
      exit: { x: p.x + nx * 1.05, y: 0, z: p.z + nz * 1.05 },
      front: { x: p.x + nx * 0.62, y: 1.2, z: p.z + nz * 0.62 },
    });
  }

  hideCupboard(o, w, s, rot, occ) {
    const p = this.wallPoint(w, s, 0.01);
    this.put(o, 'cupboard_tall', p.x, 0, p.z, rot, { collide: true, occ });
    const nx = w.n.x, nz = w.n.z;
    const tx = Math.cos(rot), tz = -Math.sin(rot);
    const fl = { x: p.x - tx * 0.49 + nx * 0.5, z: p.z - tz * 0.49 + nz * 0.5 };
    const fr = { x: p.x + tx * 0.49 + nx * 0.5, z: p.z + tz * 0.49 + nz * 0.5 };
    o.hides.push({
      type: 'cupboard',
      doorNodes: ['cupboard_door_l', 'cupboard_door_r'],
      pivots: [{ x: fl.x, y: 0, z: fl.z, rot, open: -1.7, node: 'cupboard_door_l' }, { x: fr.x, y: 0, z: fr.z, rot, open: 1.7, node: 'cupboard_door_r' }],
      position: { x: p.x + nx * 0.25, y: 1.5, z: p.z + nz * 0.25 },
      look: { x: nx, z: nz },
      exit: { x: p.x + nx * 1.0, y: 0, z: p.z + nz * 1.0 },
      front: { x: p.x + nx * 0.58, y: 1.2, z: p.z + nz * 0.58 },
    });
  }

  // classroom --------------------------------------------------------------------------------
  /** opts (Floor 2): front side, board text, deskHide (true/false instead of the 35 % roll).
   *  Returns { front, teacher: { x, z, rot } | null }. */
  classroom(room, rng, o, inf, occ, variant, opts = {}) {
    const front = this.pickFront(inf, rng, null, opts.front || null);
    let teacher = null;
    const F = this.frame(inf, front.side);
    const f = F.f;
    const studentRot = rotFor(f.x, f.z);
    const chairColor = rng.chance(0.5) ? 'chair_orange' : 'chair_blue';
    const other = chairColor === 'chair_orange' ? 'chair_blue' : 'chair_orange';
    const creepy = rng.chance(0.55);
    let text = creepy ? rng.pick(CHALK_CREEPY) : rng.pick(CHALK_NORMAL);
    if (opts.text != null) text = opts.text;
    if (front.wall) this.board(o, front.wall, 2, text, 'chalk', occ);
    // teacher desk: 1.75 m from the board, to one side
    const tSide = rng.chance(0.5) ? 1 : -1;
    const tu = F.lat / 2 + tSide * Math.min(F.lat / 2 - 1.2, 1.6);
    const [tx, tz] = F.w(tu, 1.75);
    const teacherRot = rotFor(-f.x, -f.z);
    if (this.fits(occ, 'desk_teacher', tx, tz, teacherRot, 0.1)) {
      this.put(o, 'desk_teacher', tx, 0, tz, teacherRot, { collide: true, occ, gap: 0.1 });
      teacher = { x: tx, z: tz, rot: teacherRot };
      const [cx, cz] = F.w(tu + tSide * 1.05, 1.1);
      this.put(o, 'chair_wood', cx, 0, cz, teacherRot + rng.range(-0.5, 0.5), { collide: true, occ, h: 0.9 });
      if (rng.chance(0.4)) {
        const [mx, mz] = F.w(tu - tSide * 0.35, 1.75);
        this.put(o, 'crt_monitor', mx, 0.77, mz, teacherRot + Math.PI * 0, {});
      }
      { const q = lp(tx, tz, teacherRot, -0.05, 0.25); o.surfaces.push({ x: q.x, y: 0.77, z: q.z, kind: 'desk' }); }
      const [bx, bz] = F.w(tu - tSide * 1.0, 1.4);
      if (this.fits(occ, 'bin', bx, bz, 0, 0.05)) this.put(o, 'bin', bx, 0, bz, rng.range(0, 6), { collide: true, occ });
      // hide under the teacher desk (kneehole opens towards the board)
      if (opts.deskHide ?? rng.chance(0.35)) {
        const kx = Math.cos(teacherRot), kz = -Math.sin(teacherRot); // local +X
        const local = (lx, lz) => ({ x: tx + kx * lx + Math.sin(teacherRot) * lz, z: tz + kz * lx + Math.cos(teacherRot) * lz });
        const pos = local(0.18, -0.05);
        const ex = local(0.18, -1.0);
        o.hides.push({ type: 'desk', pivots: [], position: { x: pos.x, y: 0.55, z: pos.z }, look: { x: f.x, z: f.z }, exit: { x: ex.x, y: 0, z: ex.z }, front: { x: local(0.18, -0.45).x, y: 0.5, z: local(0.18, -0.45).z } });
      }
    }
    // desk grid
    const reversed = variant === 'reversed';
    const stacked = variant === 'stacked';
    const chaos = variant === 'chaos';
    const circle = variant === 'circle';
    if (circle) {
      const [ccx, ccz] = F.w(F.lat / 2, F.dep / 2 + 0.5);
      const rad = Math.min(F.lat, F.dep) / 2 - 1.4;
      const n = Math.max(6, Math.floor((Math.PI * 2 * rad) / 1.1));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = ccx + Math.cos(a) * rad, z = ccz + Math.sin(a) * rad;
        const rot = rotFor(-Math.cos(a), -Math.sin(a)); // facing the centre
        if (!this.fits(occ, 'desk_student', x, z, rot, 0.05)) continue;
        this.put(o, 'desk_student', x, 0, z, rot, { collide: true, occ });
        const cx = x + Math.cos(a) * 0.45, cz = z + Math.sin(a) * 0.45;
        this.put(o, chairColor, cx, 0, cz, rot, { collide: true, occ, h: 0.85 });
      }
      this.put(o, 'chair_wood', ccx, 0, ccz, rng.range(0, 6), { collide: true, occ, h: 0.9 });
    } else {
      // desk block with a walkway ring (side/back aisles >= 1.2 m, front aisle behind the teacher desk)
      // and pair aisles of 1.1 m, so the enemy nav (radius 0.4) reaches every row.
      const side = 1.35, pairW = 1.42, aisle = 1.1;
      const blockLat = F.lat - 2 * side;
      const nPairs = Math.max(1, Math.floor((blockLat + aisle) / (pairW + aisle)));
      const gridW = nPairs * pairW + (nPairs - 1) * aisle;
      const u0 = (F.lat - gridW) / 2;
      const cols = [];
      for (let pi = 0; pi < nPairs; pi++) {
        const base = u0 + pi * (pairW + aisle);
        cols.push(base + 0.355, base + pairW - 0.355);
      }
      // keep the ring free for other furniture
      const ring = (u1, v1, u2, v2) => { const [ax, az] = F.w(u1, v1), [bx, bz] = F.w(u2, v2); occ.mark(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), 2); };
      const vFirst = 3.5, rowStep = 1.5;
      const vLast = F.dep - 1.25 - 0.8;
      // (reserved strips stay one occupancy cell clear of the desk footprints)
      ring(0.3, F.dep - 0.95, F.lat - 0.3, F.dep - 0.25); // back aisle
      ring(0.3, 2.25, u0 - 0.4, F.dep - 0.25); // side aisles
      ring(u0 + gridW + 0.4, 2.25, F.lat - 0.3, F.dep - 0.25);
      for (let pi = 1; pi < nPairs; pi++) { const ua = u0 + pi * (pairW + aisle) - aisle; ring(ua + 0.3, vFirst - 0.6, ua + aisle - 0.3, F.dep - 0.25); }
      for (let v = vFirst; v <= vLast + 1e-6; v += rowStep) {
        for (const u of cols) {
          if (rng.chance(chaos ? 0.25 : 0.06)) continue;
          const jit = chaos ? rng.range(-0.6, 0.6) : rng.range(-0.04, 0.04);
          const [x, z] = F.w(u + rng.range(-0.03, 0.03), v + rng.range(-0.05, 0.05));
          const rot = studentRot + (reversed ? Math.PI : 0) + jit;
          if (!this.fits(occ, 'desk_student', x, z, rot, 0.0)) continue;
          if (chaos && rng.chance(0.25)) {
            this.put(o, 'desk_student', x, 0.35, z, rot, { rz: Math.PI / 2, collide: true, occ, h: 0.7 });
            continue;
          }
          this.put(o, 'desk_student', x, 0, z, rot, { collide: true, occ });
          const back = reversed ? -1 : 1;
          const [cx, cz] = F.w(u + rng.range(-0.03, 0.03), v + (0.47 + rng.range(0, 0.08)) * back);
          const col = rng.chance(0.1) ? other : chairColor;
          if (stacked) {
            this.put(o, col, x, 1.195, z, rot, { rx: Math.PI });
          } else if (rng.chance(chaos ? 0.45 : 0.08)) {
            const [px, pz] = F.w(u + rng.range(-0.1, 0.1), v + 0.75 * back);
            if (this.fits(occ, col, px, pz, rot, 0.0, -Math.PI / 2)) this.put(o, col, px, 0.21, pz, rot + rng.range(-0.4, 0.4), { rx: -Math.PI / 2, collide: true, occ, h: 0.5 });
          } else {
            const crot = rot + (rng.chance(0.2) ? rng.range(-0.35, 0.35) : rng.range(-0.08, 0.08));
            this.put(o, col, cx, 0, cz, crot, { collide: true, occ, h: 0.85 });
          }
          if (rng.chance(0.05)) this.put(o, 'backpack', cx + rng.range(-0.2, 0.2), 0, cz + rng.range(-0.2, 0.2), rng.range(0, 6));
        }
      }
      // spawn candidates: back aisle + side aisles at the back
      for (const u of [F.lat / 2, u0 - 0.6, u0 + gridW + 0.6, F.lat * 0.25, F.lat * 0.75]) {
        const [x, z] = F.w(u, F.dep - 0.65);
        o.spawns.push({ x, z, kind: 'player' });
      }
    }
    // storytelling: a desk shoved against a locked door from the inside
    for (const w of inf.walls) {
      if (w.type !== ET.DOOR) continue;
      const di = this.L.edgeDoor[w.e];
      const ld = di >= 0 ? this.L.doors[di] : null;
      if (!ld || !ld.locked) continue;
      const p = this.wallPoint(w, 2 + rng.range(-0.2, 0.2), 0.42);
      const rot = rotFor(w.n.x, w.n.z) + Math.PI / 2 + rng.range(-0.25, 0.25);
      this.put(o, 'desk_student', p.x, 0, p.z, rot, { collide: true, occ });
      const q = this.wallPoint(w, 2 + rng.range(-0.4, 0.4), 0.95);
      this.put(o, chairColor, q.x, 0.21, q.z, rng.range(0, 6), { rx: -Math.PI / 2, collide: true, occ, h: 0.5 });
    }
    // walls: windows -> radiators, clock on the back wall, noticeboard on a side
    this.radiators(o, inf, occ);
    const backSide = { N: 'S', S: 'N', W: 'E', E: 'W' }[front.side];
    this.clock(o, inf, occ, rng, [backSide]);
    const nb = this.wallSlot(inf, occ, rng, 'noticeboard', 1.2, 0.04, { sides: [backSide, ...['N', 'S', 'W', 'E'].filter((s) => s !== front.side && s !== backSide)] });
    if (nb) this.put(o, 'noticeboard', nb.p.x, 1.0, nb.p.z, nb.rot);
    this.posters(o, inf, occ, rng, rng.int(1, 3));
    if (rng.chance(0.5)) {
      const cab = this.wallSlot(inf, occ, rng, 'filing_cabinet', 0.5, 0.62, { sides: ['N', 'S', 'W', 'E'].filter((sd) => sd !== front.side && sd !== backSide) });
      if (cab) this.put(o, rng.chance(0.3) ? 'filing_cabinet_open' : 'filing_cabinet', cab.p.x, 0, cab.p.z, cab.rot, { collide: true, occ });
    }
    this.scatter(o, rng, inf, occ, rng.chance(0.5) ? 'papers_a' : 'papers_b', rng.int(0, 2));
    if (chaos) this.scatter(o, rng, inf, occ, 'papers_b', 2);
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol' });
    return { front, teacher };
  }

  // science lab ------------------------------------------------------------------------------
  lab(room, rng, o, inf, occ) {
    const front = this.pickFront(inf, rng);
    const F = this.frame(inf, front.side);
    const f = F.f;
    if (front.wall) this.board(o, front.wall, 2, rng.pick(CHALK_LAB), 'chalk', occ);
    const benchRot = rotFor(f.x, f.z); // long axis (local X) parallel to the board
    for (let v = 3.2; v <= F.dep - 1.4; v += 2.4) {
      const nb = Math.max(1, Math.floor((F.lat - 1.6) / 2.9));
      const span = (nb - 1) * 2.9;
      for (let k = 0; k < nb; k++) {
        const u = F.lat / 2 - span / 2 + k * 2.9;
        const [x, z] = F.w(u, v);
        if (!this.fits(occ, 'lab_bench', x, z, benchRot, 0.1)) continue;
        this.put(o, 'lab_bench', x, 0, z, benchRot, { collide: true, occ, gap: 0.1 });
        { const q = lp(x, z, benchRot, 0.62, -0.18); o.surfaces.push({ x: q.x, y: 0.92, z: q.z, kind: 'bench', prio: 1 }); }
        for (const du of [-0.7, 0.7]) {
          for (const dv of [-0.75, 0.75]) {
            const [sx, sz] = F.w(u + du, v + dv);
            if (rng.chance(0.85) && this.fits(occ, 'lab_stool', sx, sz, 0, 0.0)) {
              if (rng.chance(0.08)) this.put(o, 'lab_stool', sx, 0.17, sz, rng.range(0, 6), { rx: Math.PI / 2, collide: true, occ, h: 0.4 });
              else this.put(o, 'lab_stool', sx, 0, sz, rng.range(0, 6), { collide: true, occ, h: 0.66 });
            }
          }
        }
      }
    }
    const [tx, tz] = F.w(F.lat / 2 + (rng.chance(0.5) ? 1.4 : -1.4), 1.6);
    const tr = rotFor(-f.x, -f.z);
    if (this.fits(occ, 'desk_teacher', tx, tz, tr, 0.1)) {
      this.put(o, 'desk_teacher', tx, 0, tz, tr, { collide: true, occ, gap: 0.1 });
      const q = lp(tx, tz, tr, -0.05, 0.25);
      o.surfaces.push({ x: q.x, y: 0.77, z: q.z, kind: 'desk' });
    }
    for (let k = 0; k < 3; k++) {
      const s = this.wallSlot(inf, occ, rng, 'shelf_jars', 1.2, 0.3, { avoid: new Set([front.wall && front.wall.e]) });
      if (s) this.put(o, 'shelf_jars', s.p.x, 0, s.p.z, s.rot, { collide: true, occ });
    }
    this.radiators(o, inf, occ);
    this.extinguisher(o, inf, occ, rng);
    this.clock(o, inf, occ, rng, null);
    this.posters(o, inf, occ, rng, 2);
    if (rng.chance(0.6)) this.scatter(o, rng, inf, occ, 'papers_a', 1);
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol' });
  }

  // library ----------------------------------------------------------------------------------
  library(room, rng, o, inf, occ) {
    // wall shelves
    for (const w of inf.walls) {
      if (!PLAIN.has(w.type)) continue;
      for (const s of [1.05, 2.95]) {
        const p = this.wallPoint(w, s, 0.01);
        const rot = rotFor(w.n.x, w.n.z);
        if (!this.fits(occ, 'bookshelf', p.x, p.z, rot, 0.02)) continue;
        this.put(o, 'bookshelf', p.x, 0, p.z, rot, { collide: true, occ });
      }
    }
    this.radiators(o, inf, occ);
    const front = this.pickFront(inf, rng);
    const F = this.frame(inf, front.side);
    const f = F.f;
    // librarian desk near the front, with a CRT
    const [dx, dz] = F.w(F.lat / 2 + (rng.chance(0.5) ? 1 : -1) * Math.min(1.8, F.lat / 2 - 1.2), 1.9);
    const dr = rotFor(-f.x, -f.z);
    if (this.fits(occ, 'desk_teacher', dx, dz, dr, 0.15)) {
      this.put(o, 'desk_teacher', dx, 0, dz, dr, { collide: true, occ, gap: 0.15 });
      this.put(o, 'crt_monitor', dx + Math.cos(dr) * 0.35, 0.77, dz - Math.sin(dr) * 0.35, dr + Math.PI, {});
      { const q = lp(dx, dz, dr, -0.05, 0.25); o.surfaces.push({ x: q.x, y: 0.77, z: q.z, kind: 'library_desk', prio: 2 }); }
      const cr = dr + Math.PI + rng.range(-0.4, 0.4);
      const [cx, cz] = F.w(F.lat / 2, 1.1);
      void cx; void cz;
      this.put(o, 'chair_wood', dx + Math.sin(dr) * -0.75, 0, dz + Math.cos(dr) * -0.75, cr, { collide: true, occ, h: 0.9 });
    }
    // island shelves rows parallel to the front wall
    const shelfRot = rotFor(f.x, f.z);
    let toppled = 0;
    const uStart = 2.0, uEnd = F.lat - 2.0;
    const nIsl = Math.max(1, Math.floor((uEnd - uStart) / 1.85) + 1);
    const crossK = nIsl >= 4 ? Math.floor(nIsl / 2) : -1;
    for (let v = 3.6; v <= F.dep - 2.2; v += 2.5) {
      for (let k = 0; k < nIsl; k++) {
        if (k === crossK) continue; // cross aisle
        const u = uStart + k * 1.85;
        if (u > uEnd + 0.01) break;
        const [x, z] = F.w(u, v);
        const roll = rng.next();
        if (roll < 0.1 && toppled < 2) {
          const tr = shelfRot + rng.range(-0.4, 0.4);
          if (this.fits(occ, 'bookshelf_toppled', x, z, tr, 0.05)) {
            this.put(o, 'bookshelf_toppled', x, 0, z, tr, { collide: true, occ, h: 0.6 });
            toppled++;
            continue;
          }
        }
        if (!this.fits(occ, 'bookshelf_double', x, z, shelfRot, 0.05)) continue;
        if (roll > 0.9) {
          // leaning against its neighbour
          this.put(o, 'bookshelf_double', x, 0, z, shelfRot, { rz: rng.chance(0.5) ? 0.22 : -0.22, collide: true, occ, h: 1.9 });
        } else this.put(o, 'bookshelf_double', x, 0, z, shelfRot, { collide: true, occ });
      }
    }
    // reading tables in remaining open space
    for (let k = 0; k < 6; k++) {
      const x = rng.range(inf.minX + 2, inf.maxX - 2);
      const z = rng.range(inf.minZ + 2, inf.maxZ - 2);
      const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
      if (!this.fits(occ, 'table_library', x, z, rot, 0.9)) continue;
      this.put(o, 'table_library', x, 0, z, rot, { collide: true, occ, gap: 0.3 });
      o.surfaces.push({ x, y: 0.76, z, kind: 'table' });
      for (const sgn of [-1, 1]) {
        const cx = x + Math.sin(rot) * 0 + (rot ? sgn * 0.7 : 0);
        const cz = z + (rot ? 0 : sgn * 0.7);
        const crot = rot ? rotFor(-sgn, 0) : rotFor(0, -sgn);
        if (rng.chance(0.85)) this.put(o, rng.chance(0.5) ? 'chair_blue' : 'chair_orange', cx, 0, cz, crot + rng.range(-0.3, 0.3), { collide: true, occ, h: 0.85 });
      }
    }
    this.clock(o, inf, occ, rng, null);
    this.scatter(o, rng, inf, occ, 'papers_b', 2);
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol' });
  }

  // toilets ----------------------------------------------------------------------------------
  toilets(room, rng, o, inf, occ) {
    // stalls along the plain wall run with the most edges
    const bySide = {};
    for (const w of inf.walls) if (PLAIN.has(w.type)) (bySide[w.side] = bySide[w.side] || []).push(w);
    const sides = Object.entries(bySide).sort((a, b) => b[1].length - a[1].length);
    if (sides.length) {
      const [sideName, ws] = sides[0];
      for (const w of ws) {
        const rot = rotFor(w.n.x, w.n.z);
        let placed = 0;
        let lastS = 0;
        for (let s = 0.75; s <= 3.3; s += 0.95) {
          const p = this.wallPoint(w, s, 0.0);
          if (!this.fits(occ, 'toilet_stall', p.x, p.z, rot, 0.0)) continue;
          this.put(o, 'toilet_stall', p.x, 0, p.z, rot, { collide: true, occ, h: 2.0, pad: 0.01 });
          placed++;
          lastS = s;
        }
        if (placed) {
          const p = this.wallPoint(w, lastS, 0.0);
          this.put(o, 'toilet_stall_end', p.x, 0, p.z, rot);
        }
      }
      // sinks on the opposite side
      const opp = { N: 'S', S: 'N', W: 'E', E: 'W' }[sideName];
      for (const w of bySide[opp] || []) {
        const rot = rotFor(w.n.x, w.n.z);
        for (const s of [0.9, 2.0, 3.1]) {
          const p = this.wallPoint(w, s, 0.0);
          if (!this.fits(occ, 'sink_unit', p.x, p.z, rot, 0.02)) continue;
          this.put(o, 'sink_unit', p.x, 0, p.z, rot, { collide: true, occ, h: 0.9 });
          this.put(o, 'mirror', p.x, 1.15, p.z, rot);
        }
      }
    }
    if (rng.chance(0.6)) {
      for (let k = 0; k < 6; k++) {
        const x = rng.range(inf.minX + 1, inf.maxX - 1), z = rng.range(inf.minZ + 1, inf.maxZ - 1);
        const rot = rng.range(0, 6);
        if (!this.fits(occ, 'mop_bucket', x, z, rot, 0.3)) continue;
        this.put(o, 'mop_bucket', x, 0, z, rot, { collide: true, occ });
        this.put(o, 'wet_floor_sign', x + 0.8, 0, z + 0.3, rot + 0.5, { collide: false });
        break;
      }
    }
    const b = this.wallSlot(inf, occ, rng, 'bin', 0.4, 0.4);
    if (b) this.put(o, 'bin', b.p.x + b.w.n.x * 0.2, 0, b.p.z + b.w.n.z * 0.2, 0, { collide: true, occ });
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol' });
  }

  // stairwell --------------------------------------------------------------------------------
  stairwell(room, rng, o, inf, occ) {
    const st = room.stairs, ld = room.landing;
    if (!st || !ld) return;
    const dx = ld.cx - st.cx, dz = ld.cz - st.cz;
    const rot = rotFor(dx, dz);
    const ex = (st.cx + 0.5 + dx * 0.5) * CELL, ez = (st.cz + 0.5 + dz * 0.5) * CELL;
    this.put(o, 'stairwell_set', ex, 0, ez, rot);
    // the stairs cell is blocked (fence at 0.15 m into it)
    const x0 = st.cx * CELL, z0 = st.cz * CELL;
    let c = { minX: x0, maxX: x0 + CELL, minZ: z0, maxZ: z0 + CELL };
    if (dx === 1) c.maxX -= 0.12; if (dx === -1) c.minX += 0.12; if (dz === 1) c.maxZ -= 0.12; if (dz === -1) c.minZ += 0.12;
    o.colliders.push({ ...c, kind: 'prop', h: 2.5 });
    occ.mark(c.minX, c.minZ, c.maxX, c.maxZ);
    const nb = this.wallSlot(inf, occ, rng, 'noticeboard', 1.2, 0.04);
    if (nb) this.put(o, 'noticeboard', nb.p.x, 1.0, nb.p.z, nb.rot);
    this.posters(o, inf, occ, rng, 1);
    if (rng.chance(0.5)) this.scatter(o, rng, { minX: ld.cx * CELL, maxX: ld.cx * CELL + CELL, minZ: ld.cz * CELL, maxZ: ld.cz * CELL + CELL }, occ, 'ceiling_debris', 1);
    o.spawns.push({ x: ld.cx * CELL + 2, z: ld.cz * CELL + 2, kind: 'patrol' });
  }

  // reception --------------------------------------------------------------------------------
  reception(room, rng, o, inf, occ) {
    // entrance is on the S (outer) wall. Counter runs parallel to a side wall (W or E) without openings.
    const ent = inf.walls.find((w) => w.type === ET.ENTRANCE);
    let side = rng.chance(0.5) ? 'W' : 'E';
    // the counter must not cut the walkway from the corridor openings to the entrance: try the drawn
    // side first, then nudges and the other side (pinned stairwells keep the band 2 cells deep, so a
    // blind placement blocked the way in on ~4 % of seeds); fall back to the old spot
    let F = this.frame(inf, side), cx, cz;
    let placed = false;
    for (const sd of [side, side === 'W' ? 'E' : 'W']) {
      const Fs = this.frame(inf, sd);
      const crs = rotFor(-Fs.f.x, -Fs.f.z);
      for (const [du, v] of [[-0.4, 2.1], [0.6, 2.1], [-1.4, 2.1], [-0.4, 1.6], [0.6, 1.6], [-1.4, 1.6]]) {
        const [x, z] = Fs.w(Fs.lat / 2 + du, v);
        if (!this.fits(occ, 'reception_counter', x, z, crs, 0.05)) continue;
        side = sd; F = Fs; cx = x; cz = z; placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) [cx, cz] = F.w(F.lat / 2 - 0.4, 2.1);
    const f = F.f;
    const len = F.lat;
    const crot = rotFor(-f.x, -f.z); // visitor side (+Z local) faces away from the side wall
    this.put(o, 'reception_counter', cx, 0, cz, crot, { collide: true, occ, gap: 0.05, h: 1.1 });
    o.surfaces.push({ x: cx - Math.cos(crot) * 0.6 - Math.sin(crot) * 0.15, y: 0.76, z: cz + Math.sin(crot) * 0.6 - Math.cos(crot) * 0.15, kind: 'counter', prio: 1 });
    // back office: pigeonholes + filing cabinets on the side wall
    for (const w of inf.walls) {
      if (w.side !== side || !PLAIN.has(w.type)) continue;
      const rot = rotFor(w.n.x, w.n.z);
      const p = this.wallPoint(w, 2, 0.01);
      if (this.fits(occ, 'pigeonholes', p.x, p.z, rot, 0.0)) this.put(o, 'pigeonholes', p.x, 0, p.z, rot, { collide: true, occ });
      else {
        for (const s of [0.6, 3.4]) {
          const q = this.wallPoint(w, s, 0.01);
          if (this.fits(occ, 'filing_cabinet', q.x, q.z, rot, 0.0)) this.put(o, rng.chance(0.4) ? 'filing_cabinet_open' : 'filing_cabinet', q.x, 0, q.z, rot, { collide: true, occ });
        }
      }
    }
    // waiting area: benches along the entrance wall, a dead plant, noticeboard
    if (ent) {
      const rot = rotFor(ent.n.x, ent.n.z);
      for (const w of inf.walls) {
        if (w.side !== ent.side || w.type === ET.ENTRANCE) continue;
        const p = this.wallPoint(w, 2, 0.25);
        if (this.fits(occ, 'bench', p.x, p.z, rot, 0.05)) this.put(o, 'bench', p.x, 0, p.z, rot, { collide: true, occ, h: 0.45 });
      }
      const pp = this.wallPoint(ent, rng.chance(0.5) ? 0.45 : 3.55, 0.35);
      if (this.fits(occ, 'plant_dead', pp.x, pp.z, 0, 0.0)) this.put(o, 'plant_dead', pp.x, 0, pp.z, rng.range(0, 6), { collide: true, occ, h: 0.8 });
    }
    // exit sign hanging just inside the main doors + grime where everyone walked in
    if (ent) {
      const q = this.wallPoint(ent, 2, 0.9);
      this.put(o, 'exit_sign', q.x, WALL_HEIGHT, q.z, rotFor(ent.n.x, ent.n.z));
      const d2 = this.wallPoint(ent, 2, 1.6);
      this.put(o, 'decal_scuffs', d2.x, 0, d2.z, rng.range(0, 6), { scale: 1.6 });
      this.put(o, 'papers_b', d2.x + rng.range(-1, 1), 0, d2.z + rng.range(-0.5, 0.5), rng.range(0, 6));
    }
    // waiting area: rows of plastic chairs facing the counter, a low table, lost property boxes
    const toCounter = { x: -f.x, z: -f.z };
    const chairRot = rotFor(f.x, f.z); // chairs face the counter (towards the side wall)
    void toCounter;
    const colour = rng.chance(0.5) ? 'chair_blue' : 'chair_orange';
    for (let row = 0; row < 2; row++) {
      for (let tries = 0; tries < 10; tries++) {
        const [rx, rz] = F.w(rng.range(1.5, F.lat - 1.5), rng.range(5.0, F.dep - 1.5));
        const n = 4;
        const t = { x: Math.cos(chairRot), z: -Math.sin(chairRot) };
        let ok = true;
        for (let k = 0; k < n; k++) if (!this.fits(occ, colour, rx + t.x * (k - 1.5) * 0.5, rz + t.z * (k - 1.5) * 0.5, chairRot, 0.12)) { ok = false; break; }
        if (!ok) continue;
        for (let k = 0; k < n; k++) {
          const x = rx + t.x * (k - 1.5) * 0.5, z = rz + t.z * (k - 1.5) * 0.5;
          if (rng.chance(0.12)) this.put(o, colour, x + rng.range(-0.3, 0.3), 0.21, z + rng.range(-0.3, 0.3), chairRot + rng.range(-1, 1), { rx: -Math.PI / 2, collide: true, occ, h: 0.5 });
          else this.put(o, colour, x, 0, z, chairRot + rng.range(-0.06, 0.06), { collide: true, occ, h: 0.85 });
        }
        break;
      }
    }
    for (const node of ['table_library', 'box_stack', 'cleaning_trolley', 'bin']) {
      for (let tries = 0; tries < 10; tries++) {
        const x = rng.range(inf.minX + 1.2, inf.maxX - 1.2), z = rng.range(inf.minZ + 1.2, inf.maxZ - 1.2);
        const rot = rng.int(0, 3) * Math.PI / 2 + rng.range(-0.15, 0.15);
        if (!this.fits(occ, node, x, z, rot, 0.45)) continue;
        this.put(o, node, x, 0, z, rot, { collide: true, occ, gap: 0.2 });
        break;
      }
    }
    const nb = this.wallSlot(inf, occ, rng, 'noticeboard', 1.2, 0.04);
    if (nb) this.put(o, 'noticeboard', nb.p.x, 1.0, nb.p.z, nb.rot);
    const nb2 = this.wallSlot(inf, occ, rng, 'noticeboard', 1.2, 0.04);
    if (nb2) this.put(o, 'noticeboard', nb2.p.x, 1.0, nb2.p.z, nb2.rot);
    this.clock(o, inf, occ, rng, null);
    this.posters(o, inf, occ, rng, 3);
    this.extinguisher(o, inf, occ, rng);
    this.radiators(o, inf, occ);
    this.scatter(o, rng, inf, occ, 'papers_b', 1);
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol' });
  }

  // storage ----------------------------------------------------------------------------------
  storage(room, rng, o, inf, occ) {
    const isCaretaker = room.name.startsWith('Caretaker');
    // workbench (item surface). The desk's origin is its centre: tested on the wall line it never fit,
    // so store rooms had no workbench and the fuse fell back to a floor corner behind the boxes.
    const wb = this.wallSlot(inf, occ, rng, 'desk_teacher', 1.4, 0.72, { standOff: 0.4 });
    if (wb) {
      const p = this.wallPoint(wb.w, wb.s, 0.4);
      this.put(o, 'desk_teacher', p.x, 0, p.z, wb.rot + Math.PI, { collide: true, occ, gap: 0.05 });
      // front half of the desktop (local +z is towards the wall), so the fuse reads as on the bench
      const q = lp(p.x, p.z, wb.rot + Math.PI, -0.05, -0.12);
      o.surfaces.push({ x: q.x, y: 0.77, z: q.z, kind: 'workbench', prio: 1 });
    }
    // a hide cupboard
    const cup = this.wallSlot(inf, occ, rng, 'cupboard_tall', 1.0, 0.5, {});
    if (cup) {
      // clear space in front for the exit position
      const ex = this.wallPoint(cup.w, cup.s, 1.0);
      if (occ.free(ex.x - 0.35, ex.z - 0.35, ex.x + 0.35, ex.z + 0.35)) {
        this.hideCupboard(o, cup.w, cup.s, cup.rot, occ);
        occ.mark(ex.x - 0.4, ex.z - 0.4, ex.x + 0.4, ex.z + 0.4, 2);
      }
    }
    for (let k = 0; k < 6; k++) {
      const s = this.wallSlot(inf, occ, rng, 'storage_shelf', 1.2, 0.45, {});
      if (!s) break;
      this.put(o, 'storage_shelf', s.p.x, 0, s.p.z, s.rot, { collide: true, occ });
    }
    const props = isCaretaker ? ['cleaning_trolley', 'mop_bucket', 'box_stack', 'cardboard_box'] : ['box_stack', 'cardboard_box', 'filing_cabinet', 'box_stack'];
    for (const node of props) {
      for (let tries = 0; tries < 8; tries++) {
        const x = rng.range(inf.minX + 0.9, inf.maxX - 0.9), z = rng.range(inf.minZ + 0.9, inf.maxZ - 0.9);
        const rot = rng.int(0, 3) * Math.PI / 2 + rng.range(-0.2, 0.2);
        if (!this.fits(occ, node, x, z, rot, 0.35)) continue;
        this.put(o, node, x, 0, z, rot, { collide: true, occ, gap: 0.2 });
        break;
      }
    }
    // stacked chairs in a corner
    if (rng.chance(0.5)) {
      for (let tries = 0; tries < 6; tries++) {
        const x = rng.range(inf.minX + 0.6, inf.maxX - 0.6), z = rng.range(inf.minZ + 0.6, inf.maxZ - 0.6);
        if (!this.fits(occ, 'chair_blue', x, z, 0, 0.2)) continue;
        for (let k = 0; k < 4; k++) this.put(o, 'chair_blue', x, k * 0.09, z + k * 0.02, 0, k === 0 ? { collide: true, occ, h: 1.1 } : {});
        break;
      }
    }
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol' });
  }

  // Room 000 ---------------------------------------------------------------------------------
  room000(room, rng, o, inf, occ) {
    const r0 = this.L.room000;
    // the reveal wall is the "back": the chair stands at the opposite end, facing the desks
    const revealWall = inf.walls.find((w) => w.e === r0.edge);
    const backSide = revealWall ? revealWall.side : 'S';
    let frontSide = { N: 'S', S: 'N', W: 'E', E: 'W' }[backSide];
    // long rooms: the single chair sits at a short end so the rows run along the length
    const wX = inf.maxX - inf.minX, wZ = inf.maxZ - inf.minZ;
    if (wX !== wZ) {
      const shortSides = wX > wZ ? ['W', 'E'] : ['N', 'S'];
      if (!shortSides.includes(frontSide)) {
        // pick the short side farther from the reveal door
        const dm = revealWall ? revealWall.mid : { x: inf.cx, z: inf.cz };
        const dist = (sd) => (sd === 'W' ? dm.x - inf.minX : sd === 'E' ? inf.maxX - dm.x : sd === 'N' ? dm.z - inf.minZ : inf.maxZ - dm.z);
        frontSide = dist(shortSides[0]) >= dist(shortSides[1]) ? shortSides[0] : shortSides[1];
      }
    }
    const F = this.frame(inf, frontSide);
    const f = F.f;
    const [chx, chz] = F.w(F.lat / 2, 0.9);
    const chairRot = rotFor(-f.x, -f.z);
    this.put(o, 'chair_wood', chx, 0, chz, chairRot, { collide: true, occ, h: 0.9, tint: [0.8, 0.7, 0.65] });
    o.surfaces.push({ x: chx, y: 0.48, z: chz, kind: 'chair', prio: 5 });
    const [bx, bz] = F.w(F.lat / 2 + 1.4, 0.75);
    this.put(o, 'blackboard_old', bx, 0, bz, chairRot + 0.25, { collide: true, occ, h: 2.0 });
    o.boards.push({ node: 'blackboard_old_surface', m: placeMatrix(bx, 0, bz, chairRot + 0.25, 0, 0, 1), text: '000', style: 'old' });
    const deskRot = rotFor(f.x, f.z);
    for (let v = 2.0; v <= F.dep - 1.5; v += 1.1) {
      // two blocks of desks with a central aisle leading from the (future) door to the chair
      const per = Math.max(1, Math.floor((F.lat / 2 - 0.75 - 0.3) / 0.95));
      for (let k = 0; k < per * 2; k++) {
        const side = k < per ? -1 : 1;
        const kk = k % per;
        const u = F.lat / 2 + side * (0.75 + 0.35 + kk * 0.95);
        const [x, z] = F.w(u, v);
        if (!this.fits(occ, 'desk_old', x, z, deskRot, 0.02)) continue;
        this.put(o, 'desk_old', x, 0, z, deskRot + rng.range(-0.03, 0.03), { collide: true, occ, tint: [0.75, 0.62, 0.55] });
      }
    }
    this.put(o, 'papers_a', inf.cx + 0.4, 0, inf.cz - 0.3, rng.range(0, 6));
    o.spawns.push({ x: inf.cx, z: inf.cz, kind: 'patrol000' });
  }
}
