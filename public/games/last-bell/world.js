// LAST BELL - World (S1): procedural school, collision, line of sight, navigation grid, doors,
// hiding spots, lighting/atmosphere and the dynamic "transforming school". See CONTRACTS.md §6.
//
// Modules: world-layout.js (seeded layout data), world-dress.js (room dressing), world-kit.js (kit
// loading + merged static geometry), world-grid.js (collision / LOS / nav), world-lights.js (fixtures
// + pooled PointLights), world-transform.js (transformations), environment.js (fog, ambient, moon).
//
// Contract API (§6) is implemented as specified. Backwards-compatible extensions:
//   moveCircle(pos, delta, radius, out?)   optional `out` Vector3 (no allocation in hot loops)
//   lineOfSight(a, b)   if both a.y and b.y < 0.3 (feet positions) eye height 1.5 m is assumed;
//                       interior wired-glass windows are see-through between 1.0 and 2.28 m
//   checkLevel(opts)    -> { ok, problems[] } reachability report (spawns, items, exit, rooms, Room 000)
//   refreshPatrolPoints()  (called automatically after transforms / reveal; mutates patrolPoints in place)
//   setExitState('locked'|'unlocked'|'open')  chain hidden / entrance leaves swing; 'unlocked' is applied
//                       automatically on the 'exit:unlocked' event
//   room000Revealed, seed (requested), layoutSeed (actual seed after validation retries), getDebugInfo()
//   playerSpawn.room, door.kind ('door'|'room000'), door.n (normal into room B), door.interactable,
//   door.object (hinge pivot), hideSpot.playDoor(), hideSpot.front (interact point), hideSpot.room,
//   room.variant, World.FALLBACK_SEEDS
//   game.assetBase  optional prefix for asset URLs (pages in sub-folders, e.g. '../' for _dev/)
//
// Events emitted: door:open {door, by[, push]}, door:close {door, by}, door:locked {door},
//   noise {position, radius: 8, source: 'door'} (player door use; locked rattle radius 4),
//   world:transform {changed, description}, world:room000 {position}, subtitle (notes).
// Events consumed: hide:enter / hide:exit {spot} (occupied flag + door swing), exit:unlocked,
//   lights:flicker {intensity, duration} (global flicker surge), settings:change (quality).
//
// update(dt, game) reads game.camera.position (light pool centre; falls back to game.player.position),
//   game.player.position / game.enemy.position (ajar doors swing open when brushed; doors refuse to
//   close on someone). setQuality() also sets camera.far = drawDistance + 6 and fog density.
//
// Kits (assets/environment): school_kit.glb (architecture, set pieces) + props_kit.glb (furniture).
// Static geometry is merged per material into two layers ('S' shell never changes, 'D' dressing/edges
// rebuilt on transforms) -> ~35 draw calls for the whole level; doors, hiding-spot doors, chalkboards,
// notes and the instanced light panels / moonlight are separate objects.
import * as THREE from './lib/three/three.module.js';
import { CELL, WALL_HEIGHT, PLAYER, ENEMY, QUALITY, NAV_RES } from './config.js';
import { generateLayout, ET, RNG, hashSeed } from './world-layout.js';
import { Kit, StaticBatcher, placeMatrix } from './world-kit.js';
import { addVertexSnap } from './assets.js';
import { Colliders, LosGrid, NavGridBuilder, resolveCircle, circleBlocked } from './world-grid.js';
import { Dresser, NOTES, CHALK_CREEPY } from './world-dress.js';
import { LightSystem } from './world-lights.js';
import { SignSystem } from './world-signs.js';
import { ElectionPosters } from './world-election.js';
import { Graffiti } from './world-graffiti.js';
import { Environment, drawChalk } from './environment.js';
import { WorldTransformer } from './world-transform.js';

const _v = new THREE.Vector3();
const _p = { x: 0, z: 0 };

// ------------------------------------------------------------------------------------------- Door
class Door {
  constructor(world, index, data) {
    this.world = world;
    this.index = index;
    this.id = 'door' + index;
    this.kind = data.kind || 'door';
    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.isOpen = false;
    this.isLocked = !!data.locked;
    this.roomA = null;
    this.roomB = null;
    this.edge = -1;
    this.horiz = true;
    this.active = true;
    this.angle = 0;
    this.target = 0;
    this.openAngle = 1.7;
    this.ajarAngle = 0.7;
    this.hingeSign = data.hingeSign || 1;
    this.pivot = new THREE.Group();
    this.pivot.name = 'door-pivot';
    this.object = this.pivot;
    this.collider = null;
    this.n = { x: 0, z: 1 };
    this.baseRot = 0;
  }
  open(by = 'world') {
    if (this.isLocked) {
      if (by === 'player') this.world.events?.emit('door:locked', { door: this });
      return false;
    }
    if (this.isOpen && Math.abs(this.target) >= Math.abs(this.openAngle) * 0.95) return true;
    const wasOpen = this.isOpen;
    this.isOpen = true;
    this.target = this.openAngle;
    if (!wasOpen) this.world._doorEvent(this, 'door:open', by);
    return true;
  }
  close(by = 'world') {
    if (!this.isOpen) return true;
    if (this.world._doorBlocked(this)) return false;
    this.isOpen = false;
    this.target = 0;
    this.world._doorEvent(this, 'door:close', by);
    return true;
  }
  toggle(by = 'world') {
    return this.isOpen ? this.close(by) : this.open(by);
  }
}

// ------------------------------------------------------------------------------------------- HideSpot
class HideSpot {
  constructor(id, data, room) {
    this.id = id;
    this.type = data.type;
    this.position = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
    this.yaw = Math.atan2(-data.look.x, -data.look.z);
    this.exitPosition = new THREE.Vector3(data.exit.x, 0, data.exit.z);
    this.front = new THREE.Vector3(data.front.x, data.front.y, data.front.z);
    this.object = new THREE.Group();
    this.object.name = 'hide-' + data.type;
    this.object.position.set(data.front.x, 0, data.front.z);
    this.occupied = false;
    this.room = room;
    this.doors = [];
    this.anim = -1;
  }
  playDoor() { this.anim = 0; }
}

// ------------------------------------------------------------------------------------------- World
export class World {
  /** Layout seeds verified by _dev/world-test.html validate(); last-resort fallbacks for generate(). */
  static FALLBACK_SEEDS = [7, 1, 2, 3, 4, 5, 6, 8];

  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.events = game.events;
    this.settings = game.settings || {};
    this.kit = new Kit();
    this.root = new THREE.Group();
    this.root.name = 'world';
    this.scene.add(this.root);
    this.env = new Environment(this.scene);
    this.lights = new LightSystem(this);
    this.signs = new SignSystem(this); // corridor wayfinding (main agent)
    this.election = new ElectionPosters(this); // campaign posters + reception banner (main agent)
    this.graffiti = new Graffiti(this); // easter egg: one glow-in-the-dark "EGEMEN WAS HERE" tag per layout, only visible with the torch off (main agent)
    this.root.add(this.lights.group);
    this.quality = this.settings.quality || 'medium';
    this.transformer = new WorldTransformer(this);
    // gameplay data
    this.playerSpawn = null;
    this.enemySpawn = null;
    this.itemSpawns = null;
    this.exit = null;
    this.rooms = [];
    this.doors = [];
    this.hidingSpots = [];
    this.patrolPoints = [];
    this.room000Revealed = false;
    this.seed = 0;
    this.layoutSeed = 0;
    this.stats = {};
    this._interactables = [];
    this._levelObjects = [];
    this._levelMaterials = [];
    this._levelTextures = [];
    this._subs = [];
    if (this.events) {
      this._subs.push(this.events.on('hide:enter', ({ spot }) => { if (spot && this.hidingSpots.includes(spot)) { spot.occupied = true; spot.playDoor(); } }));
      this._subs.push(this.events.on('hide:exit', ({ spot }) => { if (spot && this.hidingSpots.includes(spot)) { spot.occupied = false; spot.playDoor(); } }));
      this._subs.push(this.events.on('exit:unlocked', () => this.setExitState('unlocked')));
      this._subs.push(this.events.on('lights:flicker', (p) => this.lights.pulse(p?.intensity ?? 1, p?.duration ?? 1)));
      this._subs.push(this.events.on('settings:change', ({ settings }) => { if (settings && settings.quality && settings.quality !== this.quality) this.setQuality(settings.quality); }));
    }
  }

  // ------------------------------------------------------------------------------- loading
  async load(onProgress) {
    // game.assetBase lets pages in sub-folders (e.g. _dev/) resolve the relative asset paths
    await this.kit.load((p, url) => onProgress?.(p * 0.95, url), this.game.assetBase || '');
    this.election.applyPosters();
    this.env.attach();
    this.setQuality(this.quality);
    onProgress?.(1, 'world');
  }

  setQuality(q) {
    if (!QUALITY[q]) q = 'medium';
    this.quality = q;
    const Q = QUALITY[q];
    this.lights.setPoolSize(Q.lightPool);
    this.env.setQuality(q);
    const cam = this.game.camera;
    if (cam && cam.isPerspectiveCamera) {
      cam.far = Q.drawDistance + 6;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------------------- generation
  generate(seed) {
    if (!this.kit.loaded) throw new Error('[world] call load() before generate()');
    const t0 = performance.now();
    this.seed = (Number(seed) >>> 0) || 0;
    // 1) the seed itself, 2) derived seeds, 3) known-good fallback layouts. Never throws.
    const candidates = [this.seed];
    for (let k = 1; k < 24; k++) candidates.push(hashSeed(this.seed, 0xbe11, k));
    candidates.push(...World.FALLBACK_SEEDS);
    let ok = false;
    this._failLog = [];
    for (const s of candidates) {
      this._disposeLevel();
      try {
        ok = this._build(s);
      } catch (err) {
        ok = false;
        this._failReason = 'exception ' + (err && err.message);
        console.warn('[world] build threw for seed', s, err);
      }
      if (ok) { this.layoutSeed = s; break; }
      this._failLog.push(s + ': ' + this._failReason);
    }
    if (!ok) {
      // Should be unreachable (fallback seeds are validated). Keep the game running anyway.
      console.error('[world] no valid level found; using unvalidated fallback', this._failLog.slice(-3));
      this._disposeLevel();
      this._build(World.FALLBACK_SEEDS[0], true);
      this.layoutSeed = World.FALLBACK_SEEDS[0];
    }
    this.stats.generateMs = performance.now() - t0;
    this.stats.attempts = this._failLog.length + 1;
    this.signs?.refresh();
    this.election?.placeBanner();
    this.graffiti?.place();
    return this;
  }

  _build(s, force = false) {
    const L = (this.layout = generateLayout(s));
    this._rng = new RNG(hashSeed(s, 77));
    const rng = this._rng;
    this.room000Revealed = false;
    this._failReason = null;
    const maxX = L.W * CELL, maxZ = L.H * CELL;
    this.bounds = { minX: 0, minZ: 0, maxX, maxZ };
    // chunkSize 0: one merged mesh per material per layer (lowest draw calls; GPUs handle the vertex count)
    this.static = new StaticBatcher(this.kit, this.root, 0);
    this.colliders = new Colliders(-1, -1, maxX + 1, maxZ + 1);
    this.los = new LosGrid(-1, -1, maxX + 1, maxZ + 1);
    this.navb = new NavGridBuilder(maxX, maxZ);
    this.dresser = new Dresser(this);
    this._roomData = new Map();
    this._edgeExtras = new Map();

    // rooms (contract objects)
    this.rooms = L.rooms.map((r) => {
      let minX = Infinity, maxX2 = -Infinity, minZ = Infinity, maxZ2 = -Infinity;
      for (const c of r.cells) {
        minX = Math.min(minX, c.cx * CELL); maxX2 = Math.max(maxX2, c.cx * CELL + CELL);
        minZ = Math.min(minZ, c.cz * CELL); maxZ2 = Math.max(maxZ2, c.cz * CELL + CELL);
      }
      return {
        id: r.id, type: r.type, name: r.name, isCorridor: r.isCorridor,
        cells: r.cells.map((c) => ({ cx: c.cx, cz: c.cz })),
        bounds: { minX, maxX: maxX2, minZ, maxZ: maxZ2 },
        center: new THREE.Vector3((minX + maxX2) / 2, 0, (minZ + maxZ2) / 2),
        layout: r,
      };
    });
    this.room000 = this.rooms.find((r) => r.type === 'room000');

    // doors (real leaves only; reception openings have no leaf)
    this.doors = [];
    for (const d of L.doors) {
      if (d.kind !== 'door') continue;
      const door = new Door(this, this.doors.length, { locked: d.locked, hingeSign: rng.chance(0.5) ? 1 : -1 });
      door.layoutDoor = d;
      this.doors.push(door);
      this._placeDoor(door, d.edge, d.room, d.corridor);
      if (d.start === 'open') { door.isOpen = true; door.angle = door.target = door.openAngle; }
      else if (d.start === 'ajar' && !d.locked) { door.isOpen = true; door.angle = door.target = door.ajarAngle; }
      door.pivot.rotation.y = door.baseRot + door.angle;
    }

    // static dressing
    for (const room of this.rooms) {
      const shell = this.dresser.dressShell(room.layout, rng.fork(1000 + room.id));
      this.static.setOwner('shell:' + room.id, shell.placements, 'S');
      room.fixtures = shell.fixtures;
    }
    for (const room of this.rooms) {
      let variant = 'normal';
      if (room.type === 'classroom') variant = rng.weighted(['normal', 'chaos', 'stacked', 'reversed', 'circle'], [0.62, 0.14, 0.1, 0.07, 0.07]);
      this._dressRoomOwner(room, variant, hashSeed(s, 31, room.id));
    }
    for (let e = 0; e < L.nEdges; e++) this._dressEdgeOwner(e);
    for (let vz = 0; vz <= L.H; vz++) for (let vx = 0; vx <= L.W; vx++) this._dressVertexOwner(vx, vz);
    for (const d of this.doors) this.colliders.set('door:' + d.index, [d.collider]);
    for (const d of L.doors) this._signOwner(d.edge);
    this._buildEntrance();
    this.static.flush();

    // grids
    this._rasterAll();

    // lights
    const fixtures = [];
    for (const room of this.rooms) for (const f of room.fixtures) fixtures.push({ ...f, dangling: false });
    // dangling broken fixtures have no panel (their housing model hangs open)
    for (const owner of this.rooms.map((r) => 'shell:' + r.id)) {
      const pls = this.static.getOwner(owner) || [];
      for (const pl of pls) {
        if (pl.node !== 'light_fixture_broken') continue;
        const e = pl.m.elements;
        const f = fixtures.find((ff) => Math.abs(ff.x - e[12]) < 0.01 && Math.abs(ff.z - e[14]) < 0.01);
        if (f) f.dangling = true;
      }
    }
    this.lights.build(fixtures, this.kit);
    if (this.room000) this.lights.setRoomEnabled(this.room000.id, false);
    // moonlight pools under exterior windows
    const moon = [];
    for (let e = 0; e < L.nEdges; e++) {
      if (L.edgeType[e] !== ET.EXT_WINDOW) continue;
      const ei = L.edgeInfo(e);
      const [ra, rb] = L.edgeRooms(e);
      const inside = ra >= 0 ? -1 : 1; // room on the A (-) or B (+) side
      const n = ei.horiz ? { x: 0, z: inside } : { x: inside, z: 0 };
      moon.push({ x: ei.mx + n.x * 1.25, z: ei.mz + n.z * 1.25, rot: Math.atan2(n.x, n.z) });
      void rb;
    }
    this.env.buildMoonlight(moon);

    // spawns, items, exit
    if (!this._placeGameplay(rng) && !force) return false;
    if (!this._validate() && !force) return false;
    this._rebuildInteractables();
    this.lights.setMode('normal');
    this.env.setMode('normal');
    this.stats.static = this.static.computeStats();
    this.stats.colliders = this.colliders.count;
    return true;
  }

  // ------------------------------------------------------------------------------- owners
  _dressRoomOwner(room, variant, seed) {
    const old = this._roomData.get(room.id);
    if (old) this._disposeRoomExtras(old);
    const out = this.dresser.dressRoom(room.layout, new RNG(seed), variant);
    this.static.setOwner('room:' + room.id, out.placements);
    this.colliders.set('room:' + room.id, out.colliders);
    const data = { variant, seed, out, boards: [], hides: [], notes: [] };
    // boards
    for (const b of out.boards) data.boards.push(this._makeBoard(b, seed));
    // hide spots
    for (const h of out.hides) data.hides.push(this._makeHide(h, room));
    this._roomData.set(room.id, data);
    room.variant = variant;
    return data;
  }

  _disposeRoomExtras(data) {
    for (const b of data.boards) {
      this.root.remove(b.mesh);
      b.mesh.material.map?.dispose();
      b.mesh.material.dispose();
    }
    for (const h of data.hides) {
      this.root.remove(h.object);
      for (const d of h.doors) this.root.remove(d.pivot);
    }
    data.boards = [];
    data.hides = [];
  }

  _dressEdgeOwner(e) {
    const out = this.dresser.dressEdge(e);
    this.static.setOwner('edge:' + e, out.placements);
    this.colliders.set('edge:' + e, out.colliders);
  }

  _dressVertexOwner(vx, vz) {
    const out = this.dresser.dressVertex(vx, vz);
    const k = vz * (this.layout.W + 1) + vx;
    this.static.setOwner('vert:' + k, out.placements);
    this.colliders.set('vert:' + k, out.colliders);
  }

  _edgeVertices(e) {
    const ei = this.layout.edgeInfo(e);
    return ei.horiz ? [[ei.cx, ei.cz], [ei.cx + 1, ei.cz]] : [[ei.cx, ei.cz], [ei.cx, ei.cz + 1]];
  }

  /** Room number plate on the corridor side of a door edge (own owner so doors can move). */
  _signOwner(e) {
    const L = this.layout;
    const owner = 'sign:' + e;
    const t = L.edgeType[e];
    if (t !== ET.DOOR && t !== ET.OPENING) { this.static.removeOwner(owner); return; }
    const [ra, rb] = L.edgeRooms(e);
    const A = ra >= 0 ? this.rooms[ra] : null, B = rb >= 0 ? this.rooms[rb] : null;
    const ei = L.edgeInfo(e);
    let room, n;
    if (A && A.isCorridor && B && !B.isCorridor) { room = B; n = ei.horiz ? { x: 0, z: -1 } : { x: -1, z: 0 }; }
    else if (B && B.isCorridor && A && !A.isCorridor) { room = A; n = ei.horiz ? { x: 0, z: 1 } : { x: 1, z: 0 }; }
    else { this.static.removeOwner(owner); return; }
    const slot = room.layout.sign;
    if (slot == null || slot < 0) { this.static.removeOwner(owner); return; }
    const tx = ei.horiz ? 1 : 0, tz = ei.horiz ? 0 : 1;
    const px = ei.x0 + tx * 3.0 + n.x * 0.102, pz = ei.z0 + tz * 3.0 + n.z * 0.102;
    this.static.setOwner(owner, [{ node: 'sign_plate', m: placeMatrix(px, 1.62, pz, Math.atan2(n.x, n.z)), uvTo: this.signUV(slot) }]);
  }

  _refreshSignsFor(room) {
    for (const d of this.layout.doors) if (d.room === room.id) this._signOwner(d.edge);
  }

  /** Remove corridor wall props standing against edge `e` (so a door can appear there). Returns undo fn. */
  _stripCorridorEdge(corrId, e) {
    const data = this._roomData.get(corrId);
    if (!data) return () => {};
    const ei = this.layout.edgeInfo(e);
    const room = this.rooms[corrId];
    const into = ei.horiz ? Math.sign(room.center.z - ei.mz) || 1 : Math.sign(room.center.x - ei.mx) || 1;
    const r = ei.horiz
      ? { minX: ei.x0 - 0.05, maxX: ei.x1 + 0.05, minZ: Math.min(ei.mz, ei.mz + into * 1.0), maxZ: Math.max(ei.mz, ei.mz + into * 1.0) }
      : { minX: Math.min(ei.mx, ei.mx + into * 1.0), maxX: Math.max(ei.mx, ei.mx + into * 1.0), minZ: ei.z0 - 0.05, maxZ: ei.z1 + 0.05 };
    const inR = (x, z) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
    const KEEP = /^(ceiling_pipes|decal_scuffs|exit_sign|papers_|ceiling_debris|light_)/;
    const oldPl = this.static.getOwner('room:' + corrId) || [];
    const oldCols = this.colliders.get('room:' + corrId) || [];
    const oldHides = data.hides.slice();
    const newPl = oldPl.filter((pl) => KEEP.test(pl.node) || !inR(pl.m.elements[12], pl.m.elements[14]));
    const newCols = oldCols.filter((c) => !(c.maxX > r.minX && c.minX < r.maxX && c.maxZ > r.minZ && c.minZ < r.maxZ));
    const removedHides = data.hides.filter((h) => inR(h.front.x, h.front.z));
    for (const h of removedHides) {
      for (const d of h.doors) this.root.remove(d.pivot);
      if (!h.doors.length) this.root.remove(h.object);
      h.removed = true;
    }
    data.hides = data.hides.filter((h) => !h.removed);
    const hadUse = data.out.edgeUse.has(e);
    data.out.edgeUse.delete(e);
    this.static.setOwner('room:' + corrId, newPl);
    this.colliders.set('room:' + corrId, newCols);
    return () => {
      for (const h of removedHides) {
        h.removed = false;
        for (const d of h.doors) this.root.add(d.pivot);
        if (!h.doors.length) this.root.add(h.object);
      }
      data.hides = oldHides;
      if (hadUse) data.out.edgeUse.add(e);
      this.static.setOwner('room:' + corrId, oldPl);
      this.colliders.set('room:' + corrId, oldCols);
    };
  }

  /** Re-collect hiding spots after rooms were re-dressed. */
  _collectHides() {
    const spots = [];
    for (const [, d] of this._roomData) {
      for (const h of d.hides) {
        if (h.disabled === undefined) h.disabled = !this.isWalkable(h.exitPosition.x, h.exitPosition.z, PLAYER.radius);
        if (!h.disabled) spots.push(h);
      }
    }
    this.hidingSpots = spots;
    this._rebuildInteractables();
  }

  signUV(slot) {
    const col = slot % 2, row = Math.floor(slot / 2);
    return [col * 0.5, row / 8, col * 0.5 + 0.5, (row + 1) / 8];
  }

  _makeBoard(b, seed) {
    const old = b.style === 'old';
    const canvas = document.createElement('canvas');
    canvas.width = old ? 128 : 256;
    canvas.height = old ? 80 : 96;
    drawChalk(canvas, this.kit.chalkImage, b.text, b.style, seed);
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: old ? 0x9a8f88 : 0xffffff });
    addVertexSnap(mat);
    const part = this.kit.get(b.node).parts[0];
    const mesh = new THREE.Mesh(part.geometry, mat);
    mesh.name = 'board';
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(b.m);
    mesh.matrixWorldNeedsUpdate = true;
    this.root.add(mesh);
    return { mesh, canvas, tex, text: b.text, style: b.style };
  }

  redrawBoard(board, text) {
    board.text = text;
    drawChalk(board.canvas, this.kit.chalkImage, text, board.style, (Math.random() * 1e9) | 0);
    board.tex.needsUpdate = true;
  }

  _makeHide(h, room) {
    const spot = new HideSpot('hide' + (this._hideCounter = (this._hideCounter || 0) + 1), h, room);
    for (const pv of h.pivots) {
      const pivot = new THREE.Group();
      pivot.position.set(pv.x, pv.y, pv.z);
      pivot.rotation.y = pv.rot;
      const leaf = this.kit.makeObject(pv.node || h.doorNode);
      pivot.add(leaf);
      this.root.add(pivot);
      spot.doors.push({ pivot, base: pv.rot, open: pv.open });
    }
    if (spot.doors.length) spot.object = spot.doors[0].pivot;
    else this.root.add(spot.object);
    return spot;
  }

  _placeDoor(door, e, roomId, corridorId) {
    const L = this.layout;
    const ei = L.edgeInfo(e);
    const [ra] = L.edgeRooms(e);
    const roomOnA = ra === roomId;
    const n = ei.horiz ? { x: 0, z: roomOnA ? -1 : 1 } : { x: roomOnA ? -1 : 1, z: 0 };
    const t = ei.horiz ? { x: 1, z: 0 } : { x: 0, z: 1 };
    const hs = door.hingeSign;
    const c = { x: ei.mx, z: ei.mz };
    const hinge = { x: c.x - t.x * 0.58 * hs, z: c.z - t.z * 0.58 * hs };
    const dir = { x: t.x * hs, z: t.z * hs };
    const th0 = Math.atan2(-dir.z, dir.x);
    const sgn = (-Math.sin(th0) * n.x - Math.cos(th0) * n.z) >= 0 ? 1 : -1;
    door.edge = e;
    door.horiz = ei.horiz;
    door.n = n;
    door.baseRot = th0;
    door.openAngle = sgn * 1.72;
    door.ajarAngle = sgn * 0.75;
    door.position.set(c.x, 0, c.z);
    door.yaw = Math.atan2(-n.x, -n.z);
    door.roomA = this.rooms[corridorId] || null;
    door.roomB = this.rooms[roomId] || null;
    if (!door.leaf) {
      door.leaf = this.kit.makeObject('door_leaf', door.kind === 'room000' ? this._door000Material() : null);
      door.pivot.add(door.leaf);
      this.root.add(door.pivot);
    }
    door.pivot.position.set(hinge.x, 0, hinge.z);
    door.pivot.rotation.y = th0 + door.angle;
    door.collider = ei.horiz
      ? { minX: c.x - 0.6, maxX: c.x + 0.6, minZ: c.z - 0.1, maxZ: c.z + 0.1, kind: 'door', door, h: 99 }
      : { minX: c.x - 0.1, maxX: c.x + 0.1, minZ: c.z - 0.6, maxZ: c.z + 0.6, kind: 'door', door, h: 99 };
    door.interactable = door.interactable || {
      id: door.id, kind: 'door', position: new THREE.Vector3(), range: PLAYER.interactRange, object: door.pivot, door,
      getPrompt: () => (door.isLocked ? 'Locked' : door.isOpen ? 'Close door' : 'Open door'),
      interact: () => {
        if (door.isLocked) {
          this.events?.emit('door:locked', { door });
          this.events?.emit('noise', { position: door.position, radius: 4, source: 'door-rattle' });
          return;
        }
        door.toggle('player');
      },
    };
    door.interactable.position.set(c.x, 1.1, c.z);
  }

  _door000Material() {
    if (!this._mat000) {
      const src = this.kit.materials.get('m_door');
      this._mat000 = src.clone();
      this._mat000.color.setRGB(0.42, 0.22, 0.2);
      this._mat000.onBeforeCompile = src.onBeforeCompile;
      this._mat000.customProgramCacheKey = src.customProgramCacheKey;
    }
    return this._mat000;
  }

  _buildEntrance() {
    const L = this.layout;
    const e = L.entranceEdge;
    if (e < 0) return;
    const ei = L.edgeInfo(e);
    // inside is the -z side (reception is above the outer edge at z = H*CELL)
    const n = { x: 0, z: -1 };
    const rot = Math.atan2(n.x, n.z);
    const leaves = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(ei.mx + side * 0.99, 0, ei.mz);
      const leaf = this.kit.makeObject('entrance_leaf');
      if (side < 0) leaf.scale.z = -1; // mirror so the push bar faces inside
      pivot.add(leaf);
      // leaf extends +X from hinge; left hinge (side -1) points +x, right hinge points -x
      pivot.rotation.y = side < 0 ? 0 : Math.PI;
      pivot.userData.base = pivot.rotation.y;
      pivot.userData.side = side;
      this.root.add(pivot);
      leaves.push(pivot);
    }
    const chain = this.kit.makeObject('entrance_chain');
    chain.position.set(ei.mx, 0, ei.mz);
    chain.rotation.y = Math.PI; // chain modelled on the -Y (Blender) side -> face inside (-z)
    this.root.add(chain);
    this.entrance = { leaves, chain, state: 'locked', anim: 0, edge: e };
    this._entranceRot = rot;
  }

  setExitState(state) {
    if (!this.entrance) return;
    this.entrance.state = state;
    this.entrance.chain.visible = state === 'locked';
  }

  // ------------------------------------------------------------------------------- grids
  _inside(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const r = this.layout.roomAt(cx, cz);
    if (r < 0) return false;
    if (!this.room000Revealed && this.room000 && r === this.room000.id) return false;
    return true;
  }

  _rasterRegion(x0, z0, x1, z1) {
    this.los.rasterize(this.colliders, this.doors, x0, z0, x1, z1);
    this.navb.rasterize(this.colliders, this.doors, ENEMY.radius, (x, z) => this._inside(x, z), x0, z0, x1, z1);
  }

  _rasterAll() {
    this._rasterRegion(-1, -1, this.bounds.maxX + 1, this.bounds.maxZ + 1);
    this.navb.nav.version++;
  }

  getNav() { return this.navb ? this.navb.nav : null; }

  // ------------------------------------------------------------------------------- gameplay placement
  _walkPoint(x, z, maxDist = 1.6) {
    const i = this.navb.nearestWalkable(x, z, maxDist);
    if (i < 0) return null;
    const nav = this.navb.nav;
    const c = i % nav.cols, r = (i - c) / nav.cols;
    return new THREE.Vector3(nav.originX + (c + 0.5) * nav.res, 0, nav.originZ + (r + 0.5) * nav.res);
  }

  _roomOfCell(cx, cz) { const r = this.layout.roomAt(cx, cz); return r >= 0 ? this.rooms[r] : null; }

  _placeGameplay(rng) {
    const L = this.layout;
    const reception = this.rooms.find((r) => r.type === 'reception');
    const recL = reception.layout;
    // exit: inside the entrance
    const ei = L.edgeInfo(L.entranceEdge);
    const exitPos = new THREE.Vector3(ei.mx, 0, ei.mz - 1.3);
    this.exit = { position: exitPos, yaw: Math.atan2(-0, -1), room: reception };
    // the exit faces +z (towards the doors / outside): yaw such that forward = (0,0,1) -> yaw = PI
    this.exit.yaw = Math.PI;
    // cell distances from the exit
    const distFrom = (room) => L.cellDistances(room.cells[0].cx, room.cells[0].cz, { room000Open: true });
    const dExit = distFrom(reception);
    const dRoom = (dist, room) => Math.min(...room.cells.map((c) => (dist[L.idx(c.cx, c.cz)] >= 0 ? dist[L.idx(c.cx, c.cz)] : 999)));
    // player spawn: classroom farthest from the exit, on a cell the nav flood reaches from the exit
    const reach = this._reachable();
    const classes = this.rooms.filter((r) => r.type === 'classroom');
    classes.sort((a, b) => dRoom(dExit, b) - dRoom(dExit, a));
    let pSpawn = null;
    let pRoom = null;
    for (const room of classes) {
      const data = this._roomData.get(room.id);
      const cands = data.out.spawns.filter((sp) => sp.kind === 'player');
      for (const sp of cands) {
        if (this.isWalkable(sp.x, sp.z, PLAYER.radius + 0.15) && this._pointReached(reach, sp, 1.0)) { pSpawn = new THREE.Vector3(sp.x, 0, sp.z); break; }
      }
      if (!pSpawn) {
        const w = this._walkPoint(room.center.x, room.center.z, 2.5);
        if (w && this.getRoomAt(w.x, w.z) === room && this._pointReached(reach, w, 0.3)) pSpawn = w;
      }
      if (pSpawn) { pRoom = room; break; }
    }
    if (!pSpawn) { this._failReason = 'no player spawn'; return false; }
    // face the room's door
    const pd = this.doors.find((d) => d.roomB === pRoom) || null;
    const look = pd ? { x: pd.position.x - pSpawn.x, z: pd.position.z - pSpawn.z } : { x: pRoom.center.x - pSpawn.x, z: pRoom.center.z - pSpawn.z };
    this.playerSpawn = { position: pSpawn, yaw: Math.atan2(-look.x, -look.z), room: pRoom };
    const dPlayer = distFrom(pRoom);
    // items: keycard (library / reception), fuse (storage / science lab) - far apart and away from the player
    const itemPos = (room) => {
      const data = this._roomData.get(room.id);
      const surf = data.out.surfaces.slice().sort((a, b) => (b.prio || 0) - (a.prio || 0));
      for (const s of surf) {
        if (this._pointReached(reach, s, 1.4)) return new THREE.Vector3(s.x, s.y, s.z);
      }
      // fallback: the open floor spot nearest the middle of the room (the first free cell scanned
      // from a corner was always tucked behind the boxes), preferring one with room around it
      const b = room.bounds;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      let bestP = null, bestD = Infinity;
      for (let z = b.minZ + 1; z < b.maxZ - 0.5; z += 0.5) {
        for (let x = b.minX + 1; x < b.maxX - 0.5; x += 0.5) {
          const i = this.navb.cellOf(x, z);
          if (i < 0 || !reach[i] || !this.isWalkable(x, z, 0.3)) continue;
          const d = (x - cx) ** 2 + (z - cz) ** 2 + (this.isWalkable(x, z, 0.7) ? 0 : 25);
          if (d < bestD) { bestD = d; bestP = new THREE.Vector3(x, 0, z); }
        }
      }
      return bestP;
    };
    const kc = this.rooms.filter((r) => r.type === 'library' || r.type === 'reception').map((r) => ({ r, p: itemPos(r) })).filter((c) => c.p);
    const fc = this.rooms.filter((r) => r.type === 'storage' || r.type === 'science_lab').map((r) => ({ r, p: itemPos(r) })).filter((c) => c.p);
    let best = null;
    for (const k of kc) {
      const dk = distFrom(k.r);
      for (const f of fc) {
        const dkf = dRoom(dk, f.r) * CELL;
        const eu = k.p.distanceTo(f.p);
        const dp = Math.min(k.p.distanceTo(pSpawn), f.p.distanceTo(pSpawn));
        const score = dkf * 0.6 + eu + 0.4 * dp + (k.r.type === 'library' ? 4 : 0) + rng.next();
        if (!best || score > best.score) best = { k: k.r, f: f.r, kp: k.p, fp: f.p, score };
      }
    }
    if (!best) { this._failReason = 'no item rooms'; return false; }
    const keycard = best.kp;
    const fuse = best.fp;
    let key = null;
    if (this.room000) {
      const d000 = this._roomData.get(this.room000.id);
      const chair = d000.out.surfaces.find((sf) => sf.kind === 'chair');
      key = chair ? new THREE.Vector3(chair.x, chair.y, chair.z) : this.room000.center.clone().setY(0);
    }
    if (!keycard || !fuse || !key) { this._failReason = 'item placement'; return false; }
    this.itemSpawns = { keycard, fuse, key };
    this.itemRooms = { keycard: best.k, fuse: best.f, key: this.room000 };
    // patrol points
    const pts = [];
    const seen = new Set();
    for (const room of this.rooms) {
      if (room.type === 'room000') continue;
      const data = this._roomData.get(room.id);
      for (const sp of data.out.spawns) {
        if (sp.kind !== 'patrol') continue;
        const w = this._walkPoint(sp.x, sp.z, 1.8);
        if (!w) continue;
        const key2 = (w.x * 2) + ',' + (w.z * 2);
        if (seen.has(key2)) continue;
        seen.add(key2);
        w.userData = room.id;
        pts.push(w);
      }
    }
    this.patrolPoints = pts;
    // enemy spawn: far corridor patrol point, not in LOS of the player
    const eye = _v.copy(pSpawn).setY(PLAYER.eyeHeight);
    let bestE = null;
    for (const p of pts) {
      const room = this.getRoomAt(p.x, p.z);
      if (!room || !room.isCorridor) continue;
      const cd = dPlayer[L.idx(Math.floor(p.x / CELL), Math.floor(p.z / CELL))];
      const d = (cd >= 0 ? cd * 4 : 0) + p.distanceTo(pSpawn) * 0.5;
      if (d < 24) continue;
      if (this.lineOfSight(eye, new THREE.Vector3(p.x, 2.2, p.z))) continue;
      if (!bestE || d > bestE.d) bestE = { p, d };
    }
    if (!bestE) { this._failReason = 'no enemy spawn'; return false; }
    const toward = { x: pSpawn.x - bestE.p.x, z: pSpawn.z - bestE.p.z };
    this.enemySpawn = { position: bestE.p.clone(), yaw: Math.atan2(-toward.x, -toward.z) };
    // hiding spots
    this.hidingSpots = [];
    for (const [, data] of this._roomData) {
      for (const h of data.hides) this.hidingSpots.push(h);
    }
    // notes on spare surfaces
    this._makeNotes(rng);
    return true;
  }

  _makeNotes(rng) {
    for (const n of this._notes || []) this.root.remove(n.mesh);
    this._notes = [];
    const paper = this.kit.materials.get('m_paper');
    const surfaces = [];
    for (const room of this.rooms) {
      if (room.type === 'room000' || room === this.itemRooms.keycard || room === this.itemRooms.fuse) continue;
      const data = this._roomData.get(room.id);
      for (const s of data.out.surfaces) surfaces.push({ ...s, room });
    }
    rng.shuffle(surfaces);
    const texts = rng.shuffle(NOTES.slice());
    const count = Math.min(4, surfaces.length);
    if (!this._noteGeo) {
      this._noteGeo = new THREE.PlaneGeometry(0.21, 0.3);
      this._noteGeo.rotateX(-Math.PI / 2);
      const uv = this._noteGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + uv.getX(i) * 0.48, 0.02 + uv.getY(i) * 0.46);
    }
    for (let i = 0; i < count; i++) {
      const s = surfaces[i];
      if (!this._walkPoint(s.x, s.z, 1.4)) continue;
      const mesh = new THREE.Mesh(this._noteGeo, paper);
      mesh.position.set(s.x + rng.range(-0.1, 0.1), s.y + 0.004, s.z + rng.range(-0.1, 0.1));
      mesh.rotation.y = rng.range(0, Math.PI * 2);
      this.root.add(mesh);
      const text = texts[i % texts.length];
      const note = {
        id: 'note' + i, kind: 'note', position: mesh.position.clone().setY(s.y + 0.05), range: PLAYER.interactRange, object: mesh,
        getPrompt: () => 'Read note',
        interact: () => this.events?.emit('subtitle', { text, duration: 7, speaker: 'Note' }),
        text, mesh,
      };
      this._notes.push(note);
    }
  }

  // ------------------------------------------------------------------------------- validation
  /** Flood fill the nav grid from the exit and check everything important is reachable. */
  _reachable(extraStarts = []) {
    const nb = this.navb;
    const starts = [nb.nearestWalkable(this.exit.position.x, this.exit.position.z, 2.0), ...extraStarts];
    this._mark = nb.flood(starts, this._mark);
    return this._mark;
  }

  _pointReached(mark, p, maxDist = 1.6) {
    const i = this.navb.nearestWalkable(p.x, p.z, maxDist);
    return i >= 0 && mark[i] === 1;
  }

  _roomReached(mark, room) {
    const nav = this.navb.nav;
    const b = room.bounds;
    const c0 = Math.floor((b.minX - nav.originX) / nav.res), c1 = Math.floor((b.maxX - nav.originX) / nav.res);
    const r0 = Math.floor((b.minZ - nav.originZ) / nav.res), r1 = Math.floor((b.maxZ - nav.originZ) / nav.res);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * nav.cols + c;
        if (mark[i]) {
          const x = nav.originX + (c + 0.5) * nav.res, z = nav.originZ + (r + 0.5) * nav.res;
          if (this.getRoomAt(x, z) === room) return true;
        }
      }
    }
    return false;
  }

  /** Full level check (used at generation and by the test page). opts.withRoom000 temporarily reveals. */
  checkLevel(opts = {}) {
    const res = { ok: true, problems: [] };
    const mark = this._reachable();
    const need = (name, p, d = 1.6) => { if (!p || !this._pointReached(mark, p, d)) { res.ok = false; res.problems.push(name); } };
    if (opts.spawns !== false) {
      need('playerSpawn', this.playerSpawn?.position);
      need('enemySpawn', this.enemySpawn?.position);
    }
    need('keycard', this.itemSpawns?.keycard);
    need('fuse', this.itemSpawns?.fuse);
    need('exit', this.exit?.position, 2.0);
    for (const room of this.rooms) {
      if (room.type === 'room000' && !this.room000Revealed) continue;
      if (!this._roomReached(mark, room)) { res.ok = false; res.problems.push('room:' + room.name); }
    }
    if (this.room000) {
      if (this.room000Revealed) need('key', this.itemSpawns?.key);
      else {
        const r0 = this.layout.room000;
        const ei = this.layout.edgeInfo(r0.edge);
        const corr = this.rooms[r0.corridor];
        const p = new THREE.Vector3(ei.mx, 0, ei.mz);
        const dx = corr.center.x - p.x, dz = corr.center.z - p.z;
        if (ei.horiz) p.z += Math.sign(dz) * 0.9; else p.x += Math.sign(dx) * 0.9;
        need('room000-entrance', p, 1.2);
      }
    }
    return res;
  }

  _validate() {
    // 1) everything reachable with Room 000 sealed
    let r = this.checkLevel();
    if (!r.ok) { this._failReason = 'reach: ' + r.problems.join(','); return false; }
    // 2) temporarily reveal Room 000 and check the key
    if (this.room000) {
      const undo = this._revealData();
      this._rasterRoom000();
      r = this.checkLevel();
      undo();
      this._rasterRoom000();
      if (!r.ok) { this._failReason = 'room000: ' + r.problems.join(','); return false; }
    }
    // 3) hiding spots: exit positions must be reachable & clear for the player
    const mark = this._reachable();
    this.hidingSpots = this.hidingSpots.filter((h) => {
      const ok = this.isWalkable(h.exitPosition.x, h.exitPosition.z, PLAYER.radius) && this._pointReached(mark, h.exitPosition, 1.0);
      h.disabled = !ok;
      return ok;
    });
    if (this.hidingSpots.length < 8) { this._failReason = 'hiding spots ' + this.hidingSpots.length; return false; }
    // 4) patrol points reachable
    this.patrolPoints = this.patrolPoints.filter((p) => this._pointReached(mark, p, 0.6));
    if (this.patrolPoints.length < 8) { this._failReason = 'patrol points'; return false; }
    return true;
  }

  _rasterRoom000() {
    const b = this.room000.bounds;
    const ei = this.layout.edgeInfo(this.layout.room000.edge);
    this._rasterRegion(Math.min(b.minX, ei.x0) - 2, Math.min(b.minZ, ei.z0) - 2, Math.max(b.maxX, ei.x1) + 2, Math.max(b.maxZ, ei.z1) + 2);
  }

  /** Keep patrol points on reachable cells after the school changed (mutates the array in place). */
  refreshPatrolPoints() {
    const mark = this._reachable();
    const nav = this.navb.nav;
    const keep = [];
    for (const p of this.patrolPoints) {
      if (this._pointReached(mark, p, 0.6)) { keep.push(p); continue; }
      // re-snap to the nearest reached cell within 3 m
      const c = Math.floor((p.x - nav.originX) / nav.res), r = Math.floor((p.z - nav.originZ) / nav.res);
      let best = -1, bd = Infinity;
      for (let dz = -6; dz <= 6; dz++) {
        for (let dx = -6; dx <= 6; dx++) {
          const cc = c + dx, rr = r + dz;
          if (cc < 0 || rr < 0 || cc >= nav.cols || rr >= nav.rows) continue;
          const i = rr * nav.cols + cc;
          if (!mark[i]) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best >= 0) {
        const cc = best % nav.cols, rr = (best - cc) / nav.cols;
        p.set(nav.originX + (cc + 0.5) * nav.res, 0, nav.originZ + (rr + 0.5) * nav.res);
        keep.push(p);
      }
    }
    this.patrolPoints.length = 0;
    for (const p of keep) this.patrolPoints.push(p);
  }

  _rasterEdgeRegion(e, margin = 2) {
    const ei = this.layout.edgeInfo(e);
    this._rasterRegion(Math.min(ei.x0, ei.x1) - margin, Math.min(ei.z0, ei.z1) - margin, Math.max(ei.x0, ei.x1) + margin, Math.max(ei.z0, ei.z1) + margin);
  }

  // ------------------------------------------------------------------------------- Room 000
  /** Data-level reveal (edge -> door, colliders). Returns undo fn. Used for validation and the real reveal. */
  _revealData() {
    const L = this.layout;
    const r0 = L.room000;
    const prevType = L.edgeType[r0.edge];
    const prevRevealed = this.room000Revealed;
    L.edgeType[r0.edge] = ET.DOOR;
    this.room000Revealed = true;
    const oldCols = this.colliders.get('edge:' + r0.edge);
    const out = this.dresser.dressEdge(r0.edge);
    this.colliders.set('edge:' + r0.edge, out.colliders);
    return () => {
      L.edgeType[r0.edge] = prevType;
      this.room000Revealed = prevRevealed;
      this.colliders.set('edge:' + r0.edge, oldCols);
    };
  }

  revealRoom000() {
    if (this.room000Revealed || !this.room000) return;
    const L = this.layout;
    const r0 = L.room000;
    this._revealData();
    // visuals: door frames on both sides + pillars
    this._dressEdgeOwner(r0.edge);
    for (const [vx, vz] of this._edgeVertices(r0.edge)) this._dressVertexOwner(vx, vz);
    // the door itself (dark, old) + sign plate
    const door = new Door(this, this.doors.length, { kind: 'room000', hingeSign: 1 });
    door.kind = 'room000';
    this.doors.push(door);
    L.doors.push({ id: L.doors.length, edge: r0.edge, corridor: r0.corridor, room: r0.roomId, kind: 'door', cx: r0.cx, cz: r0.cz, locked: false, start: 'closed' });
    L.edgeDoor[r0.edge] = L.doors.length - 1;
    this._placeDoor(door, r0.edge, r0.roomId, r0.corridor);
    door.pivot.rotation.y = door.baseRot;
    this.colliders.set('door:' + door.index, [door.collider]);
    this._signOwner(r0.edge);
    this.static.flush();
    this._rasterRoom000();
    this.navb.nav.version++;
    this.refreshPatrolPoints();
    this.lights.setRoomEnabled(this.room000.id, true);
    this._rebuildInteractables();
    this.events?.emit('world:room000', { position: door.position.clone() });
  }

  // ------------------------------------------------------------------------------- queries
  moveCircle(pos, delta, radius, out) {
    out = out || new THREE.Vector3();
    if (!this.colliders) return out.set(pos.x + delta.x, pos.y, pos.z + delta.z);
    const dx = delta.x, dz = delta.z;
    const len = Math.hypot(dx, dz);
    const step = Math.max(0.05, radius * 0.5);
    const steps = Math.min(64, Math.max(1, Math.ceil(len / step)));
    _p.x = pos.x;
    _p.z = pos.z;
    const sx = dx / steps, sz = dz / steps;
    resolveCircle(this.colliders, _p, radius);
    for (let s = 0; s < steps; s++) {
      _p.x += sx;
      _p.z += sz;
      resolveCircle(this.colliders, _p, radius);
    }
    // never leave the building footprint
    if (_p.x < 0.15) _p.x = 0.15;
    if (_p.z < 0.15) _p.z = 0.15;
    if (_p.x > this.bounds.maxX - 0.15) _p.x = this.bounds.maxX - 0.15;
    if (_p.z > this.bounds.maxZ - 0.15) _p.z = this.bounds.maxZ - 0.15;
    out.set(_p.x, pos.y, _p.z);
    return out;
  }

  isWalkable(x, z, radius = 0) {
    if (!this.layout || !this._inside(x, z)) return false;
    return !circleBlocked(this.colliders, x, z, radius);
  }

  lineOfSight(a, b) {
    if (!this.los) return true;
    return this.los.query(a.x, a.y, a.z, b.x, b.y, b.z, this.doors);
  }

  getRoomAt(x, z) {
    if (!this.layout) return null;
    const r = this.layout.roomAt(Math.floor(x / CELL), Math.floor(z / CELL));
    return r >= 0 ? this.rooms[r] : null;
  }

  // ------------------------------------------------------------------------------- interactables
  _rebuildInteractables() {
    const list = [];
    for (const d of this.doors) if (d.active) list.push(d.interactable);
    for (const h of this.hidingSpots) {
      if (h.disabled) continue;
      if (!h.interactable) {
        h.interactable = {
          id: h.id, kind: 'hide', position: h.front, range: PLAYER.interactRange, object: h.object, spot: h,
          getPrompt: (game) => ((game || this.game)?.player?.isHidden || h.occupied || h.remoteBy ? null : 'Hide'),
          interact: (game) => (h.remoteBy ? false : (game || this.game)?.player?.enterHide?.(h)), // remoteBy: a co-op teammate is in there
        };
      }
      list.push(h.interactable);
    }
    for (const n of this._notes || []) list.push(n);
    this._interactables = list;
  }

  getInteractables() { return this._interactables; }

  // ------------------------------------------------------------------------------- doors
  _doorEvent(door, type, by) {
    this.events?.emit(type, { door, by });
    if (by === 'player') this.events?.emit('noise', { position: door.position, radius: 8, source: 'door' });
  }

  _entityPositions() {
    const g = this.game;
    const out = this._ents || (this._ents = []);
    out.length = 0;
    if (g.player && g.player.position) out.push(g.player.position, PLAYER.radius);
    if (g.enemy && g.enemy.position) out.push(g.enemy.position, ENEMY.radius);
    g.coop?.pushEntities?.(out); // co-op: the other players
    return out;
  }

  _doorBlocked(door) {
    const ents = this._entityPositions();
    for (let i = 0; i < ents.length; i += 2) {
      const p = ents[i];
      const r = ents[i + 1];
      const c = door.collider;
      const cx = Math.max(c.minX, Math.min(p.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(p.z, c.maxZ));
      if ((p.x - cx) ** 2 + (p.z - cz) ** 2 < (r + 0.05) ** 2) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------- per frame
  update(dt, game = this.game) {
    if (!this.layout) return;
    dt = Math.min(dt, 0.1);
    // doors
    const ents = this._entityPositions();
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      // brushing past an ajar door pushes it fully open
      if (d.isOpen && Math.abs(d.target) < Math.abs(d.openAngle) * 0.9) {
        for (let k = 0; k < ents.length; k += 2) {
          const p = ents[k];
          if ((p.x - d.position.x) ** 2 + (p.z - d.position.z) ** 2 < 0.9 * 0.9) {
            d.target = d.openAngle;
            this.events?.emit('door:open', { door: d, by: k === 0 ? 'player' : k === 2 ? 'enemy' : 'remote', push: true });
            break;
          }
        }
      }
      if (d.angle !== d.target) {
        const diff = d.target - d.angle;
        const sp = 3.2 * dt;
        d.angle = Math.abs(diff) <= sp ? d.target : d.angle + Math.sign(diff) * sp;
        d.pivot.rotation.y = d.baseRot + d.angle;
      }
    }
    // hiding spot doors
    for (let i = 0; i < this.hidingSpots.length; i++) {
      const h = this.hidingSpots[i];
      if (h.anim < 0) continue;
      h.anim += dt / 0.9;
      const t = h.anim;
      const f = t < 0.3 ? t / 0.3 : t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.4);
      for (const d of h.doors) {
        d.pivot.rotation.y = d.base + d.open * Math.sin(f * Math.PI / 2);
        d.pivot.visible = true;
      }
      if (t >= 1) {
        h.anim = -1;
        // while someone is inside, the door leaf is hidden so the camera can see out (UI may draw vent slats)
        for (const d of h.doors) { d.pivot.rotation.y = d.base; d.pivot.visible = !h.occupied; }
      }
    }
    // entrance doors swing open after unlock
    if (this.entrance && this.entrance.state !== 'locked' && this.entrance.anim < 1) {
      this.entrance.anim = Math.min(1, this.entrance.anim + dt * 0.6);
      const a = this.entrance.anim * (this.entrance.state === 'open' ? 1.3 : 0.25);
      for (const pv of this.entrance.leaves) pv.rotation.y = pv.userData.base + (pv.userData.side < 0 ? -a : a);
    }
    // lights follow the camera (falls back to the player)
    const cam = game?.camera || this.game.camera;
    const ref = cam ? cam.position : game?.player?.position;
    const room = ref ? this.getRoomAt(ref.x, ref.z) : null;
    this.lights.update(dt, ref, room);
    this.env.update(dt);
    this.graffiti?.update(dt, game || this.game);
  }

  setLightsMode(mode) {
    this.lightsMode = mode;
    this.lights.setMode(mode);
    this.env.setMode(mode);
  }

  // ------------------------------------------------------------------------------- transformations
  transform(opts = {}) {
    return this.transformer.run(opts);
  }

  // ------------------------------------------------------------------------------- debug / dispose
  getDebugInfo() {
    return {
      seed: this.seed, layoutSeed: this.layoutSeed, W: this.layout?.W, H: this.layout?.H,
      rooms: this.rooms.length, doors: this.doors.length, hidingSpots: this.hidingSpots.length,
      patrolPoints: this.patrolPoints.length, fixtures: this.lights.fixtures.length,
      ...this.stats, static: this.static?.computeStats(),
    };
  }

  _disposeLevel() {
    // hiding place ids count from 1 in every school: co-op names them in messages ('hd'), so the host's
    // and a guest's ids must match whatever each of them built before (a solo run, a restart)
    this._hideCounter = 0;
    this.signs?.clear();
    this.election?.clearBanner();
    this.graffiti?.clear();
    if (this._roomData) for (const [, d] of this._roomData) this._disposeRoomExtras(d);
    this._roomData = new Map();
    if (this.static) this.static.dispose();
    this.static = null;
    for (const d of this.doors) this.root.remove(d.pivot);
    this.doors = [];
    for (const n of this._notes || []) this.root.remove(n.mesh);
    this._notes = [];
    if (this.entrance) {
      for (const l of this.entrance.leaves) this.root.remove(l);
      this.root.remove(this.entrance.chain);
      this.entrance = null;
    }
    this.lights.dispose();
    this.hidingSpots = [];
    this.patrolPoints = [];
    this._interactables = [];
    this.layout = null;
    this.transformer.reset();
  }

  dispose() {
    this._disposeLevel();
    for (const off of this._subs) off();
    this._subs = [];
    this.env.detach();
    this.scene.remove(this.root);
  }
}
