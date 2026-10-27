// LAST BELL - the two dog-leg staircases between floor 0 and floor 1 (Second Floor update). Owned by ENV.
//
// Both stairwells are 1 x 2 cells (4 x 8 m) at the same cells on both floors (config STAIRS). Each one
// has its own local frame: v runs towards the door end (the doors of both floors are stacked there),
// u runs across. The plan, in metres from the stairwell centre:
//
//      v = +4  ------ door wall (floor 0 door below, floor 1 door above) ------
//      v 2.2..3.9   entrance landing: y = 0 on floor 0, the L1 landing at y = 3.6 on floor 1
//      v -1.32..2.2 flight 1 (u < 0) rises 0 -> 1.8 away from the door, flight 2 (u > 0) rises
//                   1.8 -> 3.6 back towards it; a solid spine wall (|u| < 0.1) between them
//      v -3.9..-1.32 half landing, y = 1.8, under the half-landing window in the far wall
//
// Movement is a smooth ramp along the step nosings (groundAt), never steps. Which floor's colliders
// apply is the walker's floor by height (y > FLOOR_SPLIT_Y is floor 1), so the switch happens on the
// half landing. Per floor, the stairwell blocks what that floor can't stand on: floor 0 has the
// enclosure under flight 2, floor 1 the railing over the flight-1 void. Enemies also hit a bulkhead at
// the foot of flight 1 (floor 0) and the top of flight 2 (floor 1): moveCircle(..., { enemy: true }).
// Nav: nav.zone = 1 on the flights and the half landing of both floors' grids.
//
// Doors: floor 0 Stair A is an ordinary door, floor 0 Stair B an opening with a chained chain-link gate;
// floor 1 Stair A is an opening with a roll-down security grille (+ red/green lamp), floor 1 Stair B an
// ordinary door. setState('A', 'locked'|'open'), setState('B', 'chained'|'open'): purely physical
// (colliders, nav, visuals, the stairwell's emergency lighting). Gameplay events belong to GAME.

import * as THREE from './lib/three/three.module.js';
import { CELL, FLOOR_Y, STAIRS } from './config.js';
import { placeMatrix } from './world-kit.js';
import { STAIR_SIGN } from './security-content.js';

export const STAIR = {
  inner: 1.9, // half width to the shaft wall faces
  spine: 0.1, // half thickness of the wall between the flights
  landV: 2.2, // landings: v >= landV
  halfV: -1.32, // half landing: v <= halfV
  halfY: 1.8,
  rise: 0.15,
  run: 0.32,
  risers: 12,
  // the walking ramp follows the nosing line: it starts one tread out on the landing below and
  // reaches the next level at the top riser (feet ride the nosings instead of sinking into treads)
  ramp: 3.84,
  topY: FLOOR_Y[1],
};
const STATES = { A: ['locked', 'open'], B: ['chained', 'open'] };
const LAMP_RED = new THREE.Color(0xff2a10);
const LAMP_GREEN = new THREE.Color(0x30ff60);

function frameFor(id) {
  const S = STAIRS[id];
  const V = { x: S.hall[0] - S.door[0], z: S.hall[1] - S.door[1] };
  let cx = 0, cz = 0, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of S.cells) {
    cx += (x + 0.5) * CELL;
    cz += (z + 0.5) * CELL;
    minX = Math.min(minX, x * CELL); maxX = Math.max(maxX, x * CELL + CELL);
    minZ = Math.min(minZ, z * CELL); maxZ = Math.max(maxZ, z * CELL + CELL);
  }
  cx /= S.cells.length;
  cz /= S.cells.length;
  const far = S.cells.find(([x, z]) => x !== S.door[0] || z !== S.door[1]);
  return {
    id, main: !!S.main, V, U: { x: V.z, z: -V.x }, cx, cz, rot: Math.atan2(V.x, V.z),
    minX, maxX, minZ, maxZ, cells: S.cells, doorCell: S.door, hallCell: S.hall, farCell: far,
    door: { x: (S.door[0] + 0.5) * CELL + V.x * CELL / 2, z: (S.door[1] + 0.5) * CELL + V.z * CELL / 2 },
  };
}

export class StairSystem {
  constructor(world) {
    this.world = world;
    this.frames = { A: frameFor('A'), B: frameFor('B') };
    this.list = [this.frames.A, this.frames.B];
    this.state = { A: 'locked', B: 'chained' };
    this.objects = [];
    this.fixtureIdx = { A: [], B: [] };
    this._anim = { A: 0, B: 0 }; // 0 closed .. 1 open (visual)
    this._lampMat = null;
  }

  // ------------------------------------------------------------------------------- frames
  /** The stairwell frame containing (x, z), or null. Same cells on both floors. */
  stairAt(x, z) {
    for (const f of this.list) if (x >= f.minX && x < f.maxX && z >= f.minZ && z < f.maxZ) return f;
    return null;
  }

  local(f, x, z, out = {}) {
    const dx = x - f.cx, dz = z - f.cz;
    out.u = dx * f.U.x + dz * f.U.z;
    out.v = dx * f.V.x + dz * f.V.z;
    return out;
  }

  toWorld(f, u, v, out = {}) {
    out.x = f.cx + u * f.U.x + v * f.V.x;
    out.z = f.cz + u * f.U.z + v * f.V.z;
    return out;
  }

  /** World AABB of a local rect (the frames are axis aligned, so any rect maps to an AABB). */
  rect(f, u0, u1, v0, v1, extra = {}) {
    const a = this.toWorld(f, u0, v0), b = this.toWorld(f, u1, v1);
    return { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z), ...extra };
  }

  /** Layout edge on the far end of the stairwell (the half-landing window wall). */
  farEdge(L, f) {
    const [x, z] = f.farCell;
    return L.edgeBetween(x, z, x - f.V.x, z - f.V.z);
  }

  /** Layout edge of the door end (between the door cell and the hall cell). */
  doorEdge(L, f) {
    return L.edgeBetween(f.doorCell[0], f.doorCell[1], f.hallCell[0], f.hallCell[1]);
  }

  // ------------------------------------------------------------------------------- ground
  /** Walking surface height inside a stairwell, or null outside one. floorHint picks between the two
   *  stacked landings (and the floor-0 landing under L1). */
  groundAt(x, z, floorHint = 0) {
    const f = this.stairAt(x, z);
    if (!f) return null;
    const dx = x - f.cx, dz = z - f.cz;
    const u = dx * f.U.x + dz * f.U.z;
    const v = dx * f.V.x + dz * f.V.z;
    const S = STAIR;
    if (u < 0) {
      // flight 1 side: floor-0 landing -> up to the half landing
      if (floorHint === 1 && v >= S.landV) return S.topY;
      return S.halfY * clamp01((S.landV + S.run - v) / S.ramp);
    }
    // flight 2 side: the floor-0 landing sits under L1
    if (floorHint !== 1 && v >= S.landV) return 0;
    return S.halfY + (S.topY - S.halfY) * clamp01((v - (S.halfV - S.run)) / S.ramp);
  }

  /** On a flight or the half landing (not a landing): the cells enemies never use. */
  isFlight(x, z) {
    const f = this.stairAt(x, z);
    if (!f) return false;
    const dx = x - f.cx, dz = z - f.cz;
    return dx * f.V.x + dz * f.V.z < STAIR.landV;
  }

  // ------------------------------------------------------------------------------- build
  /** Called by world after both floors' colliders exist (and after every generate()). */
  build() {
    const w = this.world;
    this.dispose();
    this.enemyCols = [];
    this.state = { A: 'locked', B: 'chained' };
    this._anim = { A: 0, B: 0 };
    for (const f of this.list) {
      for (let fl = 0; fl < 2; fl++) {
        const F = w.floors[fl];
        if (!F || !F.colliders) continue;
        F.colliders.set('stair:' + f.id, this._colliders(f, fl));
      }
    }
    this._buildEnemyColliders();
    this._applyClosures();
    for (const f of this.list) for (let fl = 0; fl < 2; fl++) if (w.floors[fl]) w._rasterFloorRegion(fl, f.minX - 1, f.minZ - 1, f.maxX + 1, f.maxZ + 1);
    this._buildVisuals();
    this.applyNavZones();
    w.lights?.setEmergency?.('stairA', true);
  }

  _colliders(f, fl) {
    const S = STAIR;
    const out = [this.rect(f, -S.spine, S.spine, S.halfV, S.landV, { kind: 'wall', h: 99 })];
    if (fl === 0) {
      // under flight 2: a solid enclosure (its face is the plain wall you see from the floor-0 landing)
      out.push(this.rect(f, S.spine, S.inner + 0.1, 0.5, S.landV, { kind: 'wall', h: 99 }));
    } else {
      // floor 1: the railing along the L1 edge over the flight-1 void (you can see over it)
      out.push(this.rect(f, -S.inner - 0.1, -S.spine, -1.0, S.landV, { kind: 'prop', h: 1.0, noLos: true }));
    }
    return out;
  }

  _buildEnemyColliders() {
    const w = this.world;
    const S = STAIR;
    for (let fl = 0; fl < 2; fl++) {
      const F = w.floors[fl];
      if (!F || !F.colliders) { this.enemyCols[fl] = null; continue; }
      const cols = new F.colliders.constructor(-1, -1, (F.bounds?.maxX || 60) + 1, (F.bounds?.maxZ || 60) + 1);
      for (const f of this.list) {
        // floor 0: across the foot of flight 1; floor 1: across the top of flight 2 (2.3 m beams over them)
        const r = fl === 0 ? this.rect(f, -S.inner - 0.1, -S.spine, 1.95, 2.3) : this.rect(f, S.spine, S.inner + 0.1, 1.95, 2.3);
        cols.set('bulkhead:' + f.id, [{ ...r, kind: 'wall', h: 99, noLos: true }]);
      }
      this.enemyCols[fl] = cols;
    }
  }

  /** Doorway closures for the current states (shutter on floor 1 A, gate on floor 0 B). */
  _applyClosures() {
    const w = this.world;
    for (const f of this.list) {
      const fl = f.id === 'A' ? 1 : 0;
      const F = w.floors[fl];
      if (!F || !F.colliders) continue;
      const closed = this.state[f.id] !== 'open';
      const owner = 'stair:' + f.id + ':closure';
      if (closed) F.colliders.set(owner, [this.rect(f, -0.66, 0.66, 3.86, 4.14, { kind: 'prop', h: 99, noLos: true, closure: f.id })]);
      else F.colliders.remove(owner);
    }
  }

  /** nav.zone = 1 on the flights + half landing (both floors). Rasterizing never touches the zones. */
  applyNavZones() {
    const w = this.world;
    for (let fl = 0; fl < 2; fl++) {
      const nav = w.getNav?.(fl);
      if (!nav || !nav.zone) continue;
      for (const f of this.list) {
        const c0 = Math.max(0, Math.floor((f.minX - nav.originX) / nav.res));
        const c1 = Math.min(nav.cols - 1, Math.floor((f.maxX - nav.originX) / nav.res));
        const r0 = Math.max(0, Math.floor((f.minZ - nav.originZ) / nav.res));
        const r1 = Math.min(nav.rows - 1, Math.floor((f.maxZ - nav.originZ) / nav.res));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const x = nav.originX + (c + 0.5) * nav.res, z = nav.originZ + (r + 0.5) * nav.res;
            if (this.stairAt(x, z) === f) nav.zone[r * nav.cols + c] = this.isFlight(x, z) ? 1 : 0;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------------------- state
  getState(id) { return this.state[id] || null; }

  /** 'A': 'locked' | 'open'; 'B': 'chained' | 'open'. Physical only (no gameplay events). */
  setState(id, state) {
    if (!STATES[id] || !STATES[id].includes(state)) return false;
    if (this.state[id] === state) return true;
    this.state[id] = state;
    this._applyClosures();
    const f = this.frames[id];
    const fl = id === 'A' ? 1 : 0;
    this.world._rasterFloorRegion?.(fl, f.door.x - 2, f.door.z - 2, f.door.x + 2, f.door.z + 2);
    if (id === 'A') this.world.lights?.setEmergency?.('stairA', state !== 'open');
    if (state !== 'open') this._anim[id] = Math.min(this._anim[id], 0); // closing snaps (only on a reset)
    return true;
  }

  // ------------------------------------------------------------------------------- visuals
  // The stair structure is plain boxes in the stair frame (PS1 stairs are boxes anyway), merged per kit
  // material into one mesh each; kit fittings (lights, EXIT signs) go through the shared static batch.
  _buildVisuals() {
    const w = this.world;
    const kit = w.kit;
    const st = w.sharedStatic;
    const S = STAIR;
    const mat = (n, alt = 'm_concrete') => kit.materials.get(n) || kit.materials.get(alt) || null;
    const M = { con: mat('m_concrete'), wall: mat('m_wall'), ceil: mat('m_ceiling'), metal: mat('m_metal'), fence: mat('m_fence', 'm_metal') };
    const merge = new BoxMerge();
    for (const f of this.list) {
      const map = (u, y, v) => { const p = this.toWorld(f, u, v); return [p.x, y, p.z]; };
      const B = (m, u0, u1, y0, y1, v0, v1, sh) => merge.box(m, map, u0, u1, y0, y1, v0, v1, sh);
      const I = S.inner, P = S.spine;
      B(M.con, -2, 2, -0.02, 0, S.landV, 3.9); // floor-0 landing
      for (let k = 1; k <= S.risers - 1; k++) {
        B(M.con, -I, -P, 0, S.rise * k, S.landV - S.run * k, S.landV - S.run * (k - 1)); // flight 1
        B(M.con, P, I, 0, S.halfY + S.rise * k, S.halfV + S.run * (k - 1), S.halfV + S.run * k); // flight 2 (solid under: the enclosure)
        B(M.wall, -P, P, 0, S.halfY + S.rise * k + 0.95, S.halfV + S.run * (k - 1), S.halfV + S.run * k); // spine wall + balustrade
      }
      B(M.con, -I, I, 0, S.halfY, -3.9, S.halfV); // half landing
      B(M.con, -I, I, 3.2, S.topY, S.landV, 3.9); // L1 slab (its underside is the floor-0 landing ceiling)
      B(M.con, -2, -I, 3.2, S.topY, -3.9, S.landV); // slab band on the shaft walls
      B(M.con, I, 2, 3.2, S.topY, -3.9, S.landV);
      B(M.con, -2, 2, 3.2, S.topY, -4, -3.9);
      B(M.ceil, -2, 2, 6.8, 6.86, -4, 4); // top ceiling
      // floor-1 railing over the flight-1 void
      B(M.metal, -I, -P, S.topY + 0.95, S.topY + 1.0, S.landV - 0.04, S.landV + 0.04);
      B(M.metal, -I, -P, S.topY + 0.45, S.topY + 0.48, S.landV - 0.02, S.landV + 0.02);
      for (let u = -I + 0.05; u < -P; u += 0.45) B(M.metal, u, u + 0.04, S.topY, S.topY + 0.95, S.landV - 0.02, S.landV + 0.02);
      // fittings: under L1, over L1, over the half landing
      const pls = [];
      const put = (node, u, y, v, rot = 0) => {
        if (!kit.has(node)) return;
        const p = this.toWorld(f, u, v);
        pls.push({ node, m: placeMatrix(p.x, y, p.z, f.rot + rot) });
      };
      put('light_fixture', 0, 3.2, 3.05, Math.PI / 2);
      put('light_fixture', 0, 6.8, 3.05, Math.PI / 2);
      put('light_fixture', 0, 6.8, -2.6, Math.PI / 2);
      put('exit_sign', 0, 2.75, 3.6, Math.PI / 2);
      put('exit_sign', 0, S.topY + 2.75, 3.6, Math.PI / 2);
      if (st) st.setOwner('stair:' + f.id, pls, 'S');
    }
    st?.flush();
    const grp = w.root;
    for (const m of merge.meshes()) { grp.add(m); this.objects.push(m); }
    const A = this.frames.A, Bf = this.frames.B;
    // Stair A, floor 1: roll-down grille in the doorway (stair side), housing over it
    const housing = new BoxMerge();
    const at = (f, u, y, v) => { const p = this.toWorld(f, u, v); return [p.x, y, p.z]; };
    housing.box(M.metal, (u, y, v) => at(A, u, y, v), -0.75, 0.75, S.topY + 2.2, S.topY + 2.6, 3.62, 3.88);
    for (const m of housing.meshes()) { grp.add(m); this.objects.push(m); }
    const cur = new BoxMerge();
    cur.box(M.fence, (x, y, z) => [x, y, z], -0.62, 0.62, -2.2, 0, -0.16, -0.12, 'fence');
    cur.box(M.metal, (x, y, z) => [x, y, z], -0.64, 0.64, -0.08, 0, -0.17, -0.11);
    const curtain = new THREE.Group();
    for (const m of cur.meshes()) curtain.add(m);
    const cp = this.toWorld(A, 0, 4.0);
    curtain.position.set(cp.x, S.topY + 2.2, cp.z);
    curtain.rotation.y = A.rot;
    grp.add(curtain);
    this.objects.push(curtain);
    this.shutter = { curtain };
    // the status lamp over the doorway on the corridor side (visible down the Spine)
    if (!this._lampMat) this._lampMat = new THREE.MeshBasicMaterial({ color: LAMP_RED, fog: true });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), this._lampMat);
    const lp = this.toWorld(A, 0, 4.15);
    lamp.position.set(lp.x, S.topY + 2.5, lp.z);
    lamp.rotation.y = A.rot;
    lamp.name = 'stair-lamp';
    grp.add(lamp);
    this.objects.push(lamp);
    this.shutter.lamp = lamp;
    // the plate beside the doorway: says why it is shut and where to open it (green + OPEN once released)
    this._signCv = document.createElement('canvas');
    this._signCv.width = 320;
    this._signCv.height = 128;
    this._signTex = new THREE.CanvasTexture(this._signCv);
    this._signTex.magFilter = THREE.NearestFilter;
    this._signTex.minFilter = THREE.NearestFilter;
    this._signTex.colorSpace = THREE.SRGBColorSpace;
    this._signDrawn = null;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.44), new THREE.MeshBasicMaterial({ map: this._signTex, fog: true }));
    const sp = this.toWorld(A, 1.4, 4.17);
    plate.position.set(sp.x, S.topY + 1.55, sp.z);
    plate.rotation.y = A.rot;
    plate.name = 'stair-a-plate';
    grp.add(plate);
    this.objects.push(plate);
    this._drawSign();
    // Stair B, floor 0: chain-link gate, two leaves hinged on the jambs, swinging into the stairwell
    const leafGeo = new BoxMerge();
    const id3 = (x, y, z) => [x, y, z];
    leafGeo.box(M.fence, id3, 0.03, 0.57, 0.05, 1.95, -0.01, 0.01, 'fence');
    leafGeo.box(M.metal, id3, 0, 0.04, 0, 2.0, -0.02, 0.02);
    leafGeo.box(M.metal, id3, 0.55, 0.59, 0, 2.0, -0.02, 0.02);
    leafGeo.box(M.metal, id3, 0, 0.59, 1.96, 2.0, -0.02, 0.02);
    leafGeo.box(M.metal, id3, 0, 0.59, 0.02, 0.06, -0.02, 0.02);
    leafGeo.box(M.metal, id3, 0, 0.59, 1.0, 1.03, -0.02, 0.02);
    const leafMeshes = leafGeo.meshes();
    const leaves = [];
    for (const side of [-1, 1]) {
      const pv = new THREE.Group();
      const p = this.toWorld(Bf, side * 0.6, 4.0);
      pv.position.set(p.x, 0, p.z);
      pv.rotation.y = Bf.rot + (side < 0 ? 0 : Math.PI);
      pv.userData.base = pv.rotation.y;
      pv.userData.side = side;
      for (const m of leafMeshes) pv.add(side < 0 ? m : m.clone());
      grp.add(pv);
      this.objects.push(pv);
      leaves.push(pv);
    }
    // the chain and padlock, wrapped round the meeting stiles on the corridor side
    const ch = new BoxMerge();
    ch.box(M.metal, id3, -0.09, 0.09, 0.98, 1.1, 0.02, 0.06);
    ch.box(M.metal, id3, -0.04, 0.04, 0.84, 0.98, 0.04, 0.08);
    const chain = new THREE.Group();
    for (const m of ch.meshes()) chain.add(m);
    const gp = this.toWorld(Bf, 0, 4.0);
    chain.position.set(gp.x, 0, gp.z);
    chain.rotation.y = Bf.rot;
    grp.add(chain);
    this.objects.push(chain);
    this.gate = { leaves, chain };
    this._syncVisuals(true);
  }

  _syncVisuals(snap = false) {
    for (const id of ['A', 'B']) {
      const target = this.state[id] === 'open' ? 1 : 0;
      if (snap) this._anim[id] = target;
    }
    this._pose();
  }

  /** Redraw the Stair A plate when the lock changes (red LOCKED / green OPEN). */
  _drawSign() {
    const open = this.state.A === 'open';
    if (!this._signCv || this._signDrawn === open) return;
    this._signDrawn = open;
    const g = this._signCv.getContext('2d');
    const [l1, l2] = open ? STAIR_SIGN.open : STAIR_SIGN.locked;
    g.fillStyle = open ? '#13351f' : '#3a1212';
    g.fillRect(0, 0, 320, 128);
    g.strokeStyle = open ? '#7dff9a' : '#ff8a80';
    g.lineWidth = 4;
    g.strokeRect(5, 5, 310, 118);
    g.fillStyle = g.strokeStyle;
    g.textAlign = 'center';
    g.font = 'bold 23px monospace';
    g.fillText(l1, 160, 55);
    g.font = 'bold 20px monospace';
    g.fillText(l2, 160, 98);
    this._signTex.needsUpdate = true;
  }

  _pose() {
    const a = this._anim.A, b = this._anim.B;
    const c = this.shutter?.curtain;
    if (c) {
      c.scale.y = Math.max(0.03, 1 - a * 0.97); // rolls up into the housing
      c.visible = a < 0.999;
    }
    if (this._lampMat) this._lampMat.color.copy(this.state.A === 'open' ? LAMP_GREEN : LAMP_RED);
    this._drawSign();
    if (this.gate) {
      // left leaf (+X = +u) opens with +rotation, the right one (+X = -u) with -rotation: both into the stairwell
      for (const pv of this.gate.leaves) pv.rotation.y = pv.userData.base + (pv.userData.side < 0 ? 1 : -1) * b * 1.45;
      if (this.gate.chain) this.gate.chain.visible = this.state.B !== 'open';
    }
  }

  update(dt) {
    let moved = false;
    for (const id of ['A', 'B']) {
      const target = this.state[id] === 'open' ? 1 : 0;
      if (this._anim[id] === target) continue;
      const sp = id === 'A' ? 0.45 : 0.9; // the grille rolls up slowly (~2 s), the gate swings in ~1 s
      const d = target - this._anim[id];
      this._anim[id] = Math.abs(d) <= sp * dt ? target : this._anim[id] + Math.sign(d) * sp * dt;
      moved = true;
    }
    if (moved || this._lampDirty) { this._pose(); this._lampDirty = false; }
  }

  // ------------------------------------------------------------------------------- lights
  /** Fixtures for the light system: [{x, y, z, rot, state, roomId, floor, kind, stair, emergency}]. */
  fixtures(roomIdOf) {
    const out = [];
    for (const f of this.list) {
      const at = (u, y, v, floor, kind = 'panel') => {
        const p = this.toWorld(f, u, v);
        out.push({ x: p.x, y, z: p.z, rot: f.rot + Math.PI / 2, state: 'ok', roomId: roomIdOf(f, floor), floor, kind, stair: f.id, emergency: f.id === 'A' ? 'stairA' : undefined });
      };
      at(0, 3.2, 3.05, 0);
      at(0, 6.8, 3.05, 1);
      at(0, 6.8, -2.6, 1);
    }
    return out;
  }

  dispose() {
    for (const o of this.objects) {
      o.parent?.remove(o);
      o.traverse?.((m) => { if (m.isMesh && m.geometry && !m.userData.shared) m.geometry.dispose(); });
    }
    this.objects = [];
    this.shutter = null;
    this.gate = null;
  }
}

function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

// ------------------------------------------------------------------------------------------- boxes
const SHADE = { top: 1.0, bottom: 0.55, side: 0.8 };
/** Axis-aligned boxes merged per material. map(u, y, v) -> [x, y, z] (any axis-aligned frame). */
class BoxMerge {
  constructor() { this.by = new Map(); }

  box(material, map, u0, u1, y0, y1, v0, v1, kind = null) {
    if (!material) return;
    let g = this.by.get(material);
    if (!g) this.by.set(material, (g = { P: [], N: [], U: [], C: [], I: [] }));
    const s = kind === 'fence' ? 1 / 0.64 : 0.5;
    const faces = [
      // [normal axis, sign, corners (u,y,v) x4, uv axes]
      [[1, 0, 0], [[u1, y0, v0], [u1, y0, v1], [u1, y1, v1], [u1, y1, v0]], [2, 1], 'side'],
      [[-1, 0, 0], [[u0, y0, v1], [u0, y0, v0], [u0, y1, v0], [u0, y1, v1]], [2, 1], 'side'],
      [[0, 1, 0], [[u0, y1, v0], [u1, y1, v0], [u1, y1, v1], [u0, y1, v1]], [0, 2], 'top'],
      [[0, -1, 0], [[u0, y0, v1], [u1, y0, v1], [u1, y0, v0], [u0, y0, v0]], [0, 2], 'bottom'],
      [[0, 0, 1], [[u1, y0, v1], [u0, y0, v1], [u0, y1, v1], [u1, y1, v1]], [0, 1], 'side'],
      [[0, 0, -1], [[u0, y0, v0], [u1, y0, v0], [u1, y1, v0], [u0, y1, v0]], [0, 1], 'side'],
    ];
    const o = map(0, 0, 0);
    for (const [n, cs, ax, sh] of faces) {
      const base = g.P.length / 3;
      const wn = map(n[0], n[1], n[2]);
      const nx = wn[0] - o[0], ny = wn[1] - o[1], nz = wn[2] - o[2];
      const pts = cs.map((c) => map(c[0], c[1], c[2]));
      // keep the winding counter-clockwise seen from outside whatever the frame's handedness
      const e1 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
      const e2 = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
      const flip = cx * nx + cy * ny + cz * nz < 0;
      const shade = SHADE[sh];
      for (let i = 0; i < 4; i++) {
        const p = pts[i], c = cs[i];
        g.P.push(p[0], p[1], p[2]);
        g.N.push(nx, ny, nz);
        g.U.push(c[ax[0]] * s, c[ax[1]] * s);
        const ao = sh === 'side' ? 0.75 + 0.25 * Math.min(1, Math.max(0, (p[1] - y0) / 0.6)) : 1;
        g.C.push(shade * ao, shade * ao, shade * ao);
      }
      if (flip) g.I.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else g.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  meshes() {
    const out = [];
    for (const [material, g] of this.by) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.P, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.N, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.U, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.C, 3));
      geo.setIndex(g.I);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, material);
      m.name = 'stairs:' + material.name;
      out.push(m);
    }
    return out;
  }
}
