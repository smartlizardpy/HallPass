// LAST BELL - the school rearranges itself while you are not looking. Owned by S1 (World).
//
// transform({ protect, isVisible }) picks 1-3 operations:
//   seal      - wall off a corridor segment that sits on a loop
//   unseal    - remove an earlier seal
//   moveDoor  - a room's door moves to another wall facing a corridor (room is re-dressed)
//   redress   - a classroom's furniture is rearranged (reversed / stacked / circle / chaos) + new board text
//   swap      - two same-footprint classrooms trade numbers and furniture
//   lights    - broken lights move elsewhere
//   lockers   - every locker along an unseen corridor hangs open
//   board     - new writing on an unseen chalkboard
// Rules: never touch rooms (corridors: cells) containing or within 6 m of a protect point, nor anything
// isVisible() reports; rooms holding item spawns are left alone; after every walkability change the
// nav grid is flood-filled and everything that was reachable before must still be reachable, else
// the operation is reverted.
import * as THREE from './lib/three/three.module.js';
import { CELL, STAIRS } from './config.js';
import { ET, RNG, hashSeed } from './world-layout.js';
import { CHALK_CREEPY } from './world-dress.js';

// corridor cells in front of the stair doors: never sealed (CONTRACTS §13.1)
const STAIR_HALLS = new Set(Object.values(STAIRS).map((s) => s.hall.join(',')));

const PROTECT_R = 6;
const _v = new THREE.Vector3();

function rectDist(px, pz, minX, minZ, maxX, maxZ) {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  return Math.hypot(dx, dz);
}

const DESCS = {
  seal: ['Somewhere, a corridor has been bricked up.', 'A wall has grown where there was none.', 'One of the corridors no longer goes through.'],
  unseal: ['A wall that was there a minute ago is gone.', 'The bricked-up corridor is open again.'],
  moveDoor: (n) => [`The door to ${n} is somewhere else now.`, `${n} has moved its door.`],
  redress: {
    reversed: (n) => `The desks in ${n} have turned to face the back wall.`,
    stacked: (n) => `Every chair in ${n} has been put up on the desks.`,
    chaos: (n) => `Something has torn through ${n}.`,
    circle: (n) => `The desks in ${n} are arranged in a circle now.`,
    normal: (n) => `${n} has been tidied. Nobody tidied it.`,
  },
  swap: (a, b) => `${a} and ${b} have traded places.`,
  lights: ['The lights have chosen somewhere else to die.', 'Different lights are dark now.'],
  lockers: (n) => `Every locker in the ${n} is hanging open.`,
  board: (n) => `Someone has written on the board in ${n}.`,
};

export class WorldTransformer {
  constructor(world) {
    this.world = world;
    this.reset();
  }

  reset() {
    this.seals = [];
    this.count = 0;
    this.history = [];
  }

  // ------------------------------------------------------------------------------- context
  _ctx(protect, isVisible) {
    const w = this.world;
    const pts = (protect || []).filter(Boolean).map((p) => ({ x: p.x, z: p.z }));
    const vis = typeof isVisible === 'function' ? isVisible : null;
    const itemRooms = new Set(Object.values(w.itemRooms || {}).filter(Boolean));
    const ctx = {
      pts,
      itemRooms,
      visible(points) {
        if (!vis) return false;
        for (const p of points) {
          _v.set(p.x, p.y ?? 1.4, p.z);
          if (vis(_v)) return true;
        }
        return false;
      },
      nearPoint(x, z, r = PROTECT_R) { return pts.some((p) => Math.hypot(p.x - x, p.z - z) <= r); },
      rectProtected(minX, minZ, maxX, maxZ) { return pts.some((p) => rectDist(p.x, p.z, minX, minZ, maxX, maxZ) <= PROTECT_R); },
      roomProtected(room) {
        const b = room.bounds;
        return ctx.rectProtected(b.minX, b.minZ, b.maxX, b.maxZ);
      },
      cellProtected(cx, cz) { return ctx.rectProtected(cx * CELL, cz * CELL, cx * CELL + CELL, cz * CELL + CELL); },
      roomVisible(room) {
        const s = [];
        for (const c of room.cells) {
          const x = c.cx * CELL + 2, z = c.cz * CELL + 2;
          s.push({ x, z }, { x: x - 1.3, z: z - 1.3 }, { x: x + 1.3, z: z - 1.3 }, { x: x - 1.3, z: z + 1.3 }, { x: x + 1.3, z: z + 1.3 });
        }
        for (const d of w.doors) if (d.roomB === room || d.roomA === room) s.push({ x: d.position.x, y: 1.2, z: d.position.z });
        return ctx.visible(s);
      },
      roomUntouchable(room) {
        return ctx.roomProtected(room) || itemRooms.has(room) || room.type === 'room000' || ctx.roomVisible(room);
      },
    };
    ctx.baseline = this._reachState(ctx);
    return ctx;
  }

  /** Which important targets are reachable right now (from the exit). */
  _reachState(ctx) {
    const w = this.world;
    const mark = w._reachable();
    const st = { protect: [], items: {}, rooms: new Set(), exit: true, r000: false, mark: mark.slice() };
    for (const p of ctx.pts) st.protect.push(w._pointReached(mark, p, 2.0));
    for (const [k, p] of Object.entries(w.itemSpawns || {})) {
      if (k === 'key' && !w.room000Revealed) continue;
      st.items[k] = w._pointReached(mark, p, 1.6);
    }
    for (const room of w.rooms) if (w._roomReached(mark, room)) st.rooms.add(room.id);
    if (w.room000 && !w.room000Revealed) {
      const r0 = w.layout.room000;
      const ei = w.layout.edgeInfo(r0.edge);
      const corr = w.rooms[r0.corridor];
      const p = { x: ei.mx, z: ei.mz };
      if (ei.horiz) p.z += Math.sign(corr.center.z - p.z) * 0.9; else p.x += Math.sign(corr.center.x - p.x) * 0.9;
      st.r000p = p;
      st.r000 = w._pointReached(mark, p, 1.2);
    }
    return st;
  }

  /** strict: every nav cell that was reachable before and is still walkable must stay reachable
   *  (used for corridor seals so no orphaned corridor pockets appear). */
  _stillOk(ctx, strict = false) {
    const b = ctx.baseline;
    const now = this._reachState(ctx);
    if (strict) {
      const walk = this.world.getNav().walkable;
      const m = now.mark, bm = b.mark;
      for (let i = 0; i < bm.length; i++) if (bm[i] && walk[i] && !m[i]) return false;
    }
    for (let i = 0; i < b.protect.length; i++) if (b.protect[i] && !now.protect[i]) return false;
    for (const k of Object.keys(b.items)) if (b.items[k] && !now.items[k]) return false;
    for (const id of b.rooms) if (!now.rooms.has(id)) return false;
    if (b.r000 && !now.r000) return false;
    return true;
  }

  _raster(minX, minZ, maxX, maxZ) {
    this.world._rasterRegion(minX - 1.5, minZ - 1.5, maxX + 1.5, maxZ + 1.5);
  }

  _rasterEdge(e) {
    const ei = this.world.layout.edgeInfo(e);
    this._raster(Math.min(ei.x0, ei.x1), Math.min(ei.z0, ei.z1), Math.max(ei.x0, ei.x1), Math.max(ei.z0, ei.z1));
  }

  _rebuildEdge(e) {
    const w = this.world;
    w._dressEdgeOwner(e);
    for (const [vx, vz] of w._edgeVertices(e)) w._dressVertexOwner(vx, vz);
  }

  // ------------------------------------------------------------------------------- run
  run({ protect = [], isVisible = null } = {}) {
    const w = this.world;
    if (!w.layout) return { changed: [], description: '' };
    const t0 = performance.now();
    this.count++;
    const rng = new RNG(hashSeed(w.layoutSeed, 0x7f00, this.count));
    const ctx = this._ctx(protect, isVisible);
    const ops = rng.shuffle(['seal', 'seal', 'unseal', 'moveDoor', 'moveDoor', 'redress', 'redress', 'swap', 'lights', 'lockers', 'board']);
    const want = rng.weighted([1, 2, 3], [0.35, 0.45, 0.2]);
    const changed = [];
    const descs = [];
    const used = new Set();
    for (const op of ops) {
      if (changed.length >= want) break;
      if (used.has(op)) continue;
      let r = null;
      try {
        r = this[op](rng, ctx);
      } catch (err) {
        console.warn('[world] transform op failed', op, err);
        r = null;
      }
      if (r) {
        used.add(op);
        changed.push(r.label);
        descs.push(r.description);
      }
    }
    if (changed.length) {
      w.static.flush();
      w.navb.nav.version++;
      w.refreshPatrolPoints();
      w._rebuildInteractables();
    }
    const result = { changed, description: descs.join(' ') };
    this.history.push({ t: w.game?.time ?? 0, ...result, ms: performance.now() - t0 });
    w.events?.emit('world:transform', result);
    return result;
  }

  // ------------------------------------------------------------------------------- operations
  seal(rng, ctx) {
    const w = this.world;
    const L = w.layout;
    if (this.seals.length >= 3) return null;
    const cands = [];
    for (let e = 0; e < L.nEdges; e++) {
      if (L.edgeType[e] !== ET.NONE) continue;
      const [a, b] = L.edgeRooms(e);
      if (a < 0 || b < 0) continue;
      if (!w.rooms[a].isCorridor || !w.rooms[b].isCorridor) continue;
      const ei = L.edgeInfo(e);
      if (ctx.cellProtected(ei.ax, ei.az) || ctx.cellProtected(ei.bx, ei.bz)) continue;
      if (STAIR_HALLS.has(ei.ax + ',' + ei.az) || STAIR_HALLS.has(ei.bx + ',' + ei.bz)) continue; // keep the stair doors on the ring
      cands.push(e);
    }
    rng.shuffle(cands);
    for (const e of cands.slice(0, 10)) {
      const ei = L.edgeInfo(e);
      const pts = [{ x: ei.mx, z: ei.mz }, { x: ei.x0, z: ei.z0 }, { x: ei.x1, z: ei.z1 },
        { x: ei.mx + (ei.horiz ? 0 : 1.5), z: ei.mz + (ei.horiz ? 1.5 : 0) }, { x: ei.mx - (ei.horiz ? 0 : 1.5), z: ei.mz - (ei.horiz ? 1.5 : 0) }];
      if (ctx.visible(pts) || ctx.visible(pts.map((p) => ({ ...p, y: 0.4 })))) continue;
      L.edgeType[e] = ET.SEAL;
      this._rebuildEdge(e);
      this._rasterEdge(e);
      if (this._stillOk(ctx, true)) {
        this.seals.push(e);
        return { label: 'seal:' + e, description: rng.pick(DESCS.seal) };
      }
      L.edgeType[e] = ET.NONE;
      this._rebuildEdge(e);
      this._rasterEdge(e);
    }
    return null;
  }

  unseal(rng, ctx) {
    const w = this.world;
    const L = w.layout;
    for (const e of rng.shuffle(this.seals.slice())) {
      const ei = L.edgeInfo(e);
      if (ctx.cellProtected(ei.ax, ei.az) || ctx.cellProtected(ei.bx, ei.bz)) continue;
      if (ctx.visible([{ x: ei.mx, z: ei.mz }, { x: ei.x0, z: ei.z0 }, { x: ei.x1, z: ei.z1 }])) continue;
      L.edgeType[e] = ET.NONE;
      this._rebuildEdge(e);
      this._rasterEdge(e);
      if (this._stillOk(ctx)) {
        this.seals.splice(this.seals.indexOf(e), 1);
        return { label: 'unseal:' + e, description: rng.pick(DESCS.unseal) };
      }
      L.edgeType[e] = ET.SEAL;
      this._rebuildEdge(e);
      this._rasterEdge(e);
    }
    return null;
  }

  moveDoor(rng, ctx) {
    const w = this.world;
    const L = w.layout;
    const rooms = rng.shuffle(w.rooms.filter((r) => ['classroom', 'storage', 'toilets', 'library', 'science_lab'].includes(r.type)));
    for (const room of rooms) {
      if (ctx.roomUntouchable(room)) continue;
      const doors = w.doors.filter((d) => d.roomB === room && d.active && d.kind === 'door' && !d.isLocked);
      if (!doors.length) continue;
      const door = rng.pick(doors);
      // candidate edges: plain wall between this room and a corridor, corridor side unused + unprotected
      const cands = [];
      for (const c of room.layout.cells) {
        for (const n of L.cellEdges(c.cx, c.cz)) {
          if (L.edgeType[n.e] !== ET.WALL) continue;
          const nr = L.roomAt(n.nx, n.nz);
          if (nr < 0 || !w.rooms[nr].isCorridor) continue;
          if (ctx.cellProtected(n.nx, n.nz)) continue;
          const ei = L.edgeInfo(n.e);
          if (ctx.visible([{ x: ei.mx, y: 1.2, z: ei.mz }, { x: ei.mx, y: 2.0, z: ei.mz }])) continue;
          cands.push({ e: n.e, corridor: nr });
        }
      }
      if (!cands.length) continue;
      const tgt = rng.pick(cands);
      const oldE = door.edge;
      const oldCorr = door.roomA ? door.roomA.id : -1;
      const ld = door.layoutDoor;
      const before = { variant: room.variant, seed: w._roomData.get(room.id).seed, open: door.isOpen, angle: door.angle };
      const apply = (fromE, toE, corr) => {
        L.edgeType[fromE] = ET.WALL;
        L.edgeDoor[fromE] = -1;
        L.edgeType[toE] = ET.DOOR;
        L.edgeDoor[toE] = ld ? ld.id : -1;
        if (ld) { ld.edge = toE; ld.corridor = corr; }
        door.isOpen = false;
        door.angle = door.target = 0;
        w._placeDoor(door, toE, room.id, corr);
        w.colliders.set('door:' + door.index, [door.collider]);
        w._signOwner(fromE);
        w._signOwner(toE);
        this._rebuildEdge(fromE);
        this._rebuildEdge(toE);
      };
      const unstrip = w._stripCorridorEdge(tgt.corridor, tgt.e);
      apply(oldE, tgt.e, tgt.corridor);
      const nv = rng.pick(['normal', 'chaos', 'stacked']);
      w._dressRoomOwner(room, room.type === 'classroom' ? nv : room.variant, hashSeed(w.layoutSeed, 0x4d00, this.count, room.id));
      const b = room.bounds;
      const tei = L.edgeInfo(tgt.e);
      this._raster(Math.min(b.minX, tei.x0 - 1), Math.min(b.minZ, tei.z0 - 1), Math.max(b.maxX, tei.x1 + 1), Math.max(b.maxZ, tei.z1 + 1));
      if (this._stillOk(ctx)) {
        w._collectHides();
        return { label: 'moveDoor:' + room.name, description: rng.pick(DESCS.moveDoor(room.name)) };
      }
      // revert
      apply(tgt.e, oldE, oldCorr);
      unstrip();
      door.isOpen = before.open;
      door.angle = door.target = before.angle;
      door.pivot.rotation.y = door.baseRot + door.angle;
      w._updateLeaf(door);
      w._dressRoomOwner(room, before.variant, before.seed);
      this._raster(Math.min(b.minX, tei.x0 - 1), Math.min(b.minZ, tei.z0 - 1), Math.max(b.maxX, tei.x1 + 1), Math.max(b.maxZ, tei.z1 + 1));
      w._collectHides();
    }
    return null;
  }

  redress(rng, ctx) {
    const w = this.world;
    const rooms = rng.shuffle(w.rooms.filter((r) => r.type === 'classroom'));
    for (const room of rooms) {
      if (ctx.roomUntouchable(room)) continue;
      const data = w._roomData.get(room.id);
      const options = ['reversed', 'stacked', 'chaos', 'circle', 'normal'].filter((v) => v !== room.variant);
      const v = rng.pick(options);
      const before = { variant: room.variant, seed: data.seed };
      w._dressRoomOwner(room, v, hashSeed(w.layoutSeed, 0x5e00, this.count, room.id));
      const nd = w._roomData.get(room.id);
      for (const bd of nd.boards) w.redrawBoard(bd, rng.pick(CHALK_CREEPY));
      const b = room.bounds;
      this._raster(b.minX, b.minZ, b.maxX, b.maxZ);
      if (this._stillOk(ctx)) {
        w._collectHides();
        return { label: 'redress:' + room.name, description: DESCS.redress[v](room.name) };
      }
      w._dressRoomOwner(room, before.variant, before.seed);
      this._raster(b.minX, b.minZ, b.maxX, b.maxZ);
      w._collectHides();
    }
    return null;
  }

  swap(rng, ctx) {
    const w = this.world;
    const cls = w.rooms.filter((r) => r.type === 'classroom' && !ctx.roomUntouchable(r));
    const dims = (r) => {
      const b = r.bounds;
      const a = (b.maxX - b.minX), c = (b.maxZ - b.minZ);
      return Math.min(a, c) + 'x' + Math.max(a, c);
    };
    rng.shuffle(cls);
    for (let i = 0; i < cls.length; i++) {
      for (let j = i + 1; j < cls.length; j++) {
        const A = cls[i], B = cls[j];
        if (dims(A) !== dims(B)) continue;
        const dA = w._roomData.get(A.id), dB = w._roomData.get(B.id);
        const before = { aName: A.name, bName: B.name, aSign: A.layout.sign, bSign: B.layout.sign, aV: A.variant, bV: B.variant, aS: dA.seed, bS: dB.seed };
        const swapNames = () => {
          const n = A.name; A.name = B.name; B.name = n;
          A.layout.name = A.name; B.layout.name = B.name;
          const s = A.layout.sign; A.layout.sign = B.layout.sign; B.layout.sign = s;
        };
        swapNames();
        w._dressRoomOwner(A, before.bV, before.bS);
        w._dressRoomOwner(B, before.aV, before.aS);
        w._refreshSignsFor(A);
        w._refreshSignsFor(B);
        for (const r of [A, B]) { const b = r.bounds; this._raster(b.minX, b.minZ, b.maxX, b.maxZ); }
        if (this._stillOk(ctx)) {
          w._collectHides();
          return { label: 'swap:' + before.aName + '<->' + before.bName, description: DESCS.swap(before.aName, before.bName) };
        }
        swapNames();
        w._dressRoomOwner(A, before.aV, before.aS);
        w._dressRoomOwner(B, before.bV, before.bS);
        w._refreshSignsFor(A);
        w._refreshSignsFor(B);
        for (const r of [A, B]) { const b = r.bounds; this._raster(b.minX, b.minZ, b.maxX, b.maxZ); }
        w._collectHides();
      }
    }
    return null;
  }

  lights(rng, ctx) {
    const w = this.world;
    const ch = w.lights.rotateBroken(rng, (f) => {
      if ((f.floor || 0) !== 0 || f.stair) return false; // floor 0 only, never the stairwells
      const room = w.rooms[f.roomId];
      if (!room || room.type === 'room000' || room.type === 'stairwell') return false;
      if (ctx.nearPoint(f.x, f.z, PROTECT_R + 2)) return false;
      return !ctx.visible([{ x: f.x, y: 3.0, z: f.z }]);
    });
    if (!ch.length) return null;
    return { label: 'lights:' + ch.length, description: rng.pick(DESCS.lights) };
  }

  lockers(rng, ctx) {
    const w = this.world;
    for (const room of rng.shuffle(w.rooms.filter((r) => r.isCorridor))) {
      if (ctx.roomProtected(room) || ctx.roomVisible(room)) continue;
      const owner = 'room:' + room.id;
      const pls = w.static.getOwner(owner);
      if (!pls) continue;
      let n = 0;
      const next = pls.map((pl) => {
        if (pl.node === 'locker_bank') { n++; return { ...pl, node: 'locker_bank_open' }; }
        return pl;
      });
      if (n < 2) continue;
      w.static.setOwner(owner, next);
      const data = w._roomData.get(room.id);
      if (data) data.out.placements = next;
      return { label: 'lockers:' + room.name, description: DESCS.lockers(room.name) };
    }
    return null;
  }

  board(rng, ctx) {
    const w = this.world;
    for (const room of rng.shuffle(w.rooms.filter((r) => r.type === 'classroom' || r.type === 'science_lab'))) {
      if (ctx.roomProtected(room) || ctx.roomVisible(room)) continue;
      const data = w._roomData.get(room.id);
      if (!data || !data.boards.length) continue;
      for (const bd of data.boards) w.redrawBoard(bd, rng.pick(CHALK_CREEPY));
      return { label: 'board:' + room.name, description: DESCS.board(room.name) };
    }
    return null;
  }
}
