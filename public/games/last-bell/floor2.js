// LAST BELL — floor2.js: the upstairs objective chain (Second Floor update). Owned by the GAME workstream.
// Design: docs/last-bell-update/puzzle-systems.md. Contract: CONTRACTS.md §13.
//
//   A  find the staff access card ─────────────┐  (any order, in parallel)
//   B1 wire the junction box  ┐                │
//   B2 set the breakers       ┴─ power ───────┤
//   C  find the security login ───────────────┤
//   D  Security Office: swipe the card → log on → Access Control → RELEASE → Stair A opens
//   (+ Stair B: "Lift the chain" at the ground-floor gate, 2 s, noisy; the School Office card reader;
//    three combination lockers; the Employee of the Month photo)
//
//   new Floor2(game)
//   floor2.reset()            new run (after world.generate() and player.spawn()). The host builds the state
//                             from game.seed; ?start=floor1 (game.startFloor === 0) opens both stairs.
//   floor2.update(dt)         every frame while playing
//   floor2.objectives()       → [{ id, text, done, active, hint }] the HUD checklist while upstairs
//   floor2.getInteractables() → this floor's interactables
//   floor2.state              the last host state applied here (the same on every peer)
//   floor2.config             what the seed decided (same on every peer: derived from state.seed)
//   floor2.holdsCard(id?)     → 'staff' | 'visitor' | null
//
// Network (CONTRACTS §13.3): every change is net.request('f2', { a, ... }); the host validates (sender
// alive, not a Director, on the right floor, close enough, prerequisites, lease, rate) and broadcasts the
// whole state as 'f2s'. Solo runs the same code path. provideState('f2') resyncs late joiners.
// Leases: one player per panel (released on close, capture, leaving, or 8 s without input).
// Events: stairs:unlocked { stair }, floor2:power { on }, floor2:door { reader }, floor2:goal { id }.

import * as THREE from './lib/three/three.module.js';
import { FLOOR_Y } from './config.js';
import * as S from './security-content.js';
import { WiringPanel } from './puzzles/wiring.js';
import { BreakerPanel, BREAKER_LABELS } from './puzzles/breakers.js';
import { ComboPanel } from './puzzles/combo.js';
import { KeycardPanel } from './puzzles/keycard.js';
import { SecurityPC } from './security-pc.js';
import { CCTV } from './cctv.js';
import { ArtRoom } from './art-room.js';
import { Floor2Signs } from './world-floor2-signs.js'; // ENV: her Art room while she holds someone

const LEASE_IDLE = 8; // s without input before a panel lease lapses
const PANEL_RANGE = 3.2; // m (host check, feet to the anchor, horizontal)
const PICK_RANGE = 2.5; // m (card pick-up and swipe, puzzle-systems §4)
const HINT_AFTER = 30; // s into the run before the checklist names the rooms (was 90: players were already being hunted)
const CHAIN_TIME = 2; // s to lift Stair B's chain
const COLORS = ['red', 'blue', 'yellow', 'green'];
const PANEL_ANCHOR = { breakers: 'breaker-panel', 'security-pc': 'security-pc', 'locker-staff': 'locker-staff', 'locker-north': 'locker-north', 'locker-cabinet': 'locker-cabinet' };
const READERS = { security: { anchor: 'reader-security', name: 'SECURITY OFFICE' }, office: { anchor: 'reader-office', name: 'SCHOOL OFFICE' } };

// Where things are until ENV's world.floor2.anchors exist (map-design.md cells, 4 m, y = FLOOR_Y[1]).
// Good enough for the logic tests, not for play. yaw = the rotation.y that makes a +Z-facing plane face out.
const Y1 = FLOOR_Y[1];
const FALLBACK = {
  'card-library-desk': [8, Y1 + 0.9, 26, 0],
  'card-staff-locker': [16.4, Y1 + 1.1, 18, Math.PI / 2],
  'card-2c-desk': [32, Y1 + 0.78, 22, 0],
  'card-art-desk': [6, Y1 + 0.8, 4, 0],
  'card-lost-property': [48, Y1 + 0.5, 28, 0],
  'card-visitor': [4, Y1 + 0.9, 20, 0],
  'wiring-south-west': [2, Y1 + 1.3, 32.12, 0],
  'wiring-north-east': [50, Y1 + 1.3, 11.88, Math.PI],
  'breaker-panel': [39.88, Y1 + 1.3, 40, -Math.PI / 2],
  'security-pc': [32, Y1 + 1.0, 13, 0],
  'reader-security': [27.88, Y1 + 1.2, 15.4, -Math.PI / 2],
  'reader-office': [21.4, Y1 + 1.2, 35.88, Math.PI],
  'locker-staff': [16.4, Y1 + 1.2, 18, Math.PI / 2],
  'locker-north': [14, Y1 + 1.2, 8.12, 0],
  'locker-cabinet': [31.88, Y1 + 1.2, 42, -Math.PI / 2],
  'clue-breaker-staffroom': [20, Y1 + 1.5, 12.12, 0],
  'clue-breaker-prep': [38, Y1 + 1.2, 25.88, Math.PI],
  'clue-breaker-office': [22, Y1 + 0.8, 40, 0],
  'clue-login-english': [34, Y1 + 0.8, 4, 0],
  'clue-login-lab': [51.88, Y1 + 1.3, 2, -Math.PI / 2],
  'clue-login-staffroom': [23.88, Y1 + 1.4, 16, -Math.PI / 2],
  'clue-login-office': [21, Y1 + 0.8, 41, 0],
  'clue-calendar': [23.88, Y1 + 1.5, 20, -Math.PI / 2],
  'clue-blackboard': [16, Y1 + 1.5, 0.12, 0],
  'clue-plaque': [20.12, Y1 + 1.6, 40, Math.PI / 2],
  'eotm-frame': [28, Y1 + 1.6, 43.88, Math.PI],
  'stair-a-door': [26, Y1 + 1.2, 8, Math.PI],
  'stair-b-gate': [42, 1.1, 36.3, 0],
};
const FALLBACK_FLOOR = { 'stair-b-gate': 0 };

function rng(seed) {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Everything the seed decides. Pure: every peer derives the same config from the same seed. */
export function buildConfig(seed) {
  const r = rng((Number(seed) || 1) ^ 0x2f10e2);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const shuffle = (a) => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  const cfg = {};
  cfg.cardSpot = pick(Object.keys(S.CARD_SPOTS));
  cfg.box = r() < 0.5 ? 'south-west' : 'north-east';
  cfg.cables = shuffle(COLORS);
  do cfg.terminals = shuffle(COLORS);
  while (cfg.terminals.join() === cfg.cables.join());
  cfg.breakerAnswer = pick(S.BREAKER_CONFIGS).slice();
  let start;
  do start = Array.from({ length: 8 }, () => (r() < 0.45 ? 1 : 0));
  while (start.reduce((n, v, i) => n + (v !== cfg.breakerAnswer[i] ? 1 : 0), 0) < 3);
  cfg.breakerStart = start;
  cfg.pass = pick(S.PASSWORDS);
  cfg.loginClue = pick(Object.keys(S.LOGIN_CLUES));
  cfg.breakerClue = pick(Object.keys(S.BREAKER_CLUE_SPOTS));
  // the staff locker: its owner's birthday (day + month) on the staffroom calendar
  const used = new Set();
  cfg.calendar = S.CALENDAR_STAFF.map((name) => {
    let day, month;
    do {
      day = int(10, 28);
      month = int(1, 9);
    } while (used.has(`${day}${month}`));
    used.add(`${day}${month}`);
    return { name, day, month };
  });
  const owner = pick(cfg.calendar);
  cfg.staffOwner = owner.name;
  // the North Hall locker: three sums on the maths board
  const digits = [int(0, 9), int(0, 9), int(0, 9)];
  cfg.sums = digits.map((d) => {
    const k = Math.floor(r() * 4);
    if (k === 0) {
      const a = int(0, d);
      return `${a} + ${d - a}`;
    }
    if (k === 1) {
      const b = int(1, 9);
      return `${d + b} − ${b}`;
    }
    if (k === 2) {
      const pairs = [];
      for (let a = 1; a <= 9; a++) if (d % a === 0 && d / a <= 9) pairs.push([a, d / a]);
      if (!d) return `0 × ${int(2, 9)}`;
      const [a, b] = pick(pairs);
      return `${a} × ${b}`;
    }
    const b = int(2, 5);
    return `${d * b} ÷ ${b}`;
  });
  // the principal's cabinet: the last three digits of a year on the founding plaque
  cfg.years = {};
  for (const e of S.PLAQUE_EVENTS) cfg.years[e.key] = int(e.lo, e.hi);
  cfg.cabinetEvent = pick(S.PLAQUE_EVENTS).key;
  cfg.codes = {
    'locker-staff': `${owner.day}${owner.month}`,
    'locker-north': digits.join(''),
    'locker-cabinet': String(cfg.years[cfg.cabinetEvent]).slice(1),
  };
  return cfg;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const h2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Floor2 {
  constructor(game) {
    this.game = game;
    this.state = null; // the view (last applied 'f2s')
    this.config = null;
    this._auth = null; // host only: the authoritative state
    this._cfgSeed = null;
    this.group = null;
    this._disposables = [];
    this._interactables = [];
    this.panels = {
      wiring: new WiringPanel(game),
      breakers: new BreakerPanel(game),
      combo: new ComboPanel(game),
      keycard: new KeycardPanel(game),
      pc: new SecurityPC(game),
    };
    this._open = null; // { panel, lease, ctx }
    this._rate = new Map();
    this._leaseT = {};
    this._chainStart = new Map();
    this._lastPos = new Map();
    this._runT = 0;
    this._wired = false;
  }

  _wire() {
    if (this._wired || !this.game.net) return;
    this._wired = true;
    const g = this.game;
    const net = g.net;
    net.handle('f2', (d, from) => this._hostRequest(d, from));
    net.on('f2s', (s) => this._apply(s));
    net.provideState?.('f2', () => (this._auth ? clone(this._auth) : this.state ? clone(this.state) : null));
    net.onState?.('f2', (s) => s && this._apply(s));
    const ev = g.events;
    // DOWN BAD: the HallPass founder, caught by The Assistant (only ever our own capture on our own client)
    ev.on('enemy:capture', (e) => {
      const id = e?.targetId ?? e?.target?.netId ?? (e?.target === g.player ? net.selfId : null);
      if (e?.who === 'assistant' && id != null && id === net.selfId && g.isFounder?.(id) && !this._downBad) {
        this._downBad = true;
        g.moment?.('down-bad');
      }
    });
    ev.on('enemy:capture', (e) => {
      if (!net.isHost || !this._auth) return;
      const id = e?.targetId ?? (e?.target === g.player ? net.selfId : null);
      if (id) this._hostLost(id, 'caught');
    });
    ev.on('player:left', (e) => net.isHost && this._auth && e?.id && this._hostLost(e.id, 'left'));
    ev.on('player:caught', () => this._cancelChain('caught'));
  }

  // ================================================================== run lifecycle
  reset() {
    const g = this.game;
    this._downBad = false;
    this._eggs = new Set();
    this._wire();
    for (const p of Object.values(this.panels)) if (p.isOpen) p.close('force');
    this.panels.pc.reset();
    this._open = null;
    this._chain = null;
    this._rate.clear();
    this._leaseT = {};
    this._chainStart.clear();
    this._lastPos.clear();
    this._runT = 0;
    this._guideT = 0;
    this._sawSecurity = false;
    this._sawStairNear = false;
    this._hinted = {};
    this._touchT = 0;
    this._retryT = 0;
    this._hostT = 0;
    this.state = null;
    this._auth = null;
    this._buildVisuals(null);
    this.artRoom?.dispose();
    this.artRoom = null;
    this.signs?.dispose();
    this.signs = null;
    if (!g.world) return;
    this.artRoom = new ArtRoom(g);
    this.signs = new Floor2Signs(g); // door name plates + Spine signs (beta: room names upstairs)
    this._anchors = this._readAnchors();
    if (g.net?.isHost) {
      const seed = g.seed >>> 0;
      this.config = buildConfig(seed);
      this._cfgSeed = seed;
      const c = this.config;
      const down = g.startFloor === 0 && g.mode !== 'halloween'; // The Halloween Shift: both stairs stay shut
      this._auth = {
        v: 1,
        seed,
        card: { at: c.cardSpot, holder: null, pos: null, found: false },
        visitor: { at: 'card-visitor', holder: null, pos: null },
        doors: { security: false, office: false },
        wiring: { box: c.box, done: {}, solved: false },
        breakers: { set: c.breakerStart.slice(), solved: false },
        power: false,
        login: { found: false, used: false },
        stairA: down,
        stairB: down,
        lockers: {},
        taken: {},
        leases: {},
      };
      this._broadcast();
    }
  }

  /** Anchors by id: ENV's world.floor2.anchors, else the fallback table. */
  _readAnchors() {
    const out = new Map();
    const list = this.game.world?.floor2?.anchors;
    if (Array.isArray(list)) for (const a of list) if (a?.id && a.position) out.set(a.id, { ...a, floor: a.floor ?? (a.position.y > 1.8 ? 1 : 0) });
    else if (list && typeof list === 'object') for (const [id, a] of Object.entries(list)) if (a?.position) out.set(id, { id, ...a, floor: a.floor ?? (a.position.y > 1.8 ? 1 : 0) });
    this.usingFallback = !out.size;
    // the 1996 class photo stands on the library desk unless ENV gave it an anchor
    if (!out.has('secret-photo') && out.has('card-visitor')) {
      const v = out.get('card-visitor');
      out.set('secret-photo', { id: 'secret-photo', position: v.position.clone().add(new THREE.Vector3(0.5, 0.02, 0)), yaw: v.yaw || 0, floor: v.floor ?? 1, flat: true, synthetic: true });
    }
    for (const [id, [x, y, z, yaw]] of Object.entries(FALLBACK)) {
      if (out.has(id)) continue;
      out.set(id, { id, position: new THREE.Vector3(x, y, z), yaw, floor: FALLBACK_FLOOR[id] ?? 1, fallback: true });
    }
    return out;
  }

  anchor(id) {
    return this._anchors?.get(id) || null;
  }

  // ================================================================== host
  _broadcast() {
    if (!this._auth) return;
    this._auth.v++;
    this.game.net.broadcast('f2s', clone(this._auth), { reliable: true });
  }

  _rateOk(from) {
    const now = performance.now() / 1000;
    let b = this._rate.get(from);
    if (!b) this._rate.set(from, (b = { tokens: 24, t: now }));
    b.tokens = Math.min(24, b.tokens + (now - b.t) * 12);
    b.t = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  _near(info, anchorId, range) {
    const a = this.anchor(anchorId);
    if (!a || !info?.position) return false;
    if ((info.floor ?? 0) !== (a.floor ?? 1)) return false;
    return h2(info.position, a.position) <= range;
  }

  /** True when a position is inside Stairwell B (the chain is padlocked on the corridor side only). */
  _insideStairB(pos) {
    const st = this.game.world?.stairs;
    const f = st?.frames?.B;
    return !!(f && pos && st.local(f, pos.x, pos.z).v < 4.0);
  }

  _leaseOk(panel, from) {
    const A = this._auth;
    const L = A.leases[panel];
    const now = this.game.time || 0;
    if (L && L !== from) {
      const idle = now - (this._leaseT[panel] ?? -1e9) > LEASE_IDLE;
      const gone = this.game.playerInfo?.(L)?.status !== 'alive';
      if (!idle && !gone) return false;
    }
    this._leaseT[panel] = now;
    if (A.leases[panel] !== from) {
      A.leases[panel] = from;
      this._dirty = true;
    }
    return true;
  }

  _hostRequest(d, from) {
    const A = this._auth;
    const g = this.game;
    if (!A || !d || typeof d.a !== 'string') return { ok: false, error: 'bad' };
    if (!this._rateOk(from)) return { ok: false, error: 'rate' };
    const info = g.playerInfo?.(from);
    if (!info || info.director) return { ok: false, error: 'who' };
    if (info.status !== 'alive') return { ok: false, error: 'status' };
    this._dirty = false;
    let r;
    try {
      r = this._hostAct(d, from, info);
    } catch (err) {
      console.warn('[floor2] request failed', d?.a, err);
      r = { ok: false, error: 'bad' };
    }
    if (this._dirty) this._broadcast();
    return r;
  }

  _panelAnchor(panel) {
    if (panel === 'wiring') return `wiring-${this._auth.wiring.box}`;
    return PANEL_ANCHOR[panel] || null;
  }

  _hostAct(d, from, info) {
    const A = this._auth;
    const c = this.config;
    const mark = () => (this._dirty = true);
    const panelOk = (panel) => {
      const an = this._panelAnchor(panel);
      if (!an || !this._near(info, an, PANEL_RANGE)) return 'far';
      if (!this._leaseOk(panel, from)) return 'busy';
      return null;
    };
    switch (d.a) {
      case 'lease': {
        const an = this._panelAnchor(d.panel);
        if (!an || !this._near(info, an, PANEL_RANGE)) return { ok: false, error: 'far' };
        return this._leaseOk(d.panel, from) ? { ok: true } : { ok: false, error: 'busy', holder: A.leases[d.panel] };
      }
      case 'unlease':
        if (A.leases[d.panel] === from) {
          delete A.leases[d.panel];
          mark();
        }
        return { ok: true };
      case 'touch':
        if (A.leases[d.panel] === from) this._leaseT[d.panel] = this.game.time || 0;
        return { ok: true };
      case 'pick': {
        const it = d.what === 'visitor' ? A.visitor : d.what === 'card' ? A.card : null;
        if (!it || it.holder) return { ok: false, error: 'gone' };
        const where = this._itemPos(d.what);
        if (!where || (info.floor ?? 0) !== where.floor || h2(info.position, where) > PICK_RANGE) return { ok: false, error: 'far' };
        if (d.what === 'card' && it.at === 'card-staff-locker' && !A.lockers['locker-staff']) return { ok: false, error: 'locked' };
        it.holder = from;
        it.at = null;
        it.pos = null;
        if (d.what === 'card') it.found = true;
        mark();
        return { ok: true };
      }
      case 'swipe': {
        const rd = READERS[d.reader];
        if (!rd || !this._near(info, rd.anchor, PICK_RANGE + 0.5)) return { ok: false, error: 'far' };
        if (A.doors[d.reader]) return { ok: true };
        if (A.card.holder !== from) return { ok: false, denied: true };
        A.doors[d.reader] = true;
        mark();
        return { ok: true };
      }
      case 'wire': {
        const e = panelOk('wiring');
        if (e) return { ok: false, error: e };
        const ti = d.terminal | 0;
        if (!COLORS.includes(d.color) || ti < 0 || ti > 3) return { ok: false, error: 'bad' };
        if (A.wiring.done[d.color]) return { ok: true, solved: A.wiring.solved };
        if (c.terminals[ti] !== d.color) return { ok: false, error: 'wrong' };
        A.wiring.done[d.color] = true;
        A.wiring.solved = COLORS.every((k) => A.wiring.done[k]);
        A.power = A.wiring.solved && A.breakers.solved;
        mark();
        return { ok: true, solved: A.wiring.solved };
      }
      case 'flip': {
        const e = panelOk('breakers');
        if (e) return { ok: false, error: e };
        if (A.breakers.solved) return { ok: false, error: 'solved' };
        const i = d.i | 0;
        if (i < 0 || i > 7) return { ok: false, error: 'bad' };
        A.breakers.set[i] = d.on ? 1 : 0;
        mark();
        return { ok: true };
      }
      case 'test': {
        const e = panelOk('breakers');
        if (e) return { ok: false, error: e };
        if (!A.breakers.solved) {
          if (!A.breakers.set.every((v, i) => v === c.breakerAnswer[i])) return { ok: false, error: 'wrong' };
          A.breakers.solved = true;
          A.power = A.wiring.solved && A.breakers.solved;
          mark();
        }
        return { ok: true, power: A.power };
      }
      case 'read':
        if (d.clue === 'login' && !A.login.found && this._near(info, c.loginClue, PANEL_RANGE)) {
          A.login.found = true;
          mark();
        }
        return { ok: true };
      case 'login': {
        const e = panelOk('security-pc');
        if (e) return { ok: false, error: e };
        if (!A.power) return { ok: false, error: 'power' };
        if (A.login.used) return { ok: true };
        if (String(d.user || '').toLowerCase() !== S.SEC_USER || String(d.pass || '') !== c.pass) return { ok: false, error: 'wrong' };
        A.login.used = true;
        A.login.found = true;
        mark();
        return { ok: true };
      }
      case 'release': {
        const e = panelOk('security-pc');
        if (e) return { ok: false, error: e };
        if (!A.power || !A.login.used) return { ok: false, error: 'login' };
        if (!A.stairA) {
          A.stairA = true;
          mark();
        }
        return { ok: true };
      }
      case 'open': {
        const id = d.locker;
        if (!c.codes[id]) return { ok: false, error: 'bad' };
        const e = panelOk(id);
        if (e) return { ok: false, error: e };
        if (A.lockers[id]) return { ok: true };
        if (String(d.code) !== c.codes[id]) return { ok: false, error: 'wrong' };
        A.lockers[id] = true;
        mark();
        return { ok: true };
      }
      case 'take': {
        const id = d.locker;
        if (!A.lockers[id] || A.taken[id] || !this._near(info, id, PANEL_RANGE)) return { ok: false, error: 'gone' };
        A.taken[id] = from;
        mark();
        return { ok: true };
      }
      case 'chain': {
        if (A.stairB) return { ok: true };
        if (!this._near(info, 'stair-b-gate', 2.6)) return { ok: false, error: 'far' };
        if (this._insideStairB(info.position)) return { ok: false, error: 'inside' }; // padlocked from the corridor side
        const now = this.game.time || 0;
        if (d.phase === 'start') {
          this._chainStart.set(from, now);
          return { ok: true };
        }
        const t0 = this._chainStart.get(from);
        if (t0 === undefined || now - t0 < CHAIN_TIME * 0.85) return { ok: false, error: 'early' };
        this._chainStart.delete(from);
        A.stairB = true;
        mark();
        return { ok: true };
      }
      default:
        return { ok: false, error: 'unknown' };
    }
  }

  /** Host: a player was caught or left. Drop the card where they last stood; free their panels. */
  _hostLost(id) {
    const A = this._auth;
    if (!A) return;
    let changed = false;
    for (const key of ['card', 'visitor']) {
      const it = A[key];
      if (it.holder !== id) continue;
      const last = this._lastPos.get(id);
      it.holder = null;
      if (last) it.pos = [last.x, last.y, last.z, last.floor];
      else it.at = key === 'card' ? this.config.cardSpot : 'card-visitor';
      changed = true;
    }
    for (const [panel, holder] of Object.entries(A.leases)) {
      if (holder === id) {
        delete A.leases[panel];
        changed = true;
      }
    }
    this._chainStart.delete(id);
    if (changed) this._broadcast();
  }

  _hostUpdate(dt) {
    const A = this._auth;
    const g = this.game;
    this._hostT -= dt;
    if (this._hostT > 0) return;
    this._hostT = 0.5;
    const now = g.time || 0;
    let changed = false;
    // where card holders last stood on solid ground; holders who are gone drop it
    for (const key of ['card', 'visitor']) {
      const id = A[key].holder;
      if (!id) continue;
      const info = g.playerInfo?.(id);
      if (!info || info.status !== 'alive') {
        this._hostLost(id);
        continue;
      }
      const p = info.position;
      const floor = info.floor ?? 0;
      let ok = true;
      try {
        ok = g.world?.isWalkable ? g.world.isWalkable(p.x, p.z, 0.25, floor) : true;
      } catch {
        ok = true;
      }
      if (ok) this._lastPos.set(id, { x: p.x, y: g.world?.groundAt?.(p.x, p.z, floor) ?? FLOOR_Y[floor] ?? 0, z: p.z, floor });
    }
    // leases lapse after 8 s without input (or when the holder is gone)
    for (const [panel, holder] of Object.entries(A.leases)) {
      const idle = now - (this._leaseT[panel] ?? -1e9) > LEASE_IDLE;
      if (idle || g.playerInfo?.(holder)?.status !== 'alive') {
        delete A.leases[panel];
        changed = true;
      }
    }
    if (changed) this._broadcast();
  }

  // ================================================================== every peer: apply the host state
  _apply(s) {
    if (!s || typeof s !== 'object' || !s.card) return;
    const prev = this.state;
    if (prev && s.v <= prev.v && s.seed === prev.seed) return; // stale
    if (this._cfgSeed !== s.seed || !this.config) {
      this.config = buildConfig(s.seed);
      this._cfgSeed = s.seed;
    }
    if (!this._anchors) this._anchors = this._readAnchors();
    const fresh = !prev || prev.seed !== s.seed;
    this.state = s;
    if (fresh) this._buildVisuals(s);
    this._effects(fresh ? null : prev, s);
    this._syncVisuals();
    this._syncOpenPanel();
  }

  _effects(p, s) {
    const g = this.game;
    const self = g.net?.selfId;
    const notice = (t, sec = 4) => g.ui?.showNotice?.(t, sec);
    const at = (id) => this.anchor(id)?.position;
    const play = (id, pos, o = {}) => g.audio?.play?.(id, { position: pos, ...o });
    // stairs and doors (also applied on the first state, silently)
    for (const k of ['A', 'B']) {
      const open = s[`stair${k}`];
      if (!p || open !== p[`stair${k}`]) {
        try {
          g.world?.setStairState?.(k, open ? 'open' : k === 'A' ? 'locked' : 'chained');
        } catch (err) {
          console.warn('[floor2] setStairState failed', err);
        }
        if (p && open) {
          g.events.emit('stairs:unlocked', { stair: k });
          play('stair_unlock', at(k === 'A' ? 'stair-a-door' : 'stair-b-gate'));
          if (k === 'A') {
            g.announce?.('announcement_stairs_open');
            notice('Stairwell A is open. Get downstairs.', 5);
          } else notice('The chain on Stairwell B is off. A second way between the floors.', 5);
        }
      }
    }
    for (const r of Object.keys(READERS)) {
      if (s.doors[r] && (!p || !p.doors[r])) {
        this._unlockDoor(r);
        if (p) {
          g.events.emit('floor2:door', { reader: r });
          if (!this._open || this._open.panel !== 'keycard') notice(`The ${r === 'security' ? 'Security Office' : 'School Office'} door is unlocked.`);
        }
      }
    }
    if (!p) return;
    // the card
    if (s.card.holder !== p.card.holder) {
      if (s.card.holder === self) {
        play('pickup', g.player?.position);
        notice(S.CARD_TEXT.staff.pickup);
      } else if (s.card.holder) notice('Someone on your team has the staff card.');
      else if (p.card.holder) notice('The staff card was dropped.', 4);
    }
    if (s.visitor.holder === self && p.visitor.holder !== self) {
      play('pickup', g.player?.position);
      notice(S.CARD_TEXT.visitor.pickup);
    }
    if (s.card.found && !p.card.found) g.events.emit('floor2:goal', { id: 'card' });
    if (s.wiring.solved && !p.wiring.solved) {
      g.events.emit('floor2:goal', { id: 'wiring' });
      if (!s.power) notice('The junction box hums. Now the breakers.', 4);
    }
    if (s.breakers.solved && !p.breakers.solved && !s.power) notice('Breakers set. Now the junction box.', 4);
    if (s.power && !p.power) {
      g.events.emit('floor2:power', { on: true });
      g.events.emit('floor2:goal', { id: 'power' });
      play('power_on', at('security-pc'));
      g.events.emit('lights:flicker', { intensity: 0.4, duration: 0.6 });
      notice('Power restored to the Security Office.', 5);
      g._at?.(g.time + 1.6, () => g.announce?.('announcement_power_on')); // after the hum and the flicker
    }
    if (s.login.found && !p.login.found) g.events.emit('floor2:goal', { id: 'login' });
    for (const id of Object.keys(s.lockers)) {
      if (!p.lockers[id] && (!this._open || this._open.lease !== id)) play('locker_unlock', at(id));
    }
  }

  _unlockDoor(reader) {
    const w = this.game.world;
    const a = this.anchor(READERS[reader].anchor);
    const door = (w?.doors || []).find((d) => d.reader === reader) || (a ? this._nearestDoor(a) : null);
    if (!door) return;
    try {
      if (w.setDoorLocked) w.setDoorLocked(door, false);
      else {
        door.isLocked = false;
        door.locked = false;
      }
      door.open?.('world');
    } catch (err) {
      console.warn('[floor2] door unlock failed', err);
    }
  }

  _nearestDoor(a) {
    let best = null;
    let bd = 3;
    for (const d of this.game.world?.doors || []) {
      const p = d.position || d.center || d.pos;
      if (!p || (d.floor ?? 0) !== (a.floor ?? 1)) continue;
      const dist = h2(p, a.position);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  // ================================================================== asking the host
  _req(a, data = {}) {
    const net = this.game.net;
    if (!net) return Promise.resolve({ ok: false, error: 'offline' });
    return net.request('f2', { a, ...data }).then((r) => r || { ok: false, error: 'no-reply' });
  }

  holdsCard(id = this.game.net?.selfId) {
    const s = this.state;
    if (!s) return null;
    if (s.card.holder === id) return 'staff';
    if (s.visitor.holder === id) return 'visitor';
    return null;
  }

  /** Where the card (or the visitor pass) is lying: { x, y, z, floor } or null (carried / in a closed locker). */
  _itemPos(what) {
    const s = this._auth || this.state;
    const it = what === 'visitor' ? s?.visitor : s?.card;
    if (!it || it.holder) return null;
    if (it.pos) return { x: it.pos[0], y: it.pos[1], z: it.pos[2], floor: it.pos[3] };
    const a = this.anchor(it.at);
    if (!a) return null;
    return { x: a.position.x, y: a.position.y, z: a.position.z, floor: a.floor ?? 1 };
  }

  // ================================================================== panels
  _openPanel(key, lease, ctx) {
    const g = this.game;
    const p = this.panels[key];
    if (this._open || g.activeOverlay) return false;
    const self = this;
    ctx.floor ??= 1;
    ctx.activity = () => self._activity();
    ctx.onClosed = () => {
      if (self._open?.panel === key) {
        if (self._open.lease) self._req('unlease', { panel: self._open.lease });
        self._open = null;
      }
    };
    if (!p.open(ctx)) return false;
    this._open = { panel: key, lease, ctx, busy: false };
    if (lease) {
      this._req('lease', { panel: lease }).then((r) => {
        if (this._open?.panel !== key || !p.isOpen) return;
        this._open.busy = !r.ok && r.error === 'busy';
        p.setBusy(this._open.busy ? 'Someone is using this panel.' : null);
      });
    }
    return true;
  }

  _activity() {
    const o = this._open;
    if (!o?.lease) return;
    const t = performance.now();
    if (t - this._touchT < 2000) return;
    this._touchT = t;
    this._req('touch', { panel: o.lease });
  }

  /** Live state into the open panel (another player's progress, power coming on, the lease). */
  _syncOpenPanel() {
    const o = this._open;
    const s = this.state;
    if (!o || !s) return;
    const p = this.panels[o.panel];
    if (!p.isOpen) return;
    if (o.lease) {
      const holder = s.leases[o.lease];
      const busy = !!holder && holder !== this.game.net?.selfId;
      if (busy !== o.busy) {
        o.busy = busy;
        p.setBusy(busy ? 'Someone is using this panel.' : null);
      }
    }
    if (o.panel === 'wiring') p.sync({ done: { ...s.wiring.done }, solved: s.wiring.solved });
    else if (o.panel === 'breakers') {
      if (!p.isOpen || p._flipping) return;
      p.sync({ set: s.breakers.set.slice(), solved: s.breakers.solved });
    } else if (o.panel === 'pc') p.sync(this._pcCtx());
    else if (o.panel === 'keycard') p.sync({ unlocked: !!s.doors[o.ctx.reader], card: this.holdsCard() });
  }

  _pcCtx() {
    const s = this.state;
    return { powered: !!s.power, loggedIn: !!s.login.used, released: !!s.stairA, stairB: !!s.stairB, doors: { ...s.doors } };
  }

  _anchorPos(id) {
    return this.anchor(id)?.position || null;
  }

  openWiring() {
    const s = this.state;
    const c = this.config;
    const id = `wiring-${s.wiring.box}`;
    return this._openPanel('wiring', 'wiring', {
      position: this._anchorPos(id),
      box: s.wiring.box,
      cables: c.cables.slice(),
      terminals: c.terminals.slice(),
      done: { ...s.wiring.done },
      solved: s.wiring.solved,
      act: (a, d) => this._req(a, d),
    });
  }

  openBreakers() {
    const s = this.state;
    return this._openPanel('breakers', 'breakers', {
      position: this._anchorPos('breaker-panel'),
      set: s.breakers.set.slice(),
      solved: s.breakers.solved,
      act: (a, d) => this._req(a, d),
    });
  }

  openLocker(id) {
    const c = this.config;
    const L = S.LOCKERS[id];
    const code = c.codes[id];
    return this._openPanel('combo', id, {
      id,
      position: this._anchorPos(id),
      door: L.door,
      tag: id === 'locker-staff' ? c.staffOwner.toUpperCase() : L.tag,
      note: id === 'locker-cabinet' ? S.cabinetNote(c.cabinetEvent) : L.note,
      quick: (v) => v === code,
      act: (a, d) => this._req(a, { ...d, locker: id }),
    });
  }

  openReader(reader) {
    const s = this.state;
    return this._openPanel('keycard', null, {
      position: this._anchorPos(READERS[reader].anchor),
      reader,
      doorName: READERS[reader].name,
      card: this.holdsCard(),
      unlocked: !!s.doors[reader],
      act: (a, d) => this._req(a, d),
    });
  }

  openPC() {
    return this._openPanel('pc', 'security-pc', {
      position: this._anchorPos('security-pc'),
      ...this._pcCtx(),
      act: (a, d) => this._req(a, d),
      onRead: (name) => this.game.events.emit('floor2:read', { file: name }),
      cctv: this._cctv(),
    });
  }

  /** The security PC's cameras: ENV's `cctv` anchors on this floor, else two fixed rigs down the halls. */
  _cctvRigs() {
    const list = [];
    for (const a of this._anchors?.values() || []) {
      if (a.kind !== 'cctv') continue;
      list.push({ id: list.length + 1, name: a.name || a.roomName || a.room || `Camera ${list.length + 1}`, x: a.position.x, y: a.position.y, z: a.position.z, yaw: a.yaw || 0, pitch: a.pitch ?? -0.2, floor: 1 });
    }
    if (!list.length) {
      list.push({ id: 1, name: 'North Hall', x: 50.5, y: Y1 + 2.7, z: 10.5, yaw: Math.PI / 2, pitch: -0.15, floor: 1 });
      list.push({ id: 2, name: 'South Hall', x: 1.5, y: Y1 + 2.7, z: 32.1, yaw: -Math.PI / 2, pitch: -0.15, floor: 1 });
    }
    return list;
  }

  _cctv() {
    const self = this;
    return {
      rigs: () => self._cctvRigs(),
      render: (rig, canvas) => {
        self._cam ||= new CCTV(self.game);
        self._cam.render(rig, canvas);
      },
    };
  }

  // ================================================================== per frame
  update(dt) {
    const g = this.game;
    this.artRoom?.update(dt);
    if (!this.state) return;
    this._runT += dt;
    this._guideUpdate(dt);
    if (g.net?.isHost && this._auth) this._hostUpdate(dt);
    // a panel someone else holds: try to take it over once their lease lapses
    const o = this._open;
    if (o?.busy && o.lease) {
      this._retryT -= dt;
      if (this._retryT <= 0) {
        this._retryT = 1;
        this._req('lease', { panel: o.lease }).then((r) => {
          if (this._open === o && r.ok) {
            o.busy = false;
            this.panels[o.panel].setBusy(null);
          }
        });
      }
    }
    if (o?.panel === 'pc') this.panels.pc.update(dt);
    // you can't use a panel from across the room: walking off (pushed, a co-op shove) closes it
    if (o && o.ctx.position && g.player?.position && h2(g.player.position, o.ctx.position) > PANEL_RANGE + 1) this.panels[o.panel].close('force');
    if (this._chain) this._updateChain(dt);
    // the glints pulse
    if (this.group) {
      const t = g.time || 0;
      for (const gl of this._glints) gl.material.opacity = 0.35 + 0.25 * Math.sin(t * 3 + gl.userData.ph);
    }
  }

  // ---- Stair B: lift the chain (ground floor, 2 s, noisy)
  _startChain() {
    const g = this.game;
    if (this._chain || this.state?.stairB) return false;
    const a = this.anchor('stair-b-gate');
    if (this._insideStairB(g.player?.position)) {
      g.audio?.play?.('door_locked', { position: a.position });
      g.subtitle?.("It's padlocked on the corridor side. Someone downstairs could lift it.", 4, '');
      return true;
    }
    this._chain = { t: 0, pos: a.position.clone() };
    g.audio?.play?.('chain_lift', { position: a.position });
    g.events.emit('noise', { position: a.position.clone(), radius: 12, source: 'chain', floor: 0 });
    g.ui?.showNotice?.('Lifting the chain…', CHAIN_TIME + 0.3);
    this._req('chain', { phase: 'start' });
    return true;
  }

  _updateChain(dt) {
    const g = this.game;
    const c = this._chain;
    c.t += dt;
    if (g.state !== 'playing' || !g.player?.position || h2(g.player.position, c.pos) > 2.2) {
      this._cancelChain('moved');
      return;
    }
    if (c.t >= CHAIN_TIME) {
      this._chain = null;
      g.events.emit('noise', { position: c.pos.clone(), radius: 14, source: 'chain', floor: 0 });
      this._req('chain', { phase: 'done' }).then((r) => {
        if (!r.ok && r.error !== 'far') g.ui?.showNotice?.('The chain slips back. Try again.', 3);
      });
    }
  }

  _cancelChain(why) {
    if (!this._chain) return;
    this._chain = null;
    if (why === 'moved') this.game.ui?.showNotice?.('You let go of the chain.', 2.5);
  }

  // ================================================================== onboarding beats + playtest moments
  /** Once per run, per player: the Stair A plate line when you first walk up to the locked grille, and the
   *  'f2-security-first-visit' moment (so a playtest shows how long players take to find the Security Office). */
  _guideUpdate(dt) {
    const g = this.game;
    const s = this.state;
    const p = g.player?.position;
    if (!s || !p || g.state !== 'playing') return;
    if (this._guideT > 0) {
      this._guideT -= dt;
      return;
    }
    this._guideT = 0.25;
    if ((g.player.floor ?? g.world?.floorOf?.(p) ?? 0) !== 1) return;
    const near = (id, r) => {
      const a = this.anchor(id);
      return !!a && Math.hypot(a.position.x - p.x, a.position.z - p.z) < r;
    };
    if (!this._sawSecurity && near('security-pc', 4.5)) {
      this._sawSecurity = true;
      g.moment?.('f2-security-first-visit');
    }
    // after the opening lines have played, so the two never overlap
    if (!this._sawStairNear && !s.stairA && g.time > 36 && near('stair-a-door', 4)) {
      this._sawStairNear = true;
      g.subtitle?.(S.STAIR_NEAR_LINE, 4, '');
    }
  }

  // ================================================================== HUD
  objectives() {
    const s = this.state;
    if (!s) return [];
    const room = (spot, table) => table[spot]?.room || '';
    const late = this._runT > HINT_AFTER;
    const n = (s.wiring.solved ? 1 : 0) + (s.breakers.solved ? 1 : 0);
    const c = this.config;
    const list = [
      { id: 'card', text: S.GOALS.card, done: !!s.card.found, active: true, hint: s.card.found ? '' : late ? `In the ${room(c.cardSpot, S.CARD_SPOTS)}` : 'Check desks and lockers in the staff rooms' },
      {
        id: 'power',
        text: `${S.GOALS.power} (${n}/2)`,
        done: !!s.power,
        active: true,
        hint: s.power ? '' : late ? `Junction box: ${s.wiring.box === 'south-west' ? 'South Hall, west end' : 'North Hall, east end'}. Breakers: Maintenance` : 'A junction box in the halls, the breakers in Maintenance',
      },
      { id: 'login', text: S.GOALS.login, done: !!s.login.found, active: true, hint: s.login.found ? '' : late ? `A sticky note in the ${S.LOGIN_CLUES[c.loginClue]?.room}` : 'A sticky note near a staff desk' },
      { id: 'stairs', text: S.GOALS.stairs, done: !!s.stairA, active: !!(s.card.found && s.power), hint: s.stairA ? '' : 'Security Office computer: card, power, login' },
    ];
    // always listed (dimmed until Stair A opens): the reason for the whole floor is the way out below
    list.push({ id: 'down', text: S.GOALS.down, done: false, active: !!s.stairA, hint: s.stairA ? 'Stairwell A, off the North Hall' : 'Stairwell A opens from the Security Office' });
    return list;
  }

  // ================================================================== interactables
  getInteractables() {
    if (!this.state || this.game.mode === 'halloween') return []; // ground floor only: no chain, no upstairs
    // the card / visitor pass move (spot, dropped, carried): place them before the player's focus test reads
    // .position. (Bug, beta 10-18: they were only placed inside getPrompt, which the focus test only calls
    // for things already in range, so they stayed at 0,0,0 and could never be picked up.)
    for (const it of this._itemIts || []) it.sync();
    return this._interactables;
  }

  /** A secret was read: 'egg:found' once per run per secret, and the floor2 event. */
  _egg(id) {
    this.game.events.emit('floor2:secret', { id });
    this._eggs ||= new Set();
    if (this._eggs.has(id)) return;
    this._eggs.add(id);
    this.game.events.emit('egg:found', { id: `f2-${id}` });
  }

  _buildInteractables() {
    const g = this.game;
    const list = [];
    const self = this;
    const add = (id, anchorId, o) => {
      const a = this.anchor(anchorId);
      if (!a) return;
      list.push({ id: `f2:${id}`, kind: o.kind || 'panel', position: o.position || a.position, range: o.range ?? 2.0, floor: a.floor, object: o.object || null, getPrompt: o.prompt, interact: o.interact });
    };
    const floorOk = (it) => (g.player?.floor ?? g.world?.floorOf?.(g.player.position) ?? 0) === (it.floor ?? 1);
    // the card + the visitor pass (their position follows the state; getInteractables calls sync())
    this._itemIts = [];
    for (const what of ['card', 'visitor']) {
      const pos = new THREE.Vector3(0, -100, 0);
      const inLockedLocker = () => {
        const s = self.state;
        return what === 'card' && s?.card.at === 'card-staff-locker' && !s.lockers['locker-staff'];
      };
      const it = {
        id: `f2:${what}`,
        kind: 'item',
        position: pos,
        range: 2.0,
        floor: 1,
        sync: () => {
          const p = self._itemPos(what);
          if (!p) return pos.set(0, -100, 0);
          pos.set(p.x, p.y + 0.03, p.z);
          it.floor = p.floor;
        },
        getPrompt: () => {
          it.sync();
          if (!self._itemPos(what) || inLockedLocker()) return null; // a locked locker: the lock is the prompt
          return what === 'card' ? 'Pick up the staff access card' : 'Pick up the visitor pass';
        },
        interact: () => {
          self._req('pick', { what }).then((r) => {
            if (r.ok) return;
            if (r.error === 'far') g.ui?.showNotice?.('Get closer.', 2);
            else if (r.error === 'locked') g.ui?.showNotice?.('It\'s inside a locked locker.', 2.5);
          });
          return true;
        },
      };
      list.push(it);
      this._itemIts.push(it);
    }
    // junction boxes: the live one, and the other (not the security circuit)
    for (const box of ['south-west', 'north-east']) {
      add(`wiring-${box}`, `wiring-${box}`, {
        prompt: () => {
          const s = self.state;
          if (s.wiring.box !== box) return 'Junction box';
          return s.wiring.solved ? 'Junction box (connected)' : 'Open the junction box';
        },
        interact: () => {
          const s = self.state;
          if (s.wiring.box !== box) {
            g.ui?.showCard?.({ kind: 'note', title: 'DB-2F / LIGHTING', lines: ['A junction box for the corridor lights.', 'Not the security circuit.'], footer: `Try the ${box === 'south-west' ? 'North Hall, east end' : 'South Hall, west end'}.`, anchor: self._anchorPos(`wiring-${box}`) });
            return true;
          }
          return self.openWiring();
        },
      });
    }
    add('breakers', 'breaker-panel', {
      prompt: () => (self.state.breakers.solved ? 'Breaker panel (SECURITY: ON)' : 'Open the breaker panel'),
      interact: () => (self.state.breakers.solved ? (g.ui?.showNotice?.('The security circuit is on. Leave it.', 2.5), true) : self.openBreakers()),
    });
    add('pc', 'security-pc', {
      kind: 'computer',
      prompt: () => (self.state.stairA ? 'Security computer' : self.state.power ? 'Use the security computer' : 'Security computer (no power)'),
      interact: () => self.openPC(),
    });
    for (const r of Object.keys(READERS)) {
      add(`reader-${r}`, READERS[r].anchor, {
        prompt: () => (self.state.doors[r] ? null : self.holdsCard() ? 'Swipe the card' : 'Card reader'),
        interact: () => self.openReader(r),
      });
    }
    for (const id of Object.keys(S.LOCKERS)) {
      add(id, id, {
        kind: 'locker',
        prompt: () => {
          const s = self.state;
          if (!s.lockers[id]) return 'Try the combination lock';
          if (id === 'locker-staff' && s.card.at === 'card-staff-locker' && !s.card.holder) return null; // the card is the prompt
          return s.taken[id] ? null : S.LOCKER_CONTENTS[id].prompt;
        },
        interact: () => {
          const s = self.state;
          if (!s.lockers[id]) return self.openLocker(id);
          self._req('take', { locker: id }).then((r) => {
            if (!r.ok) return;
            const C = S.LOCKER_CONTENTS[id];
            const p = g.player;
            if (p) {
              p.stamina = 1;
              p.exhausted = false;
            }
            g.ui?.showCard?.({ kind: 'note', title: C.title, lines: C.lines, anchor: self._anchorPos(id) });
            g.audio?.play?.('pickup', { position: self._anchorPos(id) });
          });
          return true;
        },
      });
    }
    // clues: the security login, the circuit map, the three locker codes
    const c = this.config;
    const clue = (id, anchorId, card, onRead, prompt) =>
      add(id, anchorId, {
        kind: 'note',
        prompt: () => prompt,
        interact: () => {
          g.ui?.showCard?.({ ...card(), anchor: self._anchorPos(anchorId) });
          g.audio?.play?.('cloth', { position: self._anchorPos(anchorId) });
          onRead?.();
          return true;
        },
      });
    const L = S.LOGIN_CLUES[c.loginClue];
    clue('login', c.loginClue, () => ({ kind: 'note', title: L.title, lines: L.lines.map((l) => l.replace('{pass}', c.pass)), footer: 'The Security Office computer.' }), () => self._req('read', { clue: 'login' }), 'Read the note');
    clue('circuit', c.breakerClue, () => S.breakerClue(c.breakerAnswer, BREAKER_LABELS), null, 'Read the torn sheet');
    const owner = c.calendar.find((r) => r.name === c.staffOwner);
    void owner;
    clue('calendar', 'clue-calendar', () => S.calendarClue(c.calendar), null, 'Read the birthday calendar');
    clue('blackboard', 'clue-blackboard', () => S.blackboardClue(c.sums), null, 'Read the blackboard');
    clue('plaque', 'clue-plaque', () => S.plaqueClue(c.years), null, 'Read the plaque');
    // the Employee of the Month photo
    add('eotm', 'eotm-frame', {
      kind: 'note',
      prompt: () => 'Look at the photo',
      interact: () => {
        g.ui?.showCard?.({ ...S.SECRETS.eotm, anchor: self._anchorPos('eotm-frame') });
        self._egg('eotm');
        return true;
      },
    });
    const secret = (id, anchorId, prompt, key, visible) =>
      add(id, anchorId, {
        kind: 'note',
        prompt: () => (!visible || visible() ? prompt : null),
        interact: () => {
          g.ui?.showCard?.({ ...S.SECRETS[key], anchor: self._anchorPos(anchorId) });
          g.audio?.play?.('cloth', { position: self._anchorPos(anchorId) });
          self._egg(id);
          return true;
        },
      });
    secret('photo', 'secret-photo', 'Look at the class photo', 'photo');
    secret('drawings', 'secret-drawings', 'Look at the drawings', 'drawings');
    secret('clapper', 'locker-cabinet', 'Look at the old bell clapper', 'clapper', () => !!self.state.lockers['locker-cabinet']);
    // Stair A while it's locked; Stair B's chain (ground floor)
    add('stair-a', 'stair-a-door', {
      kind: 'door',
      prompt: () => (self.state.stairA ? null : 'Stairwell A: SECURED'),
      interact: () => {
        g.audio?.play?.('door_locked', { position: self._anchorPos('stair-a-door') });
        g.subtitle?.('SECURED: controlled from the Security Office.', 3);
        return true;
      },
    });
    add('stair-b', 'stair-b-gate', {
      kind: 'door',
      range: 2.2,
      prompt: () => (self.state.stairB || self._chain ? null : self._insideStairB(g.player?.position) ? 'Chain (padlocked from the other side)' : 'Lift the chain'),
      interact: () => self._startChain(),
    });
    // only things on your floor
    this._interactables = list.map((it) => {
      const get = it.getPrompt;
      it.getPrompt = (game) => (floorOk(it) ? get(game) : null);
      return it;
    });
  }

  // ================================================================== visuals
  _buildVisuals(s) {
    // clear the last run
    if (this.group) {
      this.group.removeFromParent();
      this.group = null;
    }
    for (const d of this._disposables.splice(0)) d.dispose?.();
    this._glints = [];
    this._interactables = [];
    if (!s || !this.game.scene) return;
    this.group = new THREE.Group();
    this.group.name = 'floor2';
    this.game.scene.add(this.group);
    const c = this.config;
    // the card and the visitor pass
    this.cardMesh = this._cardMesh('#1d3b6e', 'STAFF');
    this.visitorMesh = this._cardMesh('#b8322b', 'VISITOR');
    this.cardGlint = this._glint(0x9fc8ff, 0.22);
    this.visitorGlint = this._glint(0xffb0a0, 0.16);
    this.group.add(this.cardMesh, this.visitorMesh, this.cardGlint, this.visitorGlint);
    // paper on walls and desks: the login note, the circuit map, the calendar, the board, the plaque
    const L = S.LOGIN_CLUES[c.loginClue];
    this._sheet(c.loginClue, 0.2, 0.14, '#f3eed8', (g, w, h) => this._writeLines(g, w, h, ['user: security', `pass: ${c.pass}`], '#1f2a6a', 20), L);
    this._sheet(c.breakerClue, 0.21, 0.28, '#efe9d2', (g, w, h) => this._writeLines(g, w, h, ['CIRCUIT MAP: SECURITY', ...c.breakerAnswer.map((v, i) => (v ? `${i + 1} ON` : '')).filter(Boolean)], '#2a2a2a', 18));
    this._sheet('clue-calendar', 0.3, 0.4, '#f4f1e6', (g, w, h) => this._writeLines(g, w, h, ['BIRTHDAYS', ...c.calendar.map((r) => `${r.name}  ${r.day}/${r.month}`)], '#802040', 14));
    this._sheet('clue-blackboard', 0.9, 0.5, null, (g, w, h) => this._writeLines(g, w, h, c.sums.map((x, i) => `${i + 1})  ${x} = ?`), '#f0f0e8', 34));
    this._sheet('clue-plaque', 0.36, 0.24, '#b08a3a', (g, w, h) => this._writeLines(g, w, h, ['OPENED 1962', ...S.PLAQUE_EVENTS.map((e) => `${e.text.toUpperCase()} ${c.years[e.key]}`)], '#2a1c06', 13));
    this._buildProps();
    this._buildInteractables();
  }

  /** Framed pictures and small props: the Employee of the Month photo, the 1996 class photo, the bell clapper. */
  _buildProps() {
    const frame = (anchorId, w, h, tex, depth = 0.04) => {
      const a = this.anchor(anchorId);
      if (!a || !this.group) return null;
      const grp = new THREE.Group();
      const fg = new THREE.BoxGeometry(w + 0.07, h + 0.07, depth);
      const fm = new THREE.MeshLambertMaterial({ color: 0x4a3420 });
      const pg = new THREE.PlaneGeometry(w, h);
      const pm = new THREE.MeshLambertMaterial({ map: tex });
      this._disposables.push(fg, fm, pg, pm, tex);
      const box = new THREE.Mesh(fg, fm);
      const pic = new THREE.Mesh(pg, pm);
      pic.position.z = depth / 2 + 0.002;
      grp.add(box, pic);
      grp.position.copy(a.position);
      grp.rotation.y = a.yaw || 0;
      this.group.add(grp);
      return { grp, a };
    };
    // Employee of the Month (CHAR's portrait)
    const tl = new THREE.TextureLoader();
    const eotm = tl.load('assets/posters/assistant-eotm.png');
    eotm.colorSpace = THREE.SRGBColorSpace;
    frame('eotm-frame', 0.5, 0.625, eotm);
    // the class photo: on the library wall (ENV's anchor), or leaning back on the desk (fallback)
    const photo = this._canvasTex(320, 220, (g, w, h) => this._drawClassPhoto(g, w, h));
    const pa = this.anchor('secret-photo');
    const onWall = !!pa && !pa.flat && !pa.synthetic;
    const p = frame('secret-photo', onWall ? 0.46 : 0.3, onWall ? 0.31 : 0.2, photo, 0.02);
    if (p && (p.a.flat || p.a.synthetic)) {
      p.grp.rotation.set(-1.15, p.a.yaw || 0, 0, 'YXZ');
      p.grp.position.y += 0.1;
    }
    // the clapper: appears in the principal's cabinet once it is open
    const ca = this.anchor('locker-cabinet');
    if (ca) {
      const g = new THREE.Group();
      const brass = new THREE.MeshLambertMaterial({ color: 0xb48a2a });
      const rod = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8);
      const ball = new THREE.SphereGeometry(0.04, 10, 8);
      this._disposables.push(brass, rod, ball);
      const r = new THREE.Mesh(rod, brass);
      r.rotation.z = Math.PI / 2;
      const b = new THREE.Mesh(ball, brass);
      b.position.x = 0.12;
      g.add(r, b);
      const n = ca.normal || { x: Math.sin(ca.yaw || 0), z: Math.cos(ca.yaw || 0) };
      g.position.set(ca.position.x + n.x * 0.15, ca.position.y - 0.28, ca.position.z + n.z * 0.15);
      g.rotation.y = ca.yaw || 0;
      g.visible = false;
      this.group.add(g);
      this.clapperMesh = g;
    }
  }

  _drawClassPhoto(g, w, h) {
    g.fillStyle = '#b9a98a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#8c9a7a';
    g.fillRect(0, 0, w, h * 0.45);
    let seed = 1996;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const skin = ['#e0b896', '#c99572', '#9b6b4a', '#edc9a8'];
    const cloth = ['#2f4f8f', '#7a2a2a', '#3a6b3a', '#d8d4c8', '#5a3a6a'];
    const rows = [[10, 0.36, 0.1], [9, 0.56, 0.12], [8, 0.78, 0.14]];
    let mark = null;
    rows.forEach(([n, y, r], ri) => {
      for (let i = 0; i < n; i++) {
        const x = ((i + 0.5) / n) * w * 0.9 + w * 0.05 + (rnd() - 0.5) * 6;
        const hr = r * h * 0.5;
        g.fillStyle = cloth[(rnd() * cloth.length) | 0];
        g.fillRect(x - hr * 1.2, y * h + hr, hr * 2.4, h * 0.3);
        g.fillStyle = skin[(rnd() * skin.length) | 0];
        g.beginPath();
        g.arc(x, y * h, hr, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#2a2018';
        g.fillRect(x - hr * 0.5, y * h - hr * 0.2, 2, 2);
        g.fillRect(x + hr * 0.3, y * h - hr * 0.2, 2, 2);
        if (ri === 0 && i === 6) mark = [x, y * h, hr];
      }
    });
    if (mark) {
      g.strokeStyle = '#d01818';
      g.lineWidth = 3;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        g.ellipse(mark[0] + (k - 1), mark[1] + 1, mark[2] * 1.7 + k, mark[2] * 1.9, 0.1 * k, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#d01818';
      g.font = 'bold 22px "Marker Felt", "Comic Sans MS", cursive';
      g.fillText('me!', mark[0] + 14, mark[1] - 22);
    }
    g.fillStyle = 'rgba(40,30,10,0.55)';
    g.font = '12px "Courier New", monospace';
    g.fillText('YEAR 6   SUMMER 1996', 8, h - 6);
  }

  _canvasTex(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    this._disposables.push(t);
    return t;
  }

  _writeLines(g, w, h, lines, color, size) {
    g.fillStyle = color;
    g.font = `bold ${size}px "Courier New", monospace`;
    g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, 10, 10 + i * (size + 6), w - 20));
  }

  _cardMesh(band, label) {
    const tex = this._canvasTex(128, 80, (g, w, h) => {
      g.fillStyle = '#ecebe4';
      g.fillRect(0, 0, w, h);
      g.fillStyle = band;
      g.fillRect(0, 0, w, 24);
      g.fillStyle = '#fff';
      g.font = 'bold 16px sans-serif';
      g.fillText(label, 8, 18);
      g.fillStyle = '#8d9399';
      g.fillRect(8, 32, 28, 36);
      g.fillStyle = '#222';
      g.fillRect(108, 24, 8, 56);
    });
    const geo = new THREE.BoxGeometry(0.12, 0.004, 0.076);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    this._disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    return m;
  }

  _glint(color, size) {
    if (!this._glintTex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.15, 'rgba(255,255,255,0.7)');
      gr.addColorStop(0.4, 'rgba(255,255,255,0.12)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 64);
      this._glintTex = new THREE.CanvasTexture(cv); // kept for the session (one 64 px texture)
    }
    const mat = new THREE.SpriteMaterial({ map: this._glintTex, color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this._disposables.push(mat);
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(size);
    s.renderOrder = 5;
    s.visible = false;
    s.userData.ph = Math.random() * 6;
    this._glints.push(s);
    return s;
  }

  /** A sheet (paper, chalk, brass) on the anchor's face. */
  _sheet(anchorId, w, h, bg, draw) {
    const a = this.anchor(anchorId);
    if (!a) return null;
    const px = 256;
    const tex = this._canvasTex(px, Math.round((px * h) / w), (g, cw, ch) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, cw, ch);
      }
      draw(g, cw, ch);
    });
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: !bg, side: THREE.DoubleSide });
    this._disposables.push(geo, mat);
    const m = new THREE.Mesh(geo, mat);
    const yaw = a.yaw || 0;
    // flat on a desk (low anchors) or upright on a wall
    const onDesk = a.flat ?? (a.position.y - (FLOOR_Y[a.floor ?? 1] ?? 0) < 1.0 && !/calendar|blackboard|plaque/.test(anchorId));
    if (onDesk) {
      m.rotation.set(-Math.PI / 2, 0, yaw);
      m.position.copy(a.position).add(new THREE.Vector3(0, 0.004, 0));
    } else {
      m.rotation.set(0, yaw, 0);
      m.position.copy(a.position).add(new THREE.Vector3(Math.sin(yaw) * 0.012, 0, Math.cos(yaw) * 0.012));
    }
    this.group.add(m);
    return m;
  }

  _syncVisuals() {
    const s = this.state;
    if (!this.group || !s) return;
    const place = (mesh, glint, what) => {
      const p = this._itemPos(what);
      const hidden = what === 'card' && s.card.at === 'card-staff-locker' && !s.lockers['locker-staff'];
      const on = !!p && !hidden;
      mesh.visible = glint.visible = on;
      if (!on) return;
      mesh.position.set(p.x, p.y + 0.004, p.z);
      mesh.rotation.y = what === 'card' ? 0.5 : -0.3;
      glint.position.set(p.x, p.y + 0.08, p.z);
    };
    place(this.cardMesh, this.cardGlint, 'card');
    place(this.visitorMesh, this.visitorGlint, 'visitor');
    if (this.clapperMesh) this.clapperMesh.visible = !!s.lockers['locker-cabinet'];
  }
}
