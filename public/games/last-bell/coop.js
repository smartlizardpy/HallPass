// LAST BELL — co-op for 1–4 players, over the HallPass P2P SDK (lib/hallpass-p2p.js, vendored).
//
// Main menu › Play with friends: create a room (you are the host) or type a friend's 4-letter code.
// In the lobby everyone picks a look (blazer, skin, hair, hairstyle) and can switch on voice chat;
// the host picks the difficulty. Everyone presses Ready; when all are ready the host starts the run. Locally (localhost / 127.0.0.1) the SDK links tabs of
// one browser, so two tabs are enough to test; on HallPass it goes over the internet.
//
// Who decides what (the host is authoritative, everyone else follows):
//   - Everyone generates the same school from the host's seed and plays the same intro.
//   - The HOST runs the caretaker's AI against every player (enemy.js picks a target among
//     coop.targets()). Guests see a puppet: enemy.remote = true, fed by 'es' snapshots + 'ee' events.
//   - Noises a guest makes (steps, doors, items, computers) are forwarded to the host's caretaker.
//   - Building changes, Room 000 opening, the clock and the end of the run come from the host.
//     A transform is replayed from the same inputs (player positions + view directions), and the
//     transform RNG depends only on the seed and the count, so every school changes the same way.
//   - Items are one team inventory: a pickup is a request to the host ("first come"), then 'pk'.
//   - Doors and hiding places are mirrored ('dr', 'hd').
//
// The co-op rules:
//   - Caught: the caretaker drags you to Room 000 (it opens if it wasn't yet) and you sit there,
//     able to look around and talk. A teammate frees you by walking up and pressing E.
//   - Escape: once the team has all three items, anyone can unlock the main entrance; then everyone
//     walks out on their own. Players who are out watch the others (click to switch).
//   - The run ends when nobody is left free inside (or the clock runs out). Whoever got out wins.
//   - The game never pauses in co-op (the pause menu still opens). The host leaving ends the run.
//
// Second Floor update (protocol v2, COOP_VERSION '2'; the SDK refuses a mismatched build):
//   - Two floors: every position carries y (feet). The floor is derived from y (world.floorOf).
//   - Two enemies: the Caretaker (ground floor) and The Assistant (upstairs). Caught by the Caretaker →
//     Room 000 (as before); caught by The Assistant → the Art room's "MY FRIENDS" circle (anchor
//     'art-circle'). A teammate frees you either way (host-validated: same floor, within 3.5 m).
//   - game.net (net.js) is bound to the room while a run is on (n:<type> messages, below).
//   - Every guest→anyone message is validated (sender, shape, range, distance) and rate limited per
//     sender with a token bucket (RATE). Over-limit messages are dropped and counted (netStats).
//   - Text chat (chat.js), the player list (playerlist.js) and Director Mode (director.js) are built here.
//   - Hidden Directors (HallPass admins, multiplayer.md §5) are room members but never players: not in
//     the lobby, the ready check, the run roster, the team panel, the player list or any count; never
//     enemy targets; they can't interact. Director Mode is OFF unless the host can verify them:
//     room.verifyPeer (HallPass P2P SDK ≥ 1.3, feature-detected) or, for development only, the `local`
//     transport on localhost with ?director=dev. No name, URL flag or client claim is ever trusted.
//
// Messages (room.send names; reliable unless noted):
//   run  host→all  {seed, difficulty, roster, startAt, startFloor}   lobby host→all  back to the lobby
//   ps   all→all   [x, y, z, yaw, pitch, flags, noise]  unreliable, 15 Hz (players only, never Directors)
//   es   host→all  {c, a}: the Caretaker's and The Assistant's netSnapshot() (null when disabled), 15 Hz unreliable
//   ee   host→all  enemy events {k, en?: 'assistant', tg?: target player id, line, state, prev…}
//   nz   guest→host [x, y, z, radius, source]            dr  all→all [door, open]
//   hd   all→all   {id, on}  hiding place                pk  host→all {id, by}  item picked
//   r0   host→all  Room 000 opens                        xf/xw host→all transform / warning
//   ck   host→all  {left, t}  1 Hz                        ct  host→all {id, who}  caught (who: which enemy)
//   rs   host→all  {st: {id: status}, at: {id: 'r0'|'art'}}   fr  host→all {id, by}  freed
//   xo   host→all  main entrance open                     out guest→host  I walked out
//   end  host→all  {reason, st, t, left}                  fx  guest→host lure {k, x, y, z} (distract / call off)
//   pa / psd / pst  PA broadcast, PlayStation dropped / taken     wv  wave emote
//   dirs host→all  {ids}: the verified Directors (everyone hides them)
//   me   host→peer {founder}: what HallPass attested about you (founder Easter egg)
//   drun host→Director {seed, difficulty, roster, st, at, t, left, xf, r0, f1, exit, picked, doors, startFloor}: late join
//   n:<type>  game.net: {b} host broadcast · {h} toHost · {q, d} request      nr host→peer {q, r} reply
//   nsnap host→peer {all}: net.snapshotAll()      nsync guest→host: please resend nsnap
//   dlog / dstate host→Directors: the action log, the debug overlay (director.js)
// Requests (room.request → host): pick {id}, free {id}, exit {}.

import * as THREE from './lib/three/three.module.js';
import { HallPassP2P } from './lib/hallpass-p2p.js';
import { ITEM_IDS, ITEM_NAMES, PLAYER, DIFFICULTY, FLOOR_Y, FLOOR_SPLIT_Y } from './config.js';
import { RemoteAvatars, SnapBuffer, F, floorBand } from './coop-avatars.js';
import { songSubtitle } from './computers.js';
import { Chat } from './chat.js';
import { PlayerList } from './playerlist.js';
import { Director } from './director.js';

export const COOP_VERSION = '2';
const GAME_ID = 'last-bell';
const MAX_PLAYERS = 4;
const MAX_ROOM = 6; // 4 players + 2 Directors (only in rooms that can verify Directors)
export const DIRECTOR_NAME = 'HallPass Director'; // the name a Director joins under (hidden until the host decides)
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const CLAIM_GRACE = 6000; // ms: a late joiner has this long to be verified as a Director, or is removed
// Receive-side rate limits per sender: [tokens per second, burst]. Over the limit → dropped and counted.
const RATE = {
  ps: [24, 36], nz: [12, 24], dr: [5, 8], hd: [4, 6], pa: [0.4, 2], psd: [1, 3], pst: [1, 3], wv: [1, 3],
  fx: [1, 4], out: [0.5, 2], pick: [4, 8], free: [2, 4], exit: [1, 3], nsync: [0.2, 2], n: [30, 60],
  // Director Mode (director.js; Directors only, still bounded)
  'dir:in': [20, 40], 'dir:act': [4, 6], 'dir:possess': [2, 4], 'dir:release': [2, 4], 'dir:event': [1, 3], 'dir:kick': [0.5, 2],
};
const STATE_HZ = 15;
const ENEMY_HZ = 15;
const INTERP_DELAY = 110; // ms behind the host clock: smooth motion between snapshots
// Voice chat. A friend's voice falls off with distance like a real voice, but never below a floor, so a
// friend across the school can still be heard (a higher floor while an announcement talks over
// everyone); walls muffle it. While a friend talks, the PA and the music step back (audio.chatDuck).
const VOICE_REF = 2.2; // m: full level within this
const VOICE_ROLLOFF = 1.1;
const VOICE_FLOOR = 0.3; // ≈ −10 dB, however far away
const VOICE_FLOOR_PA = 0.6; // ≈ −4 dB while an announcement or a PA broadcast plays
const WALL_LP = 1500; // Hz: a friend behind a wall
const WALL_LP_PA = 3000; // … during an announcement (words stay clear)
const TALK_RMS = 0.012; // a voice louder than this is talking (the badges, the speaker icon, chatDuck)
const TALK_HOLD = 0.35; // s: stays "talking" through the gaps between words
const VC_TITLE = { off: '', on: 'On voice chat', muted: 'Microphone muted', talking: 'Talking' };
const NAME_KEY = 'lastbell.coop.name';
const LOOK_KEY = 'lastbell.coop.look';
const params = new URLSearchParams(location.search);

export const LOOKS = {
  blazer: [
    { n: 'Navy', c: 0x23305e }, { n: 'Maroon', c: 0x6b1a24 }, { n: 'Green', c: 0x1f5a36 }, { n: 'Mustard', c: 0x9a7a1c },
    { n: 'Royal blue', c: 0x2b48a8 }, { n: 'Purple', c: 0x4a2a6a }, { n: 'Black', c: 0x1a1a1e }, { n: 'Grey', c: 0x5a5e66 },
  ],
  skin: [{ c: 0xffffff }, { c: 0xf2d3c0 }, { c: 0xd8ab8a }, { c: 0xc89a7c }, { c: 0xa8775a }, { c: 0x8d6248 }, { c: 0x664532 }],
  hair: [
    { n: 'Dark brown', c: 0x2a1a10 }, { n: 'Black', c: 0x0d0b0a }, { n: 'Brown', c: 0x7a4a22 }, { n: 'Blonde', c: 0xc9a35a },
    { n: 'Ginger', c: 0xa4441c }, { n: 'Grey', c: 0x8a8a8a }, { n: 'Blue', c: 0x2a4aa8 }, { n: 'Pink', c: 0xc04a8a },
  ],
  style: [{ n: 'Short' }, { n: 'Long' }],
};
const SKIN_PAINT = [0.86, 0.68, 0.56]; // the painted skin (sRGB) that the skin colour multiplies

const ANIMS = ['idle', 'stare', 'walk', 'run', 'search', 'investigate', 'turn_left', 'turn_right', 'capture'];
const ESTATES = ['PATROL', 'SUSPICIOUS', 'INVESTIGATE', 'CHASE', 'SEARCH', 'CAPTURE', 'IDLE'];
const STATUS_WORD = { alive: '', captured: 'caught!', trapped: 'in Room 000', escaping: 'getting out', escaped: 'got out', left: 'left' };
const TRAP_WORD = { r0: 'in Room 000', art: 'in the Art room' };
const ENEMY_KEYS = [['c', 'caretaker'], ['a', 'assistant']];

/** Per-sender token buckets (receive-side rate limits). */
class Buckets {
  constructor() {
    this.map = new Map();
    this.dropped = {}; // type -> count
  }
  allow(type, from, [rate, burst] = RATE.n, now = performance.now()) {
    const k = `${type}|${from}`;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = { tokens: burst, t: now }));
    b.tokens = Math.min(burst, b.tokens + ((now - b.t) / 1000) * rate);
    b.t = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    this.dropped[type] = (this.dropped[type] || 0) + 1;
    return false;
  }
  forget(from) {
    for (const k of [...this.map.keys()]) if (k.endsWith(`|${from}`)) this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const r3 = (n) => Math.round((+n || 0) * 1000) / 1000;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const clampI = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : 0);
const inRange = (v, lo, hi) => num(v) && v >= lo && v <= hi;
/** A plausible world position (metres): the school lives in positive x/z, two floors. */
const okPos = (x, y, z) => inRange(x, -50, 400) && inRange(y, -5, 12) && inRange(z, -50, 400);
const floorOfY = (y) => (y > FLOOR_SPLIT_Y ? 1 : 0);
const devLocalHost = () => {
  try {
    return LOCAL_HOST.test(location.hostname);
  } catch {
    return false;
  }
};

export function cleanName(s) {
  const n = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  // nobody gets to look like staff: "HallPass", "Director", "Admin", "Moderator" are reserved
  if (/hall\s*pass|\b(director|admin|administrator|moderator|mod|staff)\b/i.test(n)) return 'Student';
  return n || 'Student';
}
const cleanText140 = (s) => String(s || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').slice(0, 140);
function cleanLook(l) {
  l = l && typeof l === 'object' ? l : {};
  return {
    b: clampI(l.b, LOOKS.blazer.length),
    s: clampI(l.s, LOOKS.skin.length),
    h: clampI(l.h, LOOKS.hair.length),
    st: clampI(l.st, LOOKS.style.length),
  };
}
export function lookColors(l) {
  l = cleanLook(l);
  return { blazer: LOOKS.blazer[l.b].c, skin: LOOKS.skin[l.s].c, hair: LOOKS.hair[l.h].c, style: l.st === 1 ? 'long' : 'short' };
}
/** Loudness (RMS) of what an analyser hears right now. */
function rms(an, buf) {
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
function skinCss(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const c = (v, p) => Math.round(Math.min(1, v * p) * 255);
  return `rgb(${c(r, SKIN_PAINT[0])},${c(g, SKIN_PAINT[1])},${c(b, SKIN_PAINT[2])})`;
}
function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: fine */
  }
}
function listNames(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
}

function makeProxy(id) {
  return {
    id,
    position: new THREE.Vector3(),
    eyePosition: new THREE.Vector3(0, PLAYER.eyeHeight, 0),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    isCrouching: false,
    isSprinting: false,
    isMoving: false,
    flashlightOn: true,
    isHidden: false,
    hidingSpot: null,
    noiseLevel: 0,
    alive: true,
    flags: 0,
    _t: 0,
    _seen: false,
  };
}

export class Coop {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.avatars = new RemoteAvatars(game);
    this.client = null;
    this.room = null;
    this.active = false; // a co-op run is going on
    this.roster = new Map(); // id -> { id, name, slot, look, status }
    this.proxies = new Map(); // id -> stand-in the host's caretaker perceives
    this.status = 'alive'; // this player: alive | captured | trapped | escaping | escaped
    this.mySlot = 0;
    this.exitOpen = false;
    this.look = cleanLook(load(LOOK_KEY, null) || { b: (Math.random() * 4) | 0, s: (Math.random() * 7) | 0, h: (Math.random() * 5) | 0, st: (Math.random() * 2) | 0 });
    this.name = cleanName(load(NAME_KEY, '') || `Student ${100 + ((Math.random() * 900) | 0)}`);
    this._offs = [];
    this._busy = false;
    this._t = { state: 0, enemy: 0, clock: 0 };
    this._enemyBuf = new SnapBuffer();
    this._enemyOut = {};
    this._targets = [];
    this._voices = new Map();
    this._voiceWaiting = new Map(); // streams that arrived before the audio engine was up
    this._vc = new Map(); // player id -> 'off' | 'on' | 'muted' | 'talking' (what the badges show)
    this._vcT = 0;
    this._meter = null; // a level meter on your own microphone (are you talking?)
    this._pending = new Set();
    this._picked = new Set();
    this._ready = false;
    this._goTimer = null;
    this._specIdx = 0;
    this._interactables = [];
    this._runTimer = null;
    // protocol v2: guards, the net bus, identity, Directors
    this._rl = new Buckets();
    this.netStats = { dropped: this._rl.dropped, bad: 0 };
    this.directors = new Map(); // host: verified Directors: id -> { id, ident, how, at }
    this._dirIds = new Set(); // everyone: the verified Directors (host's 'dirs')
    this._claims = new Map(); // host: peers waiting to be verified (Director claims, late joiners): id -> since
    this._verifying = new Set(); // host: claims being checked right now
    this._ident = new Map(); // host: id -> HallPass-attested identity { role, founder, publicId } | null
    this._selfIdent = null; // guest: what the host told us about ourselves ('me')
    this._netT = null; // the transport bound to game.net
    this._netSubs = new Map(); // 'n:<type>' -> off()
    this._netReqs = new Map(); // request id -> { resolve, timer }
    this._netSeq = 0;
    this._netKnown = -1;
    this._xfLog = []; // host: this run's transforms, for a Director who joins late
    this._wantDirector = false; // this tab asked to join as a Director
    this.$ = (id) => document.getElementById(id);
    this.chat = new Chat(game, this);
    this.plist = new PlayerList(game, this);
    this.director = new Director(game, this);
    this._bindUI();
    this._joinFromInvite(); // opened from a HallPass invite? straight into that room
    this._bindGame();
  }

  get inRoom() {
    return !!this.room;
  }
  get isHost() {
    return !!this.room?.isHost;
  }
  get selfId() {
    return this.room?.selfId || null;
  }
  get guest() {
    return this.active && !this.isHost;
  }
  /** This tab is a verified Director in the current room (the host said so). */
  get amDirector() {
    return !!this.room && this._dirIds.has(this.room.selfId);
  }

  /** Development only: the SDK's `local` transport (tabs of one browser) on localhost. */
  _devLocal() {
    return devLocalHost() && this.client?.transport === 'local';
  }

  /** Can this room verify Directors? HallPass attestation (SDK ≥ 1.3, feature-detected) or the dev stub. */
  get dirCapable() {
    return !!this.room && (typeof this.room.verifyPeer === 'function' || this._devLocal());
  }

  /** A room member who is (or claims to be, pending the host's verdict) a Director: never shown as a player. */
  _hiddenPeer(p) {
    if (!p) return false;
    if (this._dirIds.has(p.id)) return true;
    if (p.isSelf) return this._wantDirector;
    return p.name === DIRECTOR_NAME || p.meta?.dir === 1;
  }

  /** The room's players, Directors (and Director claims) left out: the lobby, the ready check, the roster. */
  _lobbyPlayers() {
    return this.room ? this.room.players.filter((p) => !this._hiddenPeer(p)) : [];
  }

  /** A real player in this run (in the roster, not left, not a Director). */
  _isPlayer(id) {
    const r = this.roster.get(id);
    return !!r && r.status !== 'left' && !this._dirIds.has(id);
  }

  /** Feet position of a player in this run (yourself, or the stand-in fed by their 'ps'). */
  _posOf(id) {
    if (id === this.selfId) return this.game.player?.position || null;
    const pr = this.proxies.get(id);
    return pr?._seen ? pr.position : null;
  }

  _floorOf(pos) {
    if (!pos) return 0;
    const f = this.game.world?.floorOf?.(pos);
    return f === 0 || f === 1 ? f : floorOfY(pos.y || 0);
  }

  /** Rate limit for messages from `from` (never for our own). */
  _allow(type, from) {
    if (from === this.selfId) return true;
    return this._rl.allow(type, from, RATE[type] || RATE.n);
  }

  // =================================================================================== lobby UI
  _bindUI() {
    this.events.on('ui:coop', ({ action } = {}) => this._uiAction(action));
    const code = this.$('coop-code');
    code?.addEventListener('input', () => {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    code?.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        e.preventDefault();
        this._uiAction('coop-join');
      }
    });
    this.$('coop-name')?.addEventListener('change', (e) => {
      this.name = cleanName(e.target.value);
      e.target.value = this.name;
      save(NAME_KEY, this.name);
    });
  }

  _uiAction(action) {
    const g = this.game;
    g.audio?.unlock?.(); // every lobby click is a user gesture: wake the audio up
    switch (action) {
      case 'coop':
        this.openLobby();
        break;
      case 'coop-create':
        this.create();
        break;
      case 'coop-join':
        this.join(this.$('coop-code')?.value);
        break;
      case 'coop-invite':
        this.invite();
        break;
      case 'coop-copy':
        try {
          navigator.clipboard?.writeText(this.room?.code || '');
          this._status('Code copied. Send it to your friends.');
        } catch {
          /* clipboard blocked */
        }
        break;
      case 'coop-ready':
        this.setReady(!this._ready);
        break;
      case 'coop-voice':
        this.toggleVoice();
        break;
      case 'coop-diff':
        if (this.isHost) {
          g.ui?.cycleDifficulty?.(1);
          this.room.setRoomMeta({ difficulty: g.settings.difficulty });
          this._renderLobby();
        }
        break;
      case 'coop-lobby':
        if (this.isHost) this.room.send('lobby', {}, { to: 'all' });
        break;
      case 'coop-back':
      case 'coop-leave':
        if (this.room) this.leave();
        else {
          if (this._busy) this._joinToken = (this._joinToken || 0) + 1; // a join still on its way is dropped when it lands
          g.ui?._sound?.('ui_back');
          g.ui?.showMenu?.();
        }
        break;
      default:
        if (action?.startsWith('coop-look-')) this._cycleLook(action.slice(10));
    }
  }

  openLobby() {
    const g = this.game;
    const nameEl = this.$('coop-name');
    if (nameEl) nameEl.value = this.name;
    g.ui?._sound?.('ui_select');
    g.ui?._show?.('coop');
    this._view(this.room ? 'room' : 'start');
    this._status(location.hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/) ? 'Testing on this computer: open the game in a second tab to join.' : '');
    this._renderLobby();
    this.avatars.load().catch(() => {}); // the student model, ready for the run
  }

  _view(v) {
    const s = this.$('coop-start');
    const r = this.$('coop-room');
    if (s) s.hidden = v !== 'start';
    if (r) r.hidden = v !== 'room';
  }

  _status(text, kind = '') {
    const el = this.$('coop-status');
    if (!el) return;
    el.textContent = text || '';
    el.dataset.kind = kind;
  }

  _cycleLook(part) {
    const key = { blazer: 'b', skin: 's', hair: 'h', style: 'st' }[part];
    if (!key) return;
    const n = LOOKS[part].length;
    this.look[key] = (this.look[key] + 1) % n;
    save(LOOK_KEY, this.look);
    this.room?.setPlayerMeta({ look: this.look });
    this.game.ui?._sound?.('ui_toggle');
    this._renderLobby();
  }

  _renderLobby() {
    const room = this.room;
    if (!room) return;
    const code = this.$('coop-code-value');
    if (code) code.textContent = room.code;
    const inv = this.$('coop-invite');
    if (inv) inv.hidden = !this._canInvite() || room.started;
    const list = this.$('coop-players');
    if (list) {
      list.replaceChildren();
      const players = this._lobbyPlayers();
      for (const p of players) {
        const li = document.createElement('li');
        const look = lookColors(p.isSelf ? this.look : p.meta?.look);
        const chip = document.createElement('span');
        chip.className = 'coop__chip';
        chip.style.setProperty('--blazer', hexCss(look.blazer));
        chip.style.setProperty('--hair', hexCss(look.hair));
        chip.style.setProperty('--skin', skinCss(look.skin));
        const name = document.createElement('span');
        name.className = 'coop__name';
        name.textContent = cleanName(p.name);
        const tag = document.createElement('span');
        tag.className = 'coop__tag';
        const ok = this._isReady(p);
        li.classList.toggle('is-ready', ok);
        tag.textContent = [p.isHost ? 'host' : '', p.isSelf ? 'you' : '', p.connection?.state === 'reconnecting' ? 'reconnecting…' : ''].filter(Boolean).join(' · ');
        const mark = document.createElement('span');
        mark.className = 'coop__ok';
        mark.textContent = ok ? 'ready' : '';
        li.append(chip, name, mark, this._vcBadge(p.id, this._vcState(p)), tag);
        list.append(li);
      }
      for (let i = players.length; i < MAX_PLAYERS; i++) {
        const li = document.createElement('li');
        li.className = 'is-empty';
        li.textContent = 'Waiting for a friend…';
        list.append(li);
      }
    }
    const look = lookColors(this.look);
    const set = (id, text, css) => {
      const el = this.$(id);
      if (!el) return;
      el.textContent = text;
      if (css) el.style.setProperty('--sw', css);
    };
    set('coop-look-blazer', LOOKS.blazer[this.look.b].n, hexCss(look.blazer));
    set('coop-look-skin', `Tone ${this.look.s + 1}`, skinCss(look.skin));
    set('coop-look-hair', LOOKS.hair[this.look.h].n, hexCss(look.hair));
    set('coop-look-style', LOOKS.style[this.look.st].n);
    const voice = this.$('coop-voice-value');
    if (voice) voice.textContent = room.voice.active ? (room.voice.muted ? 'Muted' : 'On') : 'Off';
    const diff = this.$('coop-diff-value');
    const d = this.isHost ? this.game.settings.difficulty : room.meta?.difficulty || 'normal';
    if (diff) diff.textContent = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }[d] || 'Normal';
    const go = this.$('coop-go');
    if (go) {
      go.textContent = this._ready ? 'Not ready' : 'Ready';
      go.setAttribute('aria-pressed', this._ready ? 'true' : 'false');
      go.classList.toggle('is-on', this._ready);
    }
    const dBtn = this.$('coop-diff');
    if (dBtn) dBtn.disabled = !this.isHost;
    const wait = this.$('coop-wait');
    if (wait) {
      const n = this._lobbyPlayers().filter((p) => !this._isReady(p)).length;
      wait.textContent = !n ? 'Everyone is ready. Starting…' : `Waiting for ${n} player${n > 1 ? 's' : ''} to be ready…`;
    }
    this._checkAllReady();
    this.director.renderLobby?.();
  }

  // ================================================================================== ready check
  _isReady(p) {
    return p.isSelf ? !!this._ready : !!p.meta?.ready;
  }

  setReady(on) {
    if (!this.room || (this.active && !this._ended) || this._wantDirector) return;
    this._ready = !!on;
    this.room.setPlayerMeta({ ready: this._ready ? 1 : 0 });
    this.game.ui?._sound?.('ui_toggle');
    this._renderLobby();
  }

  /** Host: everyone ready (and the lobby is open) → a short countdown, then the run. Un-readying cancels it. */
  _checkAllReady() {
    const room = this.room;
    if (!room?.isHost) return;
    const open = !(this.active && !this._ended) && !room.started;
    const players = this._lobbyPlayers();
    const all = open && players.length > 0 && players.every((p) => this._isReady(p));
    if (!all) {
      if (this._goTimer) {
        clearTimeout(this._goTimer);
        this._goTimer = null;
        this._status('');
      }
      return;
    }
    if (this._goTimer) return;
    this._status('Everyone is ready. Starting in 3…');
    this._goTimer = setTimeout(() => {
      this._goTimer = null;
      if (this.room?.isHost && this._lobbyPlayers().every((p) => this._isReady(p))) this.hostStart();
    }, 3000);
  }

  // ================================================================================ connection
  async _connect(name = this.name) {
    if (this.client && this.client.self?.name !== name && !this.room) {
      try {
        await this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
    if (!this.client) {
      this.client = await HallPassP2P.connect({ gameId: GAME_ID, gameVersion: COOP_VERSION, name, debug: params.has('coopdebug') });
    } else if (this.client.transport === 'local' && this.client.self) {
      // the same tab joining again under another name (a Director seat, then a player): local only; on
      // HallPass the name always comes from the account
      this.client.self.name = name;
    }
    return this.client;
  }

  async create() {
    if (this._busy || this.room) return;
    this._busy = true;
    this._status('Opening a room…');
    try {
      this._wantDirector = false;
      const client = await this._connect();
      // rooms that can verify Directors take 6 (4 players + 2 hidden Directors); players stay capped at 4
      const canVerify = (client.transport === 'local' && devLocalHost()) || HallPassP2P?.features?.verifyPeer === true;
      const room = await client.createRoom({ maxPlayers: canVerify ? MAX_ROOM : MAX_PLAYERS, meta: { difficulty: this.game.settings.difficulty } });
      this._attach(room);
      this._status('Share the code. Start when everyone is in.');
    } catch (err) {
      this._status(err?.message || 'Could not open a room.', 'error');
    } finally {
      this._busy = false;
    }
  }

  /** from: who invited you (a HallPass invite), for "Joining <from>'s room…".
   *  asDirector: Director Mode (director.js checks it is allowed first; the host verifies it again). */
  async join(code, from = '', { asDirector = false } = {}) {
    code = String(code || '').trim().toUpperCase();
    if (this._busy || this.room) return;
    if (code.length !== 4) {
      this._status('Type the 4-letter code your friend sees.', 'error');
      return;
    }
    this._busy = true;
    const token = (this._joinToken = (this._joinToken || 0) + 1);
    this._status(asDirector ? 'Joining as a Director…' : from ? `Joining ${from}'s room…` : 'Joining…');
    try {
      this._wantDirector = !!asDirector;
      const client = await this._connect(asDirector ? DIRECTOR_NAME : this.name);
      const room = await client.joinRoom(code, { timeoutMs: 20000 });
      if (token !== this._joinToken) {
        room.leave().catch(() => {}); // you pressed Back while it was connecting
        return;
      }
      this._attach(room);
      if (asDirector) {
        // the claim; the host verifies it (HallPass attestation, or the localhost dev stub) or removes us
        room.setPlayerMeta({ dir: 1, ...(this._devLocal() && this.director.devRequested ? { dev: 'director' } : {}) });
        this.director.onJoinedAsDirector();
      }
      this._status('');
    } catch (err) {
      if (!this.room) this._wantDirector = false;
      if (token === this._joinToken) this._status(err?.message || 'Could not join that room.', 'error');
    } finally {
      this._busy = false;
    }
  }

  // ------------------------------------------------------------------ HallPass invites
  /** HallPass's invite picker (friends get a notification, or share a link). Needs the HallPass SDK
   *  1.4+, hosted on HallPass; otherwise the button stays hidden and Copy is there. */
  _canInvite() {
    const HP = window.HallPass;
    return typeof HP?.invite === 'function' && HP.mode === 'live';
  }

  async invite() {
    if (!this.room || !this._canInvite() || this._inviting) return;
    this._inviting = true;
    this._status('Choose who to invite…');
    let r = null;
    try {
      r = await window.HallPass.invite({ data: { room: this.room.code }, expiresInMinutes: 30 });
    } catch {
      r = null; // (it never rejects, but just in case)
    }
    this._inviting = false;
    if (!this.room) return;
    if (r?.sent) this._status(`Invited ${r.sent} friend${r.sent === 1 ? '' : 's'}. They join from the notification.`);
    else if (r?.link) this._status('Invite link ready. Whoever opens it joins this room.');
    else this._status('');
  }

  /** At boot: if this page was opened from an invite, go straight into that room. */
  async _joinFromInvite() {
    const HP = window.HallPass;
    if (!HP?.ready) return;
    try {
      await HP.ready();
    } catch {
      return;
    }
    if (this.room) this._renderLobby(); // (the Invite button needs the real SDK)
    let launch = null;
    try {
      launch = window.HallPass?.getLaunch?.(); // (the real SDK replaces the stub, so read it again)
    } catch {
      return;
    }
    const code = launch?.kind === 'invite' && typeof launch.data?.room === 'string' ? launch.data.room.trim().toUpperCase() : '';
    if (!/^[A-Z0-9]{4}$/.test(code)) return;
    // wait for the main menu (after loading and the one-time photosensitivity warning)
    const ui = this.game.ui;
    for (let t = 0; t < 240 && !(this.game.state === 'menu' && ui?.active === 'menu'); t++) await new Promise((r) => setTimeout(r, 250));
    if (this.game.state !== 'menu' || ui?.active !== 'menu' || this.room || this._busy) return;
    this.openLobby();
    const input = this.$('coop-code');
    if (input) input.value = code;
    const from = typeof launch.from === 'string' && launch.from.trim() ? launch.from.trim().slice(0, 32) : '';
    this.join(code, from);
  }

  async leave() {
    const room = this.room;
    this._endRunLocal();
    this._detach();
    this._view('start');
    if (room) {
      try {
        await room.leave();
      } catch {
        /* already gone */
      }
    }
    if (this.game.state !== 'menu') this.game.enterMenu();
    else this.game.ui?.showMenu?.();
  }

  _attach(room) {
    this.room = room;
    this._dirIds.clear();
    this._claims.clear();
    this._ident.clear();
    this._selfIdent = null;
    this._rl.clear();
    const on = (ev, fn) => this._offs.push(room.on(ev, fn));
    on('player-join', (p) => {
      if (room.isHost) this._hostOnJoin(p);
      this._renderLobby();
      this.plist.refresh();
      if (this._hiddenPeer(p) || this.amDirector) return; // a Director (or a claim): no sound, no notice
      if (!this.active) this.game.audio?.play?.('ui_select');
      if (this.active) this.game.ui?.showNotice?.(`${cleanName(p.name)} is in the lobby.`, 3);
    });
    on('player-leave', ({ id }) => this._onLeave(id));
    on('player-update', (p) => {
      if (room.isHost) this._hostOnUpdate(p);
      else if (p?.id === room.hostId) this._guestHostConn(p);
      this._renderLobby();
      this.plist.refresh();
    });
    on('room-update', () => this._renderLobby());
    on('closed', ({ reason }) => this._onClosed(reason));
    on('kicked', ({ reason } = {}) => (this._kickWhy = cleanText140(reason)));
    on('error', (err) => console.warn('[coop]', err?.message || err));
    on('visibility', ({ id, hidden }) => {
      if (this.active && hidden && id === room.hostId) this.game.ui?.showNotice?.('The host tabbed out. The school is frozen until they come back.', 5);
    });
    // game messages
    on('run', (d, m) => this._onRun(d, m));
    on('lobby', (d, m) => m.from === room.hostId && this._backToLobby());
    on('ps', (d, m) => this._onPS(d, m));
    on('es', (d, m) => this._onES(d, m));
    on('ee', (d, m) => this._onEE(d, m));
    on('nz', (d, m) => this._onNoise(d, m));
    on('hd', (d, m) => this._onHide(d, m));
    on('dr', (d, m) => this._onDoor(d, m));
    on('pk', (d, m) => this._onPicked(d, m));
    on('r0', (d, m) => m.from === room.hostId && this._onReveal());
    on('xf', (d, m) => this._onTransform(d, m));
    on('xw', (d, m) => m.from === room.hostId && this.active && this.game.transformWarning?.());
    on('ck', (d, m) => this._onClock(d, m));
    on('ct', (d, m) => this._onCaught(d, m));
    on('rs', (d, m) => this._onRoster(d, m));
    on('fr', (d, m) => this._onFreed(d, m));
    on('xo', (d, m) => m.from === room.hostId && this._onExitOpen());
    on('end', (d, m) => this._onEnd(d, m));
    on('pa', (d, m) => this._onPA(d, m));
    on('psd', (d, m) => this._onPsDrop(d, m));
    on('pst', (d, m) => this._fromPlayer('pst', m) && this.game.computers?.remotePsTake?.());
    on('wv', (d, m) => this._fromPlayer('wv', m) && this.avatars.playOnce(m.from, 'wave'));
    // protocol v2: Directors, identity, the net bus, late joins, resync
    on('dirs', (d, m) => this._onDirs(d, m));
    on('me', (d, m) => m.from === room.hostId && d && (this._selfIdent = { founder: d.founder === true }));
    on('drun', (d, m) => this._onDirectorRun(d, m));
    on('nr', (d, m) => this._onNetReply(d, m));
    on('nsnap', (d, m) => m.from === room.hostId && d?.all && this.game.net.applySnapshot(d.all));
    this.director.attach(room, on);
    if (room.isHost) {
      const guard = (type, fn) => (d, m) => (this._allow(type, m.from) ? fn(d, m) : { ok: false, error: 'rate' });
      this._offs.push(room.handle('pick', guard('pick', (d, m) => this._hostPick(d, m.from))));
      this._offs.push(room.handle('free', guard('free', (d, m) => this._hostFree(d, m.from))));
      this._offs.push(room.handle('exit', guard('exit', (d, m) => this._hostExit(m.from))));
      on('out', (d, m) => this._fromPlayer('out', m) && this._hostOut(m.from));
      on('fx', (d, m) => this._fromPlayer('fx', m) && this._hostLure(d, m.from));
      on('nsync', (d, m) => this._allow('nsync', m.from) && this._sendSnapshot(m.from));
      for (const p of room.players) if (!p.isSelf) this._hostOnJoin(p);
    }
    this._offs.push(room.voice.on('stream', ({ peerId, stream }) => this._voiceStream(peerId, stream)));
    this._offs.push(room.voice.on('stream-end', ({ peerId }) => this._voiceEnd(peerId)));
    // development only (localhost + local transport): a ?founder=dev tab tells the host, which accepts
    // it only under the same conditions. On HallPass the host asks HallPass (room.verifyPeer) instead.
    const id = this.game.identity;
    const dev = this._devLocal() && id?.publicId === 'dev' ? { devId: { founder: id.founder ? 1 : 0, role: id.role || null } } : {};
    room.setPlayerMeta({ look: this.look, ...dev });
    this._view('room');
    this._renderLobby();
    this.avatars.load().catch((err) => console.warn('[coop] student model failed', err));
  }

  _detach() {
    for (const off of this._offs) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this._offs.length = 0;
    clearTimeout(this._goTimer);
    this._goTimer = null;
    this._ready = false;
    for (const id of [...this._voices.keys()]) this._voiceEnd(id);
    this._dropMeter();
    this._vc.clear();
    this.game.audio?.chatDuck?.(false);
    clearTimeout(this._runTimer);
    this._unbindNet();
    this.director.detach();
    this.chat.reset();
    this._dirIds.clear();
    this._claims.clear();
    this.directors.clear();
    this._wantDirector = false;
    this.room = null;
    this.plist.refresh();
  }

  _onClosed(reason) {
    const wasActive = this.active;
    const g = this.game;
    this._endRunLocal();
    this._detach();
    const why = { 'host-left': 'The host left, so the room closed.', kicked: this._kickWhy || 'You were removed from the room.', timeout: 'Lost the connection to the host.', error: 'The connection failed.' }[reason];
    this._kickWhy = '';
    if (reason === 'left') return;
    if (wasActive) {
      g.enterMenu();
      g.ui?.showNotice?.(why || 'The room closed.', 6);
    }
    this.openLobby();
    this._status(why || 'The room closed.', 'error');
  }

  _onLeave(id) {
    const r = this.roster.get(id);
    this._vc.delete(id);
    this._claims.delete(id);
    this._rl.forget(id);
    this._ident.delete(id);
    if (this._dirIds.has(id)) {
      // a Director left: the host releases anything they were possessing (and tells the others)
      if (this.isHost) {
        this.director.hostDirectorLeft(id);
        this.directors.delete(id);
        this._dirIds.delete(id);
        this._sendDirs();
      } else this._dirIds.delete(id);
    }
    this._renderLobby();
    this.plist.refresh();
    this._voiceEnd(id);
    if (!this.active || !r) return;
    r.status = 'left';
    this.avatars.remove(id);
    this.proxies.delete(id);
    const w = this.game.world;
    for (const h of w?.allHidingSpots?.() || w?.hidingSpots || []) if (h.remoteBy === id) h.remoteBy = null;
    if (this.isHost) this.events.emit('player:left', { id }); // floor2.js: drop the staff card where they were
    this.game.ui?.showNotice?.(`${r.name} left the game.`, 4);
    this._renderTeam();
  }

  // ============================================================== Directors & identity (host)
  /** Host: someone joined (or is in the room when we attach). Verify identity; Director claims; late joiners. */
  _hostOnJoin(p) {
    if (!p || p.isSelf) return;
    this._hostVerifyIdentity(p);
    if (this._hiddenPeer(p)) {
      this._claims.set(p.id, performance.now());
      this._hostCheckClaim(p);
      return;
    }
    const running = this.active && !this._ended;
    const players = this._lobbyPlayers().length;
    if ((running || players > MAX_PLAYERS) && this.dirCapable) {
      // only possible in rooms that stay open for Directors: give a Director's claim (meta) time to arrive
      this._claims.set(p.id, performance.now());
    } else if (players > MAX_PLAYERS) {
      this._kick(p.id, 'The room is full.');
    }
  }

  _hostOnUpdate(p) {
    if (!p || p.isSelf) return;
    if (this._claims.has(p.id)) this._hostCheckClaim(p);
    if (this._devLocal() && p.meta?.devId && !this._ident.get(p.id)) this._hostVerifyIdentity(p);
    // a peer came back after "reconnecting": catch them up on the shared state
    const st = p.connection?.state;
    const was = this._connState?.get(p.id);
    (this._connState ||= new Map()).set(p.id, st);
    if (this.active && was === 'reconnecting' && st === 'connected') this._sendSnapshot(p.id);
  }

  /** Guest: our link to the host came back after "reconnecting": ask for the shared state again. */
  _guestHostConn(p) {
    const st = p.connection?.state;
    if (this.active && this._hostConn === 'reconnecting' && st === 'connected') {
      try {
        this.room.send('nsync', {}, { to: 'host' });
      } catch {
        /* closed */
      }
    }
    this._hostConn = st;
  }

  /** Host: what HallPass says about this peer (room.verifyPeer, SDK ≥ 1.3). Dev: the localhost claim. */
  async _hostVerifyIdentity(p) {
    const room = this.room;
    let ident = null;
    if (typeof room?.verifyPeer === 'function') {
      try {
        const v = await room.verifyPeer(p.id);
        ident = v ? { role: typeof v.role === 'string' ? v.role : null, founder: v.founder === true, publicId: typeof v.publicId === 'string' ? v.publicId : null } : null;
      } catch {
        ident = null;
      }
    } else if (this._devLocal() && p.meta?.devId && typeof p.meta.devId === 'object') {
      // development only (localhost + local transport): a tab opened with ?founder=dev
      ident = { role: p.meta.devId.role === 'super_admin' ? 'super_admin' : null, founder: p.meta.devId.founder === 1, publicId: 'dev' };
    } else return;
    if (this.room !== room) return;
    this._ident.set(p.id, ident);
    try {
      room.send('me', { founder: !!ident?.founder }, { to: p.id });
    } catch {
      /* gone */
    }
  }

  /** Host: decide about a Director claim. Verified → hidden Director; anything else → removed. */
  async _hostCheckClaim(p) {
    const room = this.room;
    if (!room?.isHost || this.directors.has(p.id) || this._verifying.has(p.id)) return;
    const claim = p.meta?.dir === 1;
    this._verifying.add(p.id);
    try {
      await this._hostDecideClaim(room, p, claim);
    } finally {
      this._verifying.delete(p.id);
    }
  }

  async _hostDecideClaim(room, p, claim) {
    let ok = false;
    let how = '';
    let ident = null;
    if (typeof room.verifyPeer === 'function') {
      if (!this._hiddenPeer(p)) return; // not a claim (yet): the sweep removes late joiners
      try {
        const v = await room.verifyPeer(p.id);
        ok = !!v && (v.role === 'admin' || v.role === 'super_admin');
        ident = v ? { role: v.role ?? null, founder: v.founder === true, publicId: typeof v.publicId === 'string' ? v.publicId : null } : null;
        how = 'hallpass';
      } catch {
        ok = false;
      }
    } else if (this._devLocal()) {
      if (!claim) return; // wait for the claim's meta (the sweep removes it if it never comes)
      ok = p.meta?.dev === 'director';
      how = 'dev';
      ident = { role: 'dev-director', founder: false, publicId: `dev:${p.id.slice(0, 6)}` };
    }
    if (this.room !== room || !room.players.some((x) => x.id === p.id)) return;
    this._claims.delete(p.id);
    if (!ok) {
      this.director.hostLog('refused', p.id, { reason: how ? 'not an admin' : 'Director Mode is unavailable here' });
      this._kick(p.id, how ? 'Director Mode needs a HallPass admin account.' : 'Director Mode is not available in this room.');
      return;
    }
    this.directors.set(p.id, { id: p.id, ident, how, at: Date.now() });
    this._dirIds.add(p.id);
    this._sendDirs();
    this.director.hostDirectorJoined(p.id, ident, how);
    if (this.active && !this._ended) this._sendDirectorRun(p.id);
  }

  /** Host, every frame: claims that never got verified, and late joiners who aren't Directors, are removed. */
  _hostSweepClaims() {
    if (!this._claims.size) return;
    const now = performance.now();
    for (const [id, since] of this._claims) {
      if (now - since < CLAIM_GRACE) continue;
      this._claims.delete(id);
      const p = this.room.players.find((x) => x.id === id);
      if (!p || this.directors.has(id)) continue;
      const late = this.active && !this._ended;
      this.director.hostLog('refused', id, { reason: this._hiddenPeer(p) ? 'unverified Director claim' : late ? 'joined a running game' : 'room full' });
      this._kick(id, this._hiddenPeer(p) ? 'Director Mode is not available in this room.' : late ? 'This game has already started.' : 'The room is full.');
    }
  }

  _kick(id, reason) {
    try {
      this.room?.kick(id, reason);
    } catch (err) {
      console.warn('[coop] kick failed', err?.message || err);
    }
  }

  _sendDirs() {
    try {
      this.room?.send('dirs', { ids: [...this._dirIds] }, { to: 'others' });
    } catch {
      /* closed */
    }
    this._renderLobby();
    this.plist.refresh();
    this.director.disclosure();
  }

  _onDirs(d, m) {
    if (!this.room || m.from !== this.room.hostId || !Array.isArray(d?.ids)) return;
    const was = this.amDirector;
    this._dirIds = new Set(d.ids.filter((x) => typeof x === 'string').slice(0, 8));
    this._renderLobby();
    this.plist.refresh();
    if (!was && this.amDirector) this.director.onVerified();
    this.director.disclosure();
  }

  /** Is this peer a Director? (host-verified; everyone learns it from the host's 'dirs') */
  isDirector(id = this.selfId) {
    return !!id && this._dirIds.has(id);
  }

  /** HallPass identity of a peer, as the host verified it ({ role, founder, publicId } | null). Guests only
   *  know their own (from the host's 'me'); the host knows everyone's once HallPass can attest them. */
  peerIdentity(id) {
    if (!this.room) return id === this.selfId || id === 'local' ? this.game.identity : null;
    if (id === this.selfId) return this.isHost ? this.game.identity : this._selfIdent;
    return this.isHost ? this._ident.get(id) || null : null;
  }

  /** game.playerInfo(id) in co-op: { id, position, floor, status, hidden, director, self } or null. */
  playerInfo(id = this.selfId) {
    if (!id) return null;
    const self = id === this.selfId;
    if (this._dirIds.has(id)) return { id, position: self ? this.game.camera.position : null, floor: -1, status: 'director', hidden: true, director: true, self };
    const r = this.roster.get(id);
    if (!r) return null;
    const position = this._posOf(id);
    const status = self ? this.status : r.status;
    return {
      id,
      position: position || null,
      floor: position ? this._floorOf(position) : -1,
      status,
      hidden: self ? !!this.game.player?.isHidden : !!this.proxies.get(id)?.isHidden,
      director: false,
      self,
    };
  }

  /** Ids of everyone actually playing this run: no Directors, nobody who left. */
  playerIds() {
    const out = [];
    for (const r of this.roster.values()) if (r.status !== 'left' && !this._dirIds.has(r.id)) out.push(r.id);
    return out;
  }

  // ================================================================================ voice chat
  async toggleVoice() {
    const v = this.room?.voice;
    if (!v) return;
    if (this._wantDirector || this.amDirector) {
      this._status('Directors listen only: no microphone.', 'error');
      return;
    }
    try {
      if (!v.active) {
        await v.start({ echoCancellation: true, noiseSuppression: true, autoGainControl: true });
        this._status('Voice chat on. In the school, friends sound like they are where they are. M mutes you.');
      } else if (!v.muted) {
        v.setMuted(true);
      } else {
        v.stop();
      }
    } catch (err) {
      this._status(err?.message || 'The microphone is not available.', 'error');
    }
    this._publishVoice();
    this._renderLobby();
  }

  toggleMute() {
    const v = this.room?.voice;
    if (!v?.active) {
      this.game.ui?.showNotice?.('Voice chat is off. Switch it on in the lobby.', 3);
      return;
    }
    v.setMuted(!v.muted);
    this._publishVoice();
    this.game.ui?.showNotice?.(v.muted ? 'Microphone muted.' : 'Microphone on.', 2);
  }

  /** Tells the others whether your voice chat is on or muted (their badges show it). */
  _publishVoice() {
    const v = this.room?.voice;
    if (!v) return;
    try {
      this.room.setPlayerMeta({ vc: v.active ? (v.muted ? 'm' : 'on') : null });
    } catch {
      /* room closed */
    }
  }

  _voiceStream(peerId, stream) {
    const a = this.game.audio;
    const ctx = a?.ctx;
    this._voiceEnd(peerId);
    if (this._dirIds.has(peerId)) return; // a hidden Director never talks into the game
    if (!ctx) {
      this._voiceWaiting.set(peerId, stream); // hooked up as soon as the audio is unlocked
      return;
    }
    try {
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 1.5;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 20000;
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = VOICE_REF;
      pan.rolloffFactor = 0; // direction only: the level over distance is ours (_updateVoice), with a floor
      const dist = ctx.createGain();
      const an = ctx.createAnalyser(); // is this friend talking?
      an.fftSize = 512;
      src.connect(gain);
      gain.connect(an);
      gain.connect(lp);
      lp.connect(dist);
      dist.connect(pan);
      pan.connect(a.chatBus || a._buses?.voice || a.master || ctx.destination);
      this._voices.set(peerId, { src, gain, lp, dist, pan, an, buf: new Float32Array(an.fftSize), losT: 0, open: true, pa: false, talkT: 0 });
    } catch (err) {
      console.warn('[coop] voice', err);
    }
  }

  _voiceEnd(peerId) {
    this._voiceWaiting.delete(peerId);
    const v = this._voices.get(peerId);
    if (!v) return;
    try {
      v.src.disconnect();
      v.pan.disconnect();
    } catch {
      /* ignore */
    }
    this._voices.delete(peerId);
  }

  _updateVoice(dt) {
    if (this._voiceWaiting.size && this.game.audio?.ctx) {
      for (const [id, stream] of [...this._voiceWaiting]) this._voiceStream(id, stream);
    }
    const g = this.game;
    const a = g.audio;
    const cam = g.camera;
    const t = a?.ctx?.currentTime || 0;
    const pa = !!a?.announcing;
    const set = (param, val) => param?.setTargetAtTime?.(val, t, 0.05);
    let talking = false;
    for (const [id, v] of this._voices) {
      const av = this.active ? this.avatars.get(id) : null;
      const p = av?.root.visible || av?.cur.flags & F.seated ? av.headPos : cam.position; // lobby / out: centred
      set(v.pan.positionX, p.x);
      set(v.pan.positionY, p.y);
      set(v.pan.positionZ, p.z);
      const d = p.distanceTo(cam.position);
      set(v.dist.gain, Math.max(pa ? VOICE_FLOOR_PA : VOICE_FLOOR, VOICE_REF / (VOICE_REF + VOICE_ROLLOFF * Math.max(0, d - VOICE_REF))));
      // through walls your friends sound muffled (less so while the PA is talking over them)
      v.losT -= dt;
      if (v.losT <= 0 || v.pa !== pa) {
        v.losT = 0.3;
        v.pa = pa;
        v.open = !av || !av.root.visible || !!g.world?.lineOfSight?.(cam.position, av.headPos);
        set(v.lp.frequency, v.open ? 20000 : pa ? WALL_LP_PA : WALL_LP);
      }
      v.talkT = rms(v.an, v.buf) > TALK_RMS ? TALK_HOLD : Math.max(0, v.talkT - dt);
      if (v.talkT > 0) talking = true;
    }
    a?.chatDuck?.(talking);
    this._meterSelf(dt);
    this._voiceUI(dt);
  }

  /** A level meter on your own microphone (the SDK's stream), for your own "talking" badge. */
  _meterSelf(dt) {
    const v = this.room?.voice;
    const stream = v?.active && typeof MediaStream !== 'undefined' && v.stream instanceof MediaStream ? v.stream : null;
    if (stream !== (this._meter?.stream || null)) {
      this._dropMeter();
      const ctx = this.game.audio?.ctx;
      if (stream && ctx) {
        try {
          const src = ctx.createMediaStreamSource(stream);
          const an = ctx.createAnalyser();
          an.fftSize = 512;
          src.connect(an); // measured only, never played back
          this._meter = { stream, src, an, buf: new Float32Array(an.fftSize), talkT: 0 };
        } catch {
          this._meter = null;
        }
      }
    }
    const m = this._meter;
    if (m) m.talkT = !v.muted && rms(m.an, m.buf) > TALK_RMS ? TALK_HOLD : Math.max(0, m.talkT - dt);
  }

  _dropMeter() {
    try {
      this._meter?.src.disconnect();
    } catch {
      /* ignore */
    }
    this._meter = null;
  }

  /** 'off' | 'on' | 'muted' | 'talking' for a player in the room. */
  _vcState(p) {
    if (p.isSelf) {
      const v = this.room?.voice;
      if (!v?.active) return 'off';
      if (v.muted) return 'muted';
      return this._meter?.talkT > 0 ? 'talking' : 'on';
    }
    const s = this._voices.get(p.id);
    if (p.meta?.vc === 'm') return 'muted';
    if (s?.talkT > 0) return 'talking';
    return s || p.meta?.vc === 'on' ? 'on' : 'off';
  }

  /** A mic badge for the lobby list / team panel; _voiceUI keeps it up to date. */
  _vcBadge(id, state = this._vc.get(id) || 'off') {
    const b = document.createElement('span');
    b.className = 'vc-badge';
    b.dataset.vcPeer = id;
    b.dataset.vc = state;
    b.title = VC_TITLE[state];
    return b;
  }

  /** 10 times a second: who is on voice chat, muted, talking (badges + the speaker over their head). */
  _voiceUI(dt) {
    this._vcT -= dt;
    if (this._vcT > 0 || !this.room) return;
    this._vcT = 0.1;
    for (const p of this.room.players) {
      const st = this._vcState(p);
      if (this._vc.get(p.id) === st) continue;
      this._vc.set(p.id, st);
      for (const el of document.querySelectorAll(`.vc-badge[data-vc-peer="${CSS.escape(p.id)}"]`)) {
        el.dataset.vc = st;
        el.title = VC_TITLE[st];
      }
      if (!p.isSelf) this.avatars.setTalking?.(p.id, st === 'talking');
    }
  }

  // ================================================================================== the run
  hostStart({ again = false } = {}) {
    const room = this.room;
    if (!room?.isHost || (this.active && !this._ended && !again)) return;
    if (!this.avatars.ready) {
      this._status('Still loading the players…');
      this.avatars.load().then(() => this.hostStart());
      return;
    }
    const players = this._lobbyPlayers(); // never a Director
    const ordered = [players.find((p) => p.isHost), ...players.filter((p) => !p.isHost)].filter(Boolean).slice(0, MAX_PLAYERS);
    const roster = ordered.map((p, i) => ({ id: p.id, name: cleanName(p.name), slot: i, look: cleanLook(p.isSelf ? this.look : p.meta?.look) }));
    const seed = Number(params.get('seed')) || (Math.random() * 0x7fffffff) | 0;
    // Rooms lock at the start, as before. A room that can verify Directors stays open instead: the host
    // removes anyone who joins a running game unless HallPass (or the dev stub) attests a Director.
    if (!this.dirCapable) room.lock();
    const startFloor = params.get('start') === 'floor1' ? 0 : 1; // game.startRun still falls back to 0 without an upstairs
    room.send('run', { seed, difficulty: this.game.settings.difficulty, roster, startAt: room.now() + 900, startFloor }, { to: 'all' });
    this._status('Starting…');
  }

  /** End screen / pause "Play again" (host only): a new school, same friends. */
  restart() {
    if (!this.isHost) return;
    // (the current run keeps going until the new one starts, so nobody drops into single player)
    this.hostStart({ again: true });
  }

  _onRun(d, m) {
    const room = this.room;
    if (!room || m.from !== room.hostId || !d || !Array.isArray(d.roster)) return;
    if (this.amDirector) {
      // a Director in the lobby: spectate the run that starts
      clearTimeout(this._runTimer);
      this._runTimer = setTimeout(() => this._beginRun({ ...d, director: true }), Math.max(0, Math.min(3000, (+d.startAt || 0) - room.now())));
      return;
    }
    if (!d.roster.some((r) => r?.id === room.selfId)) {
      this._status('A run started without you. Wait for the next one.', 'error');
      return;
    }
    clearTimeout(this._runTimer);
    this._status('Starting…');
    this._runTimer = setTimeout(() => this._beginRun(d), Math.max(0, Math.min(3000, (+d.startAt || 0) - room.now())));
  }

  _beginRun(d) {
    const g = this.game;
    if (!this.room) return;
    const director = !!d.director && this.amDirector;
    this._ready = false;
    if (!director) this.room.setPlayerMeta({ ready: 0 });
    this.roster.clear();
    for (const r of d.roster.slice(0, MAX_PLAYERS)) {
      if (!r || typeof r.id !== 'string' || this._dirIds.has(r.id)) continue;
      const st = d.st?.[r.id];
      this.roster.set(r.id, {
        id: r.id,
        name: cleanName(r.name),
        slot: clampI(r.slot, MAX_PLAYERS),
        look: cleanLook(r.look),
        status: STATUS_WORD[st] !== undefined ? st : 'alive',
        at: d.at?.[r.id] === 'art' ? 'art' : 'r0',
      });
    }
    this.mySlot = this.roster.get(this.selfId)?.slot ?? 0;
    this.active = true;
    this.status = director ? 'director' : 'alive';
    this.exitOpen = false;
    this._ended = false;
    this._picked.clear();
    this._pending.clear();
    this._capBusy?.clear();
    this._xfLog.length = 0;
    this._enemyBuf = new SnapBuffer();
    this._runStartFloor = d.startFloor === 0 ? 0 : 1;
    this._bindNet(); // before startRun: floor2.reset() must already see who the host is
    const diff = DIFFICULTY[d.difficulty] ? d.difficulty : 'normal';
    g.startRun(diff, { noLock: true, seed: (+d.seed | 0) || 1, coop: true, startFloor: this._runStartFloor, director });
    if (g.startFloor !== undefined && g.startFloor !== this._runStartFloor && g.world?.floor2?.playerSpawn) {
      console.warn(`[coop] the host starts on floor ${this._runStartFloor + 1}, this tab on ${g.startFloor + 1} (check ?start=)`);
    }
    if (director) {
      this.director.beginRun(d);
      return;
    }
    // the host's state (Floor 2 objectives…) once everyone is in, in case a broadcast was missed
    if (!this.isHost) setTimeout(() => this.active && this.room?.send('nsync', {}, { to: 'host' }), 2500);
    if (!g.touch?.active) this._clickToPlay(); // pointer lock needs a click of our own (not on touch screens)
    g.ui?.showNotice?.(`Co-op: ${this.roster.size} player${this.roster.size > 1 ? 's' : ''}. Stick together, or don't.`, 4);
  }

  /** The "click to resume" overlay, worded for the start of a co-op run (restored after the click). */
  _clickToPlay() {
    const ov = this.$('resume-overlay');
    if (!ov) return;
    const t = ov.querySelector('.resume-overlay__title');
    const x = ov.querySelector('.resume-overlay__text');
    const keep = [t?.textContent, x?.textContent];
    if (t) t.textContent = 'Click to play';
    if (x) x.textContent = 'Everyone is in the building. Click to take control.';
    const restore = () => {
      if (t) t.textContent = keep[0];
      if (x) x.textContent = keep[1];
    };
    ov.addEventListener('click', () => setTimeout(restore, 300), { once: true });
    this.game.ui?.showResumeOverlay?.();
  }

  /** Called by game.startRun (co-op) after the school is built, before the shaders are compiled. */
  onRunStart() {
    const g = this.game;
    const sp = g.spawnPoint?.() || { position: g.world.playerSpawn.position, yaw: g.world.playerSpawn.yaw, floor: 0 };
    const pos = this._spawnPoint(sp, this.mySlot);
    g.player.spawn(pos, sp.yaw);
    g.player.seated = false;
    this.avatars.clear();
    this.proxies.clear();
    const lights = RemoteAvatars.torchLightsAllowed(g.settings.quality);
    for (const r of this.roster.values()) {
      if (r.id === this.selfId) continue;
      this.avatars.create({ id: r.id, name: r.name, look: lookColors(r.look) }, { torchLight: lights });
      const pr = makeProxy(r.id);
      pr.position.copy(this._spawnPoint(sp, r.slot));
      pr.eyePosition.set(pr.position.x, pr.position.y + PLAYER.eyeHeight, pr.position.z);
      this.proxies.set(r.id, pr);
    }
    // guests (and Directors) see puppets of the host's enemies
    for (const e of g.enemies || [g.enemy]) e.remote = !this.isHost;
    if (!this.isHost) g.enemy.enabled = true; // the puppet shows whatever the host's caretaker does
    this._t = { state: 0, enemy: 0, clock: 0 };
    this._renderTeam();
    const team = this.$('hud-team');
    if (team) team.hidden = this.status === 'director';
  }

  /** Where player `slot` starts: spread around game.spawnPoint() (upstairs Classroom 2B, or the ground floor). */
  _spawnPoint(sp, slot) {
    const w = this.game.world;
    const yaw = sp.yaw || 0;
    const y = sp.position.y || 0;
    const floor = sp.floor ?? floorOfY(y);
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const OFF = [[0, 0], [0.9, 0], [-0.9, 0], [0, -1.0], [0.9, -1.0], [-0.9, -1.0], [0, 1.0], [0.9, 1.0], [-0.9, 1.0]];
    const order = [OFF[slot % 4], ...OFF];
    for (const [r, f] of order) {
      const x = sp.position.x + rx * r + fx * f;
      const z = sp.position.z + rz * r + fz * f;
      if (w.isWalkable?.(x, z, PLAYER.radius, floor)) return new THREE.Vector3(x, w.groundAt?.(x, z, floor) ?? y, z);
    }
    return sp.position.clone();
  }

  /** Back to the lobby / menu: forget the run (avatars, proxies, puppet, team HUD). */
  _endRunLocal() {
    const g = this.game;
    clearTimeout(this._runTimer);
    if (!this.active) return;
    if (this.isHost) this.director.hostReleaseAll('run ended'); // no code path leaves an enemy possessed
    this.director.endRun();
    this.chat.close?.('force');
    this.active = false;
    this.status = 'alive';
    this.avatars.clear();
    this.proxies.clear();
    for (const e of g.enemies || [g.enemy]) e.remote = false;
    g.enemy.releaseCapture?.(0);
    if (g.player) g.player.seated = false;
    g.coopPaused = false;
    this._unbindNet();
    const team = this.$('hud-team');
    if (team) team.hidden = true;
    this.plist.refresh();
  }

  _backToLobby() {
    const g = this.game;
    this._endRunLocal();
    if (this.isHost) this.room?.unlock();
    g.enterMenu({ keepCoop: true });
    this.openLobby();
  }

  // ============================================================================ per frame
  update(dt) {
    const room = this.room;
    if (!room || !this.active) return;
    const g = this.game;
    const now = room.now();
    this._netRescan();
    this._t.state -= dt;
    if (this._t.state <= 0 && this.status !== 'director') {
      this._t.state = 1 / STATE_HZ;
      try {
        room.send('ps', this._myState(), { reliable: false });
      } catch {
        /* buffer full: next tick */
      }
    }
    if (this.isHost) {
      this._t.enemy -= dt;
      if (this._t.enemy <= 0) {
        this._t.enemy = 1 / ENEMY_HZ;
        this._sendEnemies();
      }
      this._t.clock -= dt;
      if (this._t.clock <= 0) {
        this._t.clock = 1;
        room.send('ck', { left: r2(g.timeLeft), t: r2(g.time) });
      }
      this._hostSweepClaims();
      if (this._outWait?.size) for (const [id, since] of [...this._outWait]) (this._outWait.delete(id), this._hostOut(id, since));
      this.director.hostUpdate(dt);
      this._hostCheckEnd();
    }
    this.avatars.update(dt, now - INTERP_DELAY);
    this._updateInteractables();
    this._updateLocal(dt);
    this._updateVoice(dt);
    this.director.update(dt);
    this.chat.update(dt);
  }

  /** Lobby / end screens: keep voice positions sane; the host still screens people who join. */
  updateIdle(dt) {
    if (!this.room) return;
    this._updateVoice(dt);
    if (this.isHost) this._hostSweepClaims();
  }

  /** Host, 15 Hz: both enemies' snapshots (only the enabled ones). Until the AI's v2 snapshots land, the
   *  Caretaker's is his 14-number array (decoded below) and The Assistant's is null. */
  _sendEnemies() {
    const g = this.game;
    const slotOf = (t) => this._slotOfTarget(t);
    const snap = (e) => {
      if (!e || !e.enabled) return null;
      try {
        return e.netSnapshot?.(slotOf) ?? null;
      } catch (err) {
        console.warn('[coop] enemy snapshot', err);
        return null;
      }
    };
    const c = snap(g.enemy);
    const a = snap(g.assistant);
    if (c == null && a == null) return;
    try {
      this.room.send('es', { c, a }, { reliable: false });
    } catch {
      /* buffer full / too big: next tick */
    }
  }

  /** Puppets sample their buffers at this host time (guests). */
  renderTime() {
    return this.room ? this.room.now() - INTERP_DELAY : 0;
  }

  _myState() {
    const p = this.game.player;
    let f = 0;
    if (p.isCrouching) f |= F.crouch;
    if (p.isSprinting) f |= F.sprint;
    if (p.isMoving) f |= F.moving;
    if (p.flashlightOn) f |= F.torch;
    if (p.isHidden) f |= F.hidden;
    if (this.status === 'trapped') f |= F.seated;
    if (this.status === 'escaped' || this.status === 'escaping') f |= F.out;
    if (this.status === 'captured') f |= F.caught;
    return [r2(p.position.x), r2(p.position.y || 0), r2(p.position.z), r3(p.yaw), r2(p.pitch), f, r2(p.noiseLevel || 0)];
  }

  /** A message from a player in this run (not a Director), within its rate. */
  _fromPlayer(type, m) {
    if (!this.active || !m || m.from === this.selfId || !this._isPlayer(m.from)) return false;
    return this._allow(type, m.from);
  }

  _onPS(d, m) {
    if (!this._fromPlayer('ps', m) || !Array.isArray(d) || d.length < 7 || !d.slice(0, 7).every(num)) return;
    const [x, y, z, yaw, pitch, flags, noise] = d;
    if (!okPos(x, y, z) || !inRange(yaw, -100, 100) || !inRange(pitch, -3.2, 3.2) || !inRange(flags, 0, 255)) {
      this.netStats.bad++;
      return;
    }
    const s = { x, y, z, yaw, pitch, flags: flags | 0, spd: 0 };
    this.avatars.push(m.from, m.sentAt, s);
    const pr = this.proxies.get(m.from);
    if (!pr) return;
    const dts = (m.sentAt - pr._t) / 1000;
    if (pr._seen && dts > 0.01 && dts < 1) pr.velocity.set((x - pr.position.x) / dts, (y - pr.position.y) / dts, (z - pr.position.z) / dts);
    pr.position.set(x, y, z);
    pr.isCrouching = !!(flags & F.crouch);
    pr.isSprinting = !!(flags & F.sprint);
    pr.isMoving = !!(flags & F.moving);
    pr.flashlightOn = !!(flags & F.torch);
    pr.isHidden = !!(flags & F.hidden) || !!pr.hidingSpot;
    pr.eyePosition.set(x, y + (pr.isCrouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight), z);
    pr.floor = floorBand(y) < 0 ? floorOfY(y) : floorBand(y);
    pr.yaw = yaw;
    pr.pitch = pitch;
    pr.noiseLevel = Math.max(0, Math.min(1, noise));
    pr.flags = flags;
    pr._t = m.sentAt;
    pr._seen = true;
  }

  /** The players the host's enemies can go after (enemy.js / assistant.js filter by their own floor).
   *  Never a Director, a spectator, someone caught or out, or someone who left. */
  targets() {
    const out = this._targets;
    out.length = 0;
    if (this.status === 'alive') out.push(this.game.player);
    for (const [id, pr] of this.proxies) {
      const r = this.roster.get(id);
      pr.alive = r?.status === 'alive' && !this._dirIds.has(id);
      if (pr.alive && pr._seen) out.push(pr);
    }
    return out;
  }

  _slotOfTarget(t) {
    if (!t) return -1;
    if (t === this.game.player) return this.mySlot;
    return this.roster.get(t.id)?.slot ?? -1;
  }

  /** world.js: remote players push ajar doors open and stop doors closing on them. */
  pushEntities(out) {
    if (!this.active) return;
    for (const av of this.avatars.map.values()) if (av.root.visible) out.push(av.root.position, PLAYER.radius);
  }

  // ======================================================================= the enemies
  /** 'es' {c, a}: each enemy's snapshot goes to its own applySnapshot(snap, sentAt) when it has one
   *  (the AI's v2 format; enemy.js / assistant.js decode it). The Caretaker's legacy 14-number array is
   *  decoded here into the buffer that enemySample() serves, as before. */
  _onES(d, m) {
    if (!this.active || this.isHost || m.from !== this.room.hostId || !d || typeof d !== 'object' || Array.isArray(d)) return;
    const g = this.game;
    for (const [key, who] of ENEMY_KEYS) {
      const snap = d[key];
      if (snap == null) continue;
      const e = who === 'assistant' ? g.assistant : g.enemy;
      if (!e) continue;
      if (!e.enabled) e.enabled = true; // the host only sends snapshots of enemies it has switched on
      if (typeof e.applySnapshot === 'function') {
        try {
          e.applySnapshot(snap, m.sentAt);
        } catch (err) {
          console.warn(`[coop] ${who} snapshot`, err);
        }
      } else if (who === 'caretaker' && Array.isArray(snap) && snap.length >= 14 && snap.every(num)) {
        this._enemyBuf.push(m.sentAt, {
          x: snap[0], y: 0, z: snap[1], yaw: snap[2], pitch: 0, flags: snap[12] | 0,
          state: ESTATES[snap[3]] || 'PATROL', anim: ANIMS[snap[4]] || 'idle', spd: snap[5], run: snap[6] === 1,
          lx: snap[7], ly: snap[8], lz: snap[9], hasLook: snap[10] === 1, meter: snap[11], tgt: snap[13],
        });
      }
    }
  }

  /** Interpolated legacy Caretaker snapshot for his puppet (enemy._updatePuppet). */
  enemySample() {
    if (!this.room) return null;
    return this._enemyBuf.sample(this.room.now() - INTERP_DELAY, this._enemyOut);
  }

  _enemyOf(who) {
    return who === 'assistant' ? this.game.assistant || this.game.enemy : this.game.enemy;
  }

  /** Host: forward the enemies' events so guests hear and see the same. en: which enemy (absent = the
   *  Caretaker, so existing listeners keep working); tg: the player it was after. */
  _relayEnemy(k, e = {}) {
    if (!this.active || !this.isHost || e?.net) return;
    const d = { k };
    if (e.who && e.who !== 'caretaker') d.en = String(e.who).slice(0, 16);
    if (e.line) d.line = String(e.line).slice(0, 32);
    if (e.big) d.big = 1;
    if (e.state) d.state = String(e.state).slice(0, 16);
    if (e.prev) d.prev = String(e.prev).slice(0, 16);
    if (e.target) d.tg = e.target === this.game.player ? this.selfId : String(e.target.id || '');
    try {
      this.room.send('ee', d);
    } catch {
      /* closed */
    }
  }

  /** Was this caretaker event (enemy:winded, the close-up burp) about this player? The host's AI fires them for
   *  whoever he was after, and guests hear them all, so the achievements only go to that player. */
  aboutMe(e) {
    if (!this.active) return true;
    if (e && 'mine' in e) return !!e.mine; // a guest: retold by the host
    return !e?.target || e.target === this.game.player;
  }

  _onEE(d, m) {
    if (!this.active || this.isHost || m.from !== this.room.hostId || !d || typeof d.k !== 'string') return;
    const assistant = d.en === 'assistant';
    const e = this._enemyOf(assistant ? 'assistant' : 'caretaker');
    const ev = this.events;
    const mine = d.tg === this.selfId;
    const who = assistant ? { who: 'assistant' } : {}; // (no `who` = the Caretaker, for existing listeners)
    const head = e.headPosition || e.position;
    this._relaying = true;
    try {
      switch (d.k) {
        case 'voice':
          ev.emit('enemy:voice', { ...who, line: String(d.line || ''), position: head, big: !!d.big, mine, net: true });
          break;
        case 'spotted':
          ev.emit('enemy:spotted', { ...who, position: e.position.clone(), net: true });
          break;
        case 'state':
          if (typeof d.state === 'string' && /^[A-Z_]{2,16}$/.test(d.state)) ev.emit('enemy:state', { ...who, state: d.state, prev: d.prev, net: true });
          break;
        case 'winded':
          ev.emit('enemy:winded', { ...who, position: e.position, mine, net: true });
          break;
        case 'sighting':
          ev.emit('enemy:sighting', { ...who, position: e.position.clone(), net: true });
          break;
        case 'lost':
          ev.emit('enemy:lost', { ...who, net: true });
          break;
        default:
          break;
      }
    } finally {
      this._relaying = false;
    }
  }

  /** Guests: a lure that has to reach the host's caretaker (PA broadcast, PlayStation, register). */
  forwardEnemy(kind, position) {
    if (!this.guest || this.status === 'director') return false;
    const d = { k: kind === 'callOff' ? 'c' : 'd' };
    if (position) {
      d.x = r2(position.x);
      d.y = r2(position.y || 0);
      d.z = r2(position.z);
    }
    this.room.send('fx', d, { to: 'host' });
    return true;
  }

  _hostLure(d, from) {
    if (!this.active || !d || !this._isPlayer(from)) return;
    const e = this.game.enemy;
    if (d.k === 'c') e.callOff?.();
    else if (num(d.x) && num(d.z)) {
      const y = num(d.y) ? d.y : 0;
      if (okPos(d.x, y, d.z)) e.distract?.(new THREE.Vector3(d.x, y, d.z));
    }
  }

  // ============================================================================== noises
  _onNoise(d, m) {
    if (!this.isHost || !this._fromPlayer('nz', m) || !Array.isArray(d) || !num(d[0]) || !num(d[1]) || !num(d[2]) || !num(d[3])) return;
    if (this.roster.get(m.from)?.status !== 'alive' || !okPos(d[0], d[1], d[2])) return;
    const position = new THREE.Vector3(d[0], d[1], d[2]);
    this.events.emit('noise', {
      position,
      radius: Math.max(0, Math.min(25, d[3])),
      source: String(d[4] || 'remote').slice(0, 16),
      floor: this._floorOf(position),
      net: true,
    });
  }

  // ======================================================================== hiding places
  _onHide(d, m) {
    if (!this._fromPlayer('hd', m) || !d || typeof d.id !== 'string' || d.id.length > 40) return;
    const g = this.game;
    const spot = g.world?.getHide?.(d.id) || (g.world?.hidingSpots || []).find((h) => h.id === d.id); // (Floor 2: f2hide*)
    const pr = this.proxies.get(m.from);
    if (!spot) return;
    if (d.on && pr?._seen) {
      // only a spot they are standing at (positions lag ~0.1 s; the camera sits inside the spot)
      const at = spot.exitPosition || spot.position;
      if (Math.hypot(at.x - pr.position.x, at.z - pr.position.z) > 3.5 || Math.abs((at.y || 0) - pr.position.y) > 2.5) {
        this.netStats.bad++;
        return;
      }
    }
    if (spot) {
      if (d.on) spot.remoteBy = m.from;
      else if (spot.remoteBy === m.from) spot.remoteBy = null;
      spot.playDoor?.();
      const pos = spot.type === 'desk' ? spot.position : spot.front || spot.position;
      if (spot.type === 'desk') g.audio?.play?.('cloth', { position: pos });
      else g.audio?.play?.('locker_open', { position: pos });
    }
    if (pr) {
      pr.hidingSpot = d.on ? spot || null : null;
      pr.isHidden = !!d.on;
      // the caretaker reacts to the player he is after vanishing into a locker in front of him
      if (this.isHost && g.enemy._target === pr) {
        if (d.on && spot) g.enemy._onHideEnter?.({ spot, net: true });
        else if (!d.on) g.enemy._seenHide = null;
      }
    }
  }

  // ================================================================================ doors
  _doorOut(door, open, by) {
    if (!this.active || !door || this.status === 'director') return;
    if (by === 'player' || (by === 'enemy' && this.isHost)) this.room.send('dr', [door.index, open ? 1 : 0]);
  }

  /** Doors stay one array on both floors (CONTRACTS §13.1): synced by index. The host's doors are
   *  trusted (its enemies open doors anywhere); a guest's only within reach of where that guest is. */
  _onDoor(d, m) {
    if (!this.active || !Array.isArray(d) || !Number.isInteger(d[0])) return;
    const door = this.game.world?.doors?.[d[0]];
    if (!door) return;
    if (m.from !== this.room.hostId) {
      if (!this._fromPlayer('dr', m)) return;
      const pos = this._posOf(m.from);
      const dp = door.position;
      if (pos && dp && (Math.hypot(dp.x - pos.x, dp.z - pos.z) > 4.5 || (door.floor !== undefined && door.floor !== this._floorOf(pos)))) {
        this.netStats.bad++;
        return;
      }
    }
    if (d[1]) door.open('remote');
    else door.close('remote');
  }

  // ================================================================================ items
  /** items.collect() in co-op: ask the host first (two players can't both take the keycard). */
  requestPick(id) {
    if (!this.active || this.status !== 'alive' || this._pending.has(id)) return false; // (a Director's status is 'director')
    if (this.isHost) return !!this._hostPick({ id }, this.selfId).ok;
    this._pending.add(id);
    this.room
      .request('host', 'pick', { id }, { timeoutMs: 4000 })
      .catch(() => {})
      .finally(() => this._pending.delete(id));
    return true;
  }

  _hostPick(d, from) {
    const g = this.game;
    const id = String(d?.id || '');
    const e = g.items?.getEntry?.(id);
    if (!e || e.collected || this._picked.has(id)) return { ok: false };
    if (!this._isPlayer(from) || this.roster.get(from)?.status !== 'alive') return { ok: false };
    if (from !== this.selfId) {
      const pr = this.proxies.get(from);
      if (!pr || Math.hypot(pr.position.x - e.position.x, pr.position.z - e.position.z) > 4 || Math.abs((e.position.y || 0) - pr.position.y) > 2.5) return { ok: false };
    }
    this._picked.add(id);
    this.room.send('pk', { id, by: from }, { to: 'all' });
    return { ok: true };
  }

  _onPicked(d, m) {
    if (!this.active || m.from !== this.room.hostId || !d) return;
    const g = this.game;
    const id = String(d.id || '');
    if (d.by === this.selfId) {
      g.items?.collect?.(id, g, { fromNet: true });
      return;
    }
    if (!g.items?.collectRemote?.(id)) return;
    const who = this.roster.get(d.by)?.name || 'Someone';
    const what = ITEM_NAMES[id] ? `the ${ITEM_NAMES[id].toLowerCase()}` : id === 'batteries' ? 'the fresh batteries' : 'something';
    g.subtitle?.(`${who} found ${what}.`, 3.5, '');
  }

  // ========================================================================== Room 000
  /** Host: open Room 000 for everyone (the second item, or the first player caught). */
  hostReveal() {
    if (!this.active || !this.isHost) return;
    this.room.send('r0', {});
  }

  _onReveal() {
    const g = this.game;
    if (!this.active || g.world?.room000Revealed) return;
    g.room000Revealed = true;
    g.revealRoom000Now?.();
  }

  /** Where player `slot` sits in Room 000 while they wait to be freed. */
  _seat(slot) {
    const w = this.game.world;
    const room = w.room000;
    const c = room?.center || w.playerSpawn.position;
    const OFF = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9], [0, 0]];
    for (const [ox, oz] of [OFF[slot % 4], ...OFF]) {
      const p = w._walkPoint?.(c.x + ox, c.z + oz, 1.2);
      if (p) return new THREE.Vector3(p.x, 0, p.z);
    }
    return new THREE.Vector3(c.x, 0, c.z);
  }

  /** A named Floor 2 spot (world.floor2.anchors: an array or a map of { id, position, yaw, room, kind }). */
  _anchor(id) {
    const f2 = this.game.world?.floor2;
    if (typeof f2?.anchor === 'function') {
      try {
        const x = f2.anchor(id);
        if (x) return x;
      } catch {
        /* fall through */
      }
    }
    const a = f2?.anchors;
    if (!a) return null;
    if (Array.isArray(a)) return a.find((x) => x?.id === id) || a.find((x) => x?.kind === id) || null;
    if (a instanceof Map) return a.get(id) || null;
    return a[id] || Object.values(a).find((x) => x?.kind === id) || null;
  }

  /** Where player `slot` sits in the Art room's "MY FRIENDS" circle after The Assistant catches them.
   *  Falls back to the upstairs spawn, then to Room 000, if the world has no such anchor yet. */
  _artSeat(slot) {
    const w = this.game.world;
    const a = this._anchor('art-circle');
    const c = a?.position || w.floor2?.playerSpawn?.position;
    if (!c) return { seat: this._seat(slot), centre: w.room000?.center || null, at: 'r0' };
    const floor = 1;
    const y = c.y || FLOOR_Y[1];
    const R = 1.1;
    for (let i = 0; i < 8; i++) {
      const ang = ((slot + i) % 8) * (Math.PI / 4);
      const x = c.x + Math.cos(ang) * R;
      const z = c.z + Math.sin(ang) * R;
      if (w.isWalkable?.(x, z, PLAYER.radius, floor) !== false) return { seat: new THREE.Vector3(x, w.groundAt?.(x, z, floor) ?? y, z), centre: c, at: 'art' };
    }
    return { seat: new THREE.Vector3(c.x, y, c.z), centre: c, at: 'art' };
  }

  // ======================================================================== transforms
  /** Host: the inputs of a transform, rounded so host and guests compute exactly the same thing. */
  transformInputs() {
    const g = this.game;
    const viewers = [];
    const protect = [];
    const add = (pos, yaw, view) => {
      protect.push([r2(pos.x), r2(pos.z)]);
      if (view) viewers.push([r2(pos.x), r2(pos.z), r3(yaw)]);
    };
    // the ground floor is the only one that changes: only people down there protect rooms or watch
    const down = (pos) => this._floorOf(pos) === 0;
    if (this.status !== 'escaped' && this.status !== 'director' && down(g.player.position)) add(g.player.position, g.player.yaw, true);
    for (const [id, pr] of this.proxies) {
      const st = this.roster.get(id)?.status;
      if (pr._seen && st !== 'escaped' && st !== 'left' && down(pr.position)) add(pr.position, pr.yaw, true);
    }
    add(g.enemy.position, 0, false);
    return { viewers, protect, n: (g.world.transformer?.count || 0) + 1 };
  }

  /** Deterministic "could anyone see this": within 34 m, inside a ~126° view cone, line of sight. */
  makeVisibility(viewers) {
    const w = this.game.world;
    const a = new THREE.Vector3();
    const cosHalf = Math.cos(1.1);
    return (v) => {
      for (const [x, z, yaw] of viewers) {
        const dx = v.x - x;
        const dz = v.z - z;
        const d = Math.hypot(dx, dz);
        if (d > 34) continue;
        if (d > 1.5 && (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d < cosHalf) continue;
        a.set(x, 1.5, z);
        if (w.lineOfSight(a, v)) return true;
      }
      return false;
    };
  }

  sendTransform(inp) {
    if (!this.active || !this.isHost) return;
    this.room.send('xf', { n: inp.n, viewers: inp.viewers, protect: inp.protect, r0: !!this.game.world.room000Revealed });
    this.sendTransformLog(inp);
  }

  _onTransform(d, m) {
    const g = this.game;
    if (!this.active || this.isHost || m.from !== this.room.hostId || !d || !Number.isInteger(d.n)) return;
    const ok = (a, k) => Array.isArray(a) && a.length <= 8 && a.every((p) => Array.isArray(p) && p.length === k && p.every(num));
    if (!ok(d.viewers, 3) || !ok(d.protect, 2)) return;
    if (d.r0 && !g.world.room000Revealed) this._onReveal();
    g._doTransform({ n: d.n, viewers: d.viewers, protect: d.protect });
  }

  // ============================================================================== clock
  _onClock(d, m) {
    const g = this.game;
    if (!this.active || this.isHost || m.from !== this.room.hostId || !d || !num(d.left)) return;
    const lag = Math.max(0, Math.min(1, (this.room.now() - m.sentAt) / 1000));
    g.timeLeft = Math.max(0, d.left - lag);
  }

  // ===================================================================== caught / freed
  /** enemy:capture { who, target }. Only the host's enemies really catch anyone. The Caretaker takes
   *  you to Room 000; The Assistant to the Art room's circle upstairs. */
  onEnemyCapture(e = {}) {
    if (!this.active || !this.isHost) return;
    const g = this.game;
    const who = e.who === 'assistant' ? 'assistant' : 'caretaker';
    const en = this._enemyOf(who);
    const t = e.target;
    const id = !t || t === g.player ? this.selfId : t.id;
    const r = this.roster.get(id);
    if (!r || r.status !== 'alive' || this._dirIds.has(id)) {
      en.releaseCapture?.(3);
      return;
    }
    // one capture at a time per enemy: while he is taking someone, a second capture event (e.g. his
    // capture cinematic re-announcing his last target) is not a second catch
    const now = performance.now();
    if ((this._capBusy ||= new Map()).get(who) > now) return;
    this._capBusy.set(who, now + 3000);
    const at = who === 'assistant' ? 'art' : 'r0';
    this._setStatus(id, 'captured', at);
    if (at === 'r0' && !g.world.room000Revealed && !g.room000Revealed) {
      g.room000Revealed = true;
      g.revealRoom000Now?.();
    }
    this.room.send('ct', { id, who }, { to: 'all' });
    if (id !== this.selfId) {
      en.remoteCapture?.(t.position);
      g._at(g.time + 2.8, () => {
        if (this.active) en.releaseCapture?.();
      });
    }
    g._at(g.time + 3.2, () => {
      if (this.active && this.roster.get(id)?.status === 'captured') this._setStatus(id, 'trapped', at);
    });
  }

  _onCaught(d, m) {
    if (!this.active || m.from !== this.room.hostId || !d) return;
    const who = d.who === 'assistant' ? 'assistant' : 'caretaker';
    if (d.id === this.selfId) {
      this._captureLocal(who);
      return;
    }
    const r = this.roster.get(d.id);
    if (r) {
      r.at = who === 'assistant' ? 'art' : 'r0';
      this.game.subtitle?.(
        who === 'assistant' ? `${r.name} has been caught! She's taking them to the Art room.` : `${r.name} has been caught! They're being taken to Room 000.`,
        4,
        '',
      );
      this.game.audio?.play?.('capture_sting', { volume: 0.35 });
    }
  }

  async _captureLocal(who = 'caretaker') {
    const g = this.game;
    if (this.status !== 'alive') return;
    this.status = 'captured';
    this._captor = who;
    this.events.emit('player:caught', { self: true, who }); // game.js closes every overlay (chat, puzzles…)
    const p = g.player;
    if (p.isHidden) {
      try {
        p.exitHide();
      } catch {
        /* ignore */
      }
    }
    this.syncPlayer();
    p.setViewmodelVisible?.(false);
    g.schoolnet?.close?.('force');
    g.audio?.play?.('capture_sting');
    g.postfx?.pulseGlitch?.(1);
    g.moment?.('captured', { coop: this.roster.size, who });
    const en = this._enemyOf(who);
    try {
      await Promise.race([Promise.resolve(en.runCaptureSequence?.(g.camera)), new Promise((r) => setTimeout(r, 4500))]);
    } catch (err) {
      console.warn('[coop] capture sequence', err);
    }
    if (this.isHost) en.releaseCapture?.();
    else en.endCapture?.();
    if (!this.active || this.status !== 'captured') return;
    this._trapLocal(who);
  }

  _trapLocal(who = this._captor || 'caretaker') {
    const g = this.game;
    this.status = 'trapped';
    let seat;
    let c;
    let at = 'r0';
    if (who === 'assistant') {
      ({ seat, centre: c, at } = this._artSeat(this.mySlot));
    }
    if (at === 'r0') {
      if (!g.world.room000Revealed) {
        g.room000Revealed = true;
        g.revealRoom000Now?.();
      }
      seat = this._seat(this.mySlot);
      c = g.world.room000?.center;
    }
    this._trapAt = at;
    c = c || seat;
    const yaw = Math.atan2(-(c.x - seat.x), -(c.z - seat.z)) || 0;
    g.player.spawn(seat, yaw);
    g.player.seated = true;
    g.player.setViewmodelVisible?.(false);
    this.syncPlayer();
    // a beat in the black first, so the move to the Art room / Room 000 doesn't feel like a random teleport (beta)
    g.postfx.fade = 1;
    const card = this._carryCard(at === 'art' ? 'She carries you to the Art room…' : 'He drags you to Room 000…');
    const HOLD = 1.8;
    g._tween(HOLD, () => (g.postfx.fade = 1));
    g._at(g.time + HOLD, () => {
      card?.remove();
      if (this.status !== 'trapped') return;
      g._tween(1.2, (k) => (g.postfx.fade = 1 - k));
      g.ui?.showNotice?.(
        at === 'art'
          ? 'Sitting in the Art room\'s circle, with her "friends". A friend has to come here and let you out (E).'
          : 'Locked in Room 000. A friend has to come here and let you out (E).',
        7,
      );
      // caught with a panel / computer / chat open (or Esc during the capture): the mouse is free and
      // nothing else would ask for it back, so looking around did nothing (beta). Ask with one click.
      if (!g.touch?.active && !g.player.isLocked && g.state === 'playing') g.ui?.showResumeOverlay?.();
    });
    this._renderTeam();
  }

  /** Centred line of text over the black while a captive is carried off (removed by the caller). */
  _carryCard(text) {
    try {
      const el = document.createElement('div');
      el.className = 'carry-card';
      el.setAttribute('role', 'status');
      el.textContent = text;
      (document.getElementById('ui') || document.body).append(el);
      return el;
    } catch {
      return null;
    }
  }

  /** Host: a free request. The rescuer must be a free player on the captive's floor, within 3.5 m. */
  _hostFree(d, from) {
    const g = this.game;
    const id = String(d?.id || '');
    const r = this.roster.get(id);
    if (!this.active || !r || r.status !== 'trapped' || !this._isPlayer(from) || this.roster.get(from)?.status !== 'alive') return { ok: false };
    const seatPos = id === this.selfId ? g.player.position : this.proxies.get(id)?.position;
    const byPos = from === this.selfId ? g.player.position : this.proxies.get(from)?.position;
    if (!seatPos || !byPos) return { ok: false };
    if (Math.hypot(seatPos.x - byPos.x, seatPos.z - byPos.z) > 3.5 || this._floorOf(seatPos) !== this._floorOf(byPos) || Math.abs(seatPos.y - byPos.y) > 1.5) {
      return { ok: false, error: 'too-far' };
    }
    this._setStatus(id, 'alive');
    this.room.send('fr', { id, by: from }, { to: 'all' });
    return { ok: true };
  }

  requestFree(id) {
    if (this.status !== 'alive') return false;
    if (this.isHost) return !!this._hostFree({ id }, this.selfId).ok;
    this.room.request('host', 'free', { id }, { timeoutMs: 4000 }).catch(() => {});
    return true;
  }

  _onFreed(d, m) {
    if (!this.active || m.from !== this.room.hostId || !d) return;
    const by = this.roster.get(d.by)?.name || 'Someone';
    if (d.id === this.selfId) {
      if (this.status !== 'trapped' && this.status !== 'captured') return;
      this.status = 'alive';
      const g = this.game;
      g.player.seated = false;
      g.player.setViewmodelVisible?.(true);
      this.syncPlayer();
      g.ui?.showNotice?.(`${by} let you out. Go!`, 4);
      g.audio?.play?.('door_open', { position: g.player.position });
    } else {
      const r = this.roster.get(d.id);
      const who = r?.name || 'Someone';
      this.avatars.playOnce(d.id, 'stand_up');
      if (d.by === this.selfId) this.game.ach?.moment('rescue');
      const where = r?.at === 'art' ? 'out of the Art room' : 'out of Room 000';
      this.game.subtitle?.(d.by === this.selfId ? `You let ${who} out.` : `${by} let ${who} ${where}.`, 3.5, '');
    }
    this._renderTeam();
  }

  /** Rescue prompts: one per trapped teammate. */
  _updateInteractables() {
    const list = this._interactables;
    list.length = 0;
    if (this.status !== 'alive') return;
    for (const r of this.roster.values()) {
      if (r.status !== 'trapped' || r.id === this.selfId) continue;
      const av = this.avatars.get(r.id);
      if (!av) continue;
      if (!av.free) {
        av.free = {
          id: 'free:' + r.id,
          kind: 'free',
          position: new THREE.Vector3(),
          range: 2.0,
          object: av.root,
          getPrompt: () => (this.roster.get(r.id)?.at === 'art' ? `Help ${r.name} up` : `Let ${r.name} out`),
          interact: () => this.requestFree(r.id),
        };
      }
      av.free.position.set(av.root.position.x, av.root.position.y + 0.9, av.root.position.z);
      list.push(av.free);
    }
  }

  getInteractables() {
    return this.active ? this._interactables : null;
  }

  // ============================================================================= escape
  /** game.tryEscape in co-op (the team has all three items). */
  tryExit() {
    if (this.status !== 'alive') return;
    if (this.exitOpen) {
      this._escapeLocal();
      return;
    }
    if (this.isHost) this._hostExit(this.selfId);
    else this.room.request('host', 'exit', {}, { timeoutMs: 4000 }).catch(() => {});
  }

  _hostExit(from) {
    const g = this.game;
    if (!this.active || this.exitOpen || !this._isPlayer(from) || this.roster.get(from)?.status !== 'alive' || !g.hasAllItems()) return { ok: false };
    const pos = this._posOf(from);
    const ex = g.world?.exit?.position;
    if (from !== this.selfId && pos && ex && (Math.hypot(pos.x - ex.x, pos.z - ex.z) > 6 || this._floorOf(pos) !== 0)) return { ok: false, error: 'too-far' };
    this.room.send('xo', {}, { to: 'all' });
    return { ok: true };
  }

  /** Host: a guest says they walked out. Only through the open entrance, from the ground floor. */
  _hostOut(from, since = performance.now()) {
    const pos = this._posOf(from);
    const ex = this.game.world?.exit?.position;
    if (!this.exitOpen || this.roster.get(from)?.status !== 'alive') return;
    if (pos && ex && (Math.hypot(pos.x - ex.x, pos.z - ex.z) > 6 || this._floorOf(pos) !== 0)) {
      // their position (unreliable, 15 Hz) can be a step behind the reliable 'out': look again for 2 s
      if (performance.now() - since < 2000) (this._outWait ||= new Map()).set(from, since);
      else this.netStats.bad++;
      return;
    }
    this._outWait?.delete(from);
    this._setStatus(from, 'escaped');
  }

  _onExitOpen() {
    const g = this.game;
    if (!this.active || this.exitOpen) return;
    this.exitOpen = true;
    g.events.emit('exit:unlocked', {});
    g.world.setExitState?.('open');
    g.audio?.play?.('exit_unlock', { position: g.exitInteractable.position });
    g.moment?.('exit-unlocked', { coop: this.roster.size });
    g.subtitle?.('The main entrance is open. Everybody out!', 4.5, '');
  }

  _escapeLocal() {
    const g = this.game;
    if (this.status !== 'alive') return;
    this.status = 'escaping';
    if (!this.isHost) this.room.send('out', {}, { to: 'host' });
    else this._setStatus(this.selfId, 'escaped');
    this.syncPlayer();
    g.player.setViewmodelVisible?.(false);
    g.audio?.play?.('escape');
    const cam = g.camera;
    const exitPos = g.world.exit.position;
    const yaw = g.world.exit.yaw ?? 0;
    const outward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const target = exitPos.clone().addScaledVector(outward, 3).setY(1.6);
    const from = cam.position.clone();
    const y0 = cam.rotation.y;
    const lookYaw = Math.atan2(-(target.x - from.x), -(target.z - from.z));
    const dyaw = ((lookYaw - y0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this._outCam = true;
    g._tween(3.2, (k) => {
      const e = k * k * (3 - 2 * k);
      cam.rotation.set(cam.rotation.x * 0.9, y0 + dyaw * Math.min(1, e * 2), 0);
      cam.position.lerpVectors(from, target, e);
      g.postfx.fade = Math.max(0, (k - 0.6) / 0.4);
    });
    g._at(g.time + 3.3, () => {
      if (!this.active) return;
      this.status = 'escaped';
      this._outCam = false;
      g.postfx.doFlash?.(0.6, 0xdfe8ff, 0.6);
      g._tween(1, (k) => (g.postfx.fade = 1 - k));
      g.moment?.('escaped', { coop: this.roster.size });
      g.ui?.showNotice?.('You got out. Watching the others (click to switch).', 6);
      this._renderTeam();
    });
  }

  // ======================================================================== local status
  /** player.enabled follows the co-op status, the co-op pause and game.canControl() (overlays: chat,
   *  puzzle panels… keep the player still). A Director's own player never moves. */
  syncPlayer() {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    const can = typeof g.canControl === 'function' ? g.canControl() : !g.coopPaused;
    p.enabled = can && !g.coopPaused && (this.status === 'alive' || this.status === 'trapped');
  }

  _updateLocal(dt) {
    const g = this.game;
    // walk out through the open entrance (ground floor)
    if (this.status === 'alive' && this.exitOpen && !g.player.isHidden) {
      const ex = g.world.exit.position;
      if (Math.hypot(g.player.position.x - ex.x, g.player.position.z - ex.z) < 1.7 && this._floorOf(g.player.position) === 0) this._escapeLocal();
    }
    if (this.status === 'escaped' && !this._outCam) this._spectate(dt);
  }

  _spectate(dt) {
    const g = this.game;
    const ids = [...this.roster.values()].filter((r) => r.id !== this.selfId && (r.status === 'alive' || r.status === 'trapped' || r.status === 'captured')).map((r) => r.id);
    const cam = g.camera;
    if (!ids.length) return;
    if (this._specClick) {
      this._specClick = false;
      this._specIdx++;
    }
    const av = this.avatars.get(ids[this._specIdx % ids.length]);
    if (!av) return;
    const s = av.cur;
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    const want = new THREE.Vector3(s.x - fx * 2.4, (s.y || 0) + (s.flags & F.seated ? 1.7 : 2.05), s.z - fz * 2.4);
    // don't put the camera inside a wall: pull it in towards them until it can see them
    const head = av.headPos;
    for (let i = 0; i < 4 && !g.world.lineOfSight(want, head); i++) want.lerp(head, 0.35);
    cam.position.lerp(want, Math.min(1, dt * 6));
    const lookYaw = Math.atan2(-(head.x - cam.position.x), -(head.z - cam.position.z));
    const pitch = Math.atan2(head.y - cam.position.y, Math.hypot(head.x - cam.position.x, head.z - cam.position.z));
    cam.rotation.set(pitch, lookYaw, 0);
  }

  // ======================================================================== roster status
  _setStatus(id, status, at) {
    if (!this.isHost || !this.roster.has(id)) return;
    const r = this.roster.get(id);
    if (at) r.at = at;
    if (r.status === status || r.status === 'left') return;
    r.status = status;
    const { st, at: where } = this._statusMaps();
    this.room.send('rs', { st, at: where }, { to: 'others' });
    this._renderTeam();
    this.plist.refresh();
  }

  _statusMaps() {
    const st = {};
    const at = {};
    for (const [k, v] of this.roster) {
      st[k] = v.status;
      at[k] = v.at || 'r0';
    }
    return { st, at };
  }

  _onRoster(d, m) {
    if (!this.active || m.from !== this.room.hostId || !d?.st) return;
    for (const [id, s] of Object.entries(d.st)) {
      const r = this.roster.get(id);
      if (r && STATUS_WORD[s] !== undefined) r.status = s;
      if (r && (d.at?.[id] === 'art' || d.at?.[id] === 'r0')) r.at = d.at[id];
    }
    this._renderTeam();
    this.plist.refresh();
  }

  /** The words for a player's status (the team panel, the player list). */
  statusWord(r, status = r?.status) {
    if (status === 'trapped') return TRAP_WORD[r?.at] || STATUS_WORD.trapped;
    return STATUS_WORD[status] ?? '';
  }

  _renderTeam() {
    const ul = this.$('hud-team-list');
    if (!ul) return;
    ul.replaceChildren();
    const rows = [...this.roster.values()].sort((a, b) => a.slot - b.slot);
    for (const r of rows) {
      const li = document.createElement('li');
      li.dataset.status = r.id === this.selfId ? this.status : r.status;
      const chip = document.createElement('span');
      chip.className = 'hud-team__chip';
      chip.style.background = hexCss(lookColors(r.look).blazer);
      const n = document.createElement('b');
      n.textContent = r.id === this.selfId ? `${r.name} (you)` : r.name;
      const s = document.createElement('small');
      s.textContent = this.statusWord(r.id === this.selfId ? { ...r, at: this._trapAt || r.at } : r, li.dataset.status);
      li.append(chip, n, this._vcBadge(r.id), s);
      ul.append(li);
    }
  }

  // =========================================================================== end of run
  _hostCheckEnd() {
    if (this._ended) return;
    const g = this.game;
    let free = 0;
    for (const r of this.roster.values()) if (r.status === 'alive' || r.status === 'escaping') free++;
    if (g.timeLeft <= 0) this._hostEnd('time');
    else if (free === 0) this._hostEnd('done');
  }

  _hostEnd(reason) {
    this._ended = true;
    const g = this.game;
    const st = {};
    for (const [k, v] of this.roster) st[k] = v.status;
    this.room.send('end', { reason, st, t: r2(g.time), left: r2(g.timeLeft) }, { to: 'all' });
  }

  _onEnd(d, m) {
    const g = this.game;
    if (!this.active || m.from !== this.room.hostId || !d?.st) return;
    this._ended = true;
    for (const [id, s] of Object.entries(d.st)) {
      const r = this.roster.get(id);
      if (r) r.status = s;
    }
    const mine = this.roster.get(this.selfId)?.status;
    const out = [...this.roster.values()].filter((r) => r.status === 'escaped').map((r) => r.name);
    const behind = [...this.roster.values()].filter((r) => r.status !== 'escaped' && r.status !== 'left').map((r) => r.name);
    const stats = { ...g._stats(), timeLeft: num(d.left) ? d.left : g.timeLeft, coop: { out, behind, total: this.roster.size } };
    const won = mine === 'escaped';
    g.finishCoop?.({ won, reason: d.reason, stats, everyone: behind.length === 0, out });
    this.status = won ? 'escaped' : this.status;
    // keep the room (and the avatars until the next run): the host can play again
    this._showEndButtons();
  }

  _showEndButtons() {
    for (const el of document.querySelectorAll('[data-coop-host]')) el.hidden = !this.isHost;
    for (const el of document.querySelectorAll('[data-coop-guest]')) el.hidden = this.isHost;
    for (const el of document.querySelectorAll('[data-action="restart"]')) {
      el.disabled = !this.isHost;
      if (!el.dataset.label) el.dataset.label = el.textContent;
      el.textContent = this.isHost ? 'Play again' : 'Waiting for the host…';
    }
  }

  /** Back to single-player looks for the end-screen buttons. */
  resetEndButtons() {
    for (const el of document.querySelectorAll('[data-coop-host], [data-coop-guest]')) el.hidden = true;
    for (const el of document.querySelectorAll('[data-action="restart"]')) {
      el.disabled = false;
      if (el.dataset.label) el.textContent = el.dataset.label;
    }
  }

  // ===================================================================== SCHOOLNET extras
  onPA(kind, pos, song) {
    if (!this.active || !pos || this.status === 'director') return;
    this.room.send('pa', { k: kind === 'song' ? 'song' : 'announcement', s: kind === 'song' ? String(song || '').slice(0, 24) : undefined, x: r2(pos.x), y: r2(pos.y ?? 2.8), z: r2(pos.z) });
  }

  _onPA(d, m) {
    const g = this.game;
    if (!this._fromPlayer('pa', m) || !d || !num(d.x) || !num(d.z) || !okPos(d.x, num(d.y) ? d.y : 2.8, d.z)) return;
    const pos = new THREE.Vector3(d.x, num(d.y) ? d.y : 2.8, d.z);
    const song = typeof d.s === 'string' ? d.s : undefined; // (a song only they have falls back to Frère Jacques)
    const dur = g.audio?.broadcast?.(d.k === 'song' ? 'song' : 'announcement', pos, song, true) || 4;
    g.subtitle?.(d.k === 'song' ? songSubtitle(g.audio, song) : '[a distant announcement echoes through the halls]', Math.min(9, dur + 1), 'PA');
  }

  onPsDrop(x, z, yaw) {
    if (this.active && this.status !== 'director') this.room.send('psd', [r2(x), r2(z), r3(yaw)]);
  }

  onPsTake() {
    if (this.active && this.status !== 'director') this.room.send('pst', {});
  }

  _onPsDrop(d, m) {
    if (!this._fromPlayer('psd', m) || !Array.isArray(d) || !d.slice(0, 3).every(num) || !okPos(d[0], 0, d[1])) return;
    this.game.computers?.remotePsDrop?.(d[0], d[1], d[2]);
  }

  // ============================================================================ game hooks
  _bindGame() {
    const ev = this.events;
    ev.on('noise', (n) => {
      if (!this.guest || n?.net || !n?.position || this.status !== 'alive') return;
      const p = n.position;
      this.room.send('nz', [r2(p.x), r2(p.y || 0), r2(p.z), r2(n.radius ?? 6), String(n.source || '').slice(0, 16)], { to: 'host' });
    });
    const hide = (spot, on) => this.active && this.status !== 'director' && spot?.id && this.room.send('hd', { id: spot.id, on });
    ev.on('hide:enter', ({ spot } = {}) => hide(spot, 1));
    ev.on('hide:exit', ({ spot } = {}) => hide(spot, 0));
    ev.on('door:open', ({ door, by, push } = {}) => !push && this._doorOut(door, true, by));
    ev.on('door:close', ({ door, by } = {}) => this._doorOut(door, false, by));
    // the host's enemies, retold to the guests (with `who` for The Assistant)
    ev.on('enemy:voice', (e) => this._relayEnemy('voice', e));
    ev.on('enemy:spotted', (e) => this._relayEnemy('spotted', e));
    ev.on('enemy:state', (e) => !e?.net && this._relayEnemy('state', e));
    ev.on('enemy:winded', (e) => this._relayEnemy('winded', e));
    ev.on('enemy:sighting', (e) => this._relayEnemy('sighting', e));
    ev.on('enemy:lost', (e) => this._relayEnemy('lost', e));
    ev.on('world:transform-warning', (e) => {
      if (this.active && this.isHost && !e?.net) this.room.send('xw', {});
    });
    // co-op keys: M mutes the mic, V waves; when out, clicking switches who you watch.
    // (never while typing: chat, a puzzle panel, a login box… CONTRACTS §13.2)
    addEventListener('keydown', (e) => {
      if (!this.active || this.game.state !== 'playing' || this.game.schoolnet?.isOpen || e.repeat) return;
      if (this.game.isTyping?.() || this.status === 'director') return;
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'KeyV' && this.status === 'alive') {
        this.room.send('wv', {});
        this.game.ui?.showNotice?.('You waved.', 1.2);
      }
      if (this.status === 'escaped' && (e.code === 'Space' || e.code === 'KeyE')) this._specClick = true;
    });
    addEventListener('mousedown', () => {
      if (this.active && this.status === 'escaped') this._specClick = true;
    });
  }

  /** HallPass moment data. */
  hpExtra() {
    return this.active ? { coop: this.roster.size, host: this.isHost ? 1 : 0 } : null;
  }

  /** Local mute (chat and voice) for a player: this session only (chat.js / playerlist.js). */
  setMuted(id, on) {
    try {
      this.room?.voice?.setPeerMuted?.(id, !!on);
    } catch {
      /* ignore */
    }
  }

  /** Host: remove a player from the room (player list "Remove"; Director kick). */
  hostKick(id, reason = 'The host removed you from the room.') {
    if (!this.isHost || !id || id === this.selfId) return false;
    this._kick(id, reason);
    return true;
  }

  // ===================================================================== game.net transport
  /** Bind game.net to this room for the run (net.js: CONTRACTS §13.3). Wire format: 'n:<type>' with
   *  {b} (host broadcast), {h} (to the host, fire and forget) or {q, d} (a request; the host answers
   *  once with 'nr' {q, r}; no answer in 5 s → { ok: false, error: 'timeout' }). The sender id always
   *  comes from the SDK link (m.from), never from the payload. */
  _bindNet() {
    const net = this.game.net;
    if (!net || !this.room) return;
    if (!this._netT) {
      this._netT = {
        isHost: () => !!this.room?.isHost,
        selfId: () => this.room?.selfId || 'local',
        broadcast: (type, data, opts = {}) => this._netSend(type, { b: data ?? null }, 'others', opts.reliable !== false),
        toHost: (type, data, opts = {}) => this._netSend(type, { h: data ?? null }, 'host', opts.reliable !== false),
        request: (type, data) => this._netRequest(type, data),
      };
    }
    net.bindTransport(this._netT);
    this._netKnown = -1;
    this._netRescan();
  }

  _unbindNet() {
    const net = this.game.net;
    if (this._netT) net?.unbindTransport?.(this._netT);
    for (const off of this._netSubs.values()) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    this._netSubs.clear();
    for (const [id, p] of this._netReqs) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'closed' });
      this._netReqs.delete(id);
    }
  }

  /** Listen for 'n:<type>' for every type game.net knows (net.on / net.handle), plus our own. The SDK has
   *  no wildcard listener, so new types are picked up when the counts change (checked every frame). */
  _netRescan() {
    const net = this.game.net;
    const room = this.room;
    if (!net || !room || net.transport !== this._netT) return;
    const n = (net._on?.size || 0) + (net._handlers?.size || 0);
    if (n === this._netKnown) return;
    this._netKnown = n;
    const types = new Set([...(net._on?.keys() || []), ...(net._handlers?.keys() || []), 'f2', 'f2s', 'floor1', 'chat', 'chatmsg']);
    for (const type of types) {
      const ev = `n:${type}`;
      if (this._netSubs.has(ev) || ev.length > 64) continue;
      this._netSubs.set(ev, room.on(ev, (body, m) => this._onNetMsg(type, body, m)));
    }
  }

  _netSend(type, body, to, reliable) {
    const room = this.room;
    if (!room) return;
    try {
      room.send(`n:${type}`, body, { to, reliable });
    } catch (err) {
      console.warn(`[coop] net '${type}' not sent:`, err?.message || err);
    }
  }

  _netRequest(type, data) {
    const room = this.room;
    if (!room) return Promise.resolve({ ok: false, error: 'offline' });
    return new Promise((resolve) => {
      const q = ++this._netSeq;
      const timer = setTimeout(() => {
        this._netReqs.delete(q);
        resolve({ ok: false, error: 'timeout' });
      }, 5000);
      this._netReqs.set(q, { resolve, timer });
      try {
        room.send(`n:${type}`, { q, d: data ?? null }, { to: 'host' });
      } catch (err) {
        clearTimeout(timer);
        this._netReqs.delete(q);
        resolve({ ok: false, error: String(err?.code || 'send-failed') });
      }
    });
  }

  _onNetMsg(type, body, m) {
    const room = this.room;
    const net = this.game.net;
    if (!room || !net || !body || typeof body !== 'object' || Array.isArray(body)) return;
    if (m.from !== room.hostId && !this._allow(`n:${type}`, m.from)) {
      if (room.isHost && Number.isInteger(body.q)) this._netReply(m.from, body.q, { ok: false, error: 'rate' });
      return;
    }
    if ('b' in body) {
      if (m.from !== room.hostId || room.isHost) return; // only the host broadcasts
      net._deliver(type, body.b, m.from);
    } else if ('h' in body) {
      if (!room.isHost) return;
      net._callHandler(type, body.h, m.from);
    } else if (Number.isInteger(body.q)) {
      if (!room.isHost) return;
      Promise.resolve(net._callHandler(type, body.d, m.from)).then(
        (r) => this._netReply(m.from, body.q, r ?? { ok: true }),
        () => this._netReply(m.from, body.q, { ok: false, error: 'handler-failed' }),
      );
    }
  }

  _netReply(to, q, r) {
    try {
      this.room?.send('nr', { q, r }, { to });
    } catch {
      try {
        this.room?.send('nr', { q, r: { ok: false, error: 'reply-failed' } }, { to });
      } catch {
        /* gone */
      }
    }
  }

  _onNetReply(d, m) {
    if (!this.room || m.from !== this.room.hostId || !d || !Number.isInteger(d.q)) return;
    const p = this._netReqs.get(d.q);
    if (!p) return;
    this._netReqs.delete(d.q);
    clearTimeout(p.timer);
    p.resolve(d.r ?? { ok: false, error: 'empty' });
  }

  /** Host: the full shared state (net.provideState) to one peer: a Director joining, a reconnect. */
  _sendSnapshot(to) {
    if (!this.room?.isHost || !this.active) return;
    try {
      this.room.send('nsnap', { all: this.game.net.snapshotAll() }, { to });
    } catch (err) {
      console.warn('[coop] snapshot not sent', err?.message || err);
    }
  }

  // =================================================================== Director: late join
  /** Host: the transforms of this run so far (a late Director replays them). */
  sendTransformLog(inp) {
    this._xfLog.push({ n: inp.n, viewers: inp.viewers, protect: inp.protect, r0: !!this.game.world.room000Revealed });
    if (this._xfLog.length > 64) this._xfLog.shift();
  }

  /** Host: everything a Director needs to build this run's school as it is now. */
  _sendDirectorRun(id) {
    const g = this.game;
    const room = this.room;
    if (!room || !this.active) return;
    const roster = [...this.roster.values()].map((r) => ({ id: r.id, name: r.name, slot: r.slot, look: r.look }));
    const { st, at } = this._statusMaps();
    const doors = (g.world?.doors || []).map((d) => (d.isOpen ? 1 : 0));
    const d = {
      seed: g.seed,
      difficulty: g.settings.difficulty,
      roster,
      st,
      at,
      t: r2(g.time),
      left: r2(g.timeLeft),
      xf: this._xfLog.slice(),
      r0: !!g.world?.room000Revealed,
      f1: !!g.floor1Reached,
      exit: !!this.exitOpen,
      picked: [...this._picked],
      doors,
      startFloor: g.startFloor ?? this._runStartFloor ?? 0,
    };
    try {
      room.send('drun', d, { to: id });
    } catch (err) {
      console.warn('[coop] drun not sent', err?.message || err);
      return;
    }
    this._sendSnapshot(id);
  }

  _onDirectorRun(d, m) {
    if (!this.room || m.from !== this.room.hostId || !d || !Array.isArray(d.roster) || !this.amDirector) return;
    this._beginRun({ ...d, director: true, late: true });
  }

  /** Director (late join): bring the freshly built school up to the host's: transforms, Room 000,
   *  doors, the team's items, the entrance, the clock. Quietly: no announcements, no fanfare. */
  catchUp(d) {
    const g = this.game;
    const w = g.world;
    const reveal = () => {
      if (w.room000Revealed) return;
      g.room000Revealed = true;
      w.revealRoom000?.();
    };
    const list = Array.isArray(d.xf) ? d.xf : [];
    const ok = (a, k) => Array.isArray(a) && a.length <= 8 && a.every((p) => Array.isArray(p) && p.length === k && p.every(num));
    for (const x of list) {
      if (!x || !Number.isInteger(x.n) || !ok(x.viewers, 3) || !ok(x.protect, 2)) continue;
      if (x.r0) reveal();
      try {
        w.transformer.count = x.n - 1;
        w.transform({ protect: x.protect.map(([px, pz]) => new THREE.Vector3(px, 0, pz)), isVisible: this.makeVisibility(x.viewers) });
        g.transforms = (g.transforms || 0) + 1;
      } catch (err) {
        console.warn('[coop] transform replay', err);
      }
    }
    if (d.r0) reveal();
    for (const id of Array.isArray(d.picked) ? d.picked : []) if (typeof id === 'string') g.items?.collectRemote?.(id);
    const doors = Array.isArray(d.doors) ? d.doors : [];
    for (let i = 0; i < doors.length && i < (w.doors || []).length; i++) {
      const door = w.doors[i];
      if (!!doors[i] !== !!door.isOpen) doors[i] ? door.open('remote') : door.close('remote');
    }
    if (d.exit) {
      this.exitOpen = true;
      w.setExitState?.('open');
    }
    if (d.f1 && !g.floor1Reached) g._onFloor1Reached?.();
    if (num(d.t)) g.time = d.t;
    if (num(d.left)) g.timeLeft = d.left;
  }
}
