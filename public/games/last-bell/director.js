// LAST BELL — director.js: Director Mode (Second Floor update, multiplayer.md §5). Owned by NET.
//
// A Director is a HallPass admin who joins a co-op room unseen: they never appear in the lobby, the ready
// check, the roster, the HUD team panel, the player list or any count; they are never a target, can't
// pick anything up or count for objectives, and have no microphone. They can watch (free camera, follow
// anyone), read a debug overlay, take over an enemy, trigger a few school events, and send announced
// "[HallPass staff]" chat lines. Every action is logged by the host (and shown to Directors).
//
// WHO MAY. Never a client-supplied flag, name or URL parameter:
//   • HallPass rooms: OFF unless the SDK can attest peers (room.verifyPeer, not in SDK 1.2.0; feature-
//     detected). The host asks HallPass about the peer and accepts only role admin / super_admin. The
//     "Join as Director" button only shows for a signed-in admin (game.identity) AND such an SDK.
//   • Development stub: ?director=dev, only on localhost with the SDK's `local` transport (the host, also
//     on localhost + local, accepts the claim). Nothing of this works on a real HallPass page.
// Claims the host can't verify are removed (coop.js _hostDecideClaim); so are late joiners who aren't
// verified Directors (rooms that can verify stay unlocked for Directors: 6 seats, players capped at 4).
//
// Messages (all checked on the host: the sender must be a verified Director, `from` = the SDK link)
//   Director → host  request 'dir:possess' { who }        → { ok, error? }   one Director per enemy
//                    request 'dir:release' { who }        → { ok }
//                    'dir:in' [w, mx, mz, yaw, pitch, run] (unreliable, 15 Hz; w 0 Caretaker / 1 Assistant)
//                    request 'dir:act' { who, a }         a: attack | open-door | look | wave → { ok, reason? }
//                    request 'dir:event' { k, id? }       k: flicker | red | bell | announcement (id)
//                    request 'dir:kick' { id }            a player (never the host) → { ok }
//   host → everyone  'dir:fx' { k, id? }                  the event, played by every client
//   host → Directors 'dlog' { e } | { all: [e…] }         action log: { t, gt, action, by, pid, detail }
//                    'dstate' {…}                         debug overlay, 2 Hz
//                    'dir:rel' { who, reason }            an enemy went back to its AI (timeout, left…)
// Possession runs on the host with the enemy's own code (AI hooks, feature-detected: setPossessed,
// applyInput, tryAttack): the same speeds, collision, floor and capture rules (range, strict LOS, same
// floor, cooldown). No input for 3 s, or the Director leaving, gives the enemy back to its AI.
// Events: one every 10 s per room (any Director); flicker at most 3 per 2 minutes, a fixed 2.5 s surge
// that world-lights.js already limits to ~3 changes a second (a gentle dim with Reduced effects on).
// Disclosure (multiplayer.md §5.6): the lobby's small print says staff may join; while a verified
// Director is in the room, every player sees a small "HallPass staff are in this room" line.
// Audit (§5.7): the host's log (this.log, console, the Directors' panel); posted to HallPass by the
// Director's client when the SDK offers room.audit (not in SDK 1.2.0: the log is lost with the room).

import * as THREE from './lib/three/three.module.js';
import { PLAYER } from './config.js';

export const DISCLOSURE =
  'HallPass administrators may join any online room for moderation, testing or special events, sometimes without appearing in the player list. They can see and hear what players in the room can.';

const params = new URLSearchParams(location.search);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const WHO = ['caretaker', 'assistant'];
const NAME = { caretaker: 'the Caretaker', assistant: 'The Assistant' };
const IN_HZ = 15;
const WATCHDOG_MS = 3000;
const STATE_HZ = 2;
const EVENT_COOLDOWN = 10000;
const FLICKER_CAP = { n: 3, windowMs: 120000 };
const RED_MS = 8000;
const LOG_MAX = 200;
const ANNOUNCE_IDS = ['announcement_shift', 'announcement_late', 'announcement_floor2', 'announcement_floor2_b', 'announcement_assistant', 'announcement_security_page', 'announcement_power_on', 'announcement_stairs_hint'];
const ACTIONS = new Set(['attack', 'open-door', 'look', 'wave']);
const REASON = {
  'not-director': 'Only a verified Director can do that.',
  'no-run': 'No game is running.',
  unsupported: 'That enemy can’t be taken over yet.',
  asleep: 'That enemy isn’t awake yet.',
  busy: 'Busy (catching someone).',
  taken: 'Another Director has that one.',
  refused: 'The enemy refused.',
  cooldown: 'Cooling down.',
  'no-target': 'Nobody to grab.',
  range: 'Out of reach.',
  los: 'Not in clear sight.',
  floor: 'Not on this floor.',
  'not-possessed': 'You’re not controlling it.',
  photosensitivity: 'Flicker limit: 3 every 2 minutes.',
  'bad-event': 'Unknown event.',
  timeout: 'The host didn’t answer.',
  rate: 'Too fast.',
};

const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

/** Was the dev stub asked for (?director=dev on localhost)? (The transport is checked when joining.) */
export function directorDevRequested() {
  return params.get('director') === 'dev' && LOCAL_HOSTS.has(location.hostname);
}

/** Does this SDK let the host ask HallPass who a peer is? (SDK 1.2.0: no.) */
export function sdkCanVerifyPeers() {
  const P = globalThis.HallPassP2P;
  return P?.features?.verifyPeer === true;
}

export class Director {
  constructor(game, coop) {
    this.game = game;
    this.coop = coop;
    this.devRequested = directorDevRequested();
    this.running = false;
    this.mode = 'free'; // 'free' | 'follow'
    this.follow = null; // { kind: 'player', id } | { kind: 'enemy', who }
    this.possessing = null; // 'caretaker' | 'assistant'
    this.cam = { pos: new THREE.Vector3(), yaw: 0, pitch: 0 };
    this.keys = new Set();
    this.log = []; // what this tab knows of the action log (host: all of it)
    this.dstate = null;
    this.showDebug = true;
    this.showLog = true;
    this._inT = 0;
    this._offs = [];
    // host
    this.held = new Map(); // who → { by, lastIn, since, last }
    this._stateT = 0;
    this._lastEvent = -Infinity;
    this._flickers = [];
    this._redTimer = 0;
    this._built = false;
    this._bindKeys();
    this._injectJoin();
    this._injectSmallPrint();
    game.events?.on('enemy:possessed', (e) => this._onEnemyPossessed(e));
  }

  /** May this tab offer "Join as Director"? (UX only: the host decides.) */
  get allowed() {
    if (this.devRequested) return true; // dev stub (the host still requires localhost + local transport)
    return ADMIN_ROLES.has(this.game.identity?.role) && sdkCanVerifyPeers();
  }

  get room() {
    return this.coop.room;
  }

  // =============================================================================== lobby UI
  _injectJoin() {
    const start = document.getElementById('coop-start');
    const join = start?.querySelector('.coop__join');
    if (!join) return;
    const box = document.createElement('div');
    box.className = 'dir-join';
    box.hidden = true;
    box.innerHTML = `<button type="button" class="menu-item dir-join__btn">Join as Director</button>
      <p class="dir-join__note"></p>`;
    join.after(box);
    this._joinBox = box;
    box.querySelector('button').addEventListener('click', () => this.join());
    const sync = () => {
      const on = this.allowed && !this.coop.room;
      if (box.hidden === on) box.hidden = !on;
      const note = box.querySelector('.dir-join__note');
      const text = this.devRequested ? 'Development stub (localhost only). You stay hidden from the players.' : 'HallPass staff: join unseen to watch, test or run an event.';
      if (note.textContent !== text) note.textContent = text;
    };
    sync();
    setInterval(sync, 1000); // game.identity arrives late (HallPass /me)
  }

  /** The lobby's small print (every online room). */
  _injectSmallPrint() {
    const wait = document.getElementById('coop-wait');
    if (!wait || document.querySelector('.coop-disclosure')) return;
    const p = document.createElement('p');
    p.className = 'coop-disclosure';
    p.textContent = DISCLOSURE;
    wait.after(p);
  }

  /** Players: the small on-screen line while a verified Director is in the room (coop: 'dirs'). */
  disclosure() {
    const c = this.coop;
    const on = !!c.room && c._dirIds.size > 0 && !c.amDirector && !c._wantDirector;
    if (!on && !this._note) return;
    if (!this._note) {
      const n = document.createElement('p');
      n.className = 'dir-note';
      n.setAttribute('role', 'status');
      n.title = DISCLOSURE;
      n.textContent = 'HallPass staff are in this room. They can see and hear what players can.';
      (document.getElementById('social-root') || document.body).append(n);
      this._note = n;
    }
    if (this._note.hidden === on) {
      this._note.hidden = !on;
      if (on) c.game.ui?.showNotice?.('HallPass staff joined this room.', 4);
    }
  }

  /** "Join as Director" (the code typed in the box). */
  async join(code = document.getElementById('coop-code')?.value) {
    if (!this.allowed) {
      this.coop._status('Director Mode needs a HallPass admin account.', 'error');
      return false;
    }
    await this.coop.join(code, '', { asDirector: true });
    return !!this.coop.room;
  }

  onJoinedAsDirector() {
    document.body.classList.add('lb-director');
    this.coop._status('Joined as a Director. Waiting for the host to verify you…');
    this.renderLobby();
  }

  onVerified() {
    this.coop._status('');
    this.coop.game.ui?.showNotice?.('Director Mode: you are hidden from the players.', 4);
    this.renderLobby();
  }

  /** coop._renderLobby: a Director's lobby says what they are and hides what they can't use. */
  renderLobby() {
    const c = this.coop;
    const me = c._wantDirector;
    document.body.classList.toggle('lb-director', !!me);
    if (!me) return;
    const wait = document.getElementById('coop-wait');
    if (wait) {
      wait.textContent = c.amDirector
        ? `Director (hidden): you'll watch when the host starts. ${c._lobbyPlayers().length} player(s) here.`
        : 'Director: waiting for the host to verify you…';
    }
  }

  // =============================================================================== room
  attach(room, on) {
    this.log.length = 0;
    this.held.clear();
    this._lastEvent = -Infinity;
    this._flickers.length = 0;
    on('dir:fx', (d, m) => m.from === room.hostId && this._applyFx(d));
    on('dlog', (d, m) => m.from === room.hostId && this._onLog(d));
    on('dstate', (d, m) => m.from === room.hostId && d && typeof d === 'object' && (this.dstate = d));
    on('dir:rel', (d, m) => m.from === room.hostId && this._onReleased(d));
    if (room.isHost) {
      const h = (ev, fn) => this.coop._offs.push(room.handle(ev, (d, m) => this._hostGuard(ev, d, m, fn)));
      h('dir:possess', (d, from) => this.hostPossess(d, from));
      h('dir:release', (d, from) => this.hostRelease(d, from));
      h('dir:act', (d, from) => this.hostAct(d, from));
      h('dir:event', (d, from) => this.hostEvent(d, from));
      h('dir:kick', (d, from) => this.hostKickPlayer(d, from));
      on('dir:in', (d, m) => this.hostInput(d, m));
    }
  }

  detach() {
    if (this.running) this.endRun();
    this.held.clear();
    this.dstate = null;
    document.body.classList.remove('lb-director');
    if (this._note) this._note.hidden = true;
  }

  /** Host: every Director request. Not a verified Director → refused (and logged). */
  _hostGuard(ev, d, m, fn) {
    const c = this.coop;
    if (!c.isDirector(m.from)) {
      this.hostLog('refused', m.from, { request: ev, reason: 'not a verified Director' });
      return { ok: false, error: 'not-director' };
    }
    if (!c._allow(ev, m.from)) return { ok: false, error: 'rate' };
    return fn(d, m.from);
  }

  // =============================================================================== host
  hostDirectorJoined(id, ident, how) {
    this.hostLog('joined', id, { how, role: ident?.role || null });
    try {
      this.room?.send('dlog', { all: this.log.slice(-50) }, { to: id });
    } catch {
      /* gone */
    }
    this._stateT = 0;
  }

  hostDirectorLeft(id) {
    for (const [who, h] of [...this.held]) if (h.by === id) this._release(who, 'left');
    this.hostLog('left', id, {});
  }

  hostReleaseAll(reason) {
    for (const who of [...this.held.keys()]) this._release(who, reason);
  }

  /** Every Director action (and refusal) lands here: host log, console, the Directors' log panel. */
  hostLog(action, by, detail = {}) {
    const c = this.coop;
    const e = {
      t: Date.now(),
      gt: r2(this.game.time || 0),
      action: String(action),
      by: String(by || ''),
      pid: c.peerIdentity?.(by)?.publicId || null,
      detail,
    };
    this.log.push(e);
    if (this.log.length > LOG_MAX) this.log.shift();
    console.info('[director]', e.action, e.by, JSON.stringify(detail));
    const ids = [...c._dirIds];
    if (ids.length && this.room) {
      try {
        this.room.send('dlog', { e }, { to: ids });
      } catch {
        /* closed */
      }
    }
    return e;
  }

  _enemy(who) {
    const g = this.game;
    return who === 'assistant' ? g.assistant || null : who === 'caretaker' ? g.enemy : null;
  }

  _hooks(e) {
    return !!e && typeof e.setPossessed === 'function' && typeof e.applyInput === 'function' && typeof e.tryAttack === 'function';
  }

  hostPossess(d, from) {
    const c = this.coop;
    const who = WHO.includes(d?.who) ? d.who : null;
    const e = this._enemy(who);
    const fail = (error) => {
      this.hostLog('possess-refused', from, { who, error });
      return { ok: false, error };
    };
    if (!c.active || c._ended) return fail('no-run');
    if (!this._hooks(e)) return fail('unsupported');
    if (!e.enabled) return fail('asleep');
    if (e._captureSeq || e.state === 'CAPTURE') return fail('busy');
    const h = this.held.get(who);
    if (h && h.by !== from) return fail('taken');
    if (h) return { ok: true };
    for (const [w, x] of [...this.held]) if (x.by === from) this._release(w, 'switched');
    let ok;
    try {
      ok = e.setPossessed(from);
    } catch (err) {
      console.warn('[director] setPossessed', err);
      ok = false;
    }
    if (ok === false) return fail('refused');
    this.held.set(who, { by: from, lastIn: performance.now(), since: Date.now(), last: { mx: 0, mz: 0, yaw: e.yaw || 0, pitch: 0, run: false } });
    this.hostLog('possess', from, { who });
    this._stateT = 0;
    return { ok: true };
  }

  hostRelease(d, from) {
    const who = WHO.includes(d?.who) ? d.who : null;
    const h = this.held.get(who);
    if (!h || h.by !== from) return { ok: false, error: 'not-possessed' };
    this._release(who, 'released');
    return { ok: true };
  }

  /** Back to its AI. reason: released | timeout | left | switched | run ended | kicked … */
  _release(who, reason) {
    const h = this.held.get(who);
    if (!h) return;
    this.held.delete(who);
    const e = this._enemy(who);
    this._releasing = true;
    try {
      if (e?.possessedBy === h.by || e?.possessedBy) e.setPossessed(null, reason);
    } catch (err) {
      console.warn('[director] release', err);
    } finally {
      this._releasing = false;
    }
    this.hostLog('release', h.by, { who, reason, heldMs: Date.now() - h.since });
    if (reason !== 'released' && reason !== 'left') {
      try {
        this.room?.send('dir:rel', { who, reason }, { to: h.by });
      } catch {
        /* gone */
      }
    }
    this._stateT = 0;
  }

  /** An enemy let go by itself (its own 3 s watchdog, a new run): keep the books straight. */
  _onEnemyPossessed(ev) {
    if (!this.coop.isHost || this._releasing || !ev || ev.by) return;
    const who = WHO.includes(ev.who) ? ev.who : 'caretaker';
    if (this.held.has(who)) this._release(who, ev.reason || 'released by the AI');
  }

  hostInput(d, m) {
    const c = this.coop;
    const from = m.from;
    if (!c.isDirector(from) || !Array.isArray(d) || d.length < 6 || !d.slice(0, 6).every(num)) return;
    if (!c._allow('dir:in', from)) return;
    const who = WHO[d[0]];
    const h = this.held.get(who);
    if (!h || h.by !== from) return;
    const e = this._enemy(who);
    const inp = {
      mx: clamp(d[1], -1, 1),
      mz: clamp(d[2], -1, 1),
      yaw: clamp(d[3], -1000, 1000),
      pitch: clamp(d[4], -1.4, 1.4),
      run: d[5] === 1,
      action: null,
    };
    h.last = inp;
    h.lastIn = performance.now();
    try {
      e.applyInput(inp, from);
    } catch (err) {
      console.warn('[director] applyInput', err);
    }
  }

  hostAct(d, from) {
    const who = WHO.includes(d?.who) ? d.who : null;
    const a = typeof d?.a === 'string' && ACTIONS.has(d.a) ? d.a : null;
    const h = this.held.get(who);
    if (!h || h.by !== from || !a) return { ok: false, error: 'not-possessed' };
    const e = this._enemy(who);
    h.lastIn = performance.now();
    if (a === 'attack') {
      let r;
      try {
        r = e.tryAttack(from);
      } catch (err) {
        console.warn('[director] tryAttack', err);
        r = null;
      }
      if (!r || typeof r !== 'object') r = { ok: false, reason: 'unsupported' };
      const target = r.targetId ? this.coop.roster.get(r.targetId)?.name || r.targetId : null;
      this.hostLog('attack', from, { who, ok: !!r.ok, reason: r.reason || null, target });
      return { ok: !!r.ok, error: r.ok ? undefined : r.reason || 'refused', target };
    }
    try {
      e.applyInput({ ...h.last, action: a }, from);
    } catch (err) {
      console.warn('[director] action', err);
    }
    this.hostLog('action', from, { who, a });
    return { ok: true };
  }

  hostEvent(d, from) {
    const c = this.coop;
    const k = typeof d?.k === 'string' ? d.k : '';
    const now = performance.now();
    const fail = (error, extra = {}) => {
      this.hostLog('event-refused', from, { k, error });
      return { ok: false, error, ...extra };
    };
    if (!c.active || c._ended) return fail('no-run');
    if (!['flicker', 'red', 'bell', 'announcement'].includes(k)) return fail('bad-event');
    const id = k === 'announcement' ? (ANNOUNCE_IDS.includes(d?.id) ? d.id : null) : undefined;
    if (k === 'announcement' && !id) return fail('bad-event');
    if (now - this._lastEvent < EVENT_COOLDOWN) return fail('cooldown', { wait: Math.ceil((EVENT_COOLDOWN - (now - this._lastEvent)) / 1000) });
    if (k === 'flicker') {
      this._flickers = this._flickers.filter((t) => now - t < FLICKER_CAP.windowMs);
      if (this._flickers.length >= FLICKER_CAP.n) return fail('photosensitivity');
      this._flickers.push(now);
    }
    this._lastEvent = now;
    const fx = id ? { k, id } : { k };
    try {
      this.room.send('dir:fx', fx, { to: 'all' });
    } catch (err) {
      return fail('send-failed');
    }
    this.hostLog('event', from, fx);
    return { ok: true };
  }

  hostKickPlayer(d, from) {
    const c = this.coop;
    const id = typeof d?.id === 'string' ? d.id : '';
    if (!id || id === c.selfId || id === this.room?.hostId || c.isDirector(id) || !this.room.players.some((p) => p.id === id)) {
      this.hostLog('kick-refused', from, { id });
      return { ok: false, error: 'refused' };
    }
    const name = c.roster.get(id)?.name || this.room.players.find((p) => p.id === id)?.name || id;
    this.hostLog('kick', from, { id, name });
    c._kick(id, 'A HallPass moderator removed you from the room.');
    return { ok: true };
  }

  /** Host, per frame (co-op run): the 3 s input watchdog, the debug state for Directors. */
  hostUpdate(dt) {
    const now = performance.now();
    for (const [who, h] of [...this.held]) {
      const e = this._enemy(who);
      if (now - h.lastIn > WATCHDOG_MS) this._release(who, 'timeout');
      else if (e && e.possessedBy !== undefined && e.possessedBy !== h.by) this._release(who, 'released by the AI');
    }
    if (!this.coop._dirIds.size) return;
    this._stateT -= dt;
    if (this._stateT > 0) return;
    this._stateT = 1 / STATE_HZ;
    try {
      this.room.send('dstate', this._hostState(), { to: [...this.coop._dirIds], reliable: false });
    } catch {
      /* next tick */
    }
  }

  _hostState() {
    const g = this.game;
    const c = this.coop;
    const tid = (t) => (!t ? null : t === g.player ? c.selfId : t.id ?? null);
    const en = [];
    for (const who of WHO) {
      const e = this._enemy(who);
      if (!e) continue;
      const p = e.position || e.object?.position;
      en.push({
        who,
        on: !!e.enabled,
        st: String(e.state || ''),
        tg: tid(e._target),
        p: p ? [r2(p.x), r2(p.y), r2(p.z)] : null,
        by: this.held.get(who)?.by || null,
        m: r2(e.meter || 0),
        los: e._los ? 1 : 0,
        mv: String(e.moveStatus || ''),
        hooks: this._hooks(e) ? 1 : 0,
      });
    }
    const pl = [...c.roster.values()].map((r) => {
      const info = c.playerInfo(r.id);
      const p = info?.position;
      return { id: r.id, n: r.name, st: r.id === c.selfId ? c.status : r.status, f: info?.floor ?? -1, h: info?.hidden ? 1 : 0, at: r.at, p: p ? [r2(p.x), r2(p.y), r2(p.z)] : null };
    });
    let stats = {};
    try {
      stats = this.room.stats?.() || {};
    } catch {
      stats = {};
    }
    const peers = Object.entries(stats).map(([id, s]) => [id, s?.rttMs ?? null, s?.lossPct ?? null, s?.bytesIn ?? 0, s?.bytesOut ?? 0, s?.relay ? 1 : 0]);
    let shared = '';
    try {
      shared = JSON.stringify(g.net?.snapshotAll?.() || {});
    } catch {
      shared = '';
    }
    return {
      t: r2(g.time),
      left: r2(g.timeLeft),
      en,
      pl,
      obj: {
        f1: !!g.floor1Reached,
        exit: !!c.exitOpen,
        r0: !!g.room000Revealed,
        xf: g.transforms || 0,
        items: [...c._picked],
        shared: shared.length > 1500 ? shared.slice(0, 1500) + '…' : shared,
      },
      net: { peers, dropped: { ...c._rl.dropped }, bad: c.netStats?.bad || 0, bus: { ...(g.net?.stats || {}) } },
    };
  }

  // =============================================================================== everyone
  /** A Director's event, on every client (players included). */
  _applyFx(d) {
    const g = this.game;
    if (!this.coop.active || g.state !== 'playing' || !d) return;
    const w = g.world;
    switch (d.k) {
      case 'flicker':
        // world-lights.js holds every level ≥ 0.17 s and turns it into a slow dim with Reduced effects
        g.events.emit('lights:flicker', { intensity: 0.7, duration: 2.5 });
        break;
      case 'red': {
        const prev = w.lights?.mode && w.lights.mode !== 'red' ? w.lights.mode : 'normal';
        (w.setLightsMode ? w.setLightsMode.bind(w) : (m) => w.lights?.setMode?.(m))('red');
        clearTimeout(this._redTimer);
        this._redTimer = setTimeout(() => {
          if (w.lights?.mode === 'red') (w.setLightsMode ? w.setLightsMode.bind(w) : (m) => w.lights?.setMode?.(m))(prev);
        }, RED_MS);
        break;
      }
      case 'bell':
        g.audio?.play?.('bell');
        break;
      case 'announcement':
        if (ANNOUNCE_IDS.includes(d.id)) g.announce?.(d.id);
        break;
      default:
        break;
    }
  }

  // =============================================================================== Director client
  _onLog(d) {
    const add = (e) => {
      if (!e || typeof e !== 'object' || typeof e.action !== 'string') return;
      this.log.push(e);
      if (this.log.length > LOG_MAX) this.log.shift();
      // HallPass audit (a future SDK: the Director's own session records their action server-side)
      if (e.by === this.coop.selfId && typeof this.room?.audit === 'function') {
        try {
          Promise.resolve(this.room.audit({ action: e.action, detail: e.detail, gameTime: e.gt })).catch(() => {});
        } catch {
          /* best effort */
        }
      }
    };
    if (Array.isArray(d?.all)) {
      this.log.length = 0;
      d.all.slice(-LOG_MAX).forEach(add);
    } else add(d?.e);
    this._renderLog();
  }

  _onReleased(d) {
    const who = WHO.includes(d?.who) ? d.who : null;
    if (!who || this.possessing !== who) return;
    this.possessing = null;
    const why = d.reason === 'timeout' ? 'no input for 3 s' : String(d.reason || '');
    this.game.ui?.showNotice?.(`${NAME[who]} is back on its own${why ? ` (${why})` : ''}.`, 4);
  }

  beginRun(d) {
    const g = this.game;
    this.running = true;
    document.body.classList.add('lb-director');
    if (d?.late) {
      g.timeline.length = 0; // a late Director doesn't get the intro (bell, announcement) all over again
      this.coop.catchUp(d);
    }
    g.player.enabled = false;
    g.player.setViewmodelVisible?.(false);
    g.player.setFlashlight?.(false);
    const cam = g.camera;
    this.cam.pos.copy(cam.position);
    this.cam.yaw = g.player.yaw || 0;
    this.cam.pitch = 0;
    this.mode = 'free';
    this.follow = null;
    this.possessing = null;
    this.keys.clear();
    this._build();
    this.hud.hidden = false;
    this._renderLog();
    g.ui?.showNotice?.('Director Mode. Click the view to look around; G frees the mouse for the panel.', 6);
  }

  endRun() {
    const was = this.running;
    this.running = false;
    this.possessing = null;
    this.follow = null;
    this.keys.clear();
    if (this.hud) this.hud.hidden = true;
    clearTimeout(this._redTimer);
    if (was) this.game.player?.setViewmodelVisible?.(true);
  }

  // ------------------------------------------------------------------------------- controls
  _bindKeys() {
    addEventListener('keydown', (e) => this._onKey(e, true));
    addEventListener('keyup', (e) => this._onKey(e, false));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.running || document.pointerLockElement !== this.game.player?.dom) return;
      const sens = 0.0022 * (this.game.settings.sensitivity || 1);
      this.cam.yaw -= e.movementX * sens;
      this.cam.pitch = clamp(this.cam.pitch - e.movementY * sens, -1.45, 1.45);
    });
    addEventListener('mousedown', (e) => {
      if (!this.running || this.game.state !== 'playing' || this.game.coopPaused) return;
      const canvas = this.game.player?.dom;
      if (document.pointerLockElement === canvas) {
        if (e.button === 0 && this.possessing) this.act('attack');
      } else if (e.target === canvas) this.game.player.lockPointer?.();
    });
  }

  _onKey(e, down) {
    if (!this.running) return;
    const g = this.game;
    if (!down) {
      this.keys.delete(e.code);
      return;
    }
    if (g.state !== 'playing' || g.coopPaused || g.isTyping?.()) return;
    this.keys.add(e.code);
    if (e.repeat) return;
    const k = e.code;
    const players = [...this.coop.roster.values()].sort((a, b) => a.slot - b.slot);
    if (/^Digit[1-4]$/.test(k)) {
      const r = players[Number(k.slice(5)) - 1];
      if (r) this.setFollow({ kind: 'player', id: r.id });
    } else if (k === 'Digit5') this.setFollow({ kind: 'enemy', who: 'caretaker' });
    else if (k === 'Digit6') this.setFollow({ kind: 'enemy', who: 'assistant' });
    else if (k === 'Digit0') this.setFollow(null);
    else if (k === 'KeyX') {
      const who = this.follow?.kind === 'enemy' ? this.follow.who : 'caretaker';
      if (this.possessing) this.release();
      else this.possess(who);
    } else if (k === 'KeyR' && this.possessing) this.release();
    else if (k === 'Space' && this.possessing) this.act('attack');
    else if (k === 'KeyE' && this.possessing) this.act('open-door');
    else if (k === 'KeyF' && this.possessing) this.act('look');
    else if (k === 'KeyV' && this.possessing) this.act('wave');
    else if (k === 'KeyG') this.toggleCursor();
    else if (k === 'KeyB') {
      this.showDebug = !this.showDebug;
      this._renderHud(true);
    } else if (k === 'KeyL') {
      this.showLog = !this.showLog;
      this._renderLog();
    }
  }

  toggleCursor() {
    const p = this.game.player;
    if (document.pointerLockElement === p?.dom) p.unlockPointer?.();
    else p?.lockPointer?.();
  }

  setFollow(f) {
    if (this.possessing && (!f || f.kind !== 'enemy' || f.who !== this.possessing)) this.release();
    this.follow = f;
    this.mode = f ? 'follow' : 'free';
    if (!f) this.cam.pos.copy(this.game.camera.position);
    this._renderHud(true);
  }

  async _req(ev, data) {
    const room = this.room;
    if (!room) return { ok: false, error: 'offline' };
    try {
      return (await room.request('host', ev, data, { timeoutMs: 4000 })) || { ok: false, error: 'empty' };
    } catch (err) {
      return { ok: false, error: err?.code === 'timeout' ? 'timeout' : String(err?.code || 'failed') };
    }
  }

  _say(r, ok) {
    if (r?.ok) {
      if (ok) this.game.ui?.showNotice?.(ok, 2.5);
    } else this.game.ui?.showNotice?.(REASON[r?.error] || `Refused (${r?.error || 'unknown'}).`, 3);
  }

  async possess(who) {
    if (!this.running || !WHO.includes(who)) return { ok: false };
    const r = await this._req('dir:possess', { who });
    if (r.ok) {
      this.possessing = who;
      this.follow = { kind: 'enemy', who };
      this.mode = 'follow';
      const e = this._enemy(who);
      if (e && num(e.yaw)) this.cam.yaw = e.yaw;
      this.cam.pitch = 0;
    }
    this._say(r, `You are ${NAME[who]}. WASD, Shift runs, click grabs, E opens a door, R lets go.`);
    this._renderHud(true);
    return r;
  }

  async release() {
    const who = this.possessing;
    if (!who) return { ok: false };
    this.possessing = null;
    const r = await this._req('dir:release', { who });
    this._renderHud(true);
    return r;
  }

  async act(a) {
    if (!this.possessing) return { ok: false };
    const r = await this._req('dir:act', { who: this.possessing, a });
    if (a === 'attack') this._say(r, r?.target ? `Caught ${r.target}.` : 'Caught.');
    return r;
  }

  async event(k, id) {
    const r = await this._req('dir:event', id ? { k, id } : { k });
    this._say(r, `Event: ${k}${id ? ` (${id.replace('announcement_', '')})` : ''}.`);
    if (!r.ok && r.error === 'cooldown' && r.wait) this.game.ui?.showNotice?.(`Events: wait ${r.wait} s.`, 2.5);
    return r;
  }

  async kick(id) {
    const r = await this._req('dir:kick', { id });
    this._say(r, 'Removed.');
    return r;
  }

  /** Per frame (coop.update): the camera, the possessed enemy's input, the HUD. */
  update(dt) {
    if (!this.running) return;
    const g = this.game;
    if (g.player.enabled) g.player.enabled = false;
    const k = this.keys;
    const ax = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const az = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const ay = (k.has('KeyE') ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const fast = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.possessing) {
      this._inT -= dt;
      if (this._inT <= 0) {
        this._inT = 1 / IN_HZ;
        try {
          this.room?.send('dir:in', [WHO.indexOf(this.possessing), ax, az, r2(this.cam.yaw * 50) / 50, r2(this.cam.pitch), fast ? 1 : 0], { to: 'host', reliable: false });
        } catch {
          /* next tick */
        }
      }
    }
    const cam = g.camera;
    if (this.follow?.kind === 'player') {
      if (!this._followPlayer(cam, dt)) this.setFollow(null);
    } else if (this.follow?.kind === 'enemy') {
      if (!this._followEnemy(cam)) this.setFollow(null);
    } else {
      // free fly
      const speed = (fast ? 11 : 4) * dt;
      const cp = Math.cos(this.cam.pitch);
      _v.set(-Math.sin(this.cam.yaw) * cp, Math.sin(this.cam.pitch), -Math.cos(this.cam.yaw) * cp).multiplyScalar(az * speed);
      _w.set(Math.cos(this.cam.yaw), 0, -Math.sin(this.cam.yaw)).multiplyScalar(ax * speed);
      this.cam.pos.add(_v).add(_w);
      this.cam.pos.y = clamp(this.cam.pos.y + ay * speed, -1, 14);
      cam.position.copy(this.cam.pos);
      _e.set(this.cam.pitch, this.cam.yaw, 0);
      cam.quaternion.setFromEuler(_e);
    }
    this._hudT = (this._hudT || 0) - dt;
    if (this._hudT <= 0) {
      this._hudT = 0.25;
      this._renderHud(false);
    }
  }

  /** First person through their eyes (their own avatar hidden). */
  _followPlayer(cam, dt) {
    const c = this.coop;
    const av = c.avatars.get(this.follow.id);
    const r = c.roster.get(this.follow.id);
    if (!av || !r || r.status === 'left') return false;
    const s = av.cur;
    cam.position.set(s.x, s.y + PLAYER.eyeHeight, s.z);
    _e.set(s.pitch || 0, s.yaw || 0, 0);
    cam.quaternion.setFromEuler(_e);
    av.root.visible = false;
    this.cam.yaw = s.yaw || 0;
    this.cam.pitch = s.pitch || 0;
    return true;
  }

  /** Behind and above an enemy (closer when a wall is in the way); the mouse turns the view. */
  _followEnemy(cam) {
    const e = this._enemy(this.follow.who);
    if (!e || !e.enabled) return false;
    const p = e.position || e.object?.position;
    if (!p) return false;
    const head = _v.set(p.x, (p.y || 0) + 2.2, p.z);
    const cp = Math.cos(this.cam.pitch);
    const dir = _w.set(-Math.sin(this.cam.yaw) * cp, Math.sin(this.cam.pitch), -Math.cos(this.cam.yaw) * cp);
    const w = this.game.world;
    let dist = 0.4;
    const probe = new THREE.Vector3();
    for (let d = 0.4; d <= 3; d += 0.25) {
      probe.copy(head).addScaledVector(dir, -d);
      probe.y += 0.15 * d;
      if (w?.lineOfSight && !w.lineOfSight(head, probe)) break;
      dist = d;
    }
    cam.position.copy(head).addScaledVector(dir, -dist);
    cam.position.y += 0.15 * dist;
    _e.set(this.cam.pitch - 0.12, this.cam.yaw, 0);
    cam.quaternion.setFromEuler(_e);
    return true;
  }

  // ------------------------------------------------------------------------------- HUD
  _build() {
    if (this._built) return;
    const root = document.getElementById('social-root') || document.body;
    const el = document.createElement('section');
    el.className = 'dir';
    el.setAttribute('aria-label', 'Director Mode');
    el.hidden = true;
    el.innerHTML = `
      <header class="dir__badge"><b>DIRECTOR</b><span class="dir__mode"></span></header>
      <p class="dir__keys"></p>
      <div class="dir__panel">
        <section class="dir__sec"><h3>Watch</h3><div class="dir__follow"></div></section>
        <section class="dir__sec"><h3>Take over</h3><div class="dir__possess"></div></section>
        <section class="dir__sec"><h3>Events <small class="dir__cool"></small></h3>
          <div class="dir__events">
            <button type="button" data-ev="flicker">Flicker</button>
            <button type="button" data-ev="red">Red lights</button>
            <button type="button" data-ev="bell">Bell</button>
            <select class="dir__ann" aria-label="Announcement">${ANNOUNCE_IDS.map((id) => `<option value="${id}">${id.replace('announcement_', 'PA: ')}</option>`).join('')}</select>
            <button type="button" data-ev="announcement">Play</button>
          </div></section>
        <section class="dir__sec"><h3>Announce in chat</h3>
          <form class="dir__say"><input class="dir__input" data-social-input maxlength="140" placeholder="As [HallPass staff]…" aria-label="Staff message"><button type="submit">Send</button></form></section>
      </div>
      <pre class="dir__debug"></pre>
      <section class="dir__logbox"><h3>Action log <small>kept by the host for this room only: HallPass has no audit endpoint yet</small></h3>
      <ol class="dir__log" aria-label="Director log"></ol></section>`;
    root.append(el);
    this.hud = el;
    this.$mode = el.querySelector('.dir__mode');
    this.$keys = el.querySelector('.dir__keys');
    this.$follow = el.querySelector('.dir__follow');
    this.$possess = el.querySelector('.dir__possess');
    this.$cool = el.querySelector('.dir__cool');
    this.$debug = el.querySelector('.dir__debug');
    this.$log = el.querySelector('.dir__log');
    el.querySelector('.dir__events').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ev]');
      if (!b) return;
      const k = b.dataset.ev;
      this.event(k, k === 'announcement' ? el.querySelector('.dir__ann').value : undefined);
    });
    this.$follow.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.kick) {
        if (b.dataset.sure) this.kick(b.dataset.kick);
        else {
          b.dataset.sure = '1';
          b.textContent = 'Sure?';
        }
        return;
      }
      if (b.dataset.free) this.setFollow(null);
      else if (b.dataset.player) this.setFollow({ kind: 'player', id: b.dataset.player });
      else if (b.dataset.enemy) this.setFollow({ kind: 'enemy', who: b.dataset.enemy });
    });
    this.$possess.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.release) this.release();
      else if (b.dataset.who) this.possess(b.dataset.who);
    });
    const input = el.querySelector('.dir__input');
    const send = async () => {
      const text = input.value.trim();
      if (!text) return;
      const r = await this.coop.chat.send(text, { announce: true });
      if (r?.ok) input.value = '';
    };
    input.__socialKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.blur();
      }
    };
    el.querySelector('.dir__say').addEventListener('submit', (e) => {
      e.preventDefault();
      send();
    });
    this._built = true;
  }

  _renderHud(force) {
    if (!this.hud || this.hud.hidden) return;
    const c = this.coop;
    const st = this.dstate;
    const f = this.follow;
    const fname = !f ? 'free camera' : f.kind === 'enemy' ? NAME[f.who] : c.roster.get(f.id)?.name || 'player';
    this.$mode.textContent = this.possessing ? `controlling ${NAME[this.possessing]}` : `watching · ${fname}`;
    this.$keys.textContent = this.possessing
      ? 'WASD walk · Shift run · click/Space grab · E door · F look around · V wave · R or X let go · mouse turns'
      : 'WASD/QE fly · Shift fast · 1–4 follow a player · 5 Caretaker · 6 Assistant · 0 free · X take over · G mouse · B debug · L log · T announce';
    if (force || this._lastRoster !== c.roster.size + ':' + (f?.id || f?.who || '') + ':' + (this.possessing || '') + ':' + (st?.en || []).map((x) => x.by + x.on).join()) {
      this._lastRoster = c.roster.size + ':' + (f?.id || f?.who || '') + ':' + (this.possessing || '') + ':' + (st?.en || []).map((x) => x.by + x.on).join();
      this.$follow.replaceChildren();
      const btn = (label, data, on) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        Object.assign(b.dataset, data);
        if (on) b.classList.add('is-on');
        return b;
      };
      this.$follow.append(btn('Free', { free: '1' }, !f));
      const players = [...c.roster.values()].sort((a, b) => a.slot - b.slot);
      players.forEach((r, i) => {
        const row = document.createElement('span');
        row.className = 'dir__row';
        row.append(btn(`${i + 1} ${r.name}`, { player: r.id }, f?.kind === 'player' && f.id === r.id));
        if (r.id !== this.room?.hostId && r.status !== 'left') row.append(btn('Remove', { kick: r.id }));
        this.$follow.append(row);
      });
      this.$follow.append(btn('5 Caretaker', { enemy: 'caretaker' }, f?.who === 'caretaker'), btn('6 Assistant', { enemy: 'assistant' }, f?.who === 'assistant'));
      this.$possess.replaceChildren();
      for (const who of WHO) {
        const info = st?.en?.find((x) => x.who === who);
        const mine = this.possessing === who;
        const by = info?.by && info.by !== c.selfId ? 'another Director' : '';
        const b = btn(mine ? `Let go of ${NAME[who]}` : `Be ${NAME[who]}${by ? ` (${by})` : !info?.on ? ' (asleep)' : ''}`, mine ? { release: '1' } : { who }, mine);
        if (!mine && (by || (info && !info.on))) b.disabled = true;
        this.$possess.append(b);
      }
    }
    if (this.showDebug && st) {
      const en = (st.en || []).map((e) => `${e.who.padEnd(9)} ${e.on ? e.st.padEnd(8) : 'off     '} tgt ${e.tg ? c.roster.get(e.tg)?.name || e.tg.slice(0, 6) : '-'}  ${e.p ? e.p.join(',') : ''}  m ${e.m}${e.los ? ' LOS' : ''}${e.by ? ` [${e.by === c.selfId ? 'you' : 'dir'}]` : ''}${e.hooks ? '' : ' (no hooks)'}`);
      const pl = (st.pl || []).map((p) => `${String(p.n).slice(0, 12).padEnd(12)} ${String(p.st).padEnd(8)} f${p.f}${p.h ? ' hid' : ''}${p.st === 'trapped' ? ` @${p.at}` : ''}`);
      const peers = (st.net?.peers || []).map(([id, rtt, loss, bi, bo, relay]) => `${(c.roster.get(id)?.name || (c.isDirector(id) ? 'director' : id.slice(0, 6))).slice(0, 10).padEnd(10)} ${rtt ?? '-'} ms ${loss ?? '-'}% ↓${Math.round(bi / 1024)}k ↑${Math.round(bo / 1024)}k${relay ? ' relay' : ''}`);
      const drop = Object.entries(st.net?.dropped || {}).map(([k, v]) => `${k}:${v}`).join(' ') || 'none';
      const o = st.obj || {};
      this.$debug.textContent = [
        `t ${st.t}s  left ${Math.round(st.left)}s  transforms ${o.xf}  floor1 ${o.f1 ? 'yes' : 'no'}  r000 ${o.r0 ? 'open' : 'shut'}  exit ${o.exit ? 'OPEN' : 'locked'}`,
        `items ${(o.items || []).join(', ') || '-'}`,
        ...en,
        ...pl,
        ...peers,
        `rate-limited ${drop}  bad ${st.net?.bad || 0}`,
        o.shared ? `state ${o.shared}` : '',
      ].filter(Boolean).join('\n');
      this.$debug.hidden = false;
    } else this.$debug.hidden = !this.showDebug || !st;
    if (this.$debug.hidden && this.showDebug && !st) {
      this.$debug.hidden = false;
      this.$debug.textContent = 'Waiting for the host…';
    }
  }

  _renderLog() {
    if (!this.$log) return;
    this.$log.parentElement.hidden = !this.showLog;
    if (!this.showLog) return;
    const c = this.coop;
    this.$log.replaceChildren();
    for (const e of this.log.slice(-12)) {
      const li = document.createElement('li');
      const who = e.by === c.selfId ? 'you' : c.isDirector(e.by) ? 'director' : c.roster.get(e.by)?.name || String(e.by).slice(0, 6);
      const d = e.detail && typeof e.detail === 'object' ? Object.entries(e.detail).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ') : '';
      li.textContent = `${new Date(e.t).toLocaleTimeString([], { hour12: false })}  ${who}  ${e.action}  ${d}`;
      this.$log.append(li);
    }
  }
}
