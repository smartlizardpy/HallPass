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
// URL flags (testing): ?seed=123  ?debug=1  ?autostart=1 (start a run without the menu)
//                      ?difficulty=easy|normal|hard  ?coopdebug (log the P2P SDK)
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

    // --- modules (constructed against CONTRACTS.md) -------------------------------------
    this.world = new World(this);
    this.items = new Items(this);
    this.player = new Player(this);
    this.enemy = new Enemy(this);
    this.audio = new AudioSystem(this);
    this.ui = new UI(this);
    this.touch = new TouchControls(this); // tablets only (no-op elsewhere)
    this.computers = new Computers(this); // SCHOOLNET computers + the things you can use
    this.schoolnet = new SchoolNet(this); // the computer screen
    this.ach = new Achievements(this);
    momentHook = (n, d) => this.ach.moment(n, d);
    this.coop = new Coop(this); // play with friends (HallPass P2P)
    this.mic = new MicHearing(this); // opt-in: the caretaker hears your microphone
    this.coopPaused = false;

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
    const parts = { world: 0, enemy: 0, items: 0 };
    const progress = (key) => (p) => {
      parts[key] = typeof p === 'number' ? p : 1;
      const total = (parts.world + parts.enemy + parts.items) / 3;
      this.ui.showLoading?.(Math.min(0.99, total), 'Unlocking the building…');
    };
    const results = await Promise.allSettled([
      this.world.load(progress('world')),
      this.enemy.load(progress('enemy')),
      this.items.load(progress('items')),
    ]);
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      // the world is essential; enemy/items failing to load is fatal for a real run too
      throw failed[0].reason;
    }
    this.world.setQuality?.(this.settings.quality);
    this._applyShadows();
    this.ui.showLoading?.(1, 'Ready');
    this.ui.hideLoading?.();
    requestAnimationFrame(this._frame);

    if (params.has('autostart')) {
      this.startRun(this.settings.difficulty, { noLock: true });
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

  getInteractables() {
    const list = [];
    const w = this.world.getInteractables?.();
    if (w) for (const it of w) list.push(it);
    const i = this.items.getInteractables?.();
    if (i) for (const it of i) list.push(it);
    const c = this.computers?.getInteractables?.();
    if (c) for (const it of c) list.push(it);
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
    this.coop?._endRunLocal?.();
    this.coop?.resetEndButtons?.();
    this.coopPaused = false;
    this.setState('menu');
    this.timeline.length = 0;
    this.tweens.length = 0;
    this.player.enabled = false;
    this.player.unlockPointer?.();
    this.enemy.enabled = false;
    this.postfx.fade = 0;
    this.postfx.threat = 0;
    this.seed = Number(params.get('menuSeed')) || 0x1a57be11;
    this.world.generate(this.seed);
    this.world.setLightsMode?.('normal');
    this.items.reset?.();
    this.computers?.reset();
    this.inventory?.clear?.();
    this._setupMenuVista();
    this.player.setViewmodelVisible?.(false);
    this._precompile();
    this.ui.hideAll?.();
    this.ui.hideHUD?.();
    this.ui.showMenu?.();
    this.audio.setMusicState?.('menu');
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
  startRun(difficulty, opts = {}) {
    // Must run inside the user gesture (Start/Restart click) for pointer lock + audio.
    this.audio.unlock?.();
    if (!opts.noLock) this.player.lockPointer?.();

    if (difficulty && CFG.DIFFICULTY[difficulty]) this.settings.difficulty = difficulty;
    this.difficulty = CFG.DIFFICULTY[this.settings.difficulty] || CFG.DIFFICULTY.normal;
    this.seed = opts.seed || Number(params.get('seed')) || (Math.random() * 0x7fffffff) | 0;
    this.coopPaused = false;
    if (!opts.coop) this.coop?.resetEndButtons?.();

    if (this.ui.hideAll) this.ui.hideAll();
    else {
      this.ui.hideMenu?.();
      this.ui.hidePause?.();
    }
    this.audio.stopAll?.();
    this.timeline.length = 0;
    this.tweens.length = 0;

    this.world.generate(this.seed);
    this.world.setLightsMode?.('normal');
    this.enemy.setMenuPose?.(false);
    this.items.reset?.();
    this.items.spawn(this.world.itemSpawns);
    this.player.setTorchLevel?.(1);
    const torchSpot = this._torchUpgradeSpot();
    if (torchSpot) this.items.spawnExtra?.('batteries', torchSpot);
    this.inventory?.clear?.();
    this.player.spawn(this.world.playerSpawn.position, this.world.playerSpawn.yaw);
    this.world.signs?.refresh(); // item stickers for the fresh (empty) inventory
    this.schoolnet?.close('force');
    this.computers?.build(); // computers, notes, the PlayStation, the register, the vending machine
    this.enemy.spawn(this.world.enemySpawn.position, this.world.enemySpawn.yaw);
    this.enemy.enabled = false;
    this.enemy.setAggression(0);
    this.exitInteractable.position.copy(this.world.exit.position);

    this.time = 0;
    this.timeLeft = this.difficulty.timeLimit;
    this.transforms = 0;
    this.aggression = -1; // forces the first _updateAggression() to push 0 to the enemy
    this.nextTransformAt = CFG.TRANSFORM_INTERVAL;
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
    // Intro: the final bell, the announcement, then the caretaker starts his rounds.
    this._at(0.4, () => {
      this.audio.play?.('bell');
      this.world.setLightsMode?.('flicker');
      this.events.emit('lights:flicker', { intensity: 0.6, duration: 2.5 });
    });
    this._at(3.2, () => this.world.setLightsMode?.('normal'));
    this._at(4.2, () => this.announce('announcement_intro'));
    // he starts his rounds while she is still talking; the objective lines wait until she stops
    this._at(12.5, () => {
      this.enemy.enabled = true;
      hpMoment('caretaker-active', this._hpData());
    });
    const introEnd = 4.2 + 1.5 + (Number(this.audio.speechDuration?.('announcement_intro')) || 15);
    this._at(introEnd + 0.8, () => this.subtitle('Something is moving in the building.', 3.5, ''));
    this._at(introEnd + 3.6, () => this.subtitle('Every exit is locked. Find a way out.', 4, ''));
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

  announce(id) {
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
      hpScore(r1(this.timeLeft)); // score = seconds left on the clock at escape
    });
  }

  /** Co-op: the host ended the run. Escaped players win; the rest were kept behind. */
  finishCoop({ won, reason, stats, everyone, out = [] }) {
    this.player.enabled = false;
    this.player.seated = false;
    this.player.unlockPointer?.();
    this.player.setViewmodelVisible?.(false);
    this.coopPaused = false;
    this.enemy.enabled = false;
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

  async _onCapture() {
    if (this.state !== 'playing') return;
    this.setState('captured');
    hpMoment('captured', this._hpData());
    this.player.enabled = false;
    this.player.setViewmodelVisible?.(false);
    this.audio.play?.('capture_sting');
    this.audio.setMusicState?.('none');
    this.postfx.pulseGlitch(1);
    try {
      await Promise.race([
        this.enemy.runCaptureSequence(this.camera),
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
      this.enemy.enabled = false;
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
    ev.on('ui:start', ({ difficulty } = {}) => this.startRun(difficulty));
    ev.on('ui:restart', () => {
      if (this.coop?.inRoom) this.coop.restart(); // host only: a new school, same friends
      else this.startRun(this.settings.difficulty);
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
    ev.on('enemy:capture', (e) => (this.coop?.active ? this.coop.onEnemyCapture(e) : this._onCapture()));
    ev.on('enemy:state', ({ state }) => {
      if (this.state !== 'playing') return;
      if (state === 'CHASE') hpMoment('caretaker-chase', this._hpData());
      if (state === 'CHASE') this.world.setLightsMode?.('flicker');
      else if (state === 'PATROL') this.world.setLightsMode?.('normal');
    });
    // beta tracking: chases you got away from (outrun or hidden), and the easter egg being spotted
    ev.on('enemy:lost', () => {
      if (this.state === 'playing') hpMoment('caretaker-lost', this._hpData({ winded: !!this.enemy?.winded }));
    });
    ev.on('enemy:winded', () => this.state === 'playing' && this.ach.moment('winded'));
    ev.on('enemy:voice', ({ line, big } = {}) => line === 'burp' && big && this.state === 'playing' && this.ach.moment('big-burp'));
    ev.on('egg:found', ({ id } = {}) => {
      if (this.state === 'playing') hpMoment('easter-egg', this._hpData({ egg: String(id || '').slice(0, 30) }));
    });

    addEventListener('keydown', (e) => {
      if ((e.code === 'KeyP' || e.code === 'Escape') && this.state === 'playing' && !this.schoolnet?.isOpen) {
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
        if (this.state === 'captured') this.enemy.updateCapture?.(dt, this);
        break;
      default:
        // paused / won / lost / loading: keep the post noise alive only
        break;
    }
    if (this.state !== 'playing') this.coop?.updateIdle?.(dt); // lobby / end screens: voice chat

    this.audio.update?.(dt, this);
    this.ui.update?.(dt, this);
    this.touch?.update?.();
    this.postfx.threat = this.state === 'playing' ? (this.enemy.getThreat?.() ?? 0) : this.postfx.threat * 0.95;
    this.postfx.render(this.scene, this.camera, dt);
    this.schoolnet?.afterRender(); // security-camera feeds (one per frame while that app is open)
    if (this.debugEl) this._updateDebugOverlay(dt);
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
    this.enemy.update(dt, this);
    this.world.update?.(dt, this);
    this.items.update?.(dt, this);
    this.computers?.update(dt);
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
      `aggr ${this.aggression.toFixed(2)}  threat ${(this.enemy.getThreat?.() ?? 0).toFixed(2)}  transforms ${this.transforms}\n` +
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
