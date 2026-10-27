// LAST BELL - Floor 2: the fixed, hand-authored upstairs (Second Floor update, map-design.md). Owned by ENV.
//
// Same 4 m cell grid and wall kit as the ground floor, at y = FLOOR_Y[1] (3.6 m). The architecture never
// changes; only seeded details do (teacher-desk hides, a few props). Built by world.generate() after the
// ground floor, into its own colliders / LOS grid / nav grid / static batch and its own scene group
// (world.floorGroup(1)). Doors are appended to world.doors (one shared array, door.floor = 1).
//
//   world.floor2 === world.floors[1]:
//     rooms, doors, hidingSpots, patrolPoints, colliders, los, layout, bounds, group, index (1), y (3.6)
//     anchors: [{ id, kind, position (absolute y), yaw, normal, room, roomName, floor: 1 }], anchor(id)
//     playerSpawn: { position, yaw, room, floor: 1 } (null until the run is allowed to start upstairs)
//     boards: { maths } (world.redrawBoard(board, text)), readers: { security: Door, office: Door }
//
// Anchor yaw: the three.js yaw of someone standing in front of it and looking at it, i.e.
// forward = (-sin yaw, 0, -cos yaw) points at the thing; `normal` points back out of the wall / object.

import * as THREE from './lib/three/three.module.js';
import { CELL, FLOOR_Y, FLOOR2_SIZE, PLAYER, ENEMY } from './config.js';
import { Layout, ET, RNG, hashSeed } from './world-layout.js';
import { StaticBatcher, placeMatrix } from './world-kit.js';
import { Colliders, LosGrid, NavGridBuilder } from './world-grid.js';
import { Dresser, FLOOR_NODE } from './world-dress.js';
import { dressFloor2 } from './world-floor2-dress.js';

const Y2 = FLOOR_Y[1];

// rooms: [name, type, x0, z0, x1, z1] in cells, inclusive. Order = room id (keep stable: co-op, saves).
export const F2_ROOMS = [
  ['North Hall', 'corridor', 0, 2, 12, 2],
  ['South Hall', 'corridor', 0, 8, 12, 8],
  ['Spine', 'corridor', 6, 3, 6, 7],
  ['Classroom 2B', 'classroom', 3, 9, 4, 10],
  ['Classroom 2A', 'classroom', 0, 9, 2, 10],
  ['Classroom 2C', 'classroom', 7, 5, 8, 7],
  ['Maths', 'classroom', 3, 0, 4, 1],
  ['English', 'classroom', 8, 0, 9, 1],
  ['Computer Lab', 'computer_lab', 10, 0, 12, 1],
  ['Library', 'library', 0, 3, 3, 7],
  ['Staffroom', 'staffroom', 4, 3, 5, 5],
  ['Stationery Store', 'storage', 4, 6, 5, 7],
  ['Security Office', 'security', 7, 3, 8, 4],
  ['Science Lab', 'science_lab', 9, 3, 12, 5],
  ['Science Prep Room', 'storage', 9, 6, 10, 7],
  ['Art Room', 'art', 0, 0, 2, 1],
  ['Maintenance', 'maintenance', 8, 9, 9, 10],
  ['School Office', 'office', 5, 9, 5, 10],
  ["Principal's Office", 'principal', 6, 9, 7, 10],
  ["Boys' Toilets", 'toilets', 5, 0, 5, 1],
  ["Girls' Toilets", 'toilets', 7, 0, 7, 1],
  ['Lost Property', 'storage', 11, 6, 12, 7],
  ['Cleaning Store', 'storage', 11, 9, 12, 10],
  ['Stairwell A', 'stairwell', 6, 0, 6, 1],
  ['Stairwell B', 'stairwell', 10, 9, 10, 10],
];

// doors: [room cell, other cell, kind, opts]. The first room is the leaf's "room" side (it opens into it).
// opts: start 'closed'|'ajar'|'open', locked, reader, hinge (+1/-1), wide (double doors), stair, art
export const F2_DOORS = [
  [[1, 1], [1, 2], 'door', { start: 'ajar', art: true, hinge: 1 }],
  [[3, 1], [3, 2], 'door', { start: 'closed', hinge: -1 }],
  [[5, 1], [5, 2], 'door', { start: 'ajar', hinge: 1 }],
  [[6, 1], [6, 2], 'opening', { stair: 'A' }],
  [[7, 1], [7, 2], 'door', { start: 'ajar', hinge: -1 }],
  [[9, 1], [9, 2], 'door', { start: 'closed', hinge: 1 }],
  [[9, 0], [10, 0], 'door', { start: 'closed', hinge: 1 }],
  [[11, 1], [11, 2], 'door', { start: 'ajar', hinge: -1 }],
  [[1, 3], [1, 2], 'door', { start: 'closed', wide: true }],
  [[2, 7], [2, 8], 'door', { start: 'ajar', hinge: 1 }],
  [[4, 3], [4, 2], 'door', { start: 'closed', hinge: -1 }],
  [[5, 4], [6, 4], 'door', { start: 'closed', hinge: 1 }],
  [[4, 5], [4, 6], 'door', { start: 'closed', hinge: 1 }],
  [[5, 7], [5, 8], 'door', { start: 'closed', hinge: -1 }],
  [[7, 3], [6, 3], 'door', { start: 'closed', locked: true, reader: 'security', hinge: 1 }],
  [[10, 3], [10, 2], 'door', { start: 'ajar', hinge: 1 }],
  [[9, 5], [9, 6], 'door', { start: 'closed', hinge: -1 }],
  [[9, 7], [9, 8], 'door', { start: 'closed', hinge: 1 }],
  [[7, 6], [6, 6], 'door', { start: 'ajar', hinge: -1 }],
  [[8, 7], [8, 8], 'door', { start: 'closed', hinge: 1 }],
  [[11, 7], [11, 8], 'door', { start: 'closed', hinge: -1 }],
  [[1, 9], [1, 8], 'door', { start: 'ajar', hinge: 1 }],
  [[2, 10], [3, 10], 'door', { start: 'closed', hinge: -1 }],
  [[4, 9], [4, 8], 'door', { start: 'open', hinge: -1 }],
  [[5, 9], [5, 8], 'door', { start: 'closed', locked: true, reader: 'office', hinge: 1 }],
  [[5, 10], [6, 10], 'door', { start: 'closed', hinge: 1 }],
  [[8, 9], [8, 8], 'door', { start: 'closed', hinge: -1 }],
  [[10, 9], [10, 8], 'door', { start: 'closed', stair: 'B', hinge: 1 }],
  [[12, 9], [12, 8], 'door', { start: 'closed', hinge: -1 }],
];

// interior wired windows (security office onto the North Hall and the Spine)
const F2_WINDOWS = [[[8, 3], [8, 2]], [[7, 4], [6, 4]]];
// exterior windows: [cx, cz, side] (side N/S/W/E of that cell)
const F2_EXT_WINDOWS = [
  [0, 2, 'W'], [12, 2, 'E'], [0, 8, 'W'], [12, 8, 'E'], // corridor ends
  [0, 0, 'N'], [1, 0, 'N'], [2, 0, 'N'], [3, 0, 'N'], [4, 0, 'N'], [8, 0, 'N'], [9, 0, 'N'], [10, 0, 'N'], [11, 0, 'N'], [12, 0, 'N'],
  [0, 4, 'W'], [0, 6, 'W'], [12, 3, 'E'], [12, 4, 'E'], [12, 5, 'E'],
  [0, 10, 'S'], [1, 10, 'S'], [2, 10, 'S'], [3, 10, 'S'], [4, 10, 'S'], [5, 10, 'S'], [6, 10, 'S'], [7, 10, 'S'], [9, 10, 'S'],
];

const SIDE = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };

/** The fixed Floor 2 layout (pure data, same Layout class as the ground floor). */
export function buildFloor2Layout() {
  const { cols: W, rows: H } = FLOOR2_SIZE;
  const L = new Layout(W, H, CELL);
  L.rooms = F2_ROOMS.map(([name, type, x0, z0, x1, z1], id) => {
    const cells = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { L.cellRoom[L.idx(x, z)] = id; cells.push({ cx: x, cz: z }); }
    const room = { id, type, name, isCorridor: type === 'corridor', rect: { x0, z0, x1: x1 + 1, z1: z1 + 1 }, cells, band: 'floor2', doors: [], sign: -1 };
    if (type === 'stairwell') room.stairId = name.endsWith('A') ? 'A' : 'B';
    return room;
  });
  const isCorr = (id) => id >= 0 && L.rooms[id].isCorridor;
  for (let e = 0; e < L.nEdges; e++) {
    const [a, b] = L.edgeRooms(e);
    if (a < 0 && b < 0) L.edgeType[e] = ET.NONE;
    else if (a < 0 || b < 0) L.edgeType[e] = ET.EXT;
    else if (a === b || (isCorr(a) && isCorr(b))) L.edgeType[e] = ET.NONE;
    else L.edgeType[e] = ET.WALL;
  }
  L.wideEdges = new Set();
  for (const [[rx, rz], [ox, oz], kind, opts] of F2_DOORS) {
    const e = L.edgeBetween(rx, rz, ox, oz);
    const room = L.roomAt(rx, rz), other = L.roomAt(ox, oz);
    const base = { edge: e, corridor: other, room, kind, cx: rx, cz: rz, locked: !!opts.locked, start: opts.start || 'closed', opts };
    if (opts.stair) base.stair = opts.stair;
    L.edgeType[e] = kind === 'opening' ? ET.OPENING : ET.DOOR;
    if (opts.wide) {
      // double doors: two leaves, hinged on the outer jambs, meeting in the middle
      L.wideEdges.add(e);
      for (const off of [-0.6, 0.6]) {
        const d = { ...base, id: L.doors.length, offset: off, hingeSign: off < 0 ? 1 : -1, pair: true };
        L.doors.push(d);
        L.rooms[room].doors.push(d.id);
      }
      L.edgeDoor[e] = L.doors.length - 2;
      continue;
    }
    const d = { ...base, id: L.doors.length, hingeSign: opts.hinge || 1 };
    L.doors.push(d);
    L.edgeDoor[e] = d.id;
    L.rooms[room].doors.push(d.id);
  }
  for (const [[ax, az], [bx, bz]] of F2_WINDOWS) L.edgeType[L.edgeBetween(ax, az, bx, bz)] = ET.WINDOW;
  for (const [cx, cz, side] of F2_EXT_WINDOWS) {
    const [dx, dz] = SIDE[side];
    const e = L.edgeBetween(cx, cz, cx + dx, cz + dz);
    if (L.edgeType[e] === ET.EXT) L.edgeType[e] = ET.EXT_WINDOW;
  }
  return L;
}

/** Shift a dresser output up to floor 1 (placements, boards, hides, fixtures and surfaces are built at y = 0). */
export function liftOut(o, Y = Y2) {
  for (const pl of o.placements) pl.m.elements[13] += Y;
  for (const b of o.boards || []) b.m.elements[13] += Y;
  for (const h of o.hides || []) {
    h.position.y += Y;
    h.front.y += Y;
    h.exit.y = Y;
    for (const pv of h.pivots) pv.y += Y;
  }
  for (const f of o.fixtures || []) f.y += Y;
  for (const s of o.surfaces || []) s.y += Y;
  return o;
}

export class Floor2 {
  constructor(world) {
    this.world = world;
    this.index = 1;
    this.y = Y2;
    this.group = world.floorGroup(1);
    this.hidePrefix = 'f2hide';
    this._reset();
    // the security office's CCTV monitors come on with the power (puzzle B); a new run rebuilds them dark
    if (world.events) world._subs.push(world.events.on('floor2:power', (p) => this.setPower(p?.on !== false)));
  }

  /** Light (or blank) the security office's monitor wall. */
  setPower(on) {
    if (this._screens) this._screens.visible = !!on;
  }

  /** The monitor wall's six screens as one quad batch (one draw call, hidden until the power is back).
   *  The picture is a fixed 'camera view' per screen, drawn once: green IR corridors with a label. */
  _buildScreens(list) {
    if (!list.length) return;
    const cv = document.createElement('canvas');
    cv.width = 192;
    cv.height = 64;
    const g = cv.getContext('2d');
    g.fillStyle = '#071407';
    g.fillRect(0, 0, 192, 64);
    for (let k = 0; k < 6; k++) {
      const x0 = (k % 3) * 64, y0 = Math.floor(k / 3) * 32;
      const vx = x0 + 22 + ((k * 13) % 20), vy = y0 + 13;
      g.strokeStyle = '#3f9f45';
      g.lineWidth = 1;
      g.beginPath(); // a corridor in perspective: floor and ceiling lines to the vanishing point
      for (const [ax, ay] of [[x0, y0 + 31], [x0 + 63, y0 + 31], [x0, y0 + 1], [x0 + 63, y0 + 1]]) { g.moveTo(ax, ay); g.lineTo(vx, vy); }
      g.stroke();
      g.fillStyle = '#123a14';
      g.fillRect(vx - 4, vy - 4, 8, 8); // the far end
      if (k === 4) { g.fillStyle = '#0a0a0a'; g.fillRect(vx + 1, vy - 6, 2, 9); } // someone at the end of one corridor
      for (let i = 0; i < 70; i++) { g.fillStyle = Math.random() < 0.5 ? '#2c6a2e' : '#0d260e'; g.fillRect(x0 + Math.random() * 64, y0 + Math.random() * 32, 1, 1); }
      g.fillStyle = '#9fe79f';
      g.font = '7px monospace';
      g.fillText('CAM0' + (k + 1), x0 + 3, y0 + 8);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pos = [], uv = [], idx = [];
    for (const sc of list) {
      const c = Math.cos(sc.rot), sn = Math.sin(sc.rot);
      // monitor_wall local: screens at x -0.8 / 0 / 0.8, 0.5 x 0.38, rows at 1.01 and 1.56, face 0.462 out
      for (let k = 0; k < 6; k++) {
        const lx = -0.8 + (k % 3) * 0.8, ly = (k < 3 ? 1.56 : 1.01) + 0.19;
        const u0 = (k % 3) / 3, v1 = 1 - Math.floor(k / 3) / 2, v0 = v1 - 0.5;
        const b = pos.length / 3;
        for (const [dx, dy, uu, vv] of [[-0.25, -0.19, u0, v0], [0.25, -0.19, u0 + 1 / 3, v0], [0.25, 0.19, u0 + 1 / 3, v1], [-0.25, 0.19, u0, v1]]) {
          const x = lx + dx, z = 0.463;
          pos.push(sc.x + x * c + z * sn, sc.y + ly + dy, sc.z - x * sn + z * c);
          uv.push(uu, vv);
        }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, fog: true }));
    mesh.name = 'f2_cctv_screens';
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this._screens = mesh;
  }

  _reset() {
    this.layout = null;
    this.rooms = [];
    this.doors = [];
    this.hidingSpots = [];
    this.patrolPoints = [];
    this.anchors = [];
    this.anchorMap = new Map();
    this.boards = {};
    this.readers = {};
    this.fixtures = [];
    this.moon = [];
    this._spawn = null;
    this._hides = [];
    this._boards = [];
    this._hideCounter = 0; // hide ids f2hide1.. count from 1 every build (co-op names them)
  }

  /** Classroom 2B. Null while the run may not start upstairs (world.floor2Enabled()). */
  get playerSpawn() {
    return this.world.floor2Enabled() ? this._spawn : null;
  }

  anchor(id) { return this.anchorMap.get(id) || null; }

  build(seed) {
    const w = this.world;
    const kit = w.kit;
    this.dispose();
    const L = (this.layout = buildFloor2Layout());
    const maxX = L.W * CELL, maxZ = L.H * CELL;
    this.bounds = { minX: 0, minZ: 0, maxX, maxZ };
    this.static = new StaticBatcher(kit, this.group, 0);
    this.colliders = new Colliders(-1, -1, maxX + 1, maxZ + 1);
    this.los = new LosGrid(-1, -1, maxX + 1, maxZ + 1);
    this.navb = new NavGridBuilder(maxX, maxZ);
    this.dresser = new Dresser({ kit, layout: L });
    const rng = new RNG(hashSeed(seed >>> 0, 0xf2));
    // contract rooms
    this.rooms = L.rooms.map((r) => {
      let minX = Infinity, mX = -Infinity, minZ = Infinity, mZ = -Infinity;
      for (const c of r.cells) {
        minX = Math.min(minX, c.cx * CELL); mX = Math.max(mX, c.cx * CELL + CELL);
        minZ = Math.min(minZ, c.cz * CELL); mZ = Math.max(mZ, c.cz * CELL + CELL);
      }
      return {
        id: r.id, type: r.type, name: r.name, isCorridor: r.isCorridor, floor: 1,
        cells: r.cells.map((c) => ({ cx: c.cx, cz: c.cz })),
        bounds: { minX, maxX: mX, minZ, maxZ: mZ },
        center: new THREE.Vector3((minX + mX) / 2, Y2, (minZ + mZ) / 2),
        layout: r, variant: 'fixed', fixtures: [],
        stairId: r.stairId,
      };
    });
    // doors (one shared array; leaves only, the Stair A opening holds the shutter)
    this.doors = [];
    let pairPrev = null;
    for (const d of L.doors) {
      if (d.kind !== 'door') continue;
      const door = w._newDoor({ floor: 1, locked: d.locked, hingeSign: d.hingeSign, leafNode: d.opts.art ? 'door_leaf_art' : null });
      door.layoutDoor = d;
      door.offset = d.offset || 0;
      if (d.opts.reader) { door.reader = d.opts.reader; this.readers[d.opts.reader] = door; }
      if (d.stair) door.stair = d.stair;
      w._placeDoor(door, d.edge, d.room, d.corridor, this);
      if (d.pair) {
        if (pairPrev && pairPrev.edge === door.edge) { door.pair = pairPrev; pairPrev.pair = door; pairPrev = null; } else pairPrev = door;
      }
      if (d.start === 'open') { door.isOpen = true; door.angle = door.target = door.openAngle; }
      else if (d.start === 'ajar' && !d.locked) { door.isOpen = true; door.angle = door.target = door.ajarAngle; }
      door.pivot.rotation.y = door.baseRot + door.angle;
      w._updateLeaf(door);
      this.doors.push(door);
      this.colliders.set('door:' + door.index, [door.collider]);
    }
    // shell: edges + pillars from the shared dresser (lifted), floors / ceilings / fixtures authored here
    for (let e = 0; e < L.nEdges; e++) {
      const out = liftOut(this.dresser.dressEdge(e));
      this.static.setOwner('edge:' + e, out.placements, 'S');
      this.colliders.set('edge:' + e, out.colliders);
    }
    for (let vz = 0; vz <= L.H; vz++) {
      for (let vx = 0; vx <= L.W; vx++) {
        const out = liftOut(this.dresser.dressVertex(vx, vz));
        const k = vz * (L.W + 1) + vx;
        this.static.setOwner('vert:' + k, out.placements, 'S');
        this.colliders.set('vert:' + k, out.colliders);
      }
    }
    // rooms (authored dressing, world-floor2-dress.js)
    const res = dressFloor2(this, rng);
    const extra = []; // seeded hides (teacher desks, the checkout desk) after the 16 fixed ones: stable ids
    for (const room of this.rooms) {
      const o = res.rooms.get(room.id);
      if (!o) continue;
      liftOut(o);
      this.static.setOwner('room:' + room.id, o.placements, 'D');
      this.colliders.set('room:' + room.id, o.colliders);
      room.fixtures = o.fixtures.map((f) => ({ ...f, roomId: room.id, floor: 1 }));
      room._out = o;
      for (const h of o.hides) this._hides.push(w._makeHide(h, room, this));
      for (const h of o.extraHides || []) extra.push([h, room]);
      for (const b of o.boards) {
        const bd = w._makeBoard(b, seed, this);
        this._boards.push(bd);
        if (b.key) this.boards[b.key] = bd;
      }
    }
    for (const [h, room] of extra) this._hides.push(w._makeHide(h, room, this));
    const screens = [];
    for (const room of this.rooms) for (const sc of room._out?.screens || []) screens.push({ ...sc, y: Y2 });
    this._buildScreens(screens);
    this.static.flush();
    this.raster(-1, -1, maxX + 1, maxZ + 1);
    // lights + moonlight under the exterior windows
    this.fixtures = [];
    for (const room of this.rooms) for (const f of room.fixtures) this.fixtures.push({ ...f, dangling: !!f.dangling });
    this.moon = [];
    for (let e = 0; e < L.nEdges; e++) {
      if (L.edgeType[e] !== ET.EXT_WINDOW) continue;
      const ei = L.edgeInfo(e);
      const [ra] = L.edgeRooms(e);
      const inside = ra >= 0 ? -1 : 1;
      const n = ei.horiz ? { x: 0, z: inside } : { x: inside, z: 0 };
      this.moon.push({ x: ei.mx + n.x * 1.25, y: Y2, z: ei.mz + n.z * 1.25, rot: Math.atan2(n.x, n.z) });
    }
    // gameplay: hides (deterministic order), patrol points, anchors, the spawn
    this.hidingSpots = this._hides.filter((h) => {
      h.disabled = !this.isWalkable(h.exitPosition.x, h.exitPosition.z, PLAYER.radius);
      return !h.disabled;
    });
    const pts = [];
    const seen = new Set();
    for (const room of this.rooms) {
      for (const sp of room._out?.spawns || []) {
        if (sp.kind !== 'patrol') continue;
        const p = this.walkPoint(sp.x, sp.z, 1.8);
        if (!p) continue;
        const key = p.x * 2 + ',' + p.z * 2;
        if (seen.has(key)) continue;
        seen.add(key);
        p.userData = room.id;
        p.floor = 1;
        p.room = room;
        pts.push(p);
      }
    }
    this.patrolPoints = pts;
    this.anchors = [];
    this.anchorMap = new Map();
    for (const a of res.anchors) {
      const room = a.room || this.getRoomAt(a.x, a.z) || null;
      const floor = a.floor ?? 1;
      const an = {
        id: a.id, kind: a.kind,
        position: new THREE.Vector3(a.x, FLOOR_Y[floor] + a.y, a.z),
        yaw: a.yaw, normal: { x: Math.sin(a.yaw), z: Math.cos(a.yaw) },
        room: floor === 1 ? room : null, roomName: floor === 1 ? room?.name || null : a.roomName || null, floor,
      };
      if (a.door) an.door = a.door;
      if (a.name) an.name = a.name; // cctv rigs: label + pitch for the security PC's camera view
      if (a.pitch != null) an.pitch = a.pitch;
      this.anchors.push(an);
      this.anchorMap.set(an.id, an);
    }
    const sp = this.anchorMap.get('spawn');
    this._spawn = sp ? { position: sp.position.clone(), yaw: sp.yaw, room: sp.room, floor: 1 } : null;
    for (const room of this.rooms) delete room._out;
    return true;
  }

  // ------------------------------------------------------------------------------- grids / queries
  _inside(x, z) {
    const L = this.layout;
    return !!L && L.roomAt(Math.floor(x / CELL), Math.floor(z / CELL)) >= 0;
  }

  raster(x0, z0, x1, z1) {
    const ds = this.doors;
    this.los.rasterize(this.colliders, ds, x0, z0, x1, z1);
    this.navb.rasterize(this.colliders, ds, ENEMY.radius, (x, z) => this._inside(x, z), x0, z0, x1, z1);
    this.navb.nav.version++;
  }

  getNav() { return this.navb ? this.navb.nav : null; }

  isWalkable(x, z, r = 0) { return this.world.isWalkable(x, z, r, 1); }

  getRoomAt(x, z) {
    const L = this.layout;
    if (!L) return null;
    const r = L.roomAt(Math.floor(x / CELL), Math.floor(z / CELL));
    return r >= 0 ? this.rooms[r] : null;
  }

  walkPoint(x, z, maxDist = 1.6) {
    const i = this.navb.nearestWalkable(x, z, maxDist);
    if (i < 0) return null;
    const nav = this.navb.nav;
    const c = i % nav.cols, r = (i - c) / nav.cols;
    return new THREE.Vector3(nav.originX + (c + 0.5) * nav.res, Y2, nav.originZ + (r + 0.5) * nav.res);
  }

  /** Nav flood from the Classroom 2B spawn (used by the checks). */
  reachable() {
    const s = this._spawn || this.anchorMap.get('spawn');
    const start = s ? this.navb.nearestWalkable(s.position.x, s.position.z, 2) : -1;
    return this.navb.flood([start]);
  }

  dispose() {
    const w = this.world;
    for (const h of this._hides || []) {
      w._removeFromParent(h.object);
      for (const d of h.doors) w._removeFromParent(d.pivot);
    }
    for (const b of this._boards || []) {
      w._removeFromParent(b.mesh);
      b.mesh.material.map?.dispose();
      b.mesh.material.dispose();
    }
    for (const d of this.doors || []) w._removeFromParent(d.pivot);
    if (this._screens) {
      w._removeFromParent(this._screens);
      this._screens.geometry.dispose();
      this._screens.material.map?.dispose();
      this._screens.material.dispose();
      this._screens = null;
    }
    if (this.static) this.static.dispose();
    this.static = null;
    this._reset();
  }
}
