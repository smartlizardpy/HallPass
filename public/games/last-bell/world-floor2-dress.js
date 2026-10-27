// LAST BELL - Floor 2 room shells, hiding places, patrol points and gameplay anchors. Owned by ENV.
// Everything is authored in world coordinates at y = 0 (world-floor2.js lifts it to floor 1). The
// architecture is fixed, so positions are absolute. Furniture dressing comes later (floor2_kit).
import { CELL, WALL_HEIGHT } from './config.js';
import { Occ, FLOOR_NODE, ROOM_TINT } from './world-dress.js';

const FACE = 0.1;
const PI = Math.PI;

// ceiling fittings per room, one letter per cell (row-major): o ok, f flicker, b broken housing, d dead, - none.
// Upstairs is darker than the ground floor: dim corridors, dark classrooms (map-design.md §5).
const LIGHTS = {
  'North Hall': 'ofobfodobofdo',
  'South Hall': 'odfobdoofbodo', // index 8: the bad flicker outside Maintenance
  Spine: 'odfdo',
  'Classroom 2B': 'fbdd',
  'Classroom 2A': 'bddfdd',
  'Classroom 2C': 'dbdfdd',
  Maths: 'dfbd',
  English: 'bdfd',
  'Computer Lab': 'dbddbd',
  Library: 'dbdodddfboddodbdbddd',
  Staffroom: 'odbdd-',
  'Stationery Store': 'f---',
  'Security Office': 'oo--',
  'Science Lab': 'dfdbddbdddfd',
  'Science Prep Room': 'o---',
  'Art Room': 'dfdbdd',
  Maintenance: 'o---',
  'School Office': 'od',
  "Principal's Office": 'od--',
  "Boys' Toilets": 'f-',
  "Girls' Toilets": 'fd',
  'Lost Property': 'bf--',
  'Cleaning Store': '-f--',
};
const DAMAGED = new Set(['South Hall:8', 'North Hall:9', 'Library:10', 'Art Room:4', 'Lost Property:0']);

function walls(b) {
  return {
    N: { p0: { x: b.minX, z: b.minZ + FACE }, t: { x: 1, z: 0 }, n: { x: 0, z: 1 }, rot: 0, along: 'x' },
    S: { p0: { x: b.minX, z: b.maxZ - FACE }, t: { x: 1, z: 0 }, n: { x: 0, z: -1 }, rot: PI, along: 'x' },
    W: { p0: { x: b.minX + FACE, z: b.minZ }, t: { x: 0, z: 1 }, n: { x: 1, z: 0 }, rot: PI / 2, along: 'z' },
    E: { p0: { x: b.maxX - FACE, z: b.minZ }, t: { x: 0, z: 1 }, n: { x: -1, z: 0 }, rot: -PI / 2, along: 'z' },
  };
}

/** Floor 2 dressing pass. Returns { rooms: Map(roomId -> dresser out), anchors: [...] }. */
export function dressFloor2(F, rng) {
  const D = F.dresser;
  const rooms = new Map();
  const anchors = [];
  const byName = new Map(F.rooms.map((r) => [r.name, r]));
  // 2-3 teacher-desk hides per seed (map-design §6), sometimes the library checkout desk as well
  const deskHides = new Set(rng.shuffle(['Classroom 2A', 'Classroom 2B', 'Classroom 2C', 'Maths', 'English']).slice(0, rng.int(2, 3)));
  if (rng.chance(0.6)) deskHides.add('Library');
  for (const room of F.rooms) {
    const o = D.out();
    const b = room.bounds;
    const inf = D.info(room.layout);
    const occ = new Occ(b.minX, b.minZ, b.maxX, b.maxZ);
    D.markDoors(occ, inf);
    const W = walls(b);
    const ctx = {
      room, o, occ, b, W, rng, D, inf,
      /** wall point at absolute along-wall coordinate c, off metres out from the face */
      wp(side, c, off = 0.01) {
        const w = W[side];
        const s = w.along === 'x' ? c - b.minX : c - b.minZ;
        return { x: w.p0.x + w.t.x * s + w.n.x * off, z: w.p0.z + w.t.z * s + w.n.z * off, rot: w.rot, s, w };
      },
      put(node, x, y, z, rot, opt = {}) { return D.put(o, node, x, y, z, rot, { ...opt, occ: opt.collide ? occ : null }); },
      /** wall prop at along-wall coordinate c (kit wall props: back on the wall, facing into the room) */
      wall(node, side, cc, opt = {}) {
        const p = ctx.wp(side, cc, opt.off ?? 0.01);
        const collide = opt.collide ?? false;
        D.put(o, node, p.x, opt.y || 0, p.z, p.rot + (opt.rot || 0), { ...opt, collide, occ: collide || opt.mark ? occ : null });
        return p;
      },
      /** free-standing prop; collides by default (the collider is the prop's rotated footprint) */
      free(node, x, z, rot, opt = {}) {
        const collide = opt.collide ?? true;
        return D.put(o, node, x, opt.y || 0, z, rot, { ...opt, collide, occ: collide ? occ : null });
      },
      fits(node, x, z, rot, gap = 0.05) { return D.fits(occ, node, x, z, rot, gap); },
      hideLocker(side, c) { const p = ctx.wp(side, c); D.hideLocker(o, p.w, p.s, p.rot, occ); },
      hideCupboard(side, c) { const p = ctx.wp(side, c); D.hideCupboard(o, p.w, p.s, p.rot, occ); },
      /** a toilet cubicle you can hide in (its own door hangs ajar in the model) */
      hideStall(side, c) {
        const p = ctx.wp(side, c, 0.0);
        ctx.put('toilet_stall', p.x, 0, p.z, p.rot, { collide: true, h: 2.0, pad: 0.01 });
        const n = p.w.n;
        o.hides.push({
          type: 'stall', pivots: [],
          position: { x: p.x + n.x * 0.7, y: 1.45, z: p.z + n.z * 0.7 },
          look: { x: n.x, z: n.z },
          // the stall's collider runs ~2.05 m out from the wall (its door): step out clear of it
          exit: { x: p.x + n.x * 2.55, y: 0, z: p.z + n.z * 2.55 },
          front: { x: p.x + n.x * 2.15, y: 1.2, z: p.z + n.z * 2.15 },
        });
        return p;
      },
      patrol(x, z) { o.spawns.push({ x, z, kind: 'patrol' }); },
      /** wall-mounted anchor: yaw faces the wall (forward points into it); opt.off = distance from the face */
      wallAnchor(id, kind, side, c, y = 1.3, extra = {}) {
        const p = ctx.wp(side, c, extra.off ?? 0.03);
        const { off, ...rest } = extra;
        void off;
        anchors.push({ id, kind, x: p.x, y, z: p.z, yaw: p.rot, room, ...rest });
      },
      anchor(id, kind, x, y, z, yaw, extra = {}) { anchors.push({ id, kind, x, y, z, yaw, room, ...extra }); },
      /** the shared classroom dresser (desk block + aisle ring, board, teacher desk); its desk hides go after
       *  the fixed hides so f2hide1..16 keep their ids */
      classroom(front, opt = {}) {
        const n0 = o.hides.length;
        const res = D.classroom(room.layout, rng, o, inf, occ, opt.variant || 'normal', { front, text: opt.text, deskHide: opt.deskHide });
        o.extraHides.push(...o.hides.splice(n0));
        const surf = o.surfaces.find((s) => s.kind === 'desk');
        return { ...res, desk: surf || null };
      },
    };
    o.extraHides = [];
    shell(ctx, D);
    if (room.isCorridor) {
      for (const c of room.cells) if ((c.cx + c.cz) % 2 === 0 || room.cells.length < 6) ctx.patrol(c.cx * CELL + 2, c.cz * CELL + 2);
    } else if (room.type !== 'stairwell') ctx.patrol(room.center.x, room.center.z);
    ROOMS[room.name]?.(ctx, byName, deskHides);
    rooms.set(room.id, o);
  }
  return { rooms, anchors };
}

function shell(ctx, D) {
  const { room, o, rng } = ctx;
  if (room.type === 'stairwell') return; // world-stairs.js
  const floor = FLOOR_NODE[room.type] || 'floor_lino';
  const plan = LIGHTS[room.name] || '';
  const r = room.layout.rect;
  const corrRot = (r.x1 - r.x0) >= (r.z1 - r.z0) ? 0 : PI / 2;
  room.cells.forEach((c, i) => {
    const x = c.cx * CELL + CELL / 2, z = c.cz * CELL + CELL / 2;
    const v = 0.86 + rng.next() * 0.14;
    D.put(o, floor, x, 0, z, rng.int(0, 3) * PI / 2, { tint: [v, v, v * 0.98] });
    const cv = 0.84 + rng.next() * 0.12;
    const dmg = DAMAGED.has(room.name + ':' + i);
    D.put(o, dmg ? 'ceiling_tile_damaged' : 'ceiling_tile', x, WALL_HEIGHT, z, rng.int(0, 3) * PI / 2, { tint: [cv, cv, cv * 0.97] });
    if (dmg) D.put(o, 'ceiling_debris', x + 0.4, 0, z - 0.3, rng.range(0, 6));
    const k = plan[i] || 'd';
    if (k === '-') return;
    const rot = room.isCorridor ? corrRot : (i % 2 ? 0 : PI / 2);
    const state = k === 'o' ? 'ok' : k === 'f' ? 'flicker' : 'broken';
    D.put(o, k === 'b' ? 'light_fixture_broken' : 'light_fixture', x, WALL_HEIGHT, z, rot);
    o.fixtures.push({ x, y: WALL_HEIGHT, z, rot, state, kind: 'panel', dangling: k === 'b', emergency: room.type === 'security' ? 'security' : undefined });
  });
  void ROOM_TINT;
}

// ------------------------------------------------------------------------------------------- rooms
// Hiding places (map-design.md §6): 4 lockers per hall, cupboards in four stores, 2 stalls per toilet; then
// (appended after those 16, ids f2hide17..) 2-3 teacher desks per seed and the library checkout desk.
// Anchors: the ids GAME uses (docs/last-bell-update/status/GAME.md) + spawn / assistant-spawn / art-circle /
// secret-photo / secret-clapper / 4 cctv rigs. Desk-top anchors follow the furniture the dresser placed.

// floor2_kit atlas cells (m_f2_atlas, 4 x 4 of 64 px; row 0 at the top): 0-5 her drawings
const ATLAS = (i) => { const c = i % 4, r = (i - c) / 4, e = 0.5 / 256; return [c / 4 + e, r / 4 + e, (c + 1) / 4 - e, (r + 1) / 4 - e]; };
const yawTo = (fx, fz, tx, tz) => Math.atan2(-(tx - fx), -(tz - fz));
const TEACHER_TOP = 0.775; // desk_teacher top + a card's thickness
const LOCKER_FRONT = 0.47; // locker_bank depth + a hair
// combination lockers: a normal bank with a brass dial on the middle door
function comboLocker(c, side, along, id) {
  const p = c.wall('locker_bank', side, along, { collide: true, tint: [0.85, 0.9, 0.95] });
  const n = p.w.n;
  c.put('combo_dial', p.x + n.x * 0.455, 1.25, p.z + n.z * 0.455, p.rot);
  c.wallAnchor(id, 'locker', side, along, 1.25, { off: LOCKER_FRONT });
}
function lockers(c, side, list, tint = [0.82, 0.88, 0.92]) {
  for (const x of list) {
    const p = c.wp(side, x, 0.01);
    if (!c.fits('locker_bank', p.x, p.z, p.rot, 0.02)) continue;
    c.wall(x % 3 < 0.4 ? 'locker_bank_open' : 'locker_bank', side, x, { collide: true, tint });
  }
}
function cctv(c, side, along, name, look) {
  const p = c.wall('cctv_camera', side, along);
  const n = p.w.n;
  const yaw = Math.atan2(-look.x, -look.z);
  c.anchor('cctv-' + name.toLowerCase().replace(/[^a-z]+/g, '-'), 'cctv', p.x + n.x * 0.42, 2.72, p.z + n.z * 0.42, yaw, { name, pitch: -0.22 });
}
function drawings(c, side, list) {
  // [along, y, cell, tilt]: pinned at odd angles, the way a child would
  for (const [a, y, cell, tilt] of list) c.wall('drawing', side, a, { y, rz: tilt, uvTo: ATLAS(cell), off: 0.012 });
}
// a chair at a table, facing it
function chairAt(c, node, x, z, faceX, faceZ, jitter = 0.15) {
  const rot = Math.atan2(faceX - x, faceZ - z) + c.rng.range(-jitter, jitter);
  if (c.fits(node, x, z, rot, 0.0)) c.free(node, x, z, rot, { h: 0.9 });
}

const ROOMS = {
  'North Hall'(c) {
    for (const x of [3.35, 11.7, 39.2, 48.3]) c.hideLocker('S', x);
    // the junction box at the east end (puzzle B1 candidate)
    c.wall('junction_box', 'N', 50.6);
    c.wallAnchor('wiring-north-east', 'wiring', 'N', 50.6, 1.3, { off: 0.14 });
    comboLocker(c, 'S', 30.0, 'locker-north');
    // the shutter at the head of the Spine (Stair A), seen from the corridor
    c.anchor('stair-a-door', 'stair-a-door', 26, 1.2, 8.75, 0);
    lockers(c, 'S', [1.9, 10.0, 13.4, 14.6, 21.4, 22.6, 37.6, 45.4, 46.6, 50.1]);
    lockers(c, 'N', [41.4, 42.6]);
    c.wall('trophy_cabinet', 'N', 18.0, { collide: true }); // between Maths and the boys' toilets (landmark)
    c.wall('noticeboard', 'N', 10.0, { y: 1.0 });
    c.wall('noticeboard', 'N', 34.0, { y: 1.0 });
    c.wall('fire_extinguisher', 'N', 35.3, { y: 0.32, collide: true, h: 0.9 });
    c.wall('bench', 'N', 2.0, { off: 0.2, collide: true });
    c.wall('sign_quiet', 'S', 6.0, { y: 2.42 }); // over the library's double doors
    c.D.radiators(c.o, c.inf, c.occ);
    c.D.posters(c.o, c.inf, c.occ, c.rng, 4);
    cctv(c, 'W', 8.45, 'NORTH HALL W', { x: 1, z: 0.15 });
    cctv(c, 'E', 8.45, 'NORTH HALL E', { x: -1, z: 0.15 });
  },
  'South Hall'(c) {
    for (const x of [4.05, 20.25, 32.3, 48.5]) c.hideLocker('N', x);
    c.wall('junction_box', 'N', 0.8);
    c.wallAnchor('wiring-south-west', 'wiring', 'N', 0.8, 1.3, { off: 0.14 });
    c.wallAnchor('reader-office', 'card-reader', 'S', 23.15, 1.3);
    lockers(c, 'N', [13.4, 14.6, 17.4, 18.6, 29.4, 30.6, 41.4, 42.6, 50.2]);
    lockers(c, 'S', [13.4, 14.6, 29.4, 30.6, 45.4, 46.6]);
    c.wall('noticeboard', 'N', 6.0, { y: 1.0 });
    c.wall('noticeboard', 'S', 10.0, { y: 1.0 });
    c.wall('fire_extinguisher', 'S', 38.6, { y: 0.32, collide: true, h: 0.9 });
    c.put('exit_sign', 42, WALL_HEIGHT, 35.35, PI); // the fire exit by Stair B
    c.D.radiators(c.o, c.inf, c.occ);
    c.D.posters(c.o, c.inf, c.occ, c.rng, 4);
    cctv(c, 'E', 34.0, 'SOUTH HALL', { x: -1, z: 0.02 });
    cctv(c, 'S', 26.0, 'SPINE', { x: 0, z: -1 });
  },
  Spine(c) {
    c.wallAnchor('reader-security', 'card-reader', 'E', 15.15, 1.3);
    c.wall('mural_values', 'W', 26.0); // OUR SCHOOL VALUES (landmark)
    c.wall('noticeboard', 'E', 22.0, { y: 1.0 });
    c.wall('fire_extinguisher', 'W', 13.0, { y: 0.32, collide: true, h: 0.9 });
    c.free('bin', 24.45, 30.9, 0.4);
  },
  'Classroom 2B'(c, by, dh) {
    c.classroom('E', { text: 'WELCOME BACK,\nYEAR 9!', deskHide: dh.has('Classroom 2B') });
    // spawn: back of the room (the aisle under the windows), facing the door to the South Hall
    let sp = { x: 13.2, z: 42.6 };
    let best = Infinity;
    for (const s of c.o.spawns) {
      if (s.kind !== 'player') continue;
      const d = Math.hypot(s.x - 13.2, s.z - 42.6);
      if (d < best) { best = d; sp = s; }
    }
    c.anchor('spawn', 'spawn', sp.x, 0, sp.z, yawTo(sp.x, sp.z, 18, 36.8));
    c.free('backpack', sp.x + 0.9, sp.z - 0.6, 1.2, { collide: false });
    c.wall('coat_hooks', 'W', 38.6);
  },
  'Classroom 2A'(c, by, dh) {
    c.classroom('W', { variant: c.rng.chance(0.5) ? 'stacked' : 'normal', deskHide: dh.has('Classroom 2A') });
    // an overturned chair by the window
    for (let k = 0; k < 6; k++) {
      const x = c.rng.range(2, 10), z = c.rng.range(42.4, 43.2);
      if (!c.fits('chair_blue', x, z, 0, 0.0)) continue;
      c.free('chair_blue', x, z, c.rng.range(0, 6), { y: 0.21, rx: -PI / 2, h: 0.5 });
      break;
    }
  },
  'Classroom 2C'(c, by, dh) {
    const r = c.classroom('N', { text: 'HOMEWORK:\nREAD CH. 4', deskHide: dh.has('Classroom 2C') });
    const d = r.desk || { x: 33.6, z: 22.0 };
    c.anchor('card-2c-desk', 'card', d.x, TEACHER_TOP, d.z, PI);
    for (let k = 0; k < 8; k++) {
      const x = c.rng.range(34.4, 35.2), z = c.rng.range(28.5, 31.0);
      if (!c.fits('projector_cart', x, z, PI / 2, 0.1)) continue;
      c.free('projector_cart', x, z, PI / 2 + c.rng.range(-0.3, 0.3));
      break;
    }
  },
  Maths(c, by, dh) {
    c.classroom('E', { text: '', deskHide: dh.has('Maths') });
    // GAME writes the sums on the board (clue-blackboard): centre of the board, just off its surface
    const bd = c.o.boards[0];
    if (bd) {
      const e = bd.m.elements;
      c.anchor('clue-blackboard', 'clue', e[12] - 0.06, 1.55, e[14], -PI / 2);
    } else c.wallAnchor('clue-blackboard', 'clue', 'E', 4.0, 1.5);
    c.wall('protractor_giant', 'W', 2.2, { y: 1.55 });
    c.wall('poster_shapes', 'W', 5.6, { y: 1.3 });
  },
  English(c, by, dh) {
    const r = c.classroom('W', { text: 'MACBETH\nACT 1 SCENE 3', deskHide: dh.has('English') });
    const d = r.desk || { x: 33.9, z: 2.4 };
    c.anchor('clue-login-english', 'clue', d.x, TEACHER_TOP, d.z, -PI / 2);
    c.wall('macbeth_display', 'E', 6.2, { y: 1.1 });
    // reading corner by the windows, if the desks left room
    for (const [x, z] of [[38.6, 1.4], [38.4, 6.6]]) {
      if (!c.fits('beanbag', x, z, 0, 0.1)) continue;
      c.free('beanbag', x, z, c.rng.range(0, 6), { h: 0.38 });
    }
  },
  'Computer Lab'(c) {
    // a row of PCs under the windows, an island row, two on the east wall, the network cabinet by the door
    for (const x of [42.5, 44.3, 46.1, 47.9, 49.7]) {
      c.free('computer_desk', x, 0.52, 0);
      chairAt(c, 'chair_blue', x - 0.4 + c.rng.range(-0.05, 0.05), 1.25, x - 0.4, 0.4, 0.3);
      chairAt(c, 'chair_blue', x + 0.4 + c.rng.range(-0.05, 0.05), 1.25, x + 0.4, 0.4, 0.3);
    }
    for (const x of [43.0, 44.8, 46.6]) {
      c.free('computer_desk', x, 4.0, PI);
      chairAt(c, 'chair_orange', x - 0.4, 3.3, x - 0.4, 4.5, 0.3);
      chairAt(c, 'chair_orange', x + 0.4, 3.3, x + 0.4, 4.5, 0.3);
    }
    for (const z of [3.0, 4.8]) {
      c.free('computer_desk', 51.48, z, -PI / 2);
      chairAt(c, 'chair_blue', 50.75, z - 0.4, 52, z - 0.4, 0.3);
    }
    c.wall('network_cabinet', 'W', 6.2, { collide: true });
    c.wallAnchor('clue-login-lab', 'clue', 'W', 6.2, 1.2, { off: 0.62 });
    c.wall('notice_nogames', 'E', 6.6, { y: 1.35 });
    c.wall('noticeboard', 'S', 50.0, { y: 1.0 });
    c.wall('wall_clock', 'S', 42.0, { y: 2.32 });
  },
  Library(c, by, dh) {
    // checkout desk by the double doors: patrons' side to the north, the librarian's kneehole to the south
    c.free('checkout_desk', 11.6, 14.6, PI, { h: 1.05 });
    c.anchor('card-library-desk', 'card', 12.55, 1.055, 14.35, PI);
    c.anchor('card-visitor', 'card', 10.75, 1.055, 14.75, PI);
    if (dh.has('Library')) {
      c.o.extraHides.push({
        type: 'desk', pivots: [],
        position: { x: 12.0, y: 0.55, z: 14.75 },
        look: { x: 0, z: 1 },
        exit: { x: 12.0, y: 0, z: 15.95 },
        front: { x: 12.0, y: 0.5, z: 15.45 },
      });
    }
    c.free('book_trolley', 14.4, 15.8, 0.3);
    // tall shelves on both long walls (the windows stay clear) + double rows: aisles and sight lines
    for (const z of [17.0, 18.9, 20.8, 22.7, 24.6, 26.5, 28.4, 30.3]) c.wall('bookshelf', 'E', z, { collide: true });
    for (const z of [13.6, 22.0, 30.4]) c.wall('bookshelf', 'W', z, { collide: true });
    for (const z of [19.6, 23.1, 26.6]) {
      for (const x of [2.9, 4.7, 10.3, 12.1]) c.free('bookshelf_double', x, z, 0);
    }
    // reading tables
    for (const [x, z] of [[3.6, 16.4], [3.6, 29.6], [12.6, 29.6]]) {
      c.free('table_library', x, z, 0);
      for (const dx of [-0.45, 0.45]) {
        chairAt(c, 'chair_wood', x + dx, z - 0.75, x + dx, z);
        chairAt(c, 'chair_wood', x + dx, z + 0.75, x + dx, z);
      }
    }
    for (let k = 0; k < 3; k++) {
      const x = c.rng.range(1.2, 14.5), z = c.rng.range(15.5, 31);
      if (c.fits('backpack', x, z, 0, 0.1)) c.free('backpack', x, z, c.rng.range(0, 6), { collide: false });
    }
    // the 1996 class photo, framed by GAME on the wall beside the checkout desk
    c.wallAnchor('secret-photo', 'secret', 'E', 14.2, 1.6, { off: 0.03 });
    c.wall('wall_clock', 'N', 14.0, { y: 2.32 });
  },
  Staffroom(c) {
    c.hideCupboard('W', 22.6);
    c.wall('kitchenette', 'W', 14.6, { collide: true });
    c.wall('filing_cabinet', 'W', 19.7, { collide: true });
    c.wall('filing_cabinet', 'W', 20.2, { collide: true });
    // staff lockers (the combination one holds a card)
    comboLocker(c, 'E', 21.2, 'locker-staff');
    c.wall('locker_bank', 'E', 22.45, { collide: true, tint: [0.8, 0.85, 0.9] });
    c.anchor('card-staff-locker', 'card', 23.5, 1.0, 21.2, -PI / 2);
    // noticeboard (a breaker clue candidate) + the birthday calendar beside it; pigeonholes (login candidate)
    c.wall('noticeboard', 'N', 21.0, { y: 1.0 });
    c.wallAnchor('clue-breaker-staffroom', 'clue', 'N', 21.0, 1.45, { off: 0.05 });
    c.wallAnchor('clue-calendar', 'clue', 'N', 23.0, 1.5);
    c.wall('pigeonholes', 'S', 22.0, { collide: true });
    c.wallAnchor('clue-login-staffroom', 'clue', 'S', 21.5, 1.2, { off: 0.3 });
    // the table and the tired sofa
    c.free('table_library', 21.8, 14.6, 0);
    for (const dx of [-0.45, 0.45]) {
      chairAt(c, 'chair_wood', 21.8 + dx, 13.85, 21.8 + dx, 14.6);
      chairAt(c, 'chair_wood', 21.8 + dx, 15.35, 21.8 + dx, 14.6);
    }
    c.free('coffee_table', 20.5, 21.3, 0);
    c.free('sofa', 20.5, 22.45, PI);
    c.free('plant_dead', 23.4, 12.6, 0.5, { h: 1.1 });
  },
  'Stationery Store'(c) {
    c.hideCupboard('E', 30.2);
    for (const z of [25.6, 27.0]) c.wall('storage_shelf', 'W', z, { collide: true });
    for (const z of [25.4, 26.8]) c.wall('storage_shelf', 'E', z, { collide: true });
    c.free('photocopier', 16.82, 30.4, PI / 2);
    c.free('box_stack', 16.6, 28.8, 0.2);
    c.free('cardboard_box', 23.3, 28.6, 1.3);
  },
  'Security Office'(c) {
    // the security PC on a desk against the east wall, the CCTV monitor wall opposite the window
    c.free('desk_teacher', 35.5, 16.0, PI / 2);
    c.put('crt_monitor', 35.5, 0.77, 16.0, -PI / 2);
    c.free('chair_leather', 34.55, 16.1, PI / 2 + 0.3, { h: 1.0 });
    c.anchor('security-pc', 'security-pc', 35.0, 1.05, 16.0, -PI / 2);
    const mw = c.wall('monitor_wall', 'S', 32.2, { collide: true });
    c.o.screens = [{ x: mw.x, z: mw.z, rot: mw.rot }]; // the live screens (world-floor2.js, on with the power)
    c.wall('key_cabinet', 'N', 30.3, { collide: true });
    c.wall('filing_cabinet', 'N', 31.6, { collide: true });
    c.wall('filing_cabinet_open', 'E', 13.0, { collide: true });
    c.put('papers_a', 34.8, 0.77, 15.3, 0.4);
    // the guard's things: a locker, the rota on a noticeboard, a bin, boxes of old tapes
    c.wall('locker_tall', 'E', 19.0, { collide: true, tint: [0.75, 0.8, 0.85] });
    c.wall('noticeboard', 'W', 16.0, { y: 1.0 });
    c.free('bin', 34.6, 17.25, 0.3, { h: 0.5 });
    c.free('box_stack', 28.75, 19.2, 0.15);
    c.free('cardboard_box', 29.7, 19.35, 1.1);
  },
  'Science Lab'(c) {
    c.D.lab(c.room.layout, c.rng, c.o, c.inf, c.occ);
    const tryWall = (node, side, list, opt = {}) => {
      for (const a of list) {
        const p = c.wp(side, a, 0.01);
        if (!c.fits(node, p.x, p.z, p.rot, 0.02)) continue;
        c.wall(node, side, a, opt);
        return true;
      }
      return false;
    };
    tryWall('fume_cupboard', 'N', [50.2, 46.4, 38.2], { collide: true });
    tryWall('periodic_table', 'S', [46.0, 50.0, 42.0], { y: 1.35 });
  },
  'Science Prep Room'(c) {
    c.hideCupboard('W', 29.6);
    c.wall('lab_bench', 'E', 27.0, { off: 0.46, collide: true });
    c.anchor('clue-breaker-prep', 'clue', 43.2, 0.95, 27.0, -PI / 2);
    c.wall('shelf_jars', 'E', 30.6, { collide: true });
    c.wall('shelf_jars', 'N', 42.2, { collide: true });
    c.wall('sink_unit', 'E', 24.9, { collide: true });
    c.wall('storage_shelf', 'S', 42.4, { collide: true });
  },
  'Art Room'(c) {
    // her room: the circle of chairs facing the MY FRIENDS easel (the co-op captive circle)
    const cx = 6.2, cz = 4.2;
    c.anchor('art-circle', 'art-circle', cx, 0, cz, 0);
    c.free('easel', cx, cz - 2.1, 0, { h: 1.6 });
    c.anchor('art-easel', 'art-easel', cx, 0, cz - 2.1, 0); // art-room.js pins its drawing of you here
    // six chairs on a ring; the north slot is the easel, the south slot stays open towards the door so she
    // (and a teammate coming for you) can walk in - coop seats captives 1.1 m out from the centre, so the
    // ring is a true circle (R 2.0): every chair is >= 0.9 m from every seat _artSeat can hand out
    const DOLLS = { 0: ['a', 'b'], 1: ['b', 'a'], 3: ['c', 'c'], 4: ['a', 'c'], 7: ['b', 'b'] }; // k: [body, head]
    let nd = 0;
    for (const k of [0, 1, 3, 4, 5, 7]) {
      const t = (k * PI) / 4;
      const x = cx + Math.cos(t) * 2.0, z = cz + Math.sin(t) * 2.0, rot = Math.atan2(cx - x, cz - z);
      c.free('chair_orange', x, z, rot, { h: 0.85 });
      const d = DOLLS[k];
      if (!d) continue; // one chair left empty, as if someone got up
      // her papier-mache "friends": the body is static, the head is art-room.js's (it turns while unwatched);
      // the anchor is the neck pivot, 0.07 m back of the chair's centre
      c.put('doll_body_' + d[0], x, 0, z, rot);
      c.anchor('art-doll-' + nd++, 'art-doll', x - Math.sin(rot) * 0.07, 0.86, z - Math.cos(rot) * 0.07, rot, { name: 'doll_head_' + d[1] });
    }
    // her lunch party in the middle (low; seats are 1.1 m out, it reaches 0.42). Its collider is the trays'
    // core (+-0.3): any bigger and the 0.5 m nav grid loses the ring between it and the chairs. Then the chalk
    // circle round the seats and STAY, reading from the doorway side
    c.free('lunch_party', cx, cz, 0, { h: 0.15, pad: -0.12 });
    c.put('chalk_circle', cx, 0, cz, 0);
    c.put('chalk_stay', cx + 0.05, 0, cz + 0.74, 0.06);
    // the bare bulb over the circle: 'broken' (dark, never pooled) until she has someone - art-room.js then
    // makes it the room's only light
    c.put('bulb_warm', cx + 0.1, WALL_HEIGHT, cz - 0.1, 0);
    c.o.fixtures.push({ x: cx + 0.1, y: WALL_HEIGHT - 1.0, z: cz - 0.1, rot: 0, state: 'broken', kind: 'bulb', artLamp: true });
    c.anchor('assistant-spawn', 'assistant-spawn', 2.6, 0, 6.2, yawTo(2.6, 6.2, cx, cz));
    // paint table (a card candidate), the second table, easels, the drying rack, the kiln, the sink
    c.free('paint_table', 2.0, 2.9, PI / 2);
    c.anchor('card-art-desk', 'card', 2.3, 0.725, 2.35, PI / 2);
    c.free('paint_table', 9.9, 6.6, 0);
    c.free('easel_blank', 9.3, 1.15, 0.35, { h: 1.6 }); // by the windows, clear of her drawings
    c.free('drying_rack', 0.65, 6.3, PI / 2);
    c.free('kiln', 11.25, 4.1, -PI / 2);
    c.wall('sink_unit', 'E', 6.6, { collide: true });
    // her drawings: the read spot (secret-drawings) is the big cluster on the east wall
    c.wallAnchor('secret-drawings', 'secret', 'E', 2.6, 1.45, { off: 0.03 });
    drawings(c, 'E', [[1.6, 1.62, 0, 0.06], [2.15, 1.18, 5, -0.05], [2.55, 1.75, 3, 0.03], [3.0, 1.3, 1, -0.08],
      [3.45, 1.7, 4, 0.05], [1.85, 0.78, 2, 0.1], [3.4, 0.86, 0, -0.04], [2.7, 2.15, 1, 0.0]]);
    drawings(c, 'S', [[1.0, 1.5, 4, -0.06], [1.6, 1.1, 2, 0.08], [9.0, 1.6, 3, 0.04], [10.4, 1.25, 5, -0.07], [11.0, 1.8, 0, 0.1]]);
    drawings(c, 'W', [[3.0, 1.55, 1, 0.05], [3.6, 1.2, 4, -0.04], [4.6, 1.7, 2, 0.07]]);
    // a few on the floor
    for (const [x, z, k] of [[4.1, 6.9, 1], [8.3, 5.3, 4], [3.5, 1.9, 0]]) c.put('drawing', x, 0.006, z, c.rng.range(0, 6), { rx: -PI / 2, uvTo: ATLAS(k) });
  },
  Maintenance(c) {
    c.wall('breaker_box', 'E', 39.0);
    c.wallAnchor('breaker-panel', 'breaker', 'E', 39.0, 1.4, { off: 0.18 });
    c.wall('pipes_wall', 'E', 42.3, { collide: true, h: 3.2 });
    c.wall('workbench', 'W', 39.6, { off: 0.37, collide: true });
    c.wall('tool_wall', 'W', 39.6);
    c.wall('storage_shelf', 'W', 42.6, { collide: true });
    c.free('mop_bucket', 38.9, 37.1, 2.4);
    c.free('box_stack', 33.0, 43.0, 0.3);
    c.D.radiators(c.o, c.inf, c.occ);
  },
  'School Office'(c) {
    // the reception desk faces the reader door; the secretary's chair behind it
    c.free('desk_teacher', 21.0, 39.3, PI);
    c.free('chair_wood', 21.0, 40.25, PI + 0.25, { h: 0.9 });
    c.put('crt_monitor', 20.55, 0.77, 39.35, 0.3);
    c.anchor('clue-breaker-office', 'clue', 21.35, TEACHER_TOP, 39.25, 0);
    c.wall('pigeonholes', 'W', 42.3, { collide: true });
    c.anchor('clue-login-office', 'clue', 20.42, 1.35, 41.8, PI / 2);
    c.wall('filing_cabinet', 'W', 40.65, { collide: true });
    c.wall('filing_cabinet', 'W', 37.4, { collide: true });
    c.wall('plaque_board', 'E', 38.2);
    c.wallAnchor('clue-plaque', 'clue', 'E', 38.2, 1.5, { off: 0.04 });
    c.D.radiators(c.o, c.inf, c.occ);
  },
  "Principal's Office"(c) {
    c.wallAnchor('eotm-frame', 'eotm-frame', 'N', 26.8, 1.65, { off: 0.04 });
    // the history cabinet (combination); GAME's bell clapper rests on its lower shelf
    c.wall('history_cabinet', 'E', 39.0, { collide: true });
    c.wallAnchor('locker-cabinet', 'locker', 'E', 39.0, 1.2);
    c.wallAnchor('secret-clapper', 'secret', 'E', 39.0, 0.9, { off: 0.2 });
    c.free('desk_executive', 28.0, 41.6, PI);
    c.free('chair_leather', 28.0, 42.75, PI, { h: 1.25 });
    chairAt(c, 'chair_wood', 27.4, 40.25, 27.4, 41.6, 0.2);
    chairAt(c, 'chair_wood', 28.6, 40.25, 28.6, 41.6, 0.2);
    c.wall('bookshelf', 'N', 30.0, { collide: true });
    c.wall('certificate', 'W', 37.6, { y: 1.45 });
    c.wall('certificate', 'W', 38.2, { y: 1.62 });
    c.wall('certificate', 'W', 38.8, { y: 1.45 });
    c.free('plant_dead', 24.7, 36.8, 1.0, { h: 1.1 });
    c.D.radiators(c.o, c.inf, c.occ);
  },
  "Boys' Toilets"(c) {
    c.hideStall('E', 1.1);
    c.hideStall('E', 3.05);
    const m = c.wp('E', 2.075, 0.0);
    c.put('toilet_stall', m.x, 0, m.z, m.rot, { collide: true, h: 2.0, pad: 0.01 });
    const p = c.wp('E', 3.05, 0.0);
    c.put('toilet_stall_end', p.x, 0, p.z, p.rot);
    for (const z of [4.4, 5.15, 5.9]) c.wall('urinal', 'W', z, { collide: true, h: 1.4 });
    for (const z of [1.4, 2.3]) {
      c.wall('sink_unit', 'W', z, { collide: true });
      c.wall('mirror', 'W', z, { y: 1.15 });
    }
  },
  "Girls' Toilets"(c) {
    c.hideStall('W', 1.1);
    c.hideStall('W', 3.05);
    const m = c.wp('W', 2.075, 0.0);
    c.put('toilet_stall', m.x, 0, m.z, m.rot, { collide: true, h: 2.0, pad: 0.01 });
    const p = c.wp('W', 4.0, 0.0); // its panel is on the stall's local +X side, which faces -z on this wall
    c.put('toilet_stall_end', p.x, 0, p.z, p.rot);
    for (const [z, cracked] of [[1.4, false], [2.3, true], [3.2, false]]) {
      c.wall('sink_unit', 'E', z, { collide: true });
      c.wall('mirror', 'E', z, { y: 1.15 });
      if (cracked) c.wall('mirror_crack', 'E', z, { y: 1.15, off: 0.004 });
    }
  },
  'Lost Property'(c) {
    c.free('lost_property_box', 49.5, 26.0, 0.1, { h: 0.55 });
    c.anchor('card-lost-property', 'card', 49.5, 0.55, 26.0, 0);
    for (const x of [45.2, 46.6]) c.wall('storage_shelf', 'N', x, { collide: true });
    c.wall('storage_shelf', 'W', 28.0, { collide: true });
    c.wall('coat_hooks', 'W', 30.6);
    c.wall('storage_shelf', 'E', 29.6, { collide: true });
    c.free('box_stack', 51.2, 31.2, 0.4);
    c.free('cardboard_box', 46.0, 28.6, 0.7);
    for (let k = 0; k < 3; k++) c.free('backpack', 47 + k * 0.6, 30.9 - k * 0.2, c.rng.range(0, 6), { collide: false });
  },
  'Cleaning Store'(c) {
    c.hideCupboard('S', 48.0);
    c.free('cleaning_trolley', 46.0, 41.0, PI / 2);
    c.wall('storage_shelf', 'E', 38.4, { collide: true });
    c.wall('storage_shelf', 'W', 38.4, { collide: true });
    c.free('mop_bucket', 51.0, 42.8, 0.6);
    c.free('wet_floor_sign', 47.0, 38.6, 0.2, { h: 0.6 });
    c.free('box_stack', 45.0, 43.2, 0.1);
  },
  'Stairwell B'(c) {
    // ground floor (floor 0), the corridor side of the chained gate
    c.anchor('stair-b-gate', 'stair-b-gate', 42, 1.1, 35.35, PI, { floor: 0, room: null, roomName: 'Stairwell B' });
  },
};
