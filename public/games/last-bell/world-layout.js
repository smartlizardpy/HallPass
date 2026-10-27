// LAST BELL - procedural school layout (pure data, deterministic per seed). Owned by S1 (World).
//
// The school is a single floor on a CELL (4 m) grid. Corridors form a ring (+ optional middle cross
// corridor / spur) so there are always loops; bands of rooms sit around and inside the ring.
// Every room touches a corridor; doors sit on cell edges between a room and a corridor.
//
// Edge indexing: horizontal edge h(cx,cz) lies on the line z = cz*CELL, x in [cx*CELL, cx*CELL+CELL],
// between cell (cx, cz-1) ("A" side, -z) and (cx, cz) ("B" side, +z).
// Vertical edge v(cx,cz) lies on x = cx*CELL, between (cx-1, cz) (A, -x) and (cx, cz) (B, +x).

import { STAIRS } from './config.js';

export const ET = {
  NONE: 0, WALL: 1, DOOR: 2, OPENING: 3, WINDOW: 4, EXT: 5, EXT_WINDOW: 6, ENTRANCE: 7, SEAL: 8, HIDDEN: 9,
};
export const ET_NAME = ['none', 'wall', 'door', 'opening', 'window', 'ext', 'ext_window', 'entrance', 'seal', 'hidden'];

// ------------------------------------------------------------------------------------------- RNG
export function hashSeed(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    h ^= (x >>> 0);
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export class RNG {
  constructor(seed) {
    this.s = (seed >>> 0) ^ 0x9e3779b9;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); } // inclusive
  range(a, b) { return a + this.next() * (b - a); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  weighted(items, weights) {
    let s = 0;
    for (const w of weights) s += w;
    let r = this.next() * s;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  fork(k) { return new RNG(hashSeed(this.s, k)); }
}

// ------------------------------------------------------------------------------------------- Layout
export class Layout {
  constructor(W, H, cell = 4) {
    this.W = W;
    this.H = H;
    this.cell = cell;
    this.cellRoom = new Int16Array(W * H).fill(-1);
    this.nH = (H + 1) * W;
    this.nV = H * (W + 1);
    this.nEdges = this.nH + this.nV;
    this.edgeType = new Uint8Array(this.nEdges);
    this.edgeDoor = new Int16Array(this.nEdges).fill(-1);
    this.rooms = [];
    this.doors = [];
    this.room000 = null; // { roomId, edge }
    this.entranceEdge = -1;
  }
  idx(cx, cz) { return cz * this.W + cx; }
  inside(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.W && cz < this.H; }
  roomAt(cx, cz) { return this.inside(cx, cz) ? this.cellRoom[cz * this.W + cx] : -1; }
  hEdge(cx, cz) { return cz * this.W + cx; }
  vEdge(cx, cz) { return this.nH + cz * (this.W + 1) + cx; }
  /** Edge between two 4-adjacent cells. */
  edgeBetween(ax, az, bx, bz) {
    if (ax === bx) return this.hEdge(ax, Math.max(az, bz));
    return this.vEdge(Math.max(ax, bx), az);
  }
  edgeInfo(e) {
    const C = this.cell;
    if (e < this.nH) {
      const cz = Math.floor(e / this.W);
      const cx = e - cz * this.W;
      return {
        e, horiz: true, cx, cz,
        ax: cx, az: cz - 1, bx: cx, bz: cz,
        x0: cx * C, z0: cz * C, x1: cx * C + C, z1: cz * C,
        mx: cx * C + C / 2, mz: cz * C,
      };
    }
    const k = e - this.nH;
    const cz = Math.floor(k / (this.W + 1));
    const cx = k - cz * (this.W + 1);
    return {
      e, horiz: false, cx, cz,
      ax: cx - 1, az: cz, bx: cx, bz: cz,
      x0: cx * C, z0: cz * C, x1: cx * C, z1: cz * C + C,
      mx: cx * C, mz: cz * C + C / 2,
    };
  }
  edgeRooms(e) {
    const i = this.edgeInfo(e);
    return [this.roomAt(i.ax, i.az), this.roomAt(i.bx, i.bz)];
  }
  /** Edges around a cell: [N(-z), S(+z), W(-x), E(+x)] with the neighbour cell coords. */
  cellEdges(cx, cz) {
    return [
      { e: this.hEdge(cx, cz), nx: cx, nz: cz - 1, dx: 0, dz: -1 },
      { e: this.hEdge(cx, cz + 1), nx: cx, nz: cz + 1, dx: 0, dz: 1 },
      { e: this.vEdge(cx, cz), nx: cx - 1, nz: cz, dx: -1, dz: 0 },
      { e: this.vEdge(cx + 1, cz), nx: cx + 1, nz: cz, dx: 1, dz: 0 },
    ];
  }
  /** Is the edge passable at the cell-graph level (doors count as passable, locked doors not). */
  passable(e, opts = {}) {
    const t = this.edgeType[e];
    if (t === ET.NONE || t === ET.OPENING) return true;
    if (t === ET.DOOR) {
      const d = this.doors[this.edgeDoor[e]];
      return !(d && d.locked);
    }
    if (t === ET.HIDDEN && opts.room000Open) return true;
    return false;
  }
  /** BFS over cells from a start cell. Returns Int16 distance array (-1 = unreachable). */
  cellDistances(sx, sz, opts = {}) {
    const dist = new Int16Array(this.W * this.H).fill(-1);
    const q = [this.idx(sx, sz)];
    dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      const cx = c % this.W;
      const cz = (c - cx) / this.W;
      for (const n of this.cellEdges(cx, cz)) {
        if (!this.inside(n.nx, n.nz)) continue;
        const ni = this.idx(n.nx, n.nz);
        if (dist[ni] >= 0 || this.cellRoom[ni] < 0) continue;
        if (!this.passable(n.e, opts)) continue;
        dist[ni] = dist[c] + 1;
        q.push(ni);
      }
    }
    return dist;
  }
}

// ------------------------------------------------------------------------------------------- generator
const CLASS_NUMBERS = ['101', '102', '103', '104', '105', '106', '107', '108'];

function splitLen(L, rng, weights = [0.16, 0.42, 0.32, 0.1]) {
  const out = [];
  let left = L;
  while (left > 0) {
    if (left <= 4 && (left <= 2 || rng.chance(0.35))) {
      out.push(left);
      break;
    }
    let s = rng.weighted([1, 2, 3, 4], weights);
    if (s > left) s = left;
    if (left - s === 0) {
      out.push(s);
      break;
    }
    out.push(s);
    left -= s;
  }
  return rng.chance(0.5) ? out.reverse() : out;
}

function tryGenerate(rng) {
  const W = rng.int(13, 14);
  const H = rng.int(11, 12);
  const L = new Layout(W, H);
  // Second Floor update (architecture.md §2.2): the ring's north row is pinned to z = 2 and its south row
  // to z = 8 so the two stairwells (config STAIRS) line up with the fixed Floor 2; the east column stays
  // at x >= 10. The old draws are still made so W/H/xA/xB come out as they did before for most seeds.
  rng.int(2, 3);
  rng.int(2, 3);
  const zA = STAIRS.A.hall[1];
  const zB = STAIRS.B.hall[1];
  const xA = rng.int(2, 3);
  const xB = Math.max(STAIRS.B.cells[0][0], W - 1 - rng.int(2, 3));
  const interiorW = xB - xA - 1;
  const interiorH = zB - zA - 1;

  const rects = []; // candidate room rects {x0,z0,x1,z1, band}
  const corridors = [];
  const addCorr = (name, x0, z0, x1, z1) => corridors.push({ name, x0, z0, x1, z1 });

  // --- corridor skeleton (ring + optional middle cross corridor + optional spurs)
  addCorr('North Corridor', 0, zA, W, zA + 1);
  addCorr('South Corridor', 0, zB, W, zB + 1);
  addCorr('West Corridor', xA, zA + 1, xA + 1, zB);
  addCorr('East Corridor', xB, zA + 1, xB + 1, zB);
  let xM = -1;
  if (interiorW >= 5 && rng.chance(0.75)) {
    xM = xA + 1 + rng.int(2, interiorW - 3);
    addCorr('Middle Corridor', xM, zA + 1, xM + 1, zB);
  }
  // spur up into the top band (dead end with a window at the outer wall)
  let spurX = -1;
  const stairAX = STAIRS.A.cells[0][0];
  if (rng.chance(0.55)) {
    spurX = rng.int(3, W - 4);
    if (spurX === stairAX) spurX = stairAX + 1; // the spur never runs through Stair A
    addCorr('Old Wing Corridor', spurX, 0, spurX + 1, zA);
  }

  // --- room bands
  const pushBand = (x0, z0, x1, z1, axis, band) => {
    // axis 'x': split along x, rooms span full depth z0..z1
    const len = axis === 'x' ? x1 - x0 : z1 - z0;
    if (len <= 0) return;
    const segs = splitLen(len, rng);
    let p = axis === 'x' ? x0 : z0;
    for (const s of segs) {
      if (axis === 'x') rects.push({ x0: p, z0, x1: p + s, z1, band });
      else rects.push({ x0, z0: p, x1, z1: p + s, band });
      p += s;
    }
  };
  // the two pinned stairwells (fixed rects, never typed by take()); see config STAIRS
  const stairRect = (id) => {
    const c = STAIRS[id].cells;
    const xs = c.map((q) => q[0]), zs = c.map((q) => q[1]);
    return { x0: Math.min(...xs), z0: Math.min(...zs), x1: Math.max(...xs) + 1, z1: Math.max(...zs) + 1, band: 'stair', fixed: 'stairwell', stairId: id };
  };
  const stairA = stairRect('A'), stairB = stairRect('B');
  // split a band along x around fixed columns (the spur, a stairwell)
  const pushBandAround = (x0, z0, x1, z1, band, cuts) => {
    let a = x0;
    for (const c of cuts.filter((q) => q >= x0 && q < x1).sort((p, q) => p - q)) {
      if (c > a) pushBand(a, z0, c, z1, 'x', band);
      a = c + 1;
    }
    if (x1 > a) pushBand(a, z0, x1, z1, 'x', band);
  };
  // top band (split around the spur and Stair A)
  pushBandAround(0, 0, W, zA, 'top', spurX >= 0 ? [spurX, stairA.x0] : [stairA.x0]);
  rects.push(stairA);
  // bottom band: reception in the middle touching the outer wall
  const recW = rng.int(2, 3);
  const recX0 = Math.floor(W / 2) - 1 + rng.int(-1, 0);
  const reception = { x0: recX0, z0: zB + 1, x1: recX0 + recW, z1: H, band: 'bottom', fixed: 'reception' };
  pushBand(0, zB + 1, recX0, H, 'x', 'bottom');
  rects.push(reception);
  // right of reception, split around Stair B; a deeper (H = 12) band leaves one cell under Stair B,
  // which becomes a notch in the building outline
  pushBandAround(recX0 + recW, zB + 1, W, H, 'bottom', [stairB.x0]);
  rects.push(stairB);
  if (stairB.z1 < H) rects.push({ x0: stairB.x0, z0: stairB.z1, x1: stairB.x1, z1: H, band: 'bottom', fixed: 'void', type: 'void' });
  // side bands
  pushBand(0, zA + 1, xA, zB, 'z', 'left');
  pushBand(xB + 1, zA + 1, W, zB, 'z', 'right');
  // interior blocks
  const blocks = xM >= 0 ? [[xA + 1, xM], [xM + 1, xB]] : [[xA + 1, xB]];
  for (const [bx0, bx1] of blocks) {
    const bw = bx1 - bx0;
    if (bw <= 0) continue;
    if (bw <= 3 && interiorH <= 5 && rng.chance(0.3)) {
      rects.push({ x0: bx0, z0: zA + 1, x1: bx1, z1: zB, band: 'interior', big: true });
      continue;
    }
    const top = Math.floor(interiorH / 2);
    pushBand(bx0, zA + 1, bx1, zA + 1 + top, 'x', 'interior');
    pushBand(bx0, zA + 1 + top, bx1, zB, 'x', 'interior');
  }

  // --- assign types
  const area = (r) => (r.x1 - r.x0) * (r.z1 - r.z0);
  const dims = (r) => [r.x1 - r.x0, r.z1 - r.z0];
  const free = rects.filter((r) => !r.fixed);
  const take = (pred, score) => {
    const c = free.filter(pred);
    if (!c.length) return null;
    // score once per candidate (never call the RNG inside a sort comparator: engine-dependent)
    const sc = c.map((r) => ({ r, s: score(r) }));
    sc.sort((a, b) => b.s - a.s || (a.r.x0 - b.r.x0) || (a.r.z0 - b.r.z0));
    const r = sc[0].r;
    free.splice(free.indexOf(r), 1);
    return r;
  };
  reception.type = 'reception';
  stairA.type = stairB.type = 'stairwell';
  const lib = take((r) => area(r) >= 6, (r) => area(r) + (r.band === 'interior' ? 3 : 0) + rng.next());
  if (!lib) return null;
  lib.type = 'library';
  const lab = take((r) => area(r) >= 4 && area(r) <= 9, (r) => -Math.abs(area(r) - 6) + rng.next() * 2);
  if (!lab) return null;
  lab.type = 'science_lab';
  const toil = take((r) => area(r) >= 2 && area(r) <= 4, (r) => -area(r) + rng.next());
  if (!toil) return null;
  toil.type = 'toilets';
  const adjRec = (r) => !(r.x1 >= reception.x0 - 1 && r.x0 <= reception.x1 + 1 && r.z1 >= reception.z0 - 1);
  const r000 = take((r) => area(r) >= 2 && area(r) <= 4 && adjRec(r), (r) => (area(r) === 2 ? 1 : 0) + (r.band === 'interior' ? 0.6 : 0) + rng.next());
  if (!r000) return null;
  r000.type = 'room000';
  for (let k = 0; k < 2; k++) {
    const st = take((r) => area(r) <= 4, (r) => -area(r) + rng.next());
    if (!st) return null;
    st.type = 'storage';
  }
  // classrooms: prefer ~6-cell rooms spread over the bands, at most 8 (one sign per number)
  let classes = 0;
  const bandCount = {};
  while (classes < 8) {
    const c = take((r) => area(r) >= 4 && area(r) <= 9,
      (r) => -Math.abs(area(r) - 6) * 0.6 - (bandCount[r.band] || 0) * 0.8 + rng.next());
    if (!c) break;
    c.type = 'classroom';
    bandCount[c.band] = (bandCount[c.band] || 0) + 1;
    classes++;
  }
  if (classes < 4) return null;
  let stores = 2;
  for (const r of free.slice()) {
    if (area(r) <= 3 && stores < 4) { r.type = 'storage'; stores++; continue; }
    if (r.band === 'interior') { r.type = 'void'; continue; } // courtyard (open air)
    if (area(r) <= 4) { r.type = 'storage'; stores++; continue; }
    r.type = 'void'; // notch in the building outline
  }
  // --- materialise rooms
  const roomList = [];
  const mkRoom = (type, name, rc, isCorridor) => {
    const id = roomList.length;
    const cells = [];
    for (let z = rc.z0; z < rc.z1; z++) {
      for (let x = rc.x0; x < rc.x1; x++) {
        if (L.cellRoom[L.idx(x, z)] >= 0) continue; // corridor junction cells keep the first owner
        L.cellRoom[L.idx(x, z)] = id;
        cells.push({ cx: x, cz: z });
      }
    }
    const room = { id, type, name, isCorridor, rect: { x0: rc.x0, z0: rc.z0, x1: rc.x1, z1: rc.z1 }, cells, band: rc.band || 'corridor', doors: [] };
    roomList.push(room);
    return room;
  };
  for (const c of corridors) mkRoom('corridor', c.name, c, true);
  const ordered = rects.slice().sort((a, b) => (a.z0 - b.z0) || (a.x0 - b.x0));
  let classNo = 0;
  let storeNo = 0;
  for (const r of ordered) {
    if (r.type === 'void') continue;
    let name;
    let sign = -1;
    switch (r.type) {
      case 'classroom': name = 'Room ' + CLASS_NUMBERS[classNo]; sign = classNo; classNo++; break;
      case 'library': name = 'Library'; sign = 9; break;
      case 'science_lab': name = 'Science Lab'; sign = 8; break;
      case 'toilets': name = 'Toilets'; sign = 10; break;
      case 'stairwell': name = 'Stairwell ' + r.stairId; sign = 14; break;
      case 'reception': name = 'Reception'; sign = 13; break;
      case 'storage': name = storeNo === 0 ? "Caretaker's Store" : 'Store Room'; sign = storeNo === 0 ? 12 : 11; storeNo++; break;
      case 'room000': name = 'Room 000'; sign = 15; break;
      default: name = r.type;
    }
    const room = mkRoom(r.type, name, r, false);
    room.sign = sign;
    if (r.stairId) room.stairId = r.stairId;
  }
  L.rooms = roomList;
  L.voidCells = 0;
  for (let i = 0; i < L.cellRoom.length; i++) if (L.cellRoom[i] < 0) L.voidCells++;
  if (L.voidCells > 14) return null;
  // corridor rooms may have lost junction cells; drop empty ones
  for (const r of roomList) if (!r.cells.length) return null;

  // --- edges
  const isCorr = (id) => id >= 0 && roomList[id].isCorridor;
  for (let e = 0; e < L.nEdges; e++) {
    const [a, b] = L.edgeRooms(e);
    if (a < 0 && b < 0) { L.edgeType[e] = ET.NONE; continue; }
    if (a < 0 || b < 0) { L.edgeType[e] = ET.EXT; continue; }
    if (a === b) { L.edgeType[e] = ET.NONE; continue; }
    if (isCorr(a) && isCorr(b)) { L.edgeType[e] = ET.NONE; continue; }
    L.edgeType[e] = ET.WALL;
  }

  // --- doors / openings
  const corrEdgesOf = (room) => {
    const out = [];
    for (const c of room.cells) {
      for (const n of L.cellEdges(c.cx, c.cz)) {
        const nr = L.roomAt(n.nx, n.nz);
        if (nr >= 0 && isCorr(nr)) out.push({ e: n.e, cx: c.cx, cz: c.cz, nx: n.nx, nz: n.nz, dx: n.dx, dz: n.dz, corr: nr });
      }
    }
    return out;
  };
  const addDoor = (room, ce, kind = 'door') => {
    const id = L.doors.length;
    const d = {
      id, edge: ce.e, corridor: ce.corr, room: room.id, kind,
      cx: ce.cx, cz: ce.cz, // room-side cell
      locked: false, start: 'closed',
    };
    L.doors.push(d);
    L.edgeType[ce.e] = kind === 'opening' ? ET.OPENING : ET.DOOR;
    L.edgeDoor[ce.e] = id;
    room.doors.push(id);
    return d;
  };
  const spread = (a, b) => Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
  for (const room of roomList) {
    if (room.isCorridor) continue;
    const cand = corrEdgesOf(room);
    if (!cand.length) return null;
    rng.shuffle(cand);
    // prefer edges near the middle of the room's corridor side
    const rc = room.rect;
    const midx = (rc.x0 + rc.x1 - 1) / 2;
    const midz = (rc.z0 + rc.z1 - 1) / 2;
    cand.sort((p, q) => (Math.abs(p.cx - midx) + Math.abs(p.cz - midz)) - (Math.abs(q.cx - midx) + Math.abs(q.cz - midz)));
    if (room.type === 'room000') {
      // reveal edge: prefer one facing a long corridor; until revealed it is a plain-looking wall
      const pick = cand[Math.floor(rng.next() * Math.min(2, cand.length))];
      L.edgeType[pick.e] = ET.HIDDEN;
      L.room000 = { roomId: room.id, edge: pick.e, cx: pick.cx, cz: pick.cz, corridor: pick.corr };
      continue;
    }
    if (room.type === 'reception') {
      const d1 = addDoor(room, cand[0], 'opening');
      const far = cand.filter((c) => spread(c, cand[0]) >= 2);
      if (far.length && rng.chance(0.6)) addDoor(room, far[0], 'opening');
      d1.start = 'open';
      continue;
    }
    if (room.stairId) {
      // pinned door: the stairwell's door cell onto its hall cell (config STAIRS). Stair B's ground-floor
      // doorway has no leaf: the chained gate (world-stairs.js) fills it.
      const S = STAIRS[room.stairId];
      const ce = cand.find((c) => c.cx === S.door[0] && c.cz === S.door[1] && c.nx === S.hall[0] && c.nz === S.hall[1]);
      if (!ce) return null;
      const sd = addDoor(room, ce, S.main ? 'door' : 'opening');
      sd.start = 'open';
      sd.stair = room.stairId;
      continue;
    }
    const first = cand[Math.floor(rng.next() * Math.min(2, cand.length))];
    const d = addDoor(room, first);
    const two = (room.type === 'classroom' && rng.chance(0.45)) || (room.type === 'library' && rng.chance(0.85)) ||
      (room.type === 'science_lab' && rng.chance(0.35));
    if (two) {
      const far = cand.filter((c) => spread(c, first) >= 2);
      if (far.length) {
        const d2 = addDoor(room, rng.pick(far));
        if (room.type === 'classroom' && rng.chance(0.3)) d2.locked = true;
      }
    }
    const startOf = {
      classroom: () => rng.weighted(['closed', 'ajar', 'open'], [0.6, 0.28, 0.12]),
      storage: () => rng.weighted(['closed', 'ajar'], [0.8, 0.2]),
      toilets: () => rng.weighted(['ajar', 'open', 'closed'], [0.4, 0.3, 0.3]),
      stairwell: () => 'open',
      science_lab: () => rng.weighted(['closed', 'ajar'], [0.6, 0.4]),
      library: () => rng.weighted(['open', 'ajar', 'closed'], [0.3, 0.4, 0.3]),
    };
    for (const id of room.doors) {
      const dd = L.doors[id];
      if (!dd.locked) dd.start = (startOf[room.type] || (() => 'closed'))();
    }
    void d;
  }

  // stairwells: the open dog-leg stairs are built by world-stairs.js (both floors); keep the ids handy
  L.stairs = {};
  for (const room of roomList) if (room.stairId) L.stairs[room.stairId] = { roomId: room.id, edge: L.doors[room.doors[0]].edge };

  // --- windows
  for (let e = 0; e < L.nEdges; e++) {
    const t = L.edgeType[e];
    const [a, b] = L.edgeRooms(e);
    if (t === ET.WALL) {
      const ra = roomList[a];
      const rb = roomList[b];
      const room = ra.isCorridor ? rb : rb.isCorridor ? ra : null;
      if (!room) continue;
      const p = { classroom: 0.55, science_lab: 0.45, library: 0.4, reception: 0.35 }[room.type] || 0;
      if (rng.chance(p)) L.edgeType[e] = ET.WINDOW;
    } else if (t === ET.EXT) {
      const id = a >= 0 ? a : b;
      const room = roomList[id];
      let p = { classroom: 0.75, science_lab: 0.7, library: 0.6, reception: 0.6, toilets: 0.3, storage: 0.15, stairwell: 0.5, corridor: 0.25 }[room.type] || 0;
      if (room.isCorridor) {
        // corridor ends get a window most of the time
        const info = L.edgeInfo(e);
        const r = room.rect;
        const lenX = r.x1 - r.x0;
        const lenZ = r.z1 - r.z0;
        const isEnd = (info.horiz && lenZ > lenX) || (!info.horiz && lenX > lenZ);
        if (isEnd) p = 0.92;
      }
      const info2 = L.edgeInfo(e);
      const onBoundary = info2.horiz ? (info2.cz === 0 || info2.cz === L.H) : (info2.cx === 0 || info2.cx === L.W);
      if (!onBoundary) p = Math.max(p, room.isCorridor ? 0.75 : 0.6); // facing a courtyard
      if (room.type === 'room000') p = 0;
      const win = rng.chance(p);
      if (win && room.type !== 'stairwell') L.edgeType[e] = ET.EXT_WINDOW; // (draw kept: same stream)
    }
  }
  // entrance: middle of reception's outer (bottom) wall
  {
    const rr = roomList.find((r) => r.type === 'reception');
    const cx = rr.rect.x0 + Math.floor((rr.rect.x1 - rr.rect.x0) / 2);
    const e = L.hEdge(cx, H);
    L.edgeType[e] = ET.ENTRANCE;
    L.entranceEdge = e;
    rr.entrance = { cx, cz: H - 1, edge: e };
    // keep the walls next to the entrance solid (signage / benches)
  }

  // --- connectivity at cell level
  const rec = roomList.find((r) => r.type === 'reception');
  const dist = L.cellDistances(rec.cells[0].cx, rec.cells[0].cz, { room000Open: true });
  for (let i = 0; i < dist.length; i++) if (dist[i] < 0 && L.cellRoom[i] >= 0) return null;
  // loops: the ring guarantees at least one; record corridor-corridor edges that are on cycles later
  L.meta = { zA, zB, xA, xB, xM, spurX, W, H };
  return L;
}

/** Generate a layout for `seed`. Deterministic; retries internally with a forked RNG. */
export function generateLayout(seed) {
  const base = new RNG(hashSeed(seed, 0x5c4001));
  for (let attempt = 0; attempt < 80; attempt++) {
    const rng = base.fork(attempt);
    const L = tryGenerate(rng);
    if (L) {
      L.seed = seed;
      L.attempt = attempt;
      return L;
    }
  }
  throw new Error('layout generation failed for seed ' + seed);
}

/** ASCII dump for debugging (node). */
export function layoutToAscii(L) {
  const ch = { corridor: '.', classroom: 'C', science_lab: 'S', library: 'L', toilets: 'T', stairwell: '^', reception: 'R', storage: 's', room000: '0' };
  const rows = [];
  for (let z = 0; z < L.H; z++) {
    let line = '';
    for (let x = 0; x < L.W; x++) {
      const r = L.rooms[L.roomAt(x, z)];
      const c = r ? ch[r.type] : ' ';
      line += r && !r.isCorridor && (r.id % 2) ? c.toLowerCase() === c ? c.toUpperCase() : c.toLowerCase() : c;
    }
    rows.push(line);
  }
  return rows.join('\n');
}
