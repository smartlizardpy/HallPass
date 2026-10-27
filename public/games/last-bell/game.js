// LAST BELL — main entry point. Owned by the main agent.
//
// Boots the renderer, loads every module (world, enemy, player, items, ui, audio), runs the game
// loop and the run state machine:
//
//   boot → loading → menu ⇄ playing ⇄ paused
//                            playing → captured → lost
//                            playing → escaping → won
//                            playing → lost (escape timer ran out)
//
// URL flags (testing): ?seed=123  ?debug=1  ?autostart=1 (start a run without the menu)  ?mode=halloween (with autostart)
//                      ?difficulty=easy|normal|hard  ?coopdebug (log the P2P SDK)
//                      ?start=floor1  the pre-update run: ground-floor spawn, ground-floor clock,
//                                     transforms from the start, stairs open (regression tests)
//                      ?founder=dev / ?director=dev  localhost only (CONTRACTS.md §13.4)
//                      ?halloween=1|0  force The Halloween Shift's menu entry on/off (halloween/config.js)
//
// The Halloween Shift (halloween/, seasonal, isolated): startRun(d, { mode: 'halloween' }) plays the ground
// floor only, both stairwells barricaded, with the HorrorDirector. The module is loaded on demand; normal
// runs never load it. game.mode is 'normal' | 'halloween'. Turn the event off: HALLOWEEN.enabled = false.
//
// Second Floor update: runs start upstairs (Floor 2, The Assistant). The ground floor's transforms
// start once somebody reaches it. One clock: timeLimit + floor2Time. CONTRACTS.md §13.
//
// Co-op (coop.js): the run is the same state machine, but it never leaves 'playing' until the host
// ends it (finishCoop): being caught, walking out and pausing are co-op statuses, not game states.

import * as THREE from './lib/three/three.module.js';
import * as CFG from './config.js';
import { EventBus } from './events.js';
import { PostFX } from './postfx.js';
import { World } from './world.js';
import { Enemy } from './enemy.js';
import { Player } from './player.js';
import { Items } from './items.js';
import { UI } from './ui.js';
import { AudioSystem } from './audio.js';
import { TouchControls, TOUCH_MODE } from './touch.js';
import { Computers } from './computers.js';
import { SchoolNet } from './schoolnet.js';
import { Coop } from './coop.js';
import { MicHearing } from './mic-detect.js';
import { Achievements } from './achievements.js';
import { Net } from './net.js';
import { Assistant } from './assistant.js';
import { Floor2 } from './floor2.js';
import { FloorTwoCutscene } from './cutscene-f2.js';
import { HALLOWEEN, halloweenAvailable, loadHallPassEvent, onHalloweenChange } from './halloween/config.js';

// boot-check.js watches for this: the module graph loaded and the game is starting
if (window.__lastBell) window.__lastBell.started = true;

const params = new URLSearchParams(location.search);

// HallPass SDK hooks. Fire-and-forget and always safe: a missing, inert or slow SDK (or a throw) is swallowed.
const r1 = (n) => Math.round(Number(n) || 0);
let momentHook = null; // achievements listen to the same moments HallPass gets
function hpMoment(name, data, opts) {
  try {
    momentHook?.(name, data || {});
  } catch {}
  try {
    if (window.HallPass && HallPass.moment) {
      const p = HallPass.moment(name, data, opts);
      if (p && p.catch) p.catch(() => {});
    }
  } catch {}
}
function hpScore(score) {
  try {
    if (window.HallPass && HallPass.submitScore) {
      const p = HallPass.submitScore(score, { promptHandle: false });
      if (p && p.catch) p.catch(() => {});
    }
  } catch {}
}

const ANNOUNCEMENTS = {
  announcement_intro:
    'Good evening, students. The final bell has now rung. All remaining students are required to report to Room 000. ' +
    'Please remain calm. The doors have been locked for your safety. Thank you for your cooperation.',
  announcement_room000: 'Room 000 is now open. Attendance is mandatory.',
  announcement_shift: 'Corridors are being reassigned. Please stay where you can be found.',
  announcement_late: 'Attention. The building will be secured in sixty seconds. Remain where you are.',
  announcement_floor2:
    'Students on the second floor. The stairwells have been secured for your safety. Please remain in your classroom. ' +
    'A member of staff will collect you shortly.',
  // two recorded takes: game.announce() picks one per run (by seed, so every co-op peer hears the same)
  announcement_stairs_open: 'Stairwell A is now open. Please proceed downstairs in an orderly fashion. Walking, not running. [muttering] These people always fall asleep.',
  announcement_stairs_open_2: '[clears throat] Stairwell A is now open. Please proceed downstairs in an orderly fashion. Walking, not running.',
  // a staff page, now and then while upstairs: it draws The Assistant towards the Security Office speaker
  announcement_assistant: 'Would the Assistant Caretaker please report to the second floor. Thank you.',
  // the opening notice (cutscene and no-cutscene starts): it names the lock and who controls it
  announcement_floor2_b: 'Students on the second floor. The stairwells are locked and will remain locked until the Security Office is powered. Please do not attempt to leave. Please do not attempt to leave.',
  // the staff page alternates with announcement_assistant (first page: this one)
  announcement_security_page: 'Would the Assistant Caretaker please report to the Security Office. Thank you.',
  // floor2.js: when the Security Office power comes on
  announcement_power_on: 'Attention. Power has been restored to the Security Office. This is not a scheduled event.',
  // once per run: 20 s after power comes on, or 150 s into the floor, while Stairwell A is still shut
  announcement_stairs_hint: 'Stairwell A may only be released from the Security Office. Staff are reminded not to write the password down.',
};

function loadSettings() {
  const s = { ...CFG.DEFAULT_SETTINGS };
  if (TOUCH_MODE) s.quality = 'low'; // tablets: first-run default (a saved choice still wins)
  try {
    const raw = localStorage.getItem(CFG.SETTINGS_KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
  } catch {
    /* storage unavailable — defaults are fine */
  }
  return s;
}

function fatal(message, err) {
  console.error(message, err);
  let el = document.getElementById('fatal-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal-error';
    el.style.cssText =
      'position:fixed;inset:0;display:grid;place-items:center;background:#050506;color:#c9c3b0;' +
      'font:15px/1.6 ui-monospace,Menlo,monospace;padding:24px;text-align:center;z-index:9999';
    document.body.appendChild(el);
  }
  el.textContent = `LAST BELL could not start. ${message}`;
}

class Game {
  constructor() {
    this.THREE = THREE;
    this.events = new EventBus();
    this.settings = loadSettings();
    if (params.get('difficulty')) this.settings.difficulty = params.get('difficulty');
    this.difficulty = CFG.DIFFICULTY[this.settings.difficulty] || CFG.DIFFICULTY.normal;
    this.state = 'boot';
    this.time = 0;
    this.timeLeft = 0;
    this.seed = 0;
    this.transforms = 0;
    this.aggression = 0;
    this.room000Revealed = false;
    this.exitHintShown = false;
    this.timeline = [];
    this.tweens = [];
    this.debug = params.has('debug');

    // --- renderer -----------------------------------------------------------------------
    const host = document.getElementById('game-canvas-host') || document.body;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.shadowMap.enabled = false;
    this.renderer.info.autoReset = false; // reset once per frame so stats cover scene + post
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    host.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020203);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.05, 70);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera); // the flashlight / viewmodel are camera children

    this.postfx = new PostFX(this.renderer);
    this.postfx.setQuality(this.settings.quality);
    this.postfx.setReduced(this.settings.reducedEffects);

    // --- shared services (Second Floor update; CONTRACTS.md §13) ------------------------
    this.net = new Net(this); // gameplay messages: host-authoritative in co-op, local in solo
    this.overlays = new Map(); // open overlays: name -> { keys, pointer, move }
    this.activeOverlay = null;
    this.identity = null; // this player's HallPass identity ({ role, founder, publicId }) or null
    this.floor1Reached = false; // someone has walked down to the ground floor this run

    // --- modules (constructed against CONTRACTS.md) -------------------------------------
    this.world = new World(this);
    this.items = new Items(this);
    this.player = new Player(this);
    this.enemy = new Enemy(this); // the Caretaker (ground floor)
    this.assistant = new Assistant(this); // The Assistant (upstairs)
    this.enemies = [this.enemy, this.assistant];
    this._captor = this.enemy; // who is running the capture cinematic
    this.startFloor = 0;
    this.audio = new AudioSystem(this);
    this.ui = new UI(this);
    this.touch = new TouchControls(this); // tablets only (no-op elsewhere)
    this.computers = new Computers(this); // SCHOOLNET computers + the things you can use
    this.floor2 = new Floor2(this); // the upstairs objectives and puzzles
    this.cutscene = new FloorTwoCutscene(this); // the upstairs opening (cutscene-f2.js)
    this.schoolnet = new SchoolNet(this); // the computer screen
    this.ach = new Achievements(this);
    momentHook = (n, d) => this.ach.moment(n, d);
    this.coop = new Coop(this); // play with friends (HallPass P2P)
    this.mic = new MicHearing(this); // opt-in: the caretaker hears your microphone
    this.coopPaused = false;
    this.mode = 'normal'; // 'halloween' during The Halloween Shift
    this.halloween = null; // halloween/mode.js, loaded on demand

    this.exitInteractable = {
      id: 'exit',
      kind: 'exit',
      position: new THREE.Vector3(),
      range: 2.8,
      object: null,
      getPrompt: () =>
        this.state !== 'playing'
          ? null
          : this.hasAllItems()
            ? 'Unlock the main entrance'
            : 'Main entrance (locked)',
      interact: () => this.tryEscape(),
    };

    this._bindEvents();
    this._loadIdentity();
    this._onResize();
    addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this.clock = new THREE.Timer();
    this.clock.connect(document);
    this._frame = this._frame.bind(this);
    if (this.debug) this._makeDebugOverlay();
  }

  get inventory() {
    return this.player.inventory;
  }

  // ===================================================================================
  // Boot
  // ===================================================================================
  async boot() {
    this.setState('loading');
    this.ui.showLoading?.(0, 'Unlocking the building…');
    const parts = { world: 0, enemy: 0, items: 0, assistant: 0 };
    const progress = (key) => (p) => {
      parts[key] = typeof p === 'number' ? p : 1;
      const total = (parts.world + parts.enemy + parts.items + parts.assistant) / 4;
      this.ui.showLoading?.(Math.min(0.99, total), 'Unlocking the building…');
    };
    // Ask HallPass whether the event is on, alongside the loading (it adds no wait unless the SDK is slow: 2.5 s cap).
    const eventAnswer = loadHallPassEvent(2500);
    const results = await Promise.allSettled([
      this.world.load(progress('world')),
      this.enemy.load(progress('enemy')),
      this.items.load(progress('items')),
      this.assistant.load(progress('assistant')),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      // the world is essential; enemy/items failing to load is fatal for a real run too
      throw failed[0].reason;
    }
    this.world.setQuality?.(this.settings.quality);
    this._applyShadows();
    await eventAnswer; // never rejects; the menu's halloweenAvailable() reads what HallPass said
    // HallPass flipped the event: follow it at the menu. A run in progress (or its screens) is never interrupted;
    // the next enterMenu() reads the new answer.
    onHalloweenChange((on) => {
      if (this.state !== 'menu') return;
      this.ui.setHalloween?.(on);
      if (on) this.loadHalloween().catch(() => {});
    });
    this.ui.showLoading?.(1, 'Ready');
    this.ui.hideLoading?.();
    requestAnimationFrame(this._frame);

    if (params.has('autostart')) {
      // ?mode=halloween (tests): The Halloween Shift, if the event (or ?halloween=1) allows it
      const hw = params.get('mode') === 'halloween' && halloweenAvailable();
      this.startRun(this.settings.difficulty, { noLock: true, ...(hw ? { mode: 'halloween' } : null) });
      // the run started without a click, so the browser couldn't capture the mouse: the first click on the view does
      window.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || e.target !== this.player.dom) return;
        if (this.state !== 'playing' || !this.player.enabled || this.player.isLocked || this.touch?.active || this.schoolnet?.isOpen) return;
        this.player.lockPointer?.();
      });
    } else {
      this.enterMenu();
    }
  }

  // ===================================================================================
  // State helpers
  // ===================================================================================
  setState(state) {
    if (state === this.state) return;
    const prev = this.state;
    this.state = state;
    if (prev === 'playing' && this.overlays?.size) this.closeAllOverlays(state);
    this.events.emit('game:state', { state, prev });
  }

  _precompile() {
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn('[game] precompile failed', err);
    }
  }

  hasAllItems() {
    return CFG.ITEM_IDS.every((id) => this.inventory?.has(id));
  }

  // ===================================================================================
  // Overlays and input focus (CONTRACTS.md §13.2). Every puzzle panel, the security PC, chat, the
  // player list and the Director panel open through here, so global keys (movement, P/Esc pause,
  // co-op M/V, touch UI) know to stay out of the way. The world never pauses for an overlay.
  // ===================================================================================
  /**
   * @param {string} name
   * @param {{ capturesKeys?: boolean, releasesPointer?: boolean, blocksMovement?: boolean }} opts
   */
  openOverlay(name, opts = {}) {
    const o = {
      keys: opts.capturesKeys !== false,
      pointer: opts.releasesPointer !== false,
      move: opts.blocksMovement !== false,
    };
    this.overlays.delete(name);
    this.overlays.set(name, o);
    this.activeOverlay = name;
    if (o.move) {
      this.player.enabled = false;
      this.player.focused = null;
    }
    if (o.pointer) this.player.unlockPointer?.();
    this.events.emit('overlay:open', { name });
  }

  /** relock: take the mouse back (only from a user gesture: a key or a click). */
  closeOverlay(name, { relock = true } = {}) {
    if (!this.overlays.has(name)) return;
    this.overlays.delete(name);
    this.activeOverlay = [...this.overlays.keys()].at(-1) || null;
    this.events.emit('overlay:close', { name });
    if (![...this.overlays.values()].some((o) => o.move)) this._restoreControl(relock);
  }

  /** Being caught, the run ending or a Director takeover: everything shuts, nothing re-locks. */
  closeAllOverlays(reason = 'force') {
    for (const name of [...this.overlays.keys()]) {
      this.overlays.delete(name);
      this.events.emit('overlay:close', { name, reason });
    }
    this.activeOverlay = null;
    this._restoreControl(false);
  }

  /** True while keystrokes belong to an overlay or a text box (chat, a login field…). */
  isTyping() {
    for (const o of this.overlays.values()) if (o.keys) return true;
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  /** May the local player move right now? (co-op's syncPlayer and player.js respect this too) */
  canControl() {
    if (this.state !== 'playing' || this.coopPaused || this.schoolnet?.isOpen || this.cutscene?.active) return false;
    for (const o of this.overlays.values()) if (o.move) return false;
    return true;
  }

  _restoreControl(relock) {
    if (this.state !== 'playing' || this.coopPaused) return;
    if (this.coop?.active) this.coop.syncPlayer();
    else this.player.enabled = !this.schoolnet?.isOpen && !this.cutscene?.active;
    if (relock && this.player.enabled && !this.touch?.active) this.player.lockPointer?.();
  }

  // ===================================================================================
  // Identity (HallPass) — founder Easter egg and Director Mode. Never trust a name or a URL flag
  // outside local development. Peers are verified by the host through coop (multiplayer.md §5–7).
  // ===================================================================================
  async _loadIdentity() {
    const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    if (local) {
      // dev only: ?founder=dev pretends this tab is the founder (never on a real origin)
      if (params.get('founder') === 'dev') this.identity = { role: 'super_admin', founder: true, publicId: 'dev' };
      return;
    }
    try {
      const res = await fetch('/api/v1/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      const me = await res.json();
      this.identity = {
        role: typeof me?.role === 'string' ? me.role : null,
        founder: me?.founder === true,
        publicId: typeof me?.publicId === 'string' ? me.publicId : null,
      };
    } catch {
      /* not on HallPass, or signed out: no identity */
    }
  }

  static _founderFrom(ident) {
    if (!ident) return false;
    if (ident.founder === true) return true;
    return CFG.FOUNDER_RULE === 'founder-or-super-admin' && ident.role === 'super_admin';
  }

  /** Is this player id the HallPass founder? Solo: our own identity. Co-op: host-verified only. */
  isFounder(id = this.net.selfId) {
    if (id === this.net.selfId) {
      // our own identity is only trusted for our own game: in co-op the host decides about guests
      if (!this.coop?.active || this.net.isHost) return Game._founderFrom(this.identity);
    }
    return Game._founderFrom(this.coop?.peerIdentity?.(id));
  }

  /** Is this player id a Director (a hidden admin)? Directors are never targets or players. */
  isDirector(id) {
    return !!this.coop?.isDirector?.(id);
  }

  /**
   * Live info about a player, for host-side validation: { id, position (feet, Vector3), floor,
   * status ('alive'|'captured'|'trapped'|'escaping'|'escaped'|'left'), hidden, director, self }.
   * Solo: the local player. Co-op: coop.playerInfo(id).
   */
  playerInfo(id = this.net.selfId) {
    if (this.coop?.active) return this.coop.playerInfo?.(id) ?? null;
    if (id !== this.net.selfId) return null;
    const p = this.player;
    return {
      id,
      position: p.position,
      floor: this.world.floorOf?.(p.position) ?? 0,
      status: this.state === 'playing' ? 'alive' : 'left',
      hidden: !!p.isHidden,
      director: false,
      self: true,
    };
  }

  /** Ids of everyone actually playing (not Directors, not left). */
  playerIds() {
    if (this.coop?.active) return this.coop.playerIds?.() ?? [this.net.selfId];
    return [this.net.selfId];
  }

  // ===================================================================================
  // Run phases (Second Floor update): upstairs → the ground floor
  // ===================================================================================
  /** Where this run starts: { position, yaw, floor }. Co-op spreads players around it. */
  spawnPoint() {
    const up = this.startFloor === 1 ? this.world.floor2?.playerSpawn : null;
    const sp = up || this.world.playerSpawn;
    return { position: sp.position, yaw: sp.yaw, floor: up ? 1 : 0 };
  }

  /** The HUD checklist: Floor 2's goals until someone reaches the ground floor, then the exit items. */
  objectives() {
    if (!this.floor1Reached) {
      const f = this.floor2?.objectives?.();
      if (f?.length) return f;
    }
    return CFG.ITEM_IDS.map((id) => ({ id, text: CFG.ITEM_NAMES[id], done: !!this.inventory?.has(id) }));
  }

  /** Host: somebody is standing on the ground floor. Idempotent; guests hear it from the host. */
  reachFloor1() {
    if (this.floor1Reached || !this.net.isHost) return;
    this.net.broadcast('floor1', { t: Math.round(this.time) });
  }

  _onFloor1Reached() {
    if (this.floor1Reached) return;
    this.floor1Reached = true;
    // the building starts changing a full interval after the first player gets downstairs
    this.nextTransformAt = this.time + CFG.TRANSFORM_INTERVAL;
    this.transformWarned = false;
    this.events.emit('floor1:reached', {});
    hpMoment('floor1-reached', this._hpData());
  }

  _checkFloor1(dt) {
    if (this.floor1Reached || !this.net.isHost) return;
    this._f1Check = (this._f1Check || 0) - dt;
    if (this._f1Check > 0) return;
    this._f1Check = 0.25;
    for (const id of this.playerIds()) {
      const info = this.playerInfo(id);
      if (info && !info.director && info.status === 'alive' && info.floor === 0) {
        this.reachFloor1();
        return;
      }
    }
  }

  _enemyBy(who) {
    return this.enemies.find((e) => e.who === who) || this.enemy;
  }

  getInteractables() {
    const list = [];
    const w = this.world.getInteractables?.();
    if (w) for (const it of w) list.push(it);
    const i = this.items.getInteractables?.();
    if (i) for (const it of i) list.push(it);
    const c = this.computers?.getInteractables?.();
    if (c) for (const it of c) list.push(it);
    const f2 = this.floor2?.getInteractables?.();
    if (f2) for (const it of f2) list.push(it);
    const co = this.coop?.getInteractables?.();
    if (co) for (const it of co) list.push(it);
    if (this.state === 'playing') list.push(this.exitInteractable);
    return list;
  }

  /** A HallPass moment with the usual run data (used by computers.js). */
  moment(name, extra) {
    hpMoment(name, this._hpData(extra));
  }

  _hpData(extra) {
    const pos = this.player?.position;
    return {
      t: r1(this.time),
      left: r1(this.timeLeft),
      items: this.inventory ? this.inventory.items.length : 0,
      x: pos ? r1(pos.x) : 0,
      z: pos ? r1(pos.z) : 0,
      room: String(this.world?.getRoomAt?.(pos?.x ?? 0, pos?.z ?? 0)?.name ?? '').slice(0, 40),
      seed: this.seed,
      diff: this.settings?.difficulty,
      ...(this.mode === 'halloween' ? { mode: 'halloween' } : null),
      ...this.coop?.hpExtra?.(),
      ...extra,
    };
  }

  _stats() {
    return {
      time: this.time,
      items: this.inventory ? this.inventory.items.length : 0,
      difficulty: this.settings.difficulty,
      seed: this.seed,
      transforms: this.transforms,
    };
  }

  // ===================================================================================
  // Menu (attract mode: a slow drift down a corridor with the caretaker far away)
  // ===================================================================================
  enterMenu() {
    this.halloween?.teardown();
    this.mode = 'normal';
    if (this._hwPrevDiff != null) {
      this.settings.difficulty = this._hwPrevDiff;
      this._hwPrevDiff = null;
      this.ui.refreshDifficulty?.();
    }
    this.coop?._endRunLocal?.();
    this.coop?.resetEndButtons?.();
    this.coopPaused = false;
    this.cutscene?.abort();
    this.setState('menu');
    this.timeline.length = 0;
    this.tweens.length = 0;
    this.player.enabled = false;
    this.player.unlockPointer?.();
    for (const e of this.enemies) e.enabled = false;
    this.postfx.fade = 0;
    this.postfx.threat = 0;
    this.seed = Number(params.get('menuSeed')) || 0x1a57be11;
    this.world.generate(this.seed);
    this.world.setLightsMode?.('normal');
    this.items.reset?.();
    this.computers?.reset();
    this.floor2?.reset?.();
    this.inventory?.clear?.();
    this._setupMenuVista();
    this.player.setViewmodelVisible?.(false);
    this._precompile();
    this.ui.hideAll?.();
    this.ui.hideHUD?.();
    this.ui.showMenu?.();
    this.audio.setMusicState?.('menu');
    const hw = halloweenAvailable();
    this.ui.setHalloween?.(hw);
    if (hw) this.loadHalloween().catch(() => {}); // warm it up while they read the menu
  }

  _setupMenuVista() {
    // Longest straight run of corridor cells → camera at one end, caretaker at the other.
    const corridorCells = new Set();
    for (const room of this.world.rooms || []) {
      if (!room.isCorridor) continue;
      for (const c of room.cells) corridorCells.add(`${c.cx},${c.cz}`);
    }
    let best = null;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const key of corridorCells) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [dx, dz] of dirs) {
        let n = 0;
        while (corridorCells.has(`${cx + dx * (n + 1)},${cz + dz * (n + 1)}`)) n++;
        if (!best || n > best.n) best = { cx, cz, dx, dz, n };
      }
    }
    const C = CFG.CELL;
    if (!best) {
      const sp = this.world.playerSpawn;
      this.menuVista = { from: sp.position.clone().setY(1.6), yaw: sp.yaw };
    } else {
      const from = new THREE.Vector3((best.cx + 0.5) * C, 1.55, (best.cz + 0.5) * C);
      const to = new THREE.Vector3((best.cx + best.dx * best.n + 0.5) * C, 1.55, (best.cz + best.dz * best.n + 0.5) * C);
      const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
      this.menuVista = { from, to, yaw, dir: new THREE.Vector3(best.dx, 0, best.dz) };
      const enemyPos = to.clone().setY(0);
      this.enemy.spawn(enemyPos, yaw + Math.PI);
      this.enemy.enabled = false;
      this.enemy.setMenuPose?.(true);
    }
    this.menuT = 0;
  }

  _updateMenu(dt) {
    this.menuT += dt;
    const v = this.menuVista;
    if (!v) return;
    const drift = v.dir ? Math.min(6, this.menuT * 0.12) : 0;
    this.camera.position.copy(v.from);
    if (v.dir) this.camera.position.addScaledVector(v.dir, drift);
    this.camera.position.y = 1.55 + Math.sin(this.menuT * 0.6) * 0.015;
    this.camera.rotation.set(Math.sin(this.menuT * 0.23) * 0.015 - 0.02, v.yaw + Math.sin(this.menuT * 0.17) * 0.04, 0);
    this.world.update?.(dt, this);
    this.enemy.updateMenu?.(dt, this);
  }

  // ===================================================================================
  // Run lifecycle
  // ===================================================================================
  /** The Halloween Shift's code (halloween/mode.js), loaded once on demand. */
  loadHalloween() {
    this._hwLoad ||= import('./halloween/mode.js').then((m) => (this.halloween = new m.HalloweenMode(this)));
    return this._hwLoad;
  }

  startRun(difficulty, opts = {}) {
    // Must run inside the user gesture (Start/Restart click) for pointer lock + audio.
    this.audio.unlock?.();
    if (!opts.noLock) this.player.lockPointer?.();
    const mode = opts.mode === 'halloween' && !opts.coop && halloweenAvailable() ? 'halloween' : 'normal'; // a restart after HallPass switched the event off becomes a normal run
    if (mode === 'halloween' && !this.halloween) {
      // first Halloween run: fetch the module, then start (the pointer is already locked)
      this.ui.showLoading?.(0.5, 'Unlocking the building…');
      this.loadHalloween()
        .then(() => (this.ui.hideLoading?.(), this.startRun(difficulty, { ...opts, noLock: true })))
        .catch((err) => {
          console.warn('[game] The Halloween Shift failed to load', err);
          this.ui.hideLoading?.();
          this.startRun(difficulty, { ...opts, mode: 'normal', noLock: true });
        });
      return;
    }
    this.halloween?.teardown(); // a previous Halloween run (no-op otherwise)
    this.mode = mode;
    if (mode === 'halloween') {
      // ranked runs: one difficulty for everyone; the player's own choice comes back at the menu
      this._hwPrevDiff ??= this.settings.difficulty;
      difficulty = HALLOWEEN.difficulty;
    } else if (this._hwPrevDiff != null) {
      this.settings.difficulty = this._hwPrevDiff;
      this._hwPrevDiff = null;
    }

    if (difficulty && CFG.DIFFICULTY[difficulty]) this.settings.difficulty = difficulty;
    this.difficulty = CFG.DIFFICULTY[this.settings.difficulty] || CFG.DIFFICULTY.normal;
    this.seed = opts.seed || Number(params.get('seed')) || (mode === 'halloween' ? HALLOWEEN.seed : (Math.random() * 0x7fffffff) | 0);
    this.coopPaused = false;
    if (!opts.coop) this.coop?.resetEndButtons?.();

    if (this.ui.hideAll) this.ui.hideAll();
    else {
      this.ui.hideMenu?.();
      this.ui.hidePause?.();
    }
    this.cutscene?.abort();
    this.audio.stopAll?.();
    this.timeline.length = 0;
    this.tweens.length = 0;

    this.world.generate(this.seed);
    // upstairs unless ?start=floor1 (or the world has no upstairs yet); a co-op guest follows the host's choice
    const wantFloor = mode === 'halloween' ? 0 : opts.startFloor === 0 || opts.startFloor === 1 ? opts.startFloor : params.get('start') === 'floor1' ? 0 : 1;
    this.startFloor = wantFloor === 1 && this.world.floor2?.playerSpawn ? 1 : 0;
    this.floor1Reached = this.startFloor === 0;
    this.world.setLightsMode?.('normal');
    this.enemy.setMenuPose?.(false);
    this.items.reset?.();
    this.items.spawn(this.world.itemSpawns);
    this.player.setTorchLevel?.(1);
    const torchSpot = this._torchUpgradeSpot();
    if (torchSpot) this.items.spawnExtra?.('batteries', torchSpot);
    this.inventory?.clear?.();
    const spawn = this.spawnPoint();
    this.player.spawn(spawn.position, spawn.yaw);
    this.world.signs?.refresh(); // item stickers for the fresh (empty) inventory
    this.schoolnet?.close('force');
    this.computers?.build(); // computers, notes, the PlayStation, the register, the vending machine
    this.enemy.spawn(this.world.enemySpawn.position, this.world.enemySpawn.yaw);
    this.enemy.enabled = false;
    this.enemy.setAggression(0);
    this.assistant.enabled = false;
    this.assistant.reset?.();
    this._captor = this.enemy;
    this.floor2?.reset?.(); // the upstairs objectives (host builds the state from the seed)
    this.exitInteractable.position.copy(this.world.exit.position);

    this.time = 0;
    this.timeLeft = this.difficulty.timeLimit + (this.startFloor === 1 ? this.difficulty.floor2Time || 0 : 0);
    if (mode === 'halloween') {
      this.timeLeft = HALLOWEEN.timeLimit;
      this.halloween.setupRun(); // barricades, decorations, posters, The Watcher, the HorrorDirector
    }
    this.transforms = 0;
    this.aggression = -1; // forces the first _updateAggression() to push 0 to the enemy
    this.nextTransformAt = this.floor1Reached ? CFG.TRANSFORM_INTERVAL : Infinity;
    this.transformWarned = false;
    this.room000Revealed = false;
    this.exitHintShown = false;
    this.lateAnnounced = false;
    this.exitHelp = false; // easy: everything found → +time and the minimap route to the entrance
    this.postfx.fade = 1;
    this.postfx.threat = 0;
    if (opts.coop) this.coop.onRunStart(); // spawn spread, the other players, the puppet caretaker

    this._updateAggression();
    this.player.setViewmodelVisible?.(true);
    this.player.enabled = true;
    this._precompile();
    this.setState('playing');
    this.ui.showHUD?.();
    this.audio.setMusicState?.('calm');
    hpMoment('run-start', this._hpData());

    this._tween(1.6, (p) => (this.postfx.fade = 1 - p));
    // Upstairs start: the opening cutscene (skippable, local) replaces the PA intro and the story lines.
    // ?autostart (tests) and ?cutscene=0 play the plain opening instead.
    this._assistantWake = false;
    const cutOn = this.startFloor === 1 && this.cutscene.start({ onEnd: (info) => this._f2OpeningDone(info) });
    // Intro: the final bell, the announcement, then the caretaker starts his rounds.
    this._at(0.4, () => {
      this.audio.play?.('bell');
      this.world.setLightsMode?.('flicker');
      this.events.emit('lights:flicker', { intensity: 0.6, duration: 2.5 });
    });
    this._at(3.2, () => this.world.setLightsMode?.('normal'));
    if (!cutOn) this._at(4.2, () => this.announce('announcement_intro'));
    // he starts his rounds while she is still talking; the objective lines wait until she stops
    this._at(12.5, () => {
      this.enemy.enabled = true;
      hpMoment('caretaker-active', this._hpData());
    });
    // host timers hang off a fixed length, never off how soon this player skipped the cutscene
    const introEnd = cutOn ? FloorTwoCutscene.LENGTH : 4.2 + 1.5 + (Number(this.audio.speechDuration?.('announcement_intro')) || 15);
    if (!cutOn) this._at(introEnd + 0.8, () => this.subtitle('Something is moving in the building.', 3.5, ''));
    if (this.startFloor === 1) {
      const upstairs = () => (this.state === 'playing' || this.state === 'paused') && !this.floor1Reached;
      if (!cutOn) {
        // the goal beat: what is wrong, who can fix it, what is needed. Then the checklist flashes.
        this._at(introEnd + 4.4, () => this.subtitle('The stairwell grille is down.', 3, ''));
        this._at(introEnd + 7.4, () => this.subtitle('The Security Office controls it.', 3, ''));
        this._at(introEnd + 10.4, () => {
          this.subtitle('I need a staff card, power, and the login.', 3.8, '');
          this.ui.flashGoals?.();
        });
        // she wakes at the first staff card pick-up (floor2:goal 'card', on every peer) or 60 s after the intro
        this._at(introEnd + 60, () => this._wakeAssistant('timer'));
        // the PA: the upstairs notice, then (two seconds after it ends) the player knows better
        this._at(introEnd + 30, () => upstairs() && this.announce('announcement_floor2_b'));
        const noticeEnd = introEnd + 30 + 1.5 + (Number(this.audio.speechDuration?.('announcement_floor2_b')) || 13);
        this._at(noticeEnd + 2, () => upstairs() && this.subtitle("Nobody's coming. The Security Office controls the stairs.", 4, ''));
      }
      // a staff page now and then that calls her to the Security Office
      let paged = false;
      let pages = 0;
      let s = (this.seed >>> 0) || 1;
      const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
      const page = (t) => this._at(t, () => {
        if (!upstairs()) return;
        const pageId = pages++ % 2 === 0 ? 'announcement_security_page' : 'announcement_assistant';
        this.announce(pageId);
        if (!paged) {
          paged = true; // the first page only: say where she is going
          const dur = Number(this.audio.speechDuration?.(pageId)) || 5;
          this._at(this.time + 1.5 + dur + 0.6, () => upstairs() && this.subtitle("She's heading for the Security Office.", 3, ''));
        }
        const sp = this.world.floor2?.anchor?.('security-pc')?.position;
        // host / solo only: the AI is host-authoritative
        if (sp && this.net.isHost) this._at(this.time + 2.5, () => upstairs() && this.events.emit('noise', { position: sp, radius: 90, source: 'pa' }));
        page(t + 200 + rnd() * 70);
      });
      page(introEnd + 140 + rnd() * 40);
      // the stairs hint, once: 20 s after the power comes on, or 150 s in, while Stairwell A is still shut
      // (every peer schedules it from the same events/clock, so everyone hears it together)
      let hinted = false;
      const stairsHint = () => {
        if (hinted || !upstairs() || this.floor2?.state?.stairA) return;
        hinted = true;
        this.announce('announcement_stairs_hint');
      };
      this._at(introEnd + 150, stairsHint);
      // the old notice (re-recorded 10-18) once more, later: "a member of staff will collect you" - she is awake by now
      this._at(introEnd + 95, () => upstairs() && !this.floor2?.state?.stairA && this.announce('announcement_floor2'));
      this._offPowerHint?.();
      const onPower = () => this._at(this.time + 20, stairsHint);
      this.events.on('floor2:power', onPower);
      this._offPowerHint = () => this.events.off?.('floor2:power', onPower);
    } else {
      this._at(introEnd + 3.6, () => this.subtitle('Every exit is locked. Find a way out.', 4, ''));
      if (mode === 'halloween') this.halloween.onIntro(introEnd);
    }
  }

  /** The upstairs opening cutscene ended (or was skipped): the thought, the checklist flash, and her wake timer.
   *  Everything is scheduled from NOW, so it never depends on when somebody else's cutscene ended. */
  _f2OpeningDone({ skipped, c } = {}) {
    if (this.startFloor !== 1) return;
    const upstairs = () => (this.state === 'playing' || this.state === 'paused') && !this.floor1Reached;
    hpMoment('f2-opening-end', this._hpData({ skipped: !!skipped, secs: c }));
    // her wake rule: the first staff card pick-up (floor2:goal), or 60 s after the opening
    this._at(this.time + 60, () => this._wakeAssistant('timer'));
    // the PA said "stay put, staff are coming"; two seconds after it ends, the player knows better
    const t = Math.max(this.time + 0.9, this.cutscene.announceEndsAt() + 2);
    this._at(t, () => upstairs() && this.subtitle("Nobody's coming. The Security Office controls the stairs.", 4, ''));
    this._at(t + 3.6, () => {
      if (!upstairs()) return;
      this.subtitle('I need a staff card, power, and the login.', 3.8, '');
      this.ui.flashGoals?.();
    });
  }

  pause() {
    if (this.state !== 'playing') return;
    if (this.coop?.active) {
      // co-op never stops the school: just the menu, and your hands off the controls
      if (this.coopPaused) return;
      this.coopPaused = true;
      this.coop.syncPlayer();
      this.player.unlockPointer?.();
      this.ui.showPause?.();
      return;
    }
    this.setState('paused');
    this.player.unlockPointer?.();
    this.audio.setPaused?.(true);
    this.ui.showPause?.();
  }

  resume() {
    if (this.coopPaused) {
      this.coopPaused = false;
      this.coop.syncPlayer();
      if (!this.schoolnet?.isOpen) this.player.lockPointer?.();
      this.ui.hidePause?.();
      return;
    }
    if (this.state !== 'paused') return;
    if (!this.schoolnet?.isOpen) this.player.lockPointer?.(); // at a computer the mouse stays free
    this.audio.setPaused?.(false);
    this.ui.hidePause?.();
    this.setState('playing');
  }

  /** The Assistant starts her rounds (once per run). The AI only runs on the host; a guest's puppet ignores the flag. */
  _wakeAssistant(why) {
    if (this._assistantWake || this.startFloor !== 1) return;
    if (this.state !== 'playing' && this.state !== 'paused') return;
    this._assistantWake = true;
    this.assistant.enabled = true;
    hpMoment('assistant-active', this._hpData({ why }));
  }

  announce(id) {
    if (id === 'announcement_stairs_open' && this.seed & 1) id = 'announcement_stairs_open_2';
    this.events.emit('announcement', { id, text: ANNOUNCEMENTS[id] || '' });
  }

  subtitle(text, duration = 3, speaker = '') {
    this.events.emit('subtitle', { text, duration, speaker });
  }

  // ===================================================================================
  // Objectives
  // ===================================================================================
  tryEscape() {
    if (this.state !== 'playing') return;
    if (this.coop?.active && this.hasAllItems()) {
      this.coop.tryExit(); // the host opens it for everyone; then each player walks out
      return;
    }
    if (!this.hasAllItems()) {
      const missing = CFG.ITEM_IDS.filter((id) => !this.inventory.has(id));
      this.audio.play?.('exit_denied', { position: this.exitInteractable.position });
      this.events.emit('exit:locked', { missing });
      this.events.emit('noise', { position: this.exitInteractable.position, radius: 10, source: 'exit' });
      const names = missing.map((id) => CFG.ITEM_NAMES[id].toLowerCase());
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
      this.subtitle(
        this.exitHintShown
          ? `Still locked. Missing: ${list}.`
          : `Chained shut. The lock panel needs a security keycard, a maintenance fuse and the exit key.`,
        4.5,
      );
      this.exitHintShown = true;
      return;
    }
    this._escapeSequence();
  }

  /** Fresh batteries: on a desk or shelf in one of the three rooms nearest the start (not an item room). */
  _torchUpgradeSpot() {
    const w = this.world;
    const sp = w.playerSpawn?.position;
    if (!sp || !w._roomData) return null;
    const skip = new Set([w.itemRooms?.keycard, w.itemRooms?.fuse, w.room000, w.playerSpawn.room]);
    const rooms = w.rooms
      .filter((r) => !r.isCorridor && !skip.has(r))
      .sort((a, b) => a.center.distanceTo(sp) - b.center.distanceTo(sp))
      .slice(0, 3);
    let h = (this.seed >>> 0) || 1;
    const rnd = () => ((h = (h * 16807) % 2147483647) / 2147483647);
    for (let i = rooms.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [rooms[i], rooms[j]] = [rooms[j], rooms[i]];
    }
    for (const room of rooms) {
      const surf = w._roomData.get(room.id)?.out?.surfaces || [];
      for (const s of surf) if (w._walkPoint?.(s.x, s.z, 1.4)) return new THREE.Vector3(s.x, s.y, s.z);
    }
    return null;
  }

  _onItemCollected({ id, remote }) {
    const count = this.inventory ? this.inventory.items.length : 0;
    if (!remote) hpMoment('item-collected', this._hpData({ item: String(id).slice(0, 30) }));
    this.postfx.doFlash(0.25, 0xfff4d6, 3);
    if (count >= 2 && !this.room000Revealed) {
      this.room000Revealed = true;
      // co-op: only the host opens it (and tells everyone, so every school gets the door at once)
      if (!this.coop?.guest) this._at(this.time + 2.2, () => this.revealRoom000Now());
    }
    if (this.hasAllItems()) {
      this._at(this.time + 2.5, () => this.subtitle('That’s all three. Get to the main entrance.', 4));
      const bonus = this.difficulty?.exitBonus || 0; // easy: extra time to find the entrance
      if ((bonus || this.difficulty?.exitRoute) && !this.exitHelp) {
        this.exitHelp = true; // the minimap route (easy and normal; hard gets neither)
        if (bonus && !this.coop?.guest) this.timeLeft += bonus; // co-op: the host's clock is the team's clock
        const plus = bonus ? ` +${Math.floor(bonus / 60)}:${String(bonus % 60).padStart(2, '0')} to reach the entrance.` : '';
        this.ui?.showNotice?.(`All found.${plus} The route is on your map.`, 6);
      }
    }
    this._updateAggression();
  }

  /** Room 000 appears (idempotent). Co-op: the host's reveal is sent to the others. */
  revealRoom000Now() {
    if (this.world.room000Revealed) return;
    this.room000Revealed = true;
    this.world.revealRoom000?.();
    hpMoment('room000-revealed', this._hpData());
    this.postfx.pulseGlitch(1);
    this.world.setLightsMode?.('flicker');
    this.events.emit('lights:flicker', { intensity: 1, duration: 2 });
    this.ui.flash?.('transform');
    this.announce('announcement_room000');
    this._at(this.time + 3.3, () => this.world.setLightsMode?.('normal'));
    this._at(this.time + 7.3, () => this.subtitle('A door that wasn’t there before. Room 000.', 4));
    this.coop?.hostReveal?.();
  }

  /** The 5-second warning before the building changes (co-op guests get it from the host). */
  transformWarning() {
    this.transformWarned = true;
    this.events.emit('world:transform-warning', { secondsLeft: 5 });
    this.world.setLightsMode?.('flicker');
    this.events.emit('lights:flicker', { intensity: 0.4, duration: 5 });
  }

  _updateAggression() {
    const items = this.inventory ? this.inventory.items.length : 0;
    let a = this.transforms * this.difficulty.aggressionStep + items * 0.12;
    if (this.timeLeft < 60) a += 0.2;
    a = Math.min(1, a);
    if (Math.abs(a - this.aggression) > 1e-3) {
      this.aggression = a;
      this.enemy.setAggression(a);
    }
  }

  /** net: co-op guests replay the host's transform from its inputs ({ n, viewers, protect }). */
  _doTransform(net = null) {
    this.transforms++;
    hpMoment('world-transform', this._hpData({ n: this.transforms }));
    let result = null;
    if (this.coop?.active) {
      // co-op: built from every player's position and view, rounded, so all schools change alike
      const inp = net || this.coop.transformInputs();
      try {
        if (net) this.world.transformer.count = net.n - 1;
        result = this.world.transform({
          protect: inp.protect.map(([x, z]) => new THREE.Vector3(x, 0, z)),
          isVisible: this.coop.makeVisibility(inp.viewers),
        });
      } catch (err) {
        console.warn('[game] world.transform failed', err);
      }
      if (!net) this.coop.sendTransform(inp);
    } else {
      const camera = this.camera;
      const frustum = new THREE.Frustum().setFromProjectionMatrix(
        new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      const eye = this.player.eyePosition || camera.position;
      const p = new THREE.Vector3();
      const isVisible = (v) => {
        p.set(v.x, 1.4, v.z);
        if (p.distanceTo(eye) > 34) return false;
        if (!frustum.containsPoint(p)) return false;
        return this.world.lineOfSight(eye, p);
      };
      try {
        result = this.world.transform({
          protect: [this.player.position.clone(), this.enemy.position.clone()],
          isVisible,
        });
      } catch (err) {
        console.warn('[game] world.transform failed', err);
      }
    }
    this.postfx.pulseGlitch(0.75);
    this.audio.play?.('transform');
    this.ui.flash?.('transform');
    this.world.setLightsMode?.(this.enemy.state === 'CHASE' ? 'flicker' : 'normal');
    if (this.transforms % 2 === 0) this._at(this.time + 1.5, () => this.announce('announcement_shift'));
    if (this.transforms === 1) {
      this._at(this.time + 2, () => this.subtitle('The building has changed.', 3));
    }
    this._updateAggression();
    return result;
  }

  _escapeSequence() {
    this.setState('escaping');
    hpMoment('exit-unlocked', this._hpData());
    this.player.enabled = false;
    this.player.setViewmodelVisible?.(false);
    this.events.emit('exit:unlocked', {});
    this.audio.play?.('exit_unlock', { position: this.exitInteractable.position });
    this.audio.setMusicState?.('none');
    this.world.setLightsMode?.('flicker');
    const cam = this.camera;
    const start = cam.position.clone();
    const exitPos = this.world.exit.position;
    const yaw = this.world.exit.yaw ?? 0;
    const outward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    // Walk towards the doors and through them.
    const target = exitPos.clone().addScaledVector(outward, 3).setY(1.6);
    const startYaw = cam.rotation.y;
    const lookYaw = Math.atan2(-(target.x - start.x), -(target.z - start.z));
    let dyaw = ((lookYaw - startYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this._tween(1.2, (p) => {
      const e = p * p * (3 - 2 * p);
      cam.rotation.y = startYaw + dyaw * e;
      cam.rotation.x *= 0.9;
    });
    this._at(this.time + 1.0, () => this.world.setExitState?.('open'));
    this._at(this.time + 1.4, () => this.audio.play?.('escape'));
    this._at(this.time + 1.3, () => {
      const from = cam.position.clone();
      this._tween(3.2, (p) => {
        cam.position.lerpVectors(from, target, p * p);
        this.postfx.fade = Math.max(0, (p - 0.55) / 0.45);
      });
    });
    this._at(this.time + 4.8, () => {
      this.postfx.doFlash(0.9, 0xdfe8ff, 0.6);
      this.setState('won');
      this.audio.setMusicState?.('victory');
      this.audio.play?.('victory');
      this.player.unlockPointer?.();
      this.ui.hideHUD?.();
      this.ui.showVictory?.(this._stats());
      hpMoment('escaped', this._hpData());
      // The Halloween Shift keeps its own board (halloween/score.js); never the normal one
      if (this.mode === 'halloween') this.halloween?.onEscaped(this._stats());
      else hpScore(r1(this.timeLeft)); // score = seconds left on the clock at escape
    });
  }

  /** Co-op: the host ended the run. Escaped players win; the rest were kept behind. */
  finishCoop({ won, reason, stats, everyone, out = [] }) {
    this.player.enabled = false;
    this.player.seated = false;
    this.player.unlockPointer?.();
    this.player.setViewmodelVisible?.(false);
    this.coopPaused = false;
    for (const e of this.enemies) e.enabled = false;
    this.schoolnet?.close?.('force');
    this.ui.hideHUD?.();
    if (won) {
      this.setState('won');
      this.postfx.fade = 0;
      this.postfx.doFlash(0.9, 0xdfe8ff, 0.6);
      this.audio.setMusicState?.('victory');
      this.audio.play?.('victory');
      if (everyone) this.ach.moment('team-escape');
      this.ui.showVictory?.(stats);
      const title = document.getElementById('victory-title');
      if (title) title.textContent = everyone ? 'You all got out.' : 'You got out.';
      hpScore(r1(stats.timeLeft));
    } else {
      this.setState('lost');
      this.postfx.fade = 1;
      this.audio.setMusicState?.('defeat');
      this.audio.play?.(reason === 'time' ? 'bell' : 'defeat');
      const names = out.length > 1 ? `${out.slice(0, -1).join(', ')} and ${out.at(-1)}` : out[0];
      this.ui.showGameOver?.(
        out.length ? `${names} got out. You were still inside.` : reason === 'time' ? 'time' : 'He caught every one of you.',
        stats,
      );
    }
  }

  async _onCapture(e = {}) {
    if (this.state !== 'playing') return;
    const captor = this._enemyBy(e.who || 'caretaker');
    this._captor = captor;
    for (const x of this.enemies) if (x !== captor) x.enabled = false;
    this.setState('captured');
    if (this.mode === 'halloween') this.halloween?.onCaptured();
    hpMoment('captured', this._hpData({ by: captor.who || 'caretaker' }));
    this.player.enabled = false;
    this.player.setViewmodelVisible?.(false);
    this.audio.play?.('capture_sting');
    this.audio.setMusicState?.('none');
    this.postfx.pulseGlitch(1);
    try {
      await Promise.race([
        captor.runCaptureSequence(this.camera),
        new Promise((r) => setTimeout(r, 4500)),
      ]);
    } catch (err) {
      console.warn('[game] capture sequence failed', err);
    }
    this._lose('caught');
  }

  _lose(reason) {
    if (this.state === 'lost' || this.state === 'won') return;
    const finish = () => {
      this.setState('lost');
      if (this.mode === 'halloween') this.halloween?.onRunEnd(reason);
      this.postfx.fade = 1;
      this.audio.setMusicState?.('defeat');
      this.audio.play?.('defeat');
      this.player.unlockPointer?.();
      this.ui.hideHUD?.();
      this.ui.showGameOver?.(reason, this._stats());
    };
    if (reason === 'time') {
      hpMoment('time-up', this._hpData());
      this.setState('captured');
      this.player.enabled = false;
      for (const e of this.enemies) e.enabled = false;
      this.audio.play?.('bell');
      this.world.setLightsMode?.('blackout');
      this.postfx.pulseGlitch(0.6);
      this._tween(2.6, (p) => (this.postfx.fade = p));
      this._at(this.time + 2.8, finish);
    } else {
      this._tween(0.5, (p) => (this.postfx.fade = Math.max(this.postfx.fade, p)));
      setTimeout(finish, 550);
    }
  }

  // ===================================================================================
  // Events
  // ===================================================================================
  _bindEvents() {
    const ev = this.events;
    ev.on('ui:start', ({ difficulty, mode } = {}) => this.startRun(difficulty, { mode }));
    ev.on('ui:restart', () => {
      if (this.coop?.inRoom) this.coop.restart(); // host only: a new school, same friends
      else this.startRun(this.settings.difficulty, { mode: this.mode });
    });
    ev.on('ui:resume', () => this.resume());
    ev.on('ui:pause', () => this.pause());
    ev.on('ui:quit', () => {
      if (this.coop?.inRoom) this.coop.leave();
      else this.enterMenu();
    });
    ev.on('settings:change', ({ settings } = {}) => this.applySettings(settings));
    ev.on('item:collected', (e) => this._onItemCollected(e));
    ev.on('torch:upgrade', () => {
      this.audio.play?.('pickup');
      this.ui.flash?.('item');
      this.postfx.doFlash(0.2, 0xfff4d6, 3);
    });
    ev.on('enemy:capture', (e) => (this.coop?.active ? this.coop.onEnemyCapture(e) : this._onCapture(e)));
    // co-op stays in 'playing' when you're caught: coop.js emits this for the local player
    ev.on('player:caught', (e = {}) => e.self !== false && this.closeAllOverlays('caught'));
    ev.on('enemy:state', ({ state, who = 'caretaker' }) => {
      if (this.state !== 'playing') return;
      if (state === 'CHASE') hpMoment(who === 'caretaker' ? 'caretaker-chase' : `${who}-chase`, this._hpData());
      // lights flicker while anything on your floor is chasing
      const floor = this.world.floorOf?.(this.player.position) ?? 0;
      const chasing = this.enemies.some((x) => x.enabled && x.state === 'CHASE' && (x.floor ?? 0) === floor);
      if (state === 'CHASE' && chasing) this.world.setLightsMode?.('flicker');
      else if (!chasing && (state === 'PATROL' || state === 'RETURN')) this.world.setLightsMode?.('normal');
    });
    this.net.on('floor1', () => this._onFloor1Reached());
    // beta tracking: chases you got away from (outrun or hidden), and the easter egg being spotted
    ev.on('enemy:lost', ({ who = 'caretaker' } = {}) => {
      if (this.state !== 'playing') return;
      if (who === 'caretaker') hpMoment('caretaker-lost', this._hpData({ winded: !!this.enemy?.winded }));
      else hpMoment(`${who}-lost`, this._hpData());
    });
    // co-op: only the player he was after earns these (the host's caretaker fires them for everyone)
    const mine = (e) => this.state === 'playing' && (this.coop?.aboutMe?.(e) ?? true);
    ev.on('enemy:winded', (e) => mine(e) && this.ach.moment('winded'));
    ev.on('enemy:voice', (e = {}) => (!e.who || e.who === 'caretaker') && e.line === 'burp' && e.big && mine(e) && this.ach.moment('big-burp'));
    // Floor 2 onboarding + playtest moments (each peer reports its own run clock)
    ev.on('floor2:goal', ({ id } = {}) => {
      if (id !== 'card' || this.startFloor !== 1) return;
      hpMoment('f2-card-found', this._hpData());
      this._wakeAssistant('card'); // the first card pick-up, by anyone, wakes her
    });
    ev.on('stairs:unlocked', ({ stair } = {}) => stair === 'A' && this.startFloor === 1 && hpMoment('f2-stairs-open', this._hpData()));
    ev.on('egg:found', ({ id } = {}) => {
      if (this.state === 'playing') hpMoment('easter-egg', this._hpData({ egg: String(id || '').slice(0, 30) }));
    });

    addEventListener('keydown', (e) => {
      if (
        (e.code === 'KeyP' || e.code === 'Escape') &&
        this.state === 'playing' &&
        !this.schoolnet?.isOpen &&
        !this.activeOverlay &&
        !this.isTyping()
      ) {
        e.preventDefault();
        this.pause();
      }
      if (this.debug && e.code === 'Backquote') this._toggleDebugOverlay();
    });
  }

  applySettings(next) {
    if (next && next !== this.settings) Object.assign(this.settings, next);
    const s = this.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.postfx.setQuality(s.quality);
    this.postfx.setReduced(s.reducedEffects);
    if (this.world?.lights) this.world.lights.reduced = !!s.reducedEffects;
    this.world.setQuality?.(s.quality);
    this._applyShadows();
    this.audio.setVolumes?.({
      master: s.masterVolume,
      music: s.musicVolume,
      sfx: s.sfxVolume,
      voice: s.voiceVolume,
      chat: s.chatVolume,
    });
    this.mic?.setEnabled(s.micHearing);
    this.halloween?.applySettings?.(s);
  }

  _applyShadows() {
    const want = !!CFG.QUALITY[this.settings.quality]?.shadows;
    if (this.renderer.shadowMap.enabled === want) return;
    this.renderer.shadowMap.enabled = want;
    this.scene.traverse((o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true;
    });
  }

  _onResize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postfx.setSize(w, h);
  }

  // ===================================================================================
  // Tiny scheduler (game-time based, so it pauses with the game)
  // ===================================================================================
  _at(t, fn) {
    this.timeline.push({ t, fn });
    this.timeline.sort((a, b) => a.t - b.t);
  }

  _tween(duration, fn) {
    this.tweens.push({ t: 0, duration, fn });
  }

  _runScheduler(dt) {
    while (this.timeline.length && this.timeline[0].t <= this.time) {
      const { fn } = this.timeline.shift();
      try {
        fn();
      } catch (err) {
        console.error('[game] timeline step failed', err);
      }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const p = Math.min(1, tw.t / tw.duration);
      tw.fn(p);
      if (p >= 1) this.tweens.splice(i, 1);
    }
  }

  // ===================================================================================
  // Main loop
  // ===================================================================================
  _frame(now) {
    requestAnimationFrame(this._frame);
    this.clock.update(now);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.renderer.info.reset();

    switch (this.state) {
      case 'menu':
        this._updateMenu(dt);
        break;
      case 'playing':
        this._updatePlaying(dt);
        break;
      case 'captured':
      case 'escaping':
        this.time += dt;
        this._runScheduler(dt);
        this.world.update?.(dt, this);
        if (this.state === 'captured') this._captor.updateCapture?.(dt, this);
        break;
      default:
        // paused / won / lost / loading: keep the post noise alive only
        break;
    }
    if (this.state !== 'playing') this.coop?.updateIdle?.(dt); // lobby / end screens: voice chat

    this.audio.update?.(dt, this);
    this.ui.update?.(dt, this);
    this.touch?.update?.();
    this.postfx.threat = this.state === 'playing' ? this._threat() : this.postfx.threat * 0.95;
    this.postfx.render(this.scene, this.camera, dt);
    this.schoolnet?.afterRender(); // security-camera feeds (one per frame while that app is open)
    if (this.debugEl) this._updateDebugOverlay(dt);
  }

  _threat() {
    let t = 0;
    for (const e of this.enemies) if (e.enabled !== false) t = Math.max(t, e.getThreat?.() ?? 0);
    return t;
  }

  _updatePlaying(dt) {
    this.time += dt;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this._runScheduler(dt);

    // building changes: co-op guests get them (and the warning) from the host instead
    if (!this.coop?.guest) {
      if (!this.transformWarned && this.time >= this.nextTransformAt - 5) this.transformWarning();
      if (this.time >= this.nextTransformAt) {
        this._doTransform();
        this.nextTransformAt += CFG.TRANSFORM_INTERVAL;
        this.transformWarned = false;
      }
    }
    if (!this.lateAnnounced && this.timeLeft <= 60) {
      this.lateAnnounced = true;
      this.announce('announcement_late');
      this._updateAggression();
    }

    this.player.update(dt, this);
    this.cutscene?.update(dt); // the upstairs opening owns the camera while it plays
    for (const e of this.enemies) e.update(dt, this);
    this.world.update?.(dt, this);
    if (this.mode === 'halloween') this.halloween?.update(dt);
    this.items.update?.(dt, this);
    this.computers?.update(dt);
    this.floor2?.update?.(dt);
    this._checkFloor1(dt);
    this.schoolnet?.update(dt);
    this.coop?.update(dt);
    this.mic?.update(dt);

    // (co-op: the host's coop.js ends the run, for everyone at once)
    if (this.state === 'playing' && this.timeLeft <= 0 && !this.coop?.active) this._lose('time');
  }

  // ===================================================================================
  // Debug overlay & automation hooks
  // ===================================================================================
  _makeDebugOverlay() {
    const el = document.createElement('pre');
    el.style.cssText =
      'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#9f9;' +
      'font:11px/1.35 ui-monospace,Menlo,monospace;z-index:9998;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    this.debugEl = el;
    this._fpsAcc = 0;
    this._fpsN = 0;
    this._fps = 0;
  }

  _toggleDebugOverlay() {
    if (this.debugEl) this.debugEl.hidden = !this.debugEl.hidden;
  }

  _updateDebugOverlay(dt) {
    this._fpsAcc += dt;
    this._fpsN++;
    if (this._fpsAcc < 0.5) return;
    this._fps = this._fpsN / this._fpsAcc;
    this._fpsAcc = 0;
    this._fpsN = 0;
    const info = this.renderer.info.render;
    const p = this.player.position;
    const e = this.enemy.position;
    this.debugEl.textContent =
      `fps ${this._fps.toFixed(0)}  calls ${info.calls}  tris ${info.triangles}\n` +
      `state ${this.state}  seed ${this.seed}  t ${this.time.toFixed(1)}  left ${this.timeLeft.toFixed(0)}\n` +
      `player ${p ? `${p.x.toFixed(1)},${p.z.toFixed(1)}` : '-'}  enemy ${e ? `${e.x.toFixed(1)},${e.z.toFixed(1)}` : '-'} ${this.enemy.state}\n` +
      `assistant ${this.assistant.enabled ? `${this.assistant.position.x.toFixed(1)},${this.assistant.position.z.toFixed(1)} ${this.assistant.state}` : 'off'}  floor ${this.world.floorOf?.(p) ?? 0}  f1 ${this.floor1Reached ? 'yes' : 'no'}\n` +
      `aggr ${this.aggression.toFixed(2)}  threat ${this._threat().toFixed(2)}  transforms ${this.transforms}\n` +
      `inv ${this.inventory ? this.inventory.items.join(',') : ''}`;
  }
}

// ---------------------------------------------------------------------------------------
let game;
try {
  game = new Game();
  window.__game = game; // automation / debugging hook
  game.boot().catch((err) => fatal(err?.message || String(err), err));
} catch (err) {
  fatal(err?.message || String(err), err);
}
