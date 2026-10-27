// LAST BELL - SCHOOLNET computers and the things in the school you can use. Owned by the main agent.
//
// Computers: the CRT monitors on teacher desks and the librarian's desk (at least MIN_COMPUTERS per
// run: monitors are added to teacher desks when a layout has fewer). Each is locked; its login is on a
// sticky note somewhere in the same room. One login per computer per run, SESSION_SECONDS long, three
// wrong passwords lock it too. schoolnet.js is the screen you type into; this file is everything
// behind it: accounts, the apps' data, broadcasts, the election and what each promise does.
//
// Things you can use (each tells you it exists: a glow or glint, a prompt that says what it does, a
// first-time tip, and a line in the HUD's Tools list once it is yours to use):
//   sticky notes        the logins (Tools lists every login you've read and not used yet)
//   Kaan's PlayStation  on Mr Ahmet Hoca's desk: take it, G puts it down and switches it on (a lure)
//   Room 000 register   read it, then sign it once: he stops hunting you
//   vending machine     reception; out of order until you vote Chloe: one free can = full stamina
//   döner shop          opens when you vote Ozzy; glowing signs with his face lead the way
//
// Events out: 'schoolnet:tools' {tools}, 'schoolnet:inventory' {keycard, fuse}, 'tip' {id},
//             'schoolnet:gadget' {has}. HallPass moments via game.moment().

import * as THREE from './lib/three/three.module.js';
import { PLAYER } from './config.js';
import { ET, RNG, hashSeed } from './world-layout.js';
import { addVertexSnap } from './assets.js';
import { CCTV } from './cctv.js';
import { ELECTION } from './election.js';
import * as C from './schoolnet-content.js';

const MIN_COMPUTERS = 3;
const SCREEN_LOCAL = new THREE.Vector3(0, 0.265, 0.13); // the CRT's glass, in the model's space
const SCREEN_W = 0.3;
const SCREEN_H = 0.26;
const NOTE_MIN_DIST = 1.4; // a computer's note sits at least this far from it when the room allows
const NOTE_FURNITURE = new Set(['desk_student', 'desk_old', 'table_library', 'filing_cabinet']);
const PS_SECONDS = 25; // how long Kaan's PlayStation plays before the battery dies
const PS_NOISE_EVERY = 1.5;
const DONER_BOOST = 20;
const FACE_URL = 'assets/posters/ozan-doner.jpg'; // the write-in candidate's (lookalike) face
const HAND = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', cursive";
const MONO = "'Courier Prime', 'Courier New', monospace";
const COND = "'Barlow Condensed', 'Arial Narrow', Arial, sans-serif";

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

/** Which candidate key ('mia' | 'chloe' | 'tovbe') an ELECTION candidate is. */
export function candidateKey(c) {
  if (c.style === 'handmade') return 'tovbe';
  return /chloe/i.test(c.name) ? 'chloe' : 'mia';
}

/** The subtitle for a PA song: built-in songs are music boxes, your own just play. */
export function songSubtitle(audio, song) {
  const s = audio?.songs?.find((x) => x.id === song) || { title: 'Frère Jacques' };
  return s.custom ? `[music plays over the speakers: "${s.title}", echoing through the halls]` : `[a music box plays "${s.title}", echoing through the halls]`;
}

export class Computers {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.group = new THREE.Group();
    this.group.name = 'schoolnet';
    game.scene.add(this.group);
    this.cctv = new CCTV(game);
    this.list = [];
    this.tools = [];
    this._interactables = [];
    this._face = null;
    this._faceWaiters = [];
    this._loadFace();
    this._mats = this._makeMaterials();
    this.reset();
    const ev = this.events;
    ev?.on('player:gadget', () => this.useGadget());
    ev?.on('world:transform', (r) => this.onTransform(r));
    ev?.on('world:room000', () => this._onRoom000());
    ev?.on('item:collected', () => this.events?.emit('schoolnet:tools', { tools: this.tools }));
  }

  // ================================================================== lifecycle
  reset() {
    for (const o of [...this.group.children]) this.group.remove(o);
    for (const pc of this.list || []) pc.screenMat?.dispose?.();
    this.list = [];
    this.tools = [];
    this.voted = null;
    this.wifi = false;
    this.gadget = null;
    this.ps = null;
    this.register = null;
    this.vending = null;
    this.doner = null;
    this.arrows = [];
    this._tipCheckT = 0;
    this._rebuild();
    this._emitTools();
    this.events?.emit('schoolnet:inventory', { reset: true });
  }

  /** Called by game.startRun() after the world, items and batteries are placed. */
  build() {
    this.reset();
    const w = this.game.world;
    if (!w?.layout) return;
    try {
      this.rng = new RNG(hashSeed(w.layoutSeed >>> 0, 0x5c00));
      this._findComputers();
      this._assignAccounts();
      for (const pc of this.list) this._placeNote(pc);
      this._placePlayStation();
      this._placeRegister();
      this._placeVending();
      this.cctv.build(w);
    } catch (err) {
      console.warn('[schoolnet] build failed', err);
    }
    this._rebuild();
    this._emitTools();
  }

  getInteractables() {
    return this._interactables;
  }

  /** Per frame while playing: first-time tips, the PlayStation, the döner spit. */
  update(dt) {
    const g = this.game;
    const p = g.player;
    if (this.ps?.playing) this._updatePlayStation(dt);
    if (this.doner?.spit) this.doner.spit.rotation.y += dt * 0.9;
    this._tipCheckT -= dt;
    if (this._tipCheckT <= 0 && p) {
      this._tipCheckT = 0.5;
      // the first computer you walk up to explains how to get in
      for (const pc of this.list) {
        if (pc.state === 'locked') continue;
        const d = Math.hypot(pc.pos.x - p.position.x, pc.pos.z - p.position.z);
        if (d < 3.2 && g.world.getRoomAt(p.position.x, p.position.z) === pc.room) {
          this.events?.emit('tip', { id: 'computer' });
          break;
        }
      }
    }
  }

  // ================================================================== computers
  _findComputers() {
    const w = this.game.world;
    const found = [];
    for (const [owner, list] of w.static.owners) {
      if (!String(owner).startsWith('room:')) continue;
      for (const pl of list) {
        if (pl.node !== 'crt_monitor') continue;
        const room = w.getRoomAt(pl.m.elements[12], pl.m.elements[14]);
        if (!room || room.type === 'room000') continue;
        found.push({ room, matrix: pl.m.clone(), owner, added: false });
      }
    }
    // too few: put a monitor on teacher desks that don't have one (classrooms first, seeded order)
    if (found.length < MIN_COMPUTERS) {
      const desks = [];
      for (const [owner, list] of w.static.owners) {
        if (!String(owner).startsWith('room:')) continue;
        for (const pl of list) {
          if (pl.node !== 'desk_teacher') continue;
          const room = w.getRoomAt(pl.m.elements[12], pl.m.elements[14]);
          if (!room || room.type !== 'classroom' || found.some((f) => f.room === room)) continue;
          desks.push({ room, desk: pl.m, owner });
        }
      }
      this.rng.shuffle(desks);
      for (const d of desks) {
        if (found.length >= MIN_COMPUTERS) break;
        const m = d.desk.clone().multiply(_m.makeTranslation(-0.35, 0.77, 0));
        const obj = w.kit.makeObject('crt_monitor');
        obj.matrixAutoUpdate = false;
        obj.matrix.copy(m);
        obj.matrixWorldNeedsUpdate = true;
        this.group.add(obj);
        found.push({ room: d.room, matrix: m, owner: d.owner, added: true, mesh: obj });
      }
    }
    for (const f of found) this.list.push(this._makeComputer(f));
  }

  _makeComputer(f) {
    const pc = {
      id: `pc:${f.room.id}:${this.list.length}`,
      room: f.room,
      owner: null,
      matrix: f.matrix,
      ownerKey: f.owner,
      ownerRef: this.game.world.static.owners.get(f.owner),
      added: f.added,
      mesh: f.mesh || null,
      pos: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      state: 'idle', // 'idle' | 'open' | 'locked'
      tries: 0,
      noteRead: false,
      broadcastUsed: false,
      sessionLeft: 0,
      note: null,
      screen: null,
    };
    this._poseComputer(pc);
    const self = this;
    pc.interactable = {
      id: pc.id,
      kind: 'computer',
      position: pc.pos,
      range: 2.0,
      object: null,
      getPrompt() {
        if (pc.state === 'locked') return 'SCHOOLNET: account locked';
        if (pc.state === 'open') return null;
        return pc.noteRead ? 'Log in to SCHOOLNET' : 'Use computer (needs a login)';
      },
      interact(game) {
        if (pc.state === 'locked') {
          game.audio?.play?.('sn_error', { position: pc.pos });
          return false;
        }
        return game.schoolnet?.open(pc);
      },
    };
    return pc;
  }

  /** Screen position, normal and the glowing login screen for the computer's monitor. */
  _poseComputer(pc) {
    pc.pos.copy(SCREEN_LOCAL).applyMatrix4(pc.matrix);
    pc.normal.set(0, 0, 1).transformDirection(pc.matrix);
    pc.normal.y = 0;
    pc.normal.normalize();
    if (!pc.screen) {
      pc.screenMat = new THREE.MeshBasicMaterial({ map: this._screenTex('login'), color: new THREE.Color(1.25, 1.25, 1.25) });
      pc.screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W * 0.92, SCREEN_H * 0.9), pc.screenMat);
      pc.screen.name = 'schoolnet-screen';
      this.group.add(pc.screen);
    }
    pc.matrix.decompose(_v, _q, _s);
    pc.screen.position.copy(pc.pos).addScaledVector(pc.normal, 0.004);
    pc.screen.quaternion.copy(_q);
    this._setScreen(pc);
  }

  _setScreen(pc) {
    if (!pc.screenMat) return;
    const st = pc.state === 'locked' ? 'locked' : pc.state === 'open' ? 'open' : 'login';
    pc.screenMat.map = this._screenTex(st);
    pc.screenMat.needsUpdate = true;
  }

  _assignAccounts() {
    const rng = this.rng;
    const classroom = this.list.filter((pc) => pc.room.type !== 'library');
    rng.shuffle(classroom);
    // Mr Ahmet Hoca first, then Mr Hasan P., then made-up teachers; the library is the librarian's
    const order = [C.STAFF.hoca, C.STAFF.hasan, ...C.STAFF.extra];
    for (const pc of this.list) {
      const i = classroom.indexOf(pc);
      const staff = i < 0 ? C.STAFF.librarian : order[i % order.length];
      const pass = rng.pick(staff.words) + rng.pick(C.PASS_DIGITS);
      pc.owner = { name: staff.name, role: staff.role, user: staff.user, pass, key: staff === C.STAFF.hoca ? 'hoca' : staff === C.STAFF.hasan ? 'hasan' : staff.user };
    }
  }

  // ================================================================== sticky notes
  _placeNote(pc) {
    const w = this.game.world;
    const data = w._roomData?.get(pc.room.id);
    const surfaces = (data?.out?.surfaces || []).slice();
    // any desk or table top in the room (pupils' desks too), so the note takes a little looking for
    for (const [owner, list] of w.static.owners) {
      if (!String(owner).startsWith('room:')) continue;
      for (const pl of list) {
        if (!NOTE_FURNITURE.has(pl.node)) continue;
        const e = pl.m.elements;
        if (w.getRoomAt(e[12], e[14]) !== pc.room) continue;
        const top = (w.kit.bbox?.(pl.node)?.max.y || 0.74) + e[13];
        surfaces.push({ x: e[12] + this.rng.range(-0.12, 0.12), y: top, z: e[14] + this.rng.range(-0.08, 0.08) });
      }
    }
    const taken = [w.itemSpawns?.keycard, w.itemSpawns?.fuse, this.game.items?.getEntry?.('batteries')?.position].filter(Boolean);
    const free = surfaces.filter((s) => !taken.some((t) => Math.hypot(t.x - s.x, t.z - s.z) < 0.5) && w._walkPoint?.(s.x, s.z, 1.4));
    const far = free.filter((s) => Math.hypot(s.x - pc.pos.x, s.z - pc.pos.z) >= NOTE_MIN_DIST);
    let spot = null;
    if (far.length) spot = far[Math.floor(this.rng.next() * far.length)];
    else if (free.length) spot = free[0];
    if (!spot) {
      // nothing else in the room: on the computer's own desk, beside the monitor
      _v.set(0.62, 0, 0.05).applyMatrix4(pc.matrix);
      spot = { x: _v.x, y: pc.matrix.elements[13] + 0.002, z: _v.z };
    }
    if (pc.note) this.group.remove(pc.note.mesh, pc.note.glint);
    const mesh = new THREE.Mesh(this._noteGeo || (this._noteGeo = new THREE.PlaneGeometry(0.11, 0.11)), this._mats.note);
    mesh.rotation.set(-Math.PI / 2, 0, this.rng.range(0, Math.PI * 2));
    mesh.position.set(spot.x, (spot.y || 0) + 0.006, spot.z);
    mesh.name = 'sticky-note';
    const glint = this._glint(0xfff2a0, 0.16);
    glint.position.set(spot.x, (spot.y || 0) + 0.08, spot.z);
    this.group.add(mesh, glint);
    const self = this;
    pc.note = {
      mesh,
      glint,
      interactable: {
        id: `note:${pc.id}`,
        kind: 'note',
        position: new THREE.Vector3(spot.x, (spot.y || 0) + 0.04, spot.z),
        range: 2.0,
        object: mesh,
        getPrompt: () => (pc.noteRead ? 'Read the sticky note again' : 'Read sticky note (a SCHOOLNET login)'),
        interact: () => self.readNote(pc),
      },
    };
  }

  readNote(pc) {
    const first = !pc.noteRead;
    pc.noteRead = true;
    if (pc.note?.glint) pc.note.glint.visible = false;
    this.game.ui?.showCard?.({
      kind: 'note',
      title: 'Sticky note',
      lines: ['SCHOOLNET', `user: ${pc.owner.user}`, `pass: ${pc.owner.pass}`, `- ${pc.owner.name}`],
      footer: `For the computer in ${pc.room.name}.`,
      anchor: pc.note?.interactable.position,
    });
    this.game.audio?.play?.('cloth', { position: pc.note?.interactable.position });
    if (first) {
      this.events?.emit('tip', { id: 'note' });
      this._emitTools();
    }
    return true;
  }

  // ================================================================== sessions (schoolnet.js)
  sessionLength() {
    return C.SESSION_SECONDS + (this.wifi ? C.WIFI_BONUS : 0);
  }

  tryLogin(pc, user, pass) {
    if (pc.state === 'locked') return { ok: false, msg: 'ACCOUNT LOCKED' };
    const u = String(user || '').trim().toLowerCase();
    const p = String(pass || '').trim().toLowerCase();
    if (u === pc.owner.user.toLowerCase() && p === pc.owner.pass.toLowerCase()) {
      pc.state = 'open';
      pc.sessionLeft = this.sessionLength();
      pc.noteRead = true; // logged in = you know it
      this._setScreen(pc);
      this.game.audio?.play?.('sn_ok', { position: pc.pos });
      this.game.moment?.('computer-login', { room: pc.room.name });
      this._emitTools();
      return { ok: true };
    }
    pc.tries++;
    this.game.audio?.play?.('sn_error', { position: pc.pos });
    this.events?.emit('noise', { position: pc.pos.clone(), radius: 8, source: 'computer' });
    if (pc.tries >= C.MAX_TRIES) {
      this.lock(pc);
      return { ok: false, msg: 'ACCOUNT LOCKED: too many wrong passwords', locked: true };
    }
    return { ok: false, msg: `ACCESS DENIED (${C.MAX_TRIES - pc.tries} ${C.MAX_TRIES - pc.tries === 1 ? 'try' : 'tries'} left)` };
  }

  /** One login per computer per run: a finished session (or 3 wrong passwords) locks the account. */
  lock(pc) {
    pc.state = 'locked';
    pc.sessionLeft = 0;
    if (pc.note?.glint) pc.note.glint.visible = false;
    this._setScreen(pc);
    this._emitTools();
  }

  /** Tiny keyboard click at the computer: he can hear you typing up close. */
  keyNoise(pc) {
    const now = performance.now();
    if (now - (this._lastKey || 0) < 110) return;
    this._lastKey = now;
    this.game.audio?.play?.('key_clack', { position: pc.pos });
    if (now - (this._lastKeyNoise || 0) > 600) {
      this._lastKeyNoise = now;
      this.events?.emit('noise', { position: pc.pos.clone(), radius: 4, source: 'computer' });
    }
  }

  // ================================================================== apps: announcements
  /** Where a broadcast can be sent from this computer: named places, farthest first. all: every place
   *  with PA speakers (the map), instead of one per name and at most 8 (a plain list). */
  broadcastAreas(pc, { all = false } = {}) {
    const w = this.game.world;
    const types = new Set(['corridor', 'library', 'reception', 'science_lab', 'toilets', 'stairwell']);
    const out = [];
    for (const room of w.rooms) {
      if (room === pc.room || room.type === 'room000') continue;
      if (!types.has(room.type) && !room.isCorridor) continue;
      const c = room.center;
      const d = Math.hypot(c.x - pc.pos.x, c.z - pc.pos.z);
      out.push({ name: room.name, room, pos: new THREE.Vector3(c.x, 2.8, c.z), dist: d });
    }
    if (all) return out.sort((a, b) => b.dist - a.dist);
    // one entry per name (two "Store Room"s etc. would be confusing), farthest first, at most 8
    const seen = new Set();
    return out
      .sort((a, b) => b.dist - a.dist)
      .filter((a) => !seen.has(a.name) && seen.add(a.name))
      .slice(0, 8);
  }

  /** song: an id from audio.songs (Frère Jacques if left out). */
  broadcast(pc, kind, area, song) {
    if (!pc || pc.broadcastUsed || !area) return 0;
    pc.broadcastUsed = true;
    const g = this.game;
    const dur = g.audio?.broadcast?.(kind, area.pos, song, !!g.coop?.active) || 4; // co-op: out of every speaker, for everyone
    g.coop?.onPA?.(kind, area.pos, song); // co-op: the whole school hears the PA
    // he walks to the floor under the speakers (the pathfinder snaps it to the nearest walkable spot)
    g.enemy?.distract?.(new THREE.Vector3(area.pos.x, 0, area.pos.z));
    const text =
      kind === 'song'
        ? songSubtitle(g.audio, song)
        : g.audio?.hasFile?.('announcement_caretaker')
          ? C.BROADCAST.announcement
          : '[a distant announcement echoes through the halls]';
    g.subtitle?.(text, Math.min(9, dur + 1), 'PA');
    g.moment?.('pa-broadcast', { kind, area: area.name, ...(kind === 'song' ? { song: g.audio?.songTitle?.(song) } : {}) });
    return dur;
  }

  // ================================================================== apps: maintenance inventory
  inventoryRows() {
    const g = this.game;
    const w = g.world;
    const inv = g.inventory;
    const where = (pos) => (pos ? w.getRoomAt(pos.x, pos.z)?.name || 'Unknown' : 'Unknown');
    const rows = [];
    const ir = w.itemRooms || {};
    rows.push({ item: 'Security keycard (1)', where: inv?.has('keycard') ? 'Signed out' : ir.keycard?.name || '?' });
    rows.push({ item: 'Maintenance fuse (1)', where: inv?.has('fuse') ? 'Signed out' : ir.fuse?.name || '?' });
    const bat = g.items?.getEntry?.('batteries');
    if (bat) rows.push({ item: 'Torch batteries (4)', where: bat.collected ? 'Signed out' : where(bat.position) });
    if (this.ps) rows.push({ item: 'PlayStation (confiscated)', where: this.ps.taken ? 'Signed out' : `${this.ps.room.name}, on Mr Ahmet Hoca's desk` });
    rows.push({ item: 'Exit access key', where: 'ROOM 000: NO SUCH ROOM' });
    this.events?.emit('schoolnet:inventory', { keycard: inv?.has('keycard') ? null : ir.keycard?.name, fuse: inv?.has('fuse') ? null : ir.fuse?.name });
    return rows;
  }

  // ================================================================== apps: election
  ballot() {
    return ELECTION.candidates.map((c) => {
      const key = candidateKey(c);
      return { key, name: c.name, slogan: c.variants ? c.variants[0].slogan : c.slogan, promise: C.PROMISES[key] };
    });
  }

  vote(key) {
    if (this.voted || !C.PROMISES[key]) return null;
    this.voted = key;
    const perk = C.PROMISES[key].perk;
    if (perk === 'wifi') {
      this.wifi = true;
      for (const pc of this.list) if (pc.state === 'open') pc.sessionLeft += C.WIFI_BONUS;
      this.events?.emit('tip', { id: 'wifi' });
    } else if (perk === 'vending') {
      this._switchVending(true);
      this.events?.emit('tip', { id: 'vending' });
    } else if (perk === 'doner') {
      this._openDonerShop();
      this.events?.emit('tip', { id: 'doner' });
    }
    this.game.world?.election?.showResults?.();
    this.game.moment?.('voted', { candidate: key });
    this._emitTools();
    return { winner: 'tovbe', lines: [C.COVERAGE.byVote[key], ...C.COVERAGE.lines] };
  }

  // ================================================================== apps: mail
  mailFor(pc) {
    const g = this.game;
    const w = g.world;
    const others = this.list.filter((o) => o !== pc);
    const leak = others.find((o) => o.owner.key === 'hasan') || others.find((o) => o.state !== 'locked') || others[0] || pc;
    const r000 = w.layout?.room000;
    let room000Hint = 'somewhere in the old wing';
    if (r000 && w.layout.edgeRooms) {
      const [a, b] = w.layout.edgeRooms(r000.edge);
      const other = [a, b].map((i) => w.rooms[i]).find((r) => r && r.type !== 'room000');
      if (other) room000Hint = `in the ${other.name}`;
    }
    const stops = g.enemy?.upcomingPatrol?.(3) || [];
    const rounds = stops.length
      ? stops.map((p, i) => `${i + 1}. ${w.getRoomAt(p.x, p.z)?.name || 'Corridor'}`).join('\n')
      : '1. Wherever the noise is.';
    const fill = {
      leakName: leak.owner.name,
      leakUser: leak.owner.user,
      leakPass: leak.owner.pass,
      psRoom: this.ps ? this.ps.room.name : 'the Computing room',
      room000Hint,
      graffitiRoom: w.graffiti?.spot?.room || 'corridors',
      rounds,
    };
    if (leak !== pc && leak.state !== 'locked' && !leak.noteRead) leak.leaked = true;
    return C.MAIL.map((m) => ({ ...m, body: m.body.replace(/\{(\w+)\}/g, (_, k) => fill[k] ?? '') }));
  }

  /** Reading Mr Ahmet Hoca's sticky-note email counts as knowing that login (Tools lists it). */
  learnLeak(pc) {
    for (const o of this.list) {
      if (o.leaked && !o.noteRead && o.state === 'idle') {
        o.noteRead = true;
        o.leaked = false;
        if (o.note?.glint) o.note.glint.visible = false;
      }
    }
    this._emitTools();
  }

  // ================================================================== Kaan's PlayStation
  _placePlayStation() {
    const hoca = this.list.find((pc) => pc.owner?.key === 'hoca') || this.list.find((pc) => pc.room.type === 'classroom');
    if (!hoca) return;
    const spot = this._deskBeside(hoca);
    const group = new THREE.Group();
    group.name = 'playstation';
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.055, 0.22), this._mats.psBody);
    body.position.y = 0.0275;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.006, 0.01), this._mats.psLight);
    stripe.position.set(0, 0.03, 0.112);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.085), this._mats.psBody);
    pad.position.set(0.05, 0.015, 0.2);
    pad.rotation.y = 0.4;
    group.add(body, stripe, pad);
    group.position.set(spot.x, spot.y, spot.z);
    group.rotation.y = spot.rotY;
    const glint = this._glint(0x9fc8ff, 0.2);
    glint.position.set(spot.x, spot.y + 0.14, spot.z);
    this.group.add(group, glint);
    const self = this;
    this.ps = {
      room: hoca.room,
      pc: hoca,
      mesh: group,
      glint,
      taken: false,
      playing: false,
      used: false,
      interactable: {
        id: 'ps',
        kind: 'item',
        position: new THREE.Vector3(spot.x, spot.y + 0.06, spot.z),
        range: 2.0,
        object: group,
        getPrompt: () => (self.ps.taken ? null : "Take Kaan's PlayStation (a distraction)"),
        interact: () => self._takePlayStation(),
      },
    };
  }

  _takePlayStation() {
    const ps = this.ps;
    if (!ps || ps.taken) return false;
    ps.taken = true;
    ps.mesh.visible = false;
    ps.glint.visible = false;
    this.gadget = 'ps';
    this.game.coop?.onPsTake?.();
    this.game.audio?.play?.('pickup');
    this.events?.emit('tip', { id: 'playstation' });
    this.events?.emit('schoolnet:gadget', { has: true });
    this._rebuild();
    this._emitTools();
    return true;
  }

  /** G (or the PS button on tablets): put the PlayStation down here and switch it on. */
  useGadget() {
    const g = this.game;
    const p = g.player;
    if (this.gadget !== 'ps' || g.state !== 'playing' || !p || p.isHidden) return false;
    this.gadget = null;
    const ps = this.ps;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    let x = p.position.x + fx * 0.6;
    let z = p.position.z + fz * 0.6;
    if (!g.world.isWalkable?.(x, z, 0.1)) {
      x = p.position.x;
      z = p.position.z;
    }
    ps.mesh.position.set(x, 0.01, z);
    ps.mesh.rotation.y = p.yaw;
    ps.mesh.visible = true;
    ps.pos = new THREE.Vector3(x, 0.3, z);
    ps.playing = true;
    ps.t = PS_SECONDS;
    ps.noiseT = 0;
    ps.loop = g.audio?.playLoopAt?.('ps_music', ps.pos, 0.85) || null;
    g.enemy?.distract?.(new THREE.Vector3(x, 0, z));
    g.coop?.onPsDrop?.(x, z, p.yaw);
    g.subtitle?.('[Kaan\'s PlayStation: "ONE MORE MATCH!"]', 4, '');
    g.moment?.('playstation-used', {});
    this.events?.emit('schoolnet:gadget', { has: false });
    this._emitTools();
    return true;
  }

  /** Co-op: a teammate took the PlayStation off Hoca's desk. */
  remotePsTake() {
    const ps = this.ps;
    if (!ps || ps.taken) return;
    ps.taken = true;
    ps.mesh.visible = false;
    ps.glint.visible = false;
    this._rebuild();
    this._emitTools();
  }

  /** Co-op: a teammate switched it on somewhere (their screen makes the noise for the caretaker). */
  remotePsDrop(x, z, yaw) {
    const g = this.game;
    const ps = this.ps;
    if (!ps || ps.playing) return;
    ps.taken = true;
    ps.remote = true;
    ps.glint.visible = false;
    ps.mesh.position.set(x, 0.01, z);
    ps.mesh.rotation.y = yaw;
    ps.mesh.visible = true;
    ps.pos = new THREE.Vector3(x, 0.3, z);
    ps.playing = true;
    ps.t = PS_SECONDS;
    ps.noiseT = 0;
    ps.loop = g.audio?.playLoopAt?.('ps_music', ps.pos, 0.85) || null;
    this._rebuild();
    this._emitTools();
  }

  _updatePlayStation(dt) {
    const ps = this.ps;
    ps.t -= dt;
    ps.noiseT -= dt;
    if (ps.noiseT <= 0 && !ps.remote) {
      ps.noiseT = PS_NOISE_EVERY;
      this.events?.emit('noise', { position: ps.pos.clone(), radius: 18, source: 'playstation' });
    }
    if (ps.t <= 0) {
      ps.playing = false;
      ps.used = true;
      ps.loop?.stop(0.6);
      ps.loop = null;
      this.game.subtitle?.('[the PlayStation dies: battery flat]', 2.5, '');
    }
  }

  // ================================================================== Room 000 register
  _placeRegister() {
    const w = this.game.world;
    const room = w.room000;
    const key = w.itemSpawns?.key;
    if (!room || !key) return;
    let best = null;
    for (const [owner, list] of w.static.owners) {
      if (!String(owner).startsWith('room:')) continue;
      for (const pl of list) {
        if (pl.node !== 'desk_old') continue;
        const e = pl.m.elements;
        if (w.getRoomAt(e[12], e[14]) !== room) continue;
        const d = Math.hypot(e[12] - key.x, e[14] - key.z);
        if (!best || d < best.d) best = { d, m: pl.m };
      }
    }
    if (!best) return;
    const top = (w.kit.bbox?.('desk_old')?.max.y || 0.75) + 0.012;
    best.m.decompose(_v, _q, _s);
    const book = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.024, 0.28), this._mats.register);
    book.position.set(_v.x, top, _v.z);
    book.quaternion.copy(_q);
    book.name = 'register';
    const glint = this._glint(0xffffff, 0.14);
    glint.position.set(_v.x, top + 0.1, _v.z);
    this.group.add(book, glint);
    const self = this;
    this.register = {
      mesh: book,
      glint,
      read: false,
      signed: false,
      interactable: {
        id: 'register',
        kind: 'item',
        position: new THREE.Vector3(_v.x, top + 0.03, _v.z),
        range: 2.0,
        object: book,
        getPrompt: () => (self.register.signed ? 'Read the register' : self.register.read ? 'Sign the register (he stops hunting you, once)' : 'Read the attendance register'),
        interact: () => self._useRegister(),
      },
    };
  }

  _useRegister() {
    const r = this.register;
    if (!r) return false;
    const g = this.game;
    const lines = C.STUDENTS.map((n) => `${n.padEnd(12, '.')} ABSENT`);
    if (!r.read || r.signed) {
      r.read = true;
      r.glint.visible = false;
      lines.push(r.signed ? 'You ....... PRESENT' : '____________');
      g.ui?.showCard?.({ kind: 'register', title: C.REGISTER.title, lines, footer: r.signed ? 'Your name is on it now.' : C.REGISTER.footer, anchor: r.interactable.position });
      this.events?.emit('tip', { id: 'register' });
      this._emitTools();
      return true;
    }
    r.signed = true;
    g.enemy?.callOff?.();
    g.ach?.moment('register');
    g.audio?.play?.('cloth', { position: r.interactable.position });
    g.ui?.hideCard?.();
    g.subtitle?.('Everyone is accounted for.', 3.5, 'PA');
    g.ui?.showNotice?.('You signed the register. He has stopped hunting you.', 4);
    g.moment?.('register-signed', {});
    this._emitTools();
    return true;
  }

  _onRoom000() {
    this._emitTools();
  }

  // ================================================================== vending machine (Chloe)
  _placeVending() {
    const w = this.game.world;
    const room = w.rooms.find((r) => r.type === 'reception');
    if (!room) return;
    const spot = this._wallSpot(room, 0.9);
    if (!spot) return;
    const group = new THREE.Group();
    group.name = 'vending';
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.8, 0.34), this._mats.vendBody);
    box.position.y = 0.9;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 1.66), this._mats.vendOff);
    front.position.set(0, 0.93, 0.172);
    group.add(box, front);
    group.position.set(spot.x + spot.n.x * 0.17, 0, spot.z + spot.n.z * 0.17);
    group.rotation.y = Math.atan2(spot.n.x, spot.n.z);
    this.group.add(group);
    const self = this;
    this.vending = {
      mesh: group,
      front,
      on: false,
      used: false,
      interactable: {
        id: 'vending',
        kind: 'item',
        position: new THREE.Vector3(group.position.x + spot.n.x * 0.2, 1.1, group.position.z + spot.n.z * 0.2),
        range: 2.0,
        object: group,
        getPrompt: () => (self.vending.used ? null : self.vending.on ? 'Take a free can (full stamina, loud)' : 'Vending machine (out of order)'),
        interact: () => self._useVending(),
      },
    };
  }

  _switchVending(on) {
    const v = this.vending;
    if (!v) return;
    v.on = on;
    v.front.material = on ? this._mats.vendOn : this._mats.vendOff;
  }

  _useVending() {
    const v = this.vending;
    const g = this.game;
    if (!v || v.used) return false;
    if (!v.on) {
      g.subtitle?.('Out of order. Someone has written on it: VOTE CHLOE.', 3.5, '');
      return true;
    }
    v.used = true;
    g.audio?.play?.('vend_clunk', { position: v.interactable.position });
    this.events?.emit('noise', { position: v.interactable.position.clone(), radius: 12, source: 'vending' });
    g.player?.refillStamina?.();
    g.ui?.showNotice?.('A cold can. Full stamina.', 3);
    g.moment?.('vending-used', {});
    this._emitTools();
    return true;
  }

  // ================================================================== döner shop (Ozzy)
  _openDonerShop() {
    const g = this.game;
    const w = g.world;
    const p = g.player.position;
    // the corridor signs' pathfinder is always in sync with the building (his can be idle at the start)
    const nav = w.signs?.pf?.nav ? w.signs.pf : null;
    const skip = new Set([w.room000, w.itemRooms?.keycard, w.itemRooms?.fuse, w.getRoomAt(p.x, p.z)]);
    const cands = [];
    for (const room of w.rooms) {
      if (room.isCorridor || skip.has(room) || !['classroom', 'library', 'science_lab'].includes(room.type)) continue;
      let d = room.center.distanceTo(p);
      if (nav?.findPath) {
        const buf = this._pathBuf || (this._pathBuf = new Float32Array(512));
        const n = nav.findPath(p.x, p.z, room.center.x, room.center.z, buf, 256);
        if (!n || nav.lastPartial) continue;
        d = nav.lastLength || d;
      }
      cands.push({ room, d });
    }
    // a walk, not a marathon: the nearest room at least 15 m away
    cands.sort((a, b) => (a.d < 15) - (b.d < 15) || a.d - b.d);
    for (const c of cands) {
      const spot = this._wallSpot(c.room, 1.3);
      if (!spot) continue;
      this._buildShop(c.room, spot);
      break;
    }
    this._placeArrows();
    this._rebuild();
  }

  _buildShop(room, spot) {
    const group = new THREE.Group();
    group.name = 'doner-shop';
    const counter = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 0.46), this._mats.shopCounter);
    counter.position.y = 0.475;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.85), this._mats.shopFront);
    front.position.set(0, 0.48, 0.232);
    const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.15, 0.46, 10), this._mats.doner);
    spit.position.set(-0.38, 0.95 + 0.23, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6), this._mats.psBody);
    pole.position.set(-0.38, 0.95 + 0.31, 0);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.55), this._mats.shopSign);
    sign.position.set(0, 1.85, -0.05);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.2, 8), this._mats.wrap);
    wrap.rotation.z = Math.PI / 2;
    wrap.position.set(0.18, 0.99, 0.05);
    group.add(counter, front, spit, pole, sign, wrap);
    group.position.set(spot.x + spot.n.x * 0.25, 0, spot.z + spot.n.z * 0.25);
    group.rotation.y = Math.atan2(spot.n.x, spot.n.z);
    this.group.add(group);
    group.updateMatrixWorld(true);
    const wrapPos = wrap.getWorldPosition(new THREE.Vector3());
    const glint = this._glint(0xffd27a, 0.22);
    glint.position.copy(wrapPos).y += 0.1;
    this.group.add(glint);
    const self = this;
    this.doner = {
      room,
      group,
      spit,
      wrap,
      glint,
      eaten: false,
      interactable: {
        id: 'doner',
        kind: 'item',
        position: wrapPos,
        range: 2.2,
        object: wrap,
        getPrompt: () => (self.doner.eaten ? null : 'Eat the döner (full stamina, 20 s unlimited sprint)'),
        interact: () => self._eatDoner(),
      },
    };
  }

  _eatDoner() {
    const d = this.doner;
    const g = this.game;
    if (!d || d.eaten) return false;
    d.eaten = true;
    d.wrap.visible = false;
    d.glint.visible = false;
    g.player?.boost?.(DONER_BOOST);
    g.audio?.play?.('eat_doner');
    g.subtitle?.('I just ate a shawarma.', 3, '');
    g.ui?.showNotice?.(`Döner: full stamina and ${DONER_BOOST} s of unlimited sprint.`, 4);
    g.moment?.('doner-eaten', {});
    this._clearArrows();
    this._emitTools();
    return true;
  }

  /** Glowing A-frame signs (his face, "OZZY DÖNER", an arrow) at corridor junctions, pointing the real way. */
  _placeArrows() {
    this._clearArrows();
    const d = this.doner;
    const signs = this.game.world?.signs;
    if (!d || d.eaten || !signs?.sites?.length || !signs._field) return;
    let field;
    try {
      field = signs._field(d.room);
    } catch {
      return;
    }
    const w = this.game.world;
    for (const site of signs.sites) {
      const r = signs._route(site, field);
      if (!r) continue;
      for (const f of site.arms) {
        if (this.arrows.length >= 28) break;
        let dir = null;
        if (r.arm === f) continue; // the way you came
        if (r.arm.x === -f.x && r.arm.z === -f.z) dir = 'ahead';
        else dir = r.arm.x === -f.z && r.arm.z === f.x ? 'left' : 'right';
        // standing in the arm you arrive from, to the side so nobody walks into it
        for (const side of [1, -1]) {
          const x = site.x + f.x * 2.2 + f.z * side * 1.25;
          const z = site.z + f.z * 2.2 - f.x * side * 1.25;
          if (!w.isWalkable?.(x, z, 0.3)) continue;
          const board = this._aFrame(dir);
          board.position.set(x, 0, z);
          board.rotation.y = Math.atan2(f.x, f.z);
          this.group.add(board);
          this.arrows.push(board);
          break;
        }
      }
    }
  }

  _clearArrows() {
    for (const a of this.arrows || []) this.group.remove(a);
    this.arrows = [];
  }

  _aFrame(dir) {
    const g = new THREE.Group();
    g.name = 'doner-arrow';
    const front = new THREE.Mesh(this._boardGeo || (this._boardGeo = new THREE.PlaneGeometry(0.62, 0.86)), this._mats[`arrow_${dir}`]);
    front.position.set(0, 0.44, 0.12);
    front.rotation.x = -0.24;
    const back = new THREE.Mesh(this._boardGeo, this._mats.boardBack);
    back.position.set(0, 0.44, -0.12);
    back.rotation.set(0.24, Math.PI, 0);
    g.add(front, back);
    return g;
  }

  // ================================================================== transforms
  /** The building rearranged: follow monitors and desks that moved, re-place notes in redressed rooms. */
  onTransform() {
    const w = this.game.world;
    if (!w?.static || !this.list.length) {
      if (this.doner && !this.doner.eaten) this._placeArrows();
      return;
    }
    for (const pc of [...this.list]) {
      const ref = w.static.owners.get(pc.ownerKey);
      if (ref === pc.ownerRef) continue;
      pc.ownerRef = ref;
      const moved = this._rescan(pc);
      if (!moved) {
        if (pc.state === 'open') continue; // finish the session; it locks afterwards anyway
        this.group.remove(pc.screen);
        if (pc.mesh) this.group.remove(pc.mesh);
        if (pc.note) this.group.remove(pc.note.mesh, pc.note.glint);
        this.list.splice(this.list.indexOf(pc), 1);
        // its desk is gone: the PlayStation moves to another teacher's desk
        if (this.ps && this.ps.pc === pc && !this.ps.taken) {
          const to = this.list.find((o) => o.room.type === 'classroom') || this.list[0];
          if (to) {
            this.ps.pc = to;
            this.ps.room = to.room;
            this._movePs(to);
          } else {
            this.group.remove(this.ps.mesh, this.ps.glint);
            this.ps = null;
          }
        }
        continue;
      }
      if (pc.state !== 'locked') this._placeNote(pc);
      if (this.ps && this.ps.pc === pc && !this.ps.taken) this._movePs(pc);
    }
    if (this.doner && !this.doner.eaten) this._placeArrows();
    this._rebuild();
  }

  _movePs(pc) {
    const sp = this._deskBeside(pc);
    this.ps.mesh.position.set(sp.x, sp.y, sp.z);
    this.ps.glint.position.set(sp.x, sp.y + 0.14, sp.z);
    this.ps.interactable.position.set(sp.x, sp.y + 0.06, sp.z);
  }

  /** Find this computer's monitor again after its room was redressed. false = it's gone. */
  _rescan(pc) {
    const w = this.game.world;
    const list = pc.ownerRef || [];
    const inRoom = (pl) => w.getRoomAt(pl.m.elements[12], pl.m.elements[14]) === pc.room;
    const crt = !pc.added && list.find((pl) => pl.node === 'crt_monitor' && inRoom(pl));
    if (crt) {
      pc.matrix = crt.m.clone();
    } else {
      // the redress took the monitor away (or it was one of ours): put one on the new teacher desk,
      // so the computer, its login and whatever sits beside it (the PlayStation) carry on
      const desk = list.find((pl) => pl.node === 'desk_teacher' && inRoom(pl));
      if (!desk) return false;
      pc.matrix = desk.m.clone().multiply(_m.makeTranslation(-0.35, 0.77, 0));
      if (!pc.mesh) {
        pc.mesh = w.kit.makeObject('crt_monitor');
        pc.mesh.matrixAutoUpdate = false;
        this.group.add(pc.mesh);
      }
      pc.added = true;
      pc.mesh.matrix.copy(pc.matrix);
      pc.mesh.matrixWorldNeedsUpdate = true;
    }
    this._poseComputer(pc);
    return true;
  }

  // ================================================================== tools list
  _emitTools() {
    const t = [];
    const touch = !!this.game.player?.touchMode;
    if (this.gadget === 'ps') t.push({ id: 'ps', name: "Kaan's PlayStation", how: touch ? 'PS button: put it down, switch it on' : 'G: put it down and switch it on' });
    if (this.doner && !this.doner.eaten) t.push({ id: 'doner', name: 'OZZY DÖNER is open', how: `Follow the glowing signs: ${this.doner.room.name}` });
    if (this.vending?.on && !this.vending.used) t.push({ id: 'vending', name: 'Vending machine', how: 'Reception: one free can, full stamina' });
    if (this.register && !this.register.signed && this.game.world?.room000Revealed) t.push({ id: 'register', name: 'Room 000 register', how: 'Sign it once: he stops hunting you' });
    if (this.wifi) t.push({ id: 'wifi', name: 'Free Wi-Fi', how: `Computer sessions last ${this.sessionLength()} s` });
    for (const pc of this.list) {
      if (pc.noteRead && pc.state === 'idle') t.push({ id: pc.id, name: `Login: ${pc.room.name}`, how: `${pc.owner.user} / ${pc.owner.pass}` });
    }
    this.tools = t;
    this.events?.emit('schoolnet:tools', { tools: t });
  }

  _rebuild() {
    const list = [];
    for (const pc of this.list) {
      list.push(pc.interactable);
      if (pc.note && pc.state !== 'locked') list.push(pc.note.interactable);
    }
    if (this.ps && !this.ps.taken) list.push(this.ps.interactable);
    if (this.register) list.push(this.register.interactable);
    if (this.vending && !this.vending.used) list.push(this.vending.interactable);
    if (this.doner && !this.doner.eaten) list.push(this.doner.interactable);
    this._interactables = list;
  }

  // ================================================================== placement helpers
  /** A spot on the computer's desk beside the monitor (for the PlayStation). */
  _deskBeside(pc) {
    _v.set(0.62, 0, 0.12).applyMatrix4(pc.matrix);
    pc.matrix.decompose(new THREE.Vector3(), _q, _s);
    const rotY = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
    return { x: _v.x, y: pc.matrix.elements[13] + 0.002, z: _v.z, rotY: rotY + 0.3 };
  }

  /** A bare stretch of wall in `room` with walkable floor in front (for the stand and the machine). */
  _wallSpot(room, width) {
    const w = this.game.world;
    const inf = w.dresser?.info?.(room.layout);
    if (!inf) return null;
    const things = [];
    for (const [owner, list] of w.static.owners) {
      if (!String(owner).startsWith('room:')) continue;
      for (const pl of list) {
        if (/^(ceiling_|decal_|papers_|light_)/.test(pl.node)) continue;
        const e = pl.m.elements;
        if (e[13] > 2.0) continue;
        if (w.getRoomAt(e[12], e[14]) === room) things.push(e[12], e[14]);
      }
    }
    const doors = (w.doors || []).filter((d) => d.position).map((d) => d.position);
    const out = [];
    for (const wall of inf.walls) {
      if (wall.type !== ET.WALL && wall.type !== ET.EXT) continue;
      for (const s of [2.0, 1.2, 2.8]) {
        const q = w.dresser.wallPoint(wall, s, 0.02);
        const fx = q.x + wall.n.x * 0.75;
        const fz = q.z + wall.n.z * 0.75;
        if (!w.isWalkable?.(fx, fz, 0.45)) continue;
        if (doors.some((d) => Math.hypot(d.x - q.x, d.z - q.z) < 1.5)) continue;
        let clear = true;
        for (let i = 0; i < things.length; i += 2) if (Math.hypot(things[i] - q.x, things[i + 1] - q.z) < width * 0.5 + 0.55) clear = false;
        if (clear) out.push({ x: q.x, z: q.z, n: wall.n });
      }
    }
    if (!out.length) return null;
    return out[Math.floor((this.rng?.next() ?? Math.random()) * out.length)];
  }

  _glint(color, size) {
    if (!this._glintTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.15, 'rgba(255,255,255,0.7)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.12)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      this._glintTex = new THREE.CanvasTexture(c);
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._glintTex, color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(size);
    s.renderOrder = 5;
    return s;
  }

  // ================================================================== materials & textures
  _canvasTex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.userData.redraw = () => {
      draw(c.getContext('2d'), w, h);
      t.needsUpdate = true;
    };
    return t;
  }

  _screenTex(state) {
    this._screens = this._screens || {};
    if (this._screens[state]) return this._screens[state];
    const t = this._canvasTex(128, 112, (ctx, w, h) => {
      const red = state === 'locked';
      ctx.fillStyle = red ? '#1a0505' : '#04140a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = red ? '#ff5a4a' : '#7dff8a';
      ctx.font = `bold 15px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText('SCHOOLNET 95', w / 2, 26);
      ctx.font = `11px ${MONO}`;
      if (state === 'login') {
        ctx.fillText('user: ________', w / 2, 56);
        ctx.fillText('pass: ________', w / 2, 72);
        ctx.fillText('> LOG IN_', w / 2, 96);
      } else if (state === 'open') {
        ctx.fillText('SESSION ACTIVE', w / 2, 64);
      } else {
        ctx.fillText('ACCOUNT', w / 2, 60);
        ctx.fillText('LOCKED', w / 2, 76);
      }
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000';
      for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
      ctx.globalAlpha = 1;
    });
    this._screens[state] = t;
    return t;
  }

  _loadFace() {
    const img = new Image();
    img.onload = () => {
      this._face = img;
      for (const t of this._faceWaiters) t.userData.redraw?.();
    };
    img.src = FACE_URL;
  }

  _drawFace(ctx, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = '#e8c33a';
    ctx.fill();
    if (this._face) {
      ctx.clip();
      const s = Math.min(this._face.width, this._face.height);
      ctx.drawImage(this._face, (this._face.width - s) / 2, (this._face.height - s) / 2 - s * 0.04, s, s, cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  _arrowTex(dir) {
    const t = this._canvasTex(256, 356, (ctx, w, h) => {
      ctx.fillStyle = '#4a0d0d';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 8;
      ctx.strokeRect(8, 8, w - 16, h - 16);
      ctx.fillStyle = '#ffe680';
      ctx.textAlign = 'center';
      ctx.font = `bold 40px ${COND}`;
      ctx.fillText('OZZY', w / 2, 56);
      ctx.fillText('DÖNER', w / 2, 96);
      this._drawFace(ctx, w / 2, 160, 50);
      // the arrow
      ctx.save();
      ctx.translate(w / 2, 280);
      ctx.rotate(dir === 'left' ? -Math.PI / 2 : dir === 'right' ? Math.PI / 2 : 0);
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(0, -52);
      ctx.lineTo(42, -6);
      ctx.lineTo(16, -6);
      ctx.lineTo(16, 46);
      ctx.lineTo(-16, 46);
      ctx.lineTo(-16, -6);
      ctx.lineTo(-42, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = `20px ${HAND}`;
      ctx.fillStyle = '#fff3c4';
      ctx.fillText('baba come!', w / 2, h - 20);
    });
    this._faceWaiters.push(t);
    return t;
  }

  _makeMaterials() {
    const glow = (map, k = 1.6) => new THREE.MeshBasicMaterial({ map, color: new THREE.Color(k, k, k), fog: false, side: THREE.FrontSide });
    const lambert = (color, opts = {}) => addVertexSnap(new THREE.MeshLambertMaterial({ color, ...opts }));
    const noteTex = this._canvasTex(64, 64, (ctx, w, h) => {
      ctx.fillStyle = '#f7e36a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(0, 0, w, 10);
      ctx.strokeStyle = '#2b3a8f';
      ctx.lineWidth = 2;
      for (let y = 20; y < 58; y += 10) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        for (let x = 8; x < 56; x += 6) ctx.lineTo(x, y + Math.sin(x * 0.9 + y) * 2);
        ctx.stroke();
      }
    });
    const registerTex = this._canvasTex(128, 96, (ctx, w, h) => {
      ctx.fillStyle = '#e9e1cc';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5b1a1a';
      ctx.fillRect(w / 2 - 2, 0, 4, h);
      ctx.fillStyle = '#3a3a3a';
      for (let y = 12; y < h - 8; y += 9) {
        ctx.fillRect(8, y, 40, 2);
        ctx.fillRect(70, y, 30, 2);
      }
    });
    const vendTex = (on) => this._canvasTex(128, 272, (ctx, w, h) => {
      ctx.fillStyle = on ? '#0d2a4a' : '#111418';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = on ? '#bfe4ff' : '#4a5058';
      ctx.font = `bold 18px ${COND}`;
      ctx.textAlign = 'center';
      ctx.fillText(on ? 'COLD DRINKS' : 'COLD DRINKS', w / 2, 24);
      const cols = ['#d62f2f', '#f2b705', '#2f8fd6', '#38b24a', '#e2e2e2'];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 4; c++) {
          ctx.fillStyle = on ? cols[(r + c) % cols.length] : '#2a2e33';
          ctx.fillRect(14 + c * 26, 40 + r * 34, 18, 26);
        }
      }
      ctx.fillStyle = '#05070a';
      ctx.fillRect(16, h - 52, w - 32, 34);
      if (on) {
        ctx.fillStyle = '#9dff9d';
        ctx.font = `bold 13px ${MONO}`;
        ctx.fillText('FREE TODAY', w / 2, h - 30);
      } else {
        ctx.save();
        ctx.translate(w / 2, 120);
        ctx.rotate(-0.12);
        ctx.fillStyle = '#f2efe6';
        ctx.fillRect(-44, -26, 88, 52);
        ctx.fillStyle = '#b01c1c';
        ctx.font = `bold 15px ${COND}`;
        ctx.fillText('OUT OF', 0, -6);
        ctx.fillText('ORDER', 0, 12);
        ctx.font = `11px ${HAND}`;
        ctx.fillStyle = '#1d3f9a';
        ctx.fillText('vote chloe!', 0, 24);
        ctx.restore();
      }
    });
    const shopFront = this._canvasTex(256, 196, (ctx, w, h) => {
      ctx.fillStyle = '#b0201c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f7f1e3';
      for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 16, 26);
      ctx.fillStyle = '#ffe680';
      ctx.textAlign = 'center';
      ctx.font = `bold 34px ${COND}`;
      ctx.fillText('OZZY DÖNER', w / 2, 80);
      ctx.font = `20px ${HAND}`;
      ctx.fillStyle = '#fff';
      ctx.fillText('Baba come,', w / 2, 120);
      ctx.fillText('I give you discount', w / 2, 146);
      ctx.font = `bold 16px ${COND}`;
      ctx.fillStyle = '#ffd34d';
      ctx.fillText('FREE FOR VOTERS', w / 2, 180);
    });
    const shopSign = this._canvasTex(384, 184, (ctx, w, h) => {
      ctx.fillStyle = '#2a0707';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 7;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      this._drawFace(ctx, 92, h / 2, 62);
      ctx.fillStyle = '#ffe680';
      ctx.textAlign = 'center';
      ctx.font = `bold 52px ${COND}`;
      ctx.fillText('OZZY', 262, 82);
      ctx.fillText('DÖNER', 262, 136);
      ctx.font = `18px ${HAND}`;
      ctx.fillStyle = '#fff3c4';
      ctx.fillText('open late', 262, 166);
    });
    this._faceWaiters.push(shopSign);
    return {
      note: lambert(0xffffff, { map: noteTex, emissive: 0x2a2408 }),
      register: lambert(0xffffff, { map: registerTex, emissive: 0x111111 }),
      psBody: lambert(0x16181c),
      psLight: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 2.2) }),
      vendBody: lambert(0x7a1f22),
      vendOff: lambert(0xffffff, { map: vendTex(false) }),
      vendOn: glow(vendTex(true), 1.3),
      shopCounter: lambert(0x8a1714),
      shopFront: glow(shopFront, 1.15),
      shopSign: glow(shopSign, 1.7),
      doner: lambert(0x8a5226, { emissive: 0x2a1206 }),
      wrap: lambert(0xf2ead8, { emissive: 0x222018 }),
      arrow_ahead: glow(this._arrowTex('ahead'), 1.8),
      arrow_left: glow(this._arrowTex('left'), 1.8),
      arrow_right: glow(this._arrowTex('right'), 1.8),
      boardBack: lambert(0x2a0b0b),
    };
  }
}
