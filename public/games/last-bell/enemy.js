// LAST BELL — The Caretaker (S2). Enemy AI, navigation, perception, animation and capture.
//
// Public API (CONTRACTS §7):
//   const enemy = new Enemy(game);  await enemy.load(onProgress);  game.scene.add(enemy.object);
//   enemy.spawn(position, yaw);  enemy.enabled = true;  enemy.update(dt, game);
//   enemy.setAggression(0..1);  enemy.state;  enemy.position;  enemy.hearNoise({position, radius, source});
//   enemy.getThreat();  await enemy.runCaptureSequence(camera);
//
// Backwards-compatible extensions (documented in the S2 report):
//   enemy.modelUrl            GLB path (default 'assets/characters/caretaker.glb'; set before load())
//   enemy.yaw                 facing (three.js yaw convention, 0 = -Z)
//   enemy.detection           0..1 detection meter
//   enemy.isStalking          true while doing a "distant sighting" (still state PATROL)
//   enemy.lastKnownPosition   Vector3 | null
//   enemy.capturedFromHide    HideSpot | null (set when the capture happened at a hiding spot)
//   enemy.headPosition        Vector3 world position of the face (for audio / camera)
//   enemy.forceState(state, targetVec3?)   debug / scripted moments
//   enemy.updateCapture(dt)   drives the capture cinematic while game.js no longer calls update()
//                             (runCaptureSequence also self-drives via requestAnimationFrame as a fallback)
//   enemy.setMenuPose(on) / enemy.updateMenu(dt, game)   menu vista: motionless stare, head follows camera
//   enemy.dispose()           unsubscribes from the event bus
//   event 'enemy:sighting' { position }  — emitted when a stalking stare starts while the player can see him
//   enemy.fatigue 0..1 / enemy.winded   he tires after a long flat-out chase (see _updateFatigue)
//   event 'enemy:winded' { position }   — emitted when he runs out of breath mid-chase (+ voice line 'wheeze')
//   event 'enemy:voice' { line: 'burp', big: true } — the 25 % close-up burp (see NEAR_BURP_CHANCE)
//   enemy.distract(position)  a PA broadcast / the PlayStation: he goes to check (not while chasing you in sight)
//   enemy.callOff()           the Room 000 register: he forgets you and goes back to his rounds
//   enemy.upcomingPatrol(n)   his next n patrol stops (truthful: he walks them unless something distracts him)
//
// Co-op (coop.js). On the HOST he hunts every player: _pickTarget() chooses whom he is after among
// game.coop.targets() (the local player + stand-ins for the others), 'enemy:capture' carries
// { target }, and after a capture he lets go (releaseCapture: back to his rounds, a few seconds of
// grace) instead of ending the game; remoteCapture(pos) plays the grab on someone else.
// netSnapshot() is what the host sends 15 times a second. On a GUEST enemy.remote = true: no AI,
// _updatePuppet() follows the host's snapshots (game.coop.enemySample()) and lures are forwarded.
//
// Optional world extras used when present: world.getLightLevel(x, z) -> 0..1 (detection in darkness,
// stalking spots), world.lights.fixtures [{x, z, state}] (fallback for lit stalking spots),
// moveCircle(pos, delta, r, out) allocation-free variant, Door.active === false (ignored doors).
//
// Movement only through world.moveCircle(pos, delta, ENEMY.radius); doors opened with door.open('enemy').
// A 2.6 m man under 2.2 m door frames: he procedurally stoops through doorways (spine/knees, additive
// on top of the clips) and his head tracks whatever he is interested in (you, a noise, a locker).

import * as THREE from './lib/three/three.module.js';
import { ENEMY, PLAYER, DIFFICULTY, DOOR_HEIGHT } from './config.js';
import { loadGLB, cloneGLB, ps1ify } from './assets.js';
import { AnimationController } from './animations.js';
import { NavPathfinder } from './enemy-nav.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const STATES = ['PATROL', 'SUSPICIOUS', 'INVESTIGATE', 'CHASE', 'SEARCH', 'CAPTURE', 'IDLE'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
/** three.js yaw that faces direction (dx, dz): forward = (-sin yaw, -cos yaw). */
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// scratch objects (never escape)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _vMove = new THREE.Vector3(); // moveCircle `out` (S1 extension; ignored by worlds without it)
const _UP = new THREE.Vector3(0, 1, 0);

const VOICE_COOLDOWN = { found_you: 22, still_here: 26, corridor: 45, school_closed: 50, hum: 16, burp: 45, wheeze: 20 };

// He is old and heavy, so you can outrun him (beta request). After difficulty.chaseBurst seconds of
// flat-out running he slows to difficulty.tiredSpeed x his run speed over TIRE_RAMP s and wheezes.
// Walking it off brings him back: fatigue drains at TIRE_RECOVER s per second when he isn't running.
const TIRE_RAMP = 2.5;
const TIRE_CAP = 3; // s of extra running that can pile up past the ramp (so a breather isn't instant)
const TIRE_RECOVER = 0.5;

// Each time he comes right up close to you (within NEAR_BURP_DIST), there is a NEAR_BURP_CHANCE he
// lets out an enormous burp in your face (beta request). One roll per approach: it re-arms once he
// is NEAR_BURP_REARM away again. Not while he is chasing or catching you.
const NEAR_BURP_DIST = 3;
const NEAR_BURP_REARM = 6;
const NEAR_BURP_CHANCE = 0.25;

export class Enemy {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.modelUrl = 'assets/characters/caretaker.glb';
    this.object = new THREE.Group();
    this.object.name = 'caretaker';
    game.scene?.add(this.object); // CONTRACTS §7: "root added to game.scene" (idempotent if game.js adds it too)
    this.model = null;
    this.anim = null;
    this.bones = {};
    this.enabled = false;
    this.aggression = 0;
    this.yaw = 0;
    this.nav = new NavPathfinder();
    this.path = new Float32Array(512);
    this.pathCount = 0;
    this.pathIndex = 0;
    this.goal = new THREE.Vector3();
    this.pathTarget = new THREE.Vector3();
    this.stimulus = new THREE.Vector3();
    this.lkp = new THREE.Vector3();
    this.headPosition = new THREE.Vector3(0, 2.4, 0);
    this._eye = new THREE.Vector3(0, 2.35, 0);
    this._lastSeenPos = new THREE.Vector3();
    this._stuckAnchor = new THREE.Vector3();
    this._faceTarget = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._footPos = new THREE.Vector3();
    this._evtPos = new THREE.Vector3();
    this._tmpPoint = new THREE.Vector3();
    this._searchPts = Array.from({ length: 8 }, () => ({ p: new THREE.Vector3(), spot: null }));
    this._stalkPoint = new THREE.Vector3();
    this._recentPatrol = [];
    this._procAxes = {};
    this._ready = false;
    this.remote = false; // co-op guest: a puppet of the host's caretaker
    this._target = null; // co-op host: the player he is after
    this._tgtT = 0;
    this._graceT = 0;
    this._remoteCap = false;
    this._unsubs = [];
    if (this.events) {
      this._unsubs.push(this.events.on('noise', (n) => this.hearNoise(n)));
      this._unsubs.push(this.events.on('hide:enter', (e) => this._onHideEnter(e)));
      this._unsubs.push(this.events.on('hide:exit', () => (this._seenHide = null)));
    }
    this._reset();
  }

  // =============================================================================== public API
  get state() {
    return this.enabled || this._state === 'CAPTURE' ? this._state : 'IDLE';
  }

  get position() {
    return this.object.position;
  }

  get detection() {
    return this.meter;
  }

  get isStalking() {
    return !!this.stalk;
  }

  get lastKnownPosition() {
    return this._hasLkp ? this.lkp : null;
  }

  async load(onProgress) {
    try {
      const gltf = await loadGLB(this.modelUrl);
      const model = cloneGLB(gltf.scene);
      ps1ify(model);
      model.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = false; // skinned bounds don't follow the lunge/long arms
          o.castShadow = true;
          o.receiveShadow = false;
        }
        if (o.isBone) this.bones[o.name] = o;
      });
      model.rotation.y = Math.PI; // glTF front is +Z; our object faces -Z (yaw convention)
      this._mats = [];
      model.traverse((o) => {
        if (o.isMesh && o.material?.emissive && !this._mats.includes(o.material)) this._mats.push(o.material);
      });
      this.object.add(model);
      this.model = model;
      this.anim = new AnimationController(model, gltf.animations);
    } catch (err) {
      console.warn('[enemy] caretaker GLB failed, using placeholder:', err?.message || err);
      this.model = this._buildPlaceholder();
      this.object.add(this.model);
      this.anim = new AnimationController(this.model, []);
    }
    this.anim.onFootstep = (clip) => {
      this._footPos.copy(this.object.position);
      this.events?.emit('enemy:footstep', { position: this._footPos, running: clip === 'run' });
    };
    this._setupProcedural();
    this.anim.play('idle', { fade: 0 });
    this._ready = true;
    onProgress?.(1);
  }

  spawn(position, yaw = 0) {
    this.object.position.set(position.x, 0, position.z);
    this.yaw = yaw;
    this.object.rotation.set(0, yaw, 0);
    this.object.visible = true;
    this._menuPose = false;
    this._reset();
    const prev = this._state;
    this._state = 'PATROL';
    this.events?.emit('enemy:state', { state: 'PATROL', prev });
    if (this.anim) {
      this.anim.stopAll();
      this.anim.play('idle', { fade: 0 });
    }
  }

  setAggression(level) {
    this.aggression = clamp(+level || 0, 0, 1);
  }

  getThreat() {
    return this._threat;
  }

  /** Called directly or through the 'noise' event. radius = metres heard at aggression 0. */
  hearNoise({ position, radius = 6, source } = {}) {
    if (!this.enabled || !this._ready || !position || this._state === 'CAPTURE' || this.remote) return;
    if (source === 'enemy') return;
    const diff = this._difficulty();
    let R = radius * diff.hearing * (1 + 0.6 * this.aggression);
    const d = hdist(this.object.position, position);
    if (d > R) return;
    // walls muffle: no line of sight -> 70 % radius
    const world = this.game.world;
    if (world?.lineOfSight) {
      _v1.set(position.x, Math.max(position.y || 0, 1.0), position.z);
      if (!world.lineOfSight(this._eye, _v1)) R *= 0.7;
      if (d > R) return;
    }
    this._onHeard(position, 1 - d / R, source);
  }

  forceState(state, target) {
    if (!STATES.includes(state)) return;
    if (target) {
      this.stimulus.copy(target);
      this.lkp.copy(target);
      this._hasLkp = true;
      this._stimulusNoise = true;
    }
    if (state === 'CHASE') this.meter = 1;
    this._setState(state);
  }

  /**
   * Capture cinematic: faces the camera, plays `capture`, turns the camera up to the face as the
   * hands close in (~2.5 s). Resolves when done. Drives itself if update() is no longer called.
   */
  runCaptureSequence(camera) {
    if (this._captureSeq) return this._captureSeq.promise;
    if (this._state !== 'CAPTURE') this._enterCapture();
    // caught at a hiding spot: drag the player out first (so the camera is not inside a closed locker)
    const pl = this.game.player;
    const fromHide = !!pl?.isHidden; // pulled out of a hiding place: "There you are… there you are."
    if (pl?.isHidden && this.capturedFromHide && typeof pl.exitHide === 'function') {
      try {
        pl.exitHide();
      } catch (err) {
        console.warn('[enemy] exitHide failed', err);
      }
    }
    const seq = {
      camera,
      t: 0,
      dur: Math.max(2.2, this.anim ? this.anim.duration('capture') : 0),
      q0: camera.quaternion.clone(),
      p0: camera.position.clone(),
      back: new THREE.Vector3(),
      qTarget: new THREE.Quaternion(),
      done: false,
      resolve: null,
      promise: null,
      shake: !(this.game.settings && this.game.settings.reducedEffects),
    };
    seq.promise = new Promise((res) => (seq.resolve = res));
    this._captureSeq = seq;

    // face the camera; slide the body (during the anticipation) so that the face ends ~0.45 m from
    // the camera when the clip finishes (sampled from the clip itself, so tweaks to it stay correct)
    const endHead = this._sampleClipHead('capture');
    camera.getWorldPosition(_v1);
    const pos = this.object.position;
    let dx = _v1.x - pos.x;
    let dz = _v1.z - pos.z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      dx = -Math.sin(this.yaw);
      dz = -Math.cos(this.yaw);
      d = 1;
    }
    dx /= d;
    dz /= d;
    const reach = endHead ? Math.max(0.2, -endHead.z) : 0.7;
    const want = reach + 0.45;
    seq.slideFrom = pos.clone();
    seq.slideTo = new THREE.Vector3(_v1.x - dx * want, 0, _v1.z - dz * want);
    this.yaw = yawTo(dx, dz);
    this.object.rotation.y = this.yaw;
    seq.back.set(dx, 0, dz); // camera stumbles back along this
    this._lookWeight = 1;
    if (this.anim) {
      this.anim.playOnce('capture', { fade: 0.12, fallbackDuration: seq.dur });
    }
    this.events?.emit('enemy:voice', { line: fromHide ? 'found_hiding' : 'found_you', position: this.headPosition });

    let last = performance.now();
    const tick = (now) => {
      if (seq.done || this._captureSeq !== seq) return;
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      if (now - this._lastUpdateMs > 80) this._captureTick(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return seq.promise;
  }

  /** Drive the capture cinematic from game.js while update() is paused ('captured' state). */
  updateCapture(dt) {
    if (!this._captureSeq) return;
    this._lastUpdateMs = performance.now();
    this._captureTick(Math.min(dt, 0.1));
  }

  /** Menu vista: he stands motionless at the end of the corridor, head slowly following the camera. */
  setMenuPose(on) {
    this._menuPose = !!on;
    if (on && this.anim) {
      this.anim.stopAll();
      this.anim.play('stare', { fade: 0 });
      this._wantAnim = 'stare';
      this._lookYaw = 0;
      this._lookPitch = 0;
    }
  }

  updateMenu(dt, game = this.game) {
    if (!this._ready || !this._menuPose) return;
    dt = Math.min(dt, 0.1);
    this._time += dt;
    if (game?.camera) {
      game.camera.getWorldPosition(this._lookTarget);
      this._hasLook = true;
    }
    if (this.anim) this._mixerUpdate(dt);
    this._applyProcedural(dt, game?.world);
    this._updateGlow(dt, game);
  }

  dispose() {
    for (const u of this._unsubs) u();
    this._unsubs.length = 0;
  }

  // =============================================================================== reset / state
  _reset() {
    this._state = 'PATROL';
    this._stateTime = 0;
    this._time = 0;
    this.meter = 0;
    this._threat = 0;
    this._visible = false;
    this._los = false;
    this._pathPartial = false;
    this._squeeze = false;
    this._vault = false;
    this._sqT = 0;
    (this._sqAnchor ||= new THREE.Vector3()).set(0, 0, 0);
    this._visDist = Infinity;
    this._losTimer = 0;
    this._hearTimer = 0;
    this._lastSeenTime = -999;
    this._lastSeenDist = Infinity;
    this._hasLkp = false;
    this._stimulusNoise = false;
    this._resumeState = 'PATROL';
    this.sub = 'pick';
    this.subT = 0;
    this.speed = 0;
    this._actualSpeed = 0;
    this.moveStatus = 'idle';
    this.goalMode = 'walk';
    this.goalArrive = 0.6;
    this.pathCount = 0;
    this.pathIndex = 0;
    this._needPath = false;
    this._lastPathTime = -999;
    this._navRef = null;
    this._navVersion = -1;
    this._stuckTimer = 0;
    this._stuckCount = 0;
    this.stuckEvents = 0;
    this._sidestep = 0;
    this._sidestepDir = 1;
    this._doorWait = null;
    this._turn = null;
    this._facing = false;
    this._hasLook = false;
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._lookWeight = 0;
    this._stoop = 0;
    this._doorScanT = 0;
    this._nearDoor = Infinity;
    this._seenHide = null;
    this.capturedFromHide = null;
    this._captureEmitted = false;
    this._captureSeq = null;
    this._lastUpdateMs = 0;
    this._spottedEmitted = false;
    this.stalk = null;
    this._nextStalk = 45 + Math.random() * 25;
    this._voiceT = { any: -999 };
    this._lostT = 0;
    this._runT = 0;
    this.fatigue = 0;
    this.winded = false;
    this._burpArmed = true;
    this._plan = [];
    this._planPts = null;
    this._searchEnd = 0;
    this._searchN = 0;
    this._searchIdx = 0;
    this._pauseAnim = 'idle';
    this._recentPatrol.length = 0;
    this._patrolIdx = -1;
    this._wantAnim = 'idle';
    this._target = null;
    this._tgtT = 0;
    this._graceT = 0;
    this._remoteCap = false;
    this.nav.clearBlocks?.();
  }

  _setState(s) {
    if (s === this._state && s !== 'SEARCH' && s !== 'INVESTIGATE') return;
    const prev = this._state;
    if (prev === 'CHASE' && s !== 'CAPTURE') this._spottedEmitted = false;
    this._state = s;
    this._stateTime = 0;
    this.subT = 0;
    if (s !== 'PATROL') this.stalk = null;
    this._squeeze = false;
    this._vault = false;
    switch (s) {
      case 'PATROL':
        this.sub = 'pick';
        this._stopMove();
        break;
      case 'SUSPICIOUS':
        if (prev === 'PATROL' || prev === 'SEARCH') this._resumeState = prev;
        this._stopMove();
        this.sub = 'watch';
        this._say('hum', 0.35);
        break;
      case 'INVESTIGATE':
        this.sub = 'go';
        this._goTo(this.stimulus, 'fast', 0.9);
        if (prev === 'PATROL' && Math.random() < 0.4) this._say('still_here', 1);
        break;
      case 'CHASE': {
        this.meter = 1;
        this._lostT = 0;
        const p = this._target || this.game.player;
        if (p) {
          this.lkp.copy(p.position);
          this._hasLkp = true;
        }
        if (!this._spottedEmitted) {
          this._spottedEmitted = true;
          this._evtPos.copy(this._hasLkp ? this.lkp : this.object.position);
          this.events?.emit('enemy:spotted', { position: this._evtPos });
          this._say('found_you', 1, true);
        }
        this._goTo(this.lkp, 'run', 0.3);
        break;
      }
      case 'SEARCH':
        this._beginSearch();
        break;
      case 'CAPTURE':
        this._stopMove();
        break;
      default:
        break;
    }
    this.events?.emit('enemy:state', { state: s, prev });
  }

  _enterCapture(spot = null) {
    if (this._state !== 'CAPTURE') this._setState('CAPTURE');
    this.capturedFromHide = spot;
    if (!this._captureEmitted) {
      this._captureEmitted = true;
      this.events?.emit('enemy:capture', { target: this._target || this.game.player });
    }
  }

  _difficulty() {
    return this.game.difficulty || DIFFICULTY[this.game.settings?.difficulty] || DIFFICULTY.normal;
  }

  _say(line, chance = 1, force = false) {
    if (Math.random() > chance) return;
    const t = this._time;
    if (!force && t - this._voiceT.any < 7) return;
    if (t - (this._voiceT[line] ?? -999) < (VOICE_COOLDOWN[line] || 20)) return;
    this._voiceT.any = t;
    this._voiceT[line] = t;
    this.events?.emit('enemy:voice', { line, position: this.headPosition });
  }

  // =============================================================================== update
  update(dt, game = this.game) {
    if (!this._ready || !this.enabled) return;
    if (this.remote) return this._updatePuppet(dt, game);
    this._lastUpdateMs = performance.now();
    dt = Math.min(dt, 0.1);
    if (this._captureSeq) {
      this._captureTick(dt);
      return;
    }
    this._time += dt;
    this._stateTime += dt;
    const world = game.world;
    let player = this._pickTarget(dt, game, world);
    if (this._graceT > 0) {
      // just took someone to Room 000: he isn't looking for anyone for a moment
      this._graceT -= dt;
      player = null;
      this._visible = false;
    }
    if (world) this._syncNav(world);
    this._hasLook = false;

    if (this._state !== 'CAPTURE') {
      if (player) this._perceive(dt, world, player);
      this._think(dt, world, player);
      // 'enemy:capture' is synchronous: game.js may already have started the cinematic in _think
      if (this._captureSeq) return;
    } else if (player) {
      this._setFace(player.position);
      this._setLook(player.eyePosition || player.position);
    }
    this._locomote(dt, world);
    this._updateFatigue(dt);
    this._nearBurp(player);
    this._animate(dt, world);
    this._updateGlow(dt, game);
    // threat (heartbeat, vignette, music) is about the player at THIS screen
    const coop = game.coop?.active ? game.coop : null;
    this._updateThreat(dt, coop ? (coop.status === 'alive' ? game.player : null) : player, coop ? player === game.player : true);
  }

  // =============================================================================== co-op
  /** Whom he is after. Single player: you. Co-op host: one of coop.targets(), sticky while chasing. */
  _pickTarget(dt, game, world) {
    const coop = game.coop;
    if (!coop?.active) return game.player;
    const list = coop.targets();
    const cur = this._target && list.includes(this._target) ? this._target : null;
    if (cur && (this._state === 'CHASE' || this._state === 'CAPTURE')) return cur;
    this._tgtT -= dt;
    if (cur && this._tgtT > 0) return cur;
    this._tgtT = 0.5;
    let best = null;
    let bestScore = -Infinity;
    const pos = this.object.position;
    for (const p of list) {
      const d = hdist(pos, p.position);
      let score = -d;
      if (!p.isHidden && d < 30 && world?.lineOfSight?.(this._eye, p.eyePosition || p.position)) score += 25;
      if (p === cur) score += 4; // don't flip-flop between two players at a similar distance
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best !== this._target) {
      this._target = best;
      this._losTimer = 0; // perceive the new target right away
      this._visible = false;
    }
    return best;
  }

  /** Co-op host: he grabs someone who is not at this screen (their own screen plays the close-up). */
  remoteCapture(position) {
    if (position) this._setFace(position);
    this._remoteCap = true;
    if (this._state !== 'CAPTURE') this._setState('CAPTURE');
    this.anim?.play('capture', { fade: 0.15 });
    this._wantAnim = 'capture';
    this.events?.emit('enemy:voice', { line: 'found_you', position: this.headPosition });
  }

  /** Co-op host: done with a capture; back to his rounds and ignore everyone for `grace` seconds. */
  releaseCapture(grace = 6) {
    this._captureSeq = null;
    this._captureEmitted = false;
    this.capturedFromHide = null;
    this._remoteCap = false;
    this.meter = 0;
    this._hasLkp = false;
    this._seenHide = null;
    this._visible = false;
    this._target = null;
    this._graceT = grace;
    this._lookWeight = 0;
    if (this._state === 'CAPTURE') this._setState('PATROL');
  }

  /** Co-op guest: the local capture close-up is over; the puppet follows the host again. */
  endCapture() {
    this._captureSeq = null;
    this._captureEmitted = false;
    this.capturedFromHide = null;
  }

  /** The host's caretaker in 14 numbers (coop.js 'es'). slotOf(target) -> the target's player slot. */
  netSnapshot(slotOf) {
    const p = this.object.position;
    const r2 = (n) => Math.round(n * 100) / 100;
    const anim = this._remoteCap ? 'capture' : this.anim?.requested || this._wantAnim || 'idle';
    const ai = ['idle', 'stare', 'walk', 'run', 'search', 'investigate', 'turn_left', 'turn_right', 'capture'].indexOf(anim);
    const si = STATES.indexOf(this._state);
    const t = this._lookTarget;
    const flags = (this.winded ? 1 : 0) | (this.stalk && this.stalk.phase === 'stare' ? 2 : 0) | (this._los ? 4 : 0);
    return [
      r2(p.x), r2(p.z), Math.round(this.yaw * 1000) / 1000, si < 0 ? 0 : si, ai < 0 ? 0 : ai,
      r2(this._actualSpeed || 0), this.goalMode === 'run' ? 1 : 0,
      r2(t.x), r2(t.y), r2(t.z), this._hasLook ? 1 : 0, r2(this.meter || 0), flags,
      slotOf ? slotOf(this._target) : -1,
    ];
  }

  /** Co-op guest: no AI, just the host's caretaker (interpolated), animated and glowing locally. */
  _updatePuppet(dt, game) {
    this._lastUpdateMs = performance.now();
    dt = Math.min(dt, 0.1);
    if (this._captureSeq) {
      this._captureTick(dt);
      return;
    }
    this._time += dt;
    const s = game.coop?.enemySample?.();
    let mine = false;
    if (s) {
      this.object.position.set(s.x, 0, s.z);
      this.yaw = s.yaw;
      this.object.rotation.y = s.yaw;
      if (s.state !== this._state) {
        this._state = s.state;
        this._stateTime = 0;
      }
      this._actualSpeed = s.spd;
      this.speed = s.spd;
      this.goalMode = s.run ? 'run' : 'walk';
      this.meter = s.meter;
      this.winded = !!(s.flags & 1);
      this.stalk = s.flags & 2 ? this.stalk || { phase: 'stare' } : null;
      this._los = !!(s.flags & 4);
      this._hasLook = !!s.hasLook;
      if (s.hasLook) this._lookTarget.set(s.lx, s.ly, s.lz);
      mine = s.tgt === game.coop.mySlot;
      if (this.anim) {
        const want = s.anim;
        if (want !== this._wantAnim || (this.anim.requested !== want && want !== 'capture')) {
          this.anim.play(want, { fade: want === 'run' || this._wantAnim === 'run' ? 0.22 : 0.35 });
          this._wantAnim = want;
        }
        if (want === 'walk' || want === 'run') this.anim.syncToSpeed(Math.max(s.spd, 0.3));
      }
    }
    if (this.anim) this._mixerUpdate(dt);
    this._applyProcedural(dt, game.world);
    this._updateGlow(dt, game);
    this._updateThreat(dt, game.coop?.status === 'alive' ? game.player : null, mine);
  }

  /** The close-up burp: see NEAR_BURP_CHANCE. Skips the usual voice cooldowns (it is a one-off roll). */
  _nearBurp(player) {
    if (!player || this._state === 'CHASE' || this._state === 'CAPTURE') return;
    const d = hdist(this.object.position, player.position);
    if (d > NEAR_BURP_REARM) {
      this._burpArmed = true;
      return;
    }
    if (!this._burpArmed || d > NEAR_BURP_DIST) return;
    this._burpArmed = false;
    if (Math.random() >= NEAR_BURP_CHANCE) return;
    this._voiceT.any = this._time;
    this._voiceT.burp = this._time;
    this.events?.emit('enemy:voice', { line: 'burp', position: this.headPosition, big: true });
  }

  /** Chase fatigue: see TIRE_RAMP. Drives _speedFor('run') and the 'enemy:winded' cue. */
  _updateFatigue(dt) {
    const diff = this._difficulty();
    const burst = diff.chaseBurst ?? DIFFICULTY.normal.chaseBurst;
    const running = this._state === 'CHASE' && this.goalMode === 'run' && this.speed > ENEMY.walkSpeed * 1.5;
    if (running) this._runT = Math.min(burst + TIRE_RAMP + TIRE_CAP, this._runT + dt);
    else this._runT = Math.max(0, this._runT - dt * TIRE_RECOVER);
    const k = clamp((this._runT - burst) / TIRE_RAMP, 0, 1);
    this.fatigue = k * k * (3 - 2 * k);
    if (!this.winded && this.fatigue > 0.6) {
      this.winded = true;
      this.events?.emit('enemy:winded', { position: this.object.position });
      this._say('wheeze', 1, true); // "No… running… in the corridors.", out of breath
    } else if (this.winded && this.fatigue < 0.15) {
      this.winded = false;
    }
  }

  /**
   * The pale face and hands carry a faint emissive (navy cloth stays black). It is scaled with the
   * distance to the camera: subtle up close, a dim ghostly smudge far down a dark corridor — so the
   * distant sightings actually read through fog and darkness.
   */
  _updateGlow(dt, game) {
    const mats = this._mats;
    if (!mats || !mats.length) return;
    const cam = game?.camera;
    let g = 1;
    if (cam) {
      cam.getWorldPosition(_v1);
      const d = hdist(this.object.position, _v1);
      g = 1 + clamp((d - 4) / 12, 0, 1) * 2.6;
    }
    if (this.stalk && this.stalk.phase === 'stare') g *= 1.35;
    this._glow = this._glow === undefined ? g : this._glow + (g - this._glow) * clamp(dt * 2, 0, 1);
    for (let i = 0; i < mats.length; i++) mats[i].emissiveIntensity = this._glow;
  }

  // =============================================================================== perception
  _perceive(dt, world, p) {
    const diff = this._difficulty();
    const a = this.aggression;
    const pos = this.object.position;
    const pEye = p.eyePosition || p.position;
    const d = hdist(pos, p.position);
    const chasing = this._state === 'CHASE';
    const alert = this._state === 'SUSPICIOUS' || this._state === 'INVESTIGATE' || this._state === 'SEARCH';
    const range = 18 * diff.sight * (1 + 0.25 * a) * (p.flashlightOn ? 1.2 : 1) * (chasing ? 1.35 : 1);

    this._losTimer -= dt;
    if (this._losTimer <= 0) {
      this._losTimer = 0.1;
      this._visible = false;
      this._peripheral = false;
      this._los = false;
      this._visDist = d;
      const hiddenUnseen = p.isHidden && !(this._seenHide && this._seenHide.spot === p.hidingSpot);
      if (!p.isHidden && p.alive !== false && d < range * 1.05) {
        // angle from the facing direction
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const dx = p.position.x - pos.x;
        const dz = p.position.z - pos.z;
        const cos = d > 1e-3 ? (fx * dx + fz * dz) / d : 1;
        const half = 50 * DEG;
        const inCone = cos >= Math.cos(half);
        const inPeriph = !inCone && cos >= Math.cos(85 * DEG) && d < 7;
        const sense = d < 1.6 && !(p.isCrouching && !p.isMoving); // you can't stand right behind him
        if ((inCone || inPeriph || sense || (chasing && d < 14)) && d <= range) {
          this._los = world?.lineOfSight ? world.lineOfSight(this._eye, pEye) : true;
          if (this._los) {
            this._visible = true;
            this._peripheral = !inCone && !chasing && !sense;
          }
        }
      }
      if (hiddenUnseen) this._visible = false;
      if (this._visible) {
        this._lastSeenTime = this._time;
        this._lastSeenDist = d;
        this._lastSeenPos.copy(p.position);
      }
    }

    // detection meter
    if (this._visible) {
      const closeness = clamp(1 - d / range, 0, 1);
      let rate = 0.85 * diff.sight * (1 + 0.6 * a) * (0.15 + 2.2 * closeness * closeness);
      rate *= p.isMoving ? 1 : 0.45;
      if (p.isSprinting) rate *= 1.5;
      if (p.isCrouching) rate *= 0.5;
      const light = typeof world?.getLightLevel === 'function' ? clamp(world.getLightLevel(p.position.x, p.position.z), 0, 1) : 0.5;
      if (p.flashlightOn) rate *= 1.6;
      else rate *= 0.55 + 0.6 * light; // darkness hides you
      if (this._peripheral) rate *= 0.4;
      if (alert) rate *= 1.4;
      if (d < 2.2) rate += 3;
      this.meter = Math.min(1, this.meter + rate * dt);
      if (this.stalk && d > 14) this.meter = Math.min(this.meter, 0.6);
    } else if (!chasing) {
      const decay = this._state === 'PATROL' ? 0.1 : this._state === 'SEARCH' ? 0.05 : 0.06;
      this.meter = Math.max(0, this.meter - decay * dt);
    }

    // passive hearing of the player's own noise level (breathing, rustle, steps)
    this._hearTimer -= dt;
    if (this._hearTimer <= 0) {
      this._hearTimer = 0.4;
      const nl = p.noiseLevel || 0;
      if (!p.isHidden && nl > 0.05) {
        let R = nl * 11 * diff.hearing * (1 + 0.6 * a);
        if (!this._los) R *= 0.65;
        if (d < R) this._onHeard(p.position, (1 - d / R) * 0.6, 'player');
      }
    }
  }

  _onHeard(position, intensity, source) {
    const s = this._state;
    if (s === 'CAPTURE') return;
    if (s === 'CHASE') {
      if (!this._visible && intensity > 0.15 && (source === 'player' || source === undefined || intensity > 0.4)) {
        this.lkp.copy(position);
        this.lkp.y = 0;
        this._lostT = Math.max(0, this._lostT - 0.8);
      }
      return;
    }
    if (this.stalk && this.stalk.phase === 'stare' && intensity < 0.3) return;
    if (s === 'PATROL') {
      this.meter = Math.min(0.9, this.meter + intensity * 0.45);
      this._setStimulus(position);
      this._setState(intensity > 0.55 ? 'INVESTIGATE' : 'SUSPICIOUS');
    } else if (s === 'SUSPICIOUS') {
      this._setStimulus(position);
      this.meter = Math.min(0.9, this.meter + intensity * 0.3);
      if (intensity > 0.4) this._setState('INVESTIGATE');
    } else if (s === 'INVESTIGATE') {
      if (intensity > 0.2) {
        this._setStimulus(position);
        this.sub = 'go';
        this._goTo(this.stimulus, 'fast', 0.9);
      }
    } else if (s === 'SEARCH') {
      if (intensity > 0.25) {
        this._setStimulus(position);
        this._setState('INVESTIGATE');
      }
    }
  }

  _setStimulus(position) {
    this.stimulus.set(position.x, 0, position.z);
    this._stimulusNoise = true;
  }

  _onHideEnter({ spot, net } = {}) {
    if (!this.enabled || this._state === 'CAPTURE' || this.remote) return;
    // co-op: the local player hiding only matters if he is the one being hunted (coop.js reports the others)
    if (!net && this.game.coop?.active && this._target && this._target !== this.game.player) return;
    const recent = this._time - this._lastSeenTime <= 1.5;
    const noticed = this.meter >= 0.5 || this._lastSeenDist < 8 || this._state === 'CHASE' || this._state === 'SEARCH' || this._state === 'INVESTIGATE';
    if (recent && noticed && spot) {
      this._seenHide = { spot, time: this._time };
      this.lkp.copy(spot.exitPosition || spot.position);
      this.lkp.y = 0;
      this._hasLkp = true;
      if (this._state !== 'CHASE') {
        this.meter = 1;
        this._setState('CHASE');
      }
    } else {
      this._seenHide = null;
    }
  }

  // =============================================================================== decision making
  _think(dt, world, player) {
    switch (this._state) {
      case 'PATROL':
        this._thinkPatrol(dt, world, player);
        break;
      case 'SUSPICIOUS':
        this._thinkSuspicious(dt, player);
        break;
      case 'INVESTIGATE':
        this._thinkInvestigate(dt, world, player);
        break;
      case 'CHASE':
        this._thinkChase(dt, world, player);
        break;
      case 'SEARCH':
        this._thinkSearch(dt, world, player);
        break;
      default:
        break;
    }
    // bumping into him is always fatal (unless safely hidden)
    if (player && this._state !== 'CAPTURE' && !player.isHidden && player.alive !== false) {
      const d = hdist(this.object.position, player.position);
      const reachOver = this._state === 'CHASE' && this._pathPartial && this._los && d <= 1.9;
      if (d < 0.95 || reachOver || (d <= ENEMY.captureRange && this._los && (this._state === 'CHASE' || this.meter >= 0.85))) {
        this._enterCapture();
      }
    }
    // look at the player whenever he is visible and close: the head follows you
    if (player && this._visible && this._visDist < 9 && !this._hasLook) this._setLook(player.eyePosition || player.position);
  }

  _thinkPatrol(dt, world, player) {
    if (this.meter >= 1) return this._setState('CHASE');
    if (this.stalk) return this._thinkStalk(dt, world, player);
    if (this.meter >= 0.35 && this._visible) {
      this.stimulus.copy(player.position);
      this.stimulus.y = 0;
      this._stimulusNoise = false;
      return this._setState('SUSPICIOUS');
    }
    if (this._time >= this._nextStalk && player && !player.isHidden) {
      if (this._tryStartStalk(world, player)) return;
      this._nextStalk = this._time + 8 + Math.random() * 6;
    }
    switch (this.sub) {
      case 'pick': {
        if (!world?.patrolPoints?.length) {
          this.sub = 'pause';
          this.subT = 3;
          break;
        }
        const p = this._pickPatrolPoint(world, player);
        if (p) {
          this._goTo(p, 'walk', 0.7);
          this.sub = 'walk';
          this.subT = 0;
        } else {
          this.sub = 'pause';
          this.subT = 2;
        }
        break;
      }
      case 'walk':
        this.subT += dt;
        if (this.moveStatus === 'arrived' || this.subT > 60) {
          this.sub = 'pause';
          this.subT = (2 + Math.random() * 3.5) * (1 - 0.4 * this.aggression);
          this._pauseAnim = Math.random() < 0.4 ? 'search' : Math.random() < 0.15 ? 'stare' : 'idle';
          if (this._pauseAnim !== 'search') {
            if (Math.random() < 0.3) this._say('burp', 1); // now and then, on his rounds
            else this._say('hum', 0.25);
          }
          const room = world?.getRoomAt?.(this.object.position.x, this.object.position.z);
          if (room?.isCorridor) this._say('corridor', 0.08);
          else this._say('school_closed', 0.05);
        } else if (this.moveStatus === 'failed') {
          this.sub = 'pick';
        }
        break;
      case 'pause':
        this.subT -= dt;
        if (this.subT <= 0) this.sub = 'pick';
        break;
      default:
        this.sub = 'pick';
    }
  }

  _pickPatrolPoint(world, player) {
    const pts = world.patrolPoints;
    if (this._planPts !== pts) {
      this._plan.length = 0;
      this._planPts = pts;
    }
    // stops planned ahead by upcomingPatrol() (the caretaker's log) are walked in that order
    const pick = this._plan.length ? this._plan.shift() : this._rollPatrol(pts, this.object.position, player, null);
    this._recentPatrol.push(pick);
    if (this._recentPatrol.length > 5) this._recentPatrol.shift();
    this._patrolIdx = pick;
    return pts[pick];
  }

  /** His next n patrol stops: where he is walking now, then the ones he will pick (planned now). */
  upcomingPatrol(n = 3) {
    const world = this.game.world;
    const pts = world?.patrolPoints;
    if (!pts?.length) return [];
    if (this._planPts !== pts) {
      this._plan.length = 0;
      this._planPts = pts;
    }
    const out = [];
    if (this._state === 'PATROL' && this.sub === 'walk' && this._patrolIdx != null && pts[this._patrolIdx]) out.push(pts[this._patrolIdx]);
    let from = out.length ? out[0] : this.object.position;
    const planned = out.length ? [this._patrolIdx] : [];
    for (const i of this._plan) {
      planned.push(i);
      from = pts[i];
    }
    while (out.length + this._plan.length < n) {
      const i = this._rollPatrol(pts, from, this.game.player, planned);
      this._plan.push(i);
      planned.push(i);
      from = pts[i];
    }
    for (const i of this._plan) if (out.length < n) out.push(pts[i]);
    return out;
  }

  /** A distraction (a PA broadcast, the PlayStation): he goes to check it, unless he is chasing you in sight. */
  distract(position) {
    if (this.remote) return this.game.coop?.forwardEnemy?.('distract', position) ?? false;
    if (!this.enabled || !this._ready || !position || this._state === 'CAPTURE') return false;
    if (this._state === 'CHASE' && this._visible) return false;
    this.meter = Math.min(this.meter, 0.6);
    this.forceState('INVESTIGATE', position);
    return true;
  }

  /** The Room 000 register: everyone is accounted for, so he forgets you and goes back to his rounds. */
  callOff() {
    if (this.remote) return this.game.coop?.forwardEnemy?.('callOff') ?? false;
    if (this._state === 'CAPTURE') return false;
    this.meter = 0;
    this._hasLkp = false;
    this._seenHide = null;
    this._lostT = 0;
    this._plan.length = 0;
    if (this._state !== 'PATROL') this._setState('PATROL');
    return true;
  }

  _rollPatrol(pts, pos, player, exclude) {
    const a = this.aggression;
    let total = 0;
    const n = pts.length;
    // weights computed twice (sum, then roulette) to stay allocation-free
    const weight = (i) => {
      const p = pts[i];
      const d = hdist(p, pos);
      if (d < 3.5) return 0;
      let w = d < 26 ? 1 : d < 40 ? 0.55 : 0.3;
      if (this._recentPatrol.includes(i)) w *= 0.08;
      if (exclude && exclude.includes(i)) w *= 0.02;
      if (player) {
        const dp = hdist(p, player.position);
        w *= 1 + a * 2.5 * clamp(1 - dp / 35, 0, 1); // drift towards the player's region as aggression rises
        if (dp < 6) w *= 0.25 + a * 0.5; // but never home in directly
      }
      return w;
    };
    for (let i = 0; i < n; i++) total += weight(i);
    if (total <= 0) return (Math.random() * n) | 0;
    let r = Math.random() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) {
      r -= weight(i);
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    return pick;
  }

  _thinkSuspicious(dt, player) {
    if (this.meter >= 1) return this._setState('CHASE');
    this.subT += dt;
    if (this._visible && player) {
      this.stimulus.copy(player.position);
      this.stimulus.y = 0;
    }
    this._setFace(this.stimulus);
    _v1.set(this.stimulus.x, 1.4, this.stimulus.z);
    this._setLook(_v1);
    const dur = 2.6 - 1.0 * this.aggression;
    if (this.subT > dur) {
      if (this.meter > 0.25 || this._stimulusNoise) this._setState('INVESTIGATE');
      else this._setState(this._resumeState || 'PATROL');
    } else if (this.subT > 1.2 && this.meter <= 0.02 && !this._stimulusNoise) {
      this._setState(this._resumeState || 'PATROL');
    }
  }

  _thinkInvestigate(dt, world, player) {
    if (this.meter >= 1) return this._setState('CHASE');
    if (this._visible && this.meter >= 0.5 && player) {
      this.stimulus.copy(player.position);
      this.stimulus.y = 0;
      if (this.sub === 'go') this._goTo(this.stimulus, 'fast', 0.9);
    }
    this.subT += dt;
    switch (this.sub) {
      case 'go':
        if (this.moveStatus === 'arrived' || this.moveStatus === 'failed' || this.subT > 35) {
          this.sub = 'look';
          this.subT = 0;
          this._lookDur = 4 + Math.random() * 1.8;
          this._stopMove();
        }
        break;
      case 'look':
        if (this.subT > this._lookDur) {
          const spot = this._nearestSpot(world, this.stimulus, 6, Math.random() < 0.55);
          if (spot) {
            this._checkSpot = spot;
            this._goTo(spot.exitPosition || spot.position, 'walk', 0.45);
            this.sub = 'check';
            this.subT = 0;
          } else this._finishInvestigate();
        }
        break;
      case 'check':
        if (this.moveStatus === 'arrived' || this.moveStatus === 'failed' || this.subT > 20) {
          this.sub = 'checkStand';
          this.subT = 0;
          this._lookDur = 2.4 + Math.random() * 1.2;
          this._stopMove();
          if (player?.isHidden && player.hidingSpot === this._checkSpot) this._say('still_here', 0.6);
        }
        break;
      case 'checkStand':
        if (this._checkSpot) {
          this._setFace(this._checkSpot.position);
          this._setLook(this._checkSpot.position);
        }
        if (this.subT > this._lookDur) this._finishInvestigate();
        break;
      default:
        this.sub = 'go';
    }
  }

  _finishInvestigate() {
    this.lkp.copy(this.stimulus);
    this._hasLkp = true;
    if (this.aggression > 0.45 || this.meter > 0.5) this._setState('SEARCH');
    else this._setState('PATROL');
  }

  _thinkChase(dt, world, player) {
    if (!player) return this._setState('PATROL');
    const pos = this.object.position;
    const seen = this._seenHide;
    if (player.isHidden) {
      if (seen && seen.spot === player.hidingSpot) {
        // he watched you get in. Walk up and open it.
        const ex = seen.spot.exitPosition || seen.spot.position;
        this.lkp.set(ex.x, 0, ex.z);
        this._goTo(this.lkp, 'run', 0.35);
        this._setLook(seen.spot.position);
        const dSpot = hdist(pos, seen.spot.position);
        if (hdist(pos, ex) < 0.75 || dSpot < ENEMY.captureRange + 0.35) {
          this._enterCapture(seen.spot);
        } else if (this._time - seen.time > 10) {
          // never stands at a hiding place forever (a desk boxed in by chairs he can't path past):
          // close enough, he reaches in; otherwise he gives up on it and searches the room
          if (dSpot < 2.4) {
            this._enterCapture(seen.spot);
          } else {
            this._seenHide = null;
            this.meter = 0.6;
            this.events?.emit('enemy:lost', {});
            this._setState('SEARCH');
          }
        }
        return;
      }
    }
    if (this._visible) {
      const v = player.velocity;
      const d = hdist(pos, player.position);
      const lead = clamp(d / 4, 0, 0.6);
      _v1.set(player.position.x + (v ? v.x * lead : 0), 0, player.position.z + (v ? v.z * lead : 0));
      if (d < 3 || !this.nav.nav || !this.nav.passableXZ(_v1.x, _v1.z)) _v1.set(player.position.x, 0, player.position.z);
      this.lkp.copy(_v1);
      this._hasLkp = true;
      this._lostT = 0;
      this._setLook(player.eyePosition || player.position);
    } else {
      this._lostT += dt;
    }
    this._goTo(this.lkp, 'run', 0.3);
    // Target sits in a pocket his nav grid can't reach (between desks, behind a table): rather than
    // circling the furniture, he shoves straight through it when he can see you up close.
    const dP = hdist(pos, player.position);
    this._squeeze = this._los && dP < 5 && (this._pathPartial || this.moveStatus === 'failed');
    if (this._squeeze) {
      this._lostT = 0;
      // pinned against a table: climb over it (line of sight already rules out walls in between)
      this._sqT += dt;
      if (this._sqT > 0.8) {
        this._vault = hdist(pos, this._sqAnchor) < 0.2;
        this._sqT = 0;
        this._sqAnchor.copy(pos);
      }
    } else {
      this._vault = false;
      this._sqT = 0;
      this._sqAnchor.copy(pos);
    }
    const grace = 2.5 + 2.5 * this.aggression;
    if (!this._visible && (this._lostT > grace + 2 || (this._lostT > 0.6 && (this.moveStatus === 'arrived' || this.moveStatus === 'failed')))) {
      this.events?.emit('enemy:lost', {});
      this.meter = 0.6;
      this._setState('SEARCH');
    }
  }

  _beginSearch() {
    const world = this.game.world;
    const c = this._hasLkp ? this.lkp : this.object.position;
    this._searchEnd = this._time + 15 + Math.random() * 10 + 10 * this.aggression;
    let n = 0;
    // hiding spots near the last known position (closest first, at most 3)
    const spots = world?.hidingSpots || [];
    const used = [];
    for (let k = 0; k < 3; k++) {
      let best = null;
      let bestD = 11;
      for (const s of spots) {
        if (used.includes(s)) continue;
        const d = hdist(s.position, c) + Math.random() * 1.5;
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (!best) break;
      used.push(best);
      const e = this._searchPts[n++];
      e.spot = best;
      e.p.copy(best.exitPosition || best.position);
      e.p.y = 0;
    }
    // random reachable points around it
    for (let k = 0; k < 3 && n < this._searchPts.length; k++) {
      const e = this._searchPts[n];
      if (this.nav.nav && this.nav.randomPointNear(c.x, c.z, 4 + k * 3, e.p)) {
        e.p.y = 0;
        e.spot = null;
        n++;
      }
    }
    // interleave: point, spot, point ... sort by distance from current position for a sensible tour
    const pos = this.object.position;
    const arr = this._searchPts;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const di = hdist(arr[i].p, i === 0 ? pos : arr[i - 1].p);
        const dj = hdist(arr[j].p, i === 0 ? pos : arr[i - 1].p);
        if (dj < di) {
          const t = arr[i];
          arr[i] = arr[j];
          arr[j] = t;
        }
      }
    }
    this._searchN = n;
    this._searchIdx = 0;
    this.sub = n ? 'go' : 'look';
    this.subT = 0;
    this._lookDur = 3;
    if (n) this._goTo(arr[0].p, 'fast', 0.45);
    else this._stopMove();
  }

  _thinkSearch(dt, world, player) {
    if (this.meter >= 1) return this._setState('CHASE');
    if (this._visible && this.meter >= 0.55) return this._setState('CHASE');
    if (this._time > this._searchEnd && this.sub !== 'spotStand') {
      this._say('school_closed', 0.5);
      return this._setState('PATROL');
    }
    this.subT += dt;
    const e = this._searchPts[this._searchIdx];
    switch (this.sub) {
      case 'go':
        if (this.moveStatus === 'arrived' || this.moveStatus === 'failed' || this.subT > 20) {
          this._stopMove();
          this.subT = 0;
          if (e?.spot) {
            this.sub = 'spotStand';
            this._lookDur = 2.6 + Math.random() * 1.6;
            const inside = player?.isHidden && player.hidingSpot === e.spot;
            this._say('still_here', inside ? 0.75 : 0.2);
          } else {
            this.sub = 'look';
            this._lookDur = 2.5 + Math.random() * 1.5;
          }
        }
        break;
      case 'spotStand':
        if (e?.spot) {
          this._setFace(e.spot.position);
          _v1.copy(e.spot.position);
          _v1.y = Math.max(1.4, e.spot.position.y || 0);
          this._setLook(_v1);
        }
        if (this.subT > this._lookDur) this._nextSearchPoint(world);
        break;
      case 'look':
        if (this.subT > this._lookDur) this._nextSearchPoint(world);
        break;
      default:
        this._nextSearchPoint(world);
    }
  }

  _nextSearchPoint(world) {
    this._searchIdx++;
    this.subT = 0;
    if (this._searchIdx >= this._searchN) {
      if (this._time < this._searchEnd - 6) {
        // widen the search a little
        this.lkp.copy(this.object.position);
        this._beginSearchKeepTimer();
      } else {
        this._say('school_closed', 0.5);
        this._setState('PATROL');
      }
      return;
    }
    this.sub = 'go';
    this._goTo(this._searchPts[this._searchIdx].p, 'fast', 0.45);
  }

  _beginSearchKeepTimer() {
    const end = this._searchEnd;
    this._beginSearch();
    this._searchEnd = end;
  }

  _nearestSpot(world, c, maxD, chance = true) {
    if (!chance) return null;
    const spots = world?.hidingSpots;
    if (!spots) return null;
    let best = null;
    let bestD = maxD;
    for (const s of spots) {
      const d = hdist(s.position, c);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------- stalking sightings
  _tryStartStalk(world, player) {
    const pts = world?.patrolPoints;
    if (!pts?.length || !world.lineOfSight || !this.nav.nav) return false;
    if (this._visible) return false;
    const pEye = player.eyePosition || player.position;
    const pf = player.yaw !== undefined ? player.yaw : 0;
    const fx = -Math.sin(pf);
    const fz = -Math.cos(pf);
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const dp = hdist(p, player.position);
      if (dp < 15 || dp > 28) continue;
      _v1.set(p.x, 2.3, p.z);
      if (!world.lineOfSight(pEye, _v1)) continue;
      let score = 1 + Math.random() * 0.5;
      const room = world.getRoomAt?.(p.x, p.z);
      if (room?.isCorridor) score *= 3;
      score *= 0.4 + 1.6 * this._litScore(p.x, p.z, world); // near a light panel: backlit, readable
      const dot = ((p.x - player.position.x) * fx + (p.z - player.position.z) * fz) / dp;
      score *= dot > 0.3 ? 2 : 1;
      if (hdist(p, this.object.position) > 60) score *= 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return false;
    // reachable within a sensible walk?
    const n = this.nav.findPath(this.object.position.x, this.object.position.z, best.x, best.z, this.path, 256);
    this._lastPathTime = this._time;
    if (!n || this.nav.lastPartial || this.nav.lastLength > 75) return false;
    this.pathCount = n;
    this.pathIndex = 0;
    this.pathTarget.set(best.x, 0, best.z);
    this._stalkPoint.set(best.x, 0, best.z);
    this.goal.copy(this._stalkPoint);
    this.goalMode = 'walk';
    this.goalArrive = 0.6;
    this.moveStatus = 'moving';
    this._needPath = false;
    this.stalk = { phase: 'go', t: 0, stareT: 4 + Math.random() * 3, waitLook: 9, seen: false, announced: false, hidden: 0 };
    return true;
  }

  _thinkStalk(dt, world, player) {
    const st = this.stalk;
    st.t += dt;
    const d = player ? hdist(this.object.position, player.position) : 99;
    if (this._visible && d < 9) {
      this.stalk = null;
      this.meter = 1;
      return this._setState('CHASE');
    }
    if (this._visible && d < 14 && st.phase !== 'go') {
      this.stalk = null;
      this.stimulus.copy(player.position);
      this.stimulus.y = 0;
      this._stimulusNoise = false;
      return this._setState('INVESTIGATE');
    }
    const end = this._endStalk;
    if (!player || player.isHidden) {
      if (st.phase !== 'leave') return end();
    }
    if (st.phase === 'go') {
      if (this.moveStatus === 'arrived') {
        st.phase = 'stare';
        this._stopMove();
      } else if (this.moveStatus === 'failed' || st.t > 50) return end();
      return;
    }
    const pEye = player.eyePosition || player.position;
    if (st.phase === 'stare') {
      this._setFace(player.position);
      this._setLook(pEye);
      const los = world.lineOfSight(pEye, this._eye);
      let looking = false;
      if (los) {
        const yaw = player.yaw || 0;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const dx = this.object.position.x - player.position.x;
        const dz = this.object.position.z - player.position.z;
        looking = (fx * dx + fz * dz) / Math.max(0.01, Math.hypot(dx, dz)) > Math.cos(40 * DEG);
      }
      if (looking) {
        st.seen = true;
        if (!st.announced) {
          st.announced = true;
          this._evtPos.copy(this.object.position);
          this.events?.emit('enemy:sighting', { position: this._evtPos });
          const room = world.getRoomAt?.(this.object.position.x, this.object.position.z);
          this._say(room?.isCorridor ? 'corridor' : 'still_here', 0.7);
        }
      }
      if (st.seen) st.stareT -= dt;
      else st.waitLook -= dt;
      if (st.stareT <= 0 || st.waitLook <= 0) {
        st.phase = 'leave';
        st.t = 0;
        const p = this._pickLeavePoint(world, player);
        if (p) this._goTo(p, 'slow', 0.7);
        else return end();
      }
      return;
    }
    if (st.phase === 'leave') {
      const los = player ? world.lineOfSight(pEye, this._eye) : false;
      st.hidden = los ? 0 : st.hidden + dt;
      if (st.hidden > 1.5 || this.moveStatus === 'arrived' || this.moveStatus === 'failed' || st.t > 40) end();
    }
  }

  _endStalk = () => {
    this.stalk = null;
    this.sub = 'pick';
    this._nextStalk = this._time + lerp(70, 40, this.aggression) + Math.random() * 20;
  };

  /** 0..1 how lit a spot is: world.getLightLevel() if provided, else distance to a working fixture. */
  _litScore(x, z, world) {
    if (typeof world.getLightLevel === 'function') return clamp(world.getLightLevel(x, z), 0, 1);
    const fx = world.lights?.fixtures;
    if (!fx || !fx.length) return 0.5;
    let best = 99;
    for (let i = 0; i < fx.length; i++) {
      const f = fx[i];
      if (f.state === 'broken' || f.enabled === false || f.x === undefined) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < best) best = d;
    }
    return clamp(1 - (best - 1.5) / 6, 0, 1);
  }

  _pickLeavePoint(world, player) {
    const pts = world.patrolPoints;
    const pos = this.object.position;
    const pEye = player.eyePosition || player.position;
    const dNow = hdist(pos, player.position);
    let best = null;
    let bestD = Infinity;
    for (const p of pts) {
      const dp = hdist(p, player.position);
      if (dp < dNow - 1) continue;
      const d = hdist(p, pos);
      if (d < 3 || d > 30) continue;
      _v1.set(p.x, 2.3, p.z);
      if (world.lineOfSight(pEye, _v1)) continue;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // =============================================================================== movement
  _goTo(target, mode = 'walk', arrive = 0.6) {
    const moved = hdist(this.goal, target);
    this.goal.set(target.x, 0, target.z);
    this.goalMode = mode;
    this.goalArrive = arrive;
    if (this.moveStatus !== 'moving' || this.pathCount === 0) {
      this._needPath = true;
      this.moveStatus = 'moving';
      this._stuckTimer = 0;
      this._stuckAnchor.copy(this.object.position);
    } else if (moved > 0.01 && hdist(this.goal, this.pathTarget) > (mode === 'run' ? 0.75 : 1.5)) {
      this._needPath = true;
    }
  }

  _stopMove() {
    this.moveStatus = 'idle';
    this.pathCount = 0;
    this.pathIndex = 0;
    this._needPath = false;
    this._doorWait = null;
    this._sidestep = 0;
  }

  _setFace(target) {
    this._faceTarget.set(target.x, 0, target.z);
    this._facing = true;
  }

  _setLook(target) {
    this._lookTarget.copy(target);
    this._hasLook = true;
  }

  _syncNav(world) {
    const nav = world.getNav ? world.getNav() : null;
    if (!nav) return;
    if (nav !== this._navRef || nav.version !== this._navVersion) {
      this.nav.setNav(nav, world.doors);
      this._navRef = nav;
      this._navVersion = nav.version;
      if (this.moveStatus === 'moving') this._needPath = true;
    } else if (this.nav.doors !== world.doors) {
      this.nav.doors = world.doors;
    }
  }

  _speedFor(mode) {
    const diff = this._difficulty();
    const walk = ENEMY.walkSpeed * diff.enemySpeed * (1 + 0.25 * this.aggression);
    switch (mode) {
      case 'run':
        return (
          Math.min(ENEMY.runSpeed * diff.enemySpeed * (1 + 0.06 * this.aggression), PLAYER.sprintSpeed * 0.97) *
          lerp(1, diff.tiredSpeed ?? DIFFICULTY.normal.tiredSpeed, this.fatigue || 0)
        );
      case 'fast':
        return walk * 1.15;
      case 'slow':
        return walk * 0.72;
      default:
        return walk;
    }
  }

  _requestPath() {
    const pos = this.object.position;
    this._lastPathTime = this._time;
    this._needPath = false;
    this.pathTarget.copy(this.goal);
    const n = this.nav.findPath(pos.x, pos.z, this.goal.x, this.goal.z, this.path, 256);
    this.pathCount = n;
    this.pathIndex = 0;
    this.pathRequests = (this.pathRequests || 0) + 1;
    // the player can squeeze into gaps between furniture that are narrower than his nav clearance
    this._pathPartial = !n || !!this.nav.lastPartial;
    if (!n) {
      this.moveStatus = hdist(pos, this.goal) <= this.goalArrive + 0.3 ? 'arrived' : 'failed';
    }
  }

  _locomote(dt, world) {
    const pos = this.object.position;
    let targetSpeed = 0;
    let turnRate = 2.4;
    let desiredYaw = null;

    if (this._turn) {
      // in-place pivot driven by the turn clip
      const t = this._turn;
      const step = t.rate * dt;
      if (Math.abs(step) >= Math.abs(t.left)) {
        this.yaw = wrapAngle(this.yaw + t.left);
        this._turn = null;
      } else {
        this.yaw = wrapAngle(this.yaw + step);
        t.left -= step;
        t.time -= dt;
        if (t.time <= -0.3) this._turn = null;
      }
      this.speed = 0;
      this._actualSpeed = 0;
      this.object.rotation.y = this.yaw;
      return;
    }

    if (this._doorWait) {
      const w = this._doorWait;
      w.t -= dt;
      const door = w.door;
      if (door.position) desiredYaw = yawTo(door.position.x - pos.x, door.position.z - pos.z);
      if (w.phase === 'pause' && w.t <= 0) {
        if (!door.isOpen && !door.isLocked) door.open?.('enemy');
        w.phase = 'after';
        w.t = 0.35;
      } else if (w.phase === 'after' && w.t <= 0) {
        this._doorWait = null;
        if (door.isLocked && !door.isOpen) {
          this.nav.blockDoor(w.index);
          this._needPath = true;
        }
      }
    } else if (this._squeeze && world && (this._target || this.game.player)) {
      // ---- squeezing through furniture straight at the player (slow, deliberate)
      const pp = (this._target || this.game.player).position;
      desiredYaw = yawTo(pp.x - pos.x, pp.z - pos.z);
      const diffYaw = wrapAngle(desiredYaw - this.yaw);
      turnRate = 4;
      targetSpeed = this._speedFor('walk') * 1.15 * clamp(Math.cos(diffYaw) * 1.25, 0.15, 1);
    } else if (this.moveStatus === 'moving' && world) {
      // ---- path management (≤ 4 requests per second)
      const canPath = this._time - this._lastPathTime >= 0.25;
      if (this.nav.nav && (this._needPath || this.pathCount === 0) && canPath) this._requestPath();
      if (this.moveStatus === 'moving' && this.pathCount > 0) {
        let wx = this.path[this.pathIndex * 2];
        let wz = this.path[this.pathIndex * 2 + 1];
        let d = Math.hypot(wx - pos.x, wz - pos.z);
        while (this.pathIndex < this.pathCount - 1 && d < 0.45) {
          this.pathIndex++;
          wx = this.path[this.pathIndex * 2];
          wz = this.path[this.pathIndex * 2 + 1];
          d = Math.hypot(wx - pos.x, wz - pos.z);
        }
        const last = this.pathIndex === this.pathCount - 1;
        const goalD = hdist(pos, this.goal);
        if ((last && d < this.goalArrive) || goalD < this.goalArrive * 0.8) {
          this.moveStatus = 'arrived';
        } else {
          const dirX = (wx - pos.x) / Math.max(d, 1e-4);
          const dirZ = (wz - pos.z) / Math.max(d, 1e-4);
          desiredYaw = yawTo(dirX, dirZ);
          const diffYaw = wrapAngle(desiredYaw - this.yaw);
          const run = this.goalMode === 'run';
          // big in-place turn when starting to walk
          if (!run && this.speed < 0.35 && Math.abs(diffYaw) > 100 * DEG && this._startTurn(diffYaw)) return;
          turnRate = run ? 5.5 : 2.6;
          targetSpeed = this._speedFor(this.goalMode) * clamp(Math.cos(diffYaw) * 1.25, 0.12, 1);
          if (last && !run) targetSpeed *= clamp(d / 1.3, 0.4, 1);
          // doors ahead?
          if (this._checkDoorAhead(world, dirX, dirZ)) {
            targetSpeed = 0;
          }
          if (this._sidestep > 0) {
            this._sidestep -= dt;
            desiredYaw = wrapAngle(desiredYaw + this._sidestepDir * 80 * DEG);
            targetSpeed = this._speedFor('walk') * 0.8;
          }
        }
      } else if (this.moveStatus === 'moving' && this.pathCount === 0 && this.nav.nav === null) {
        // no nav grid at all: walk straight with collision
        const d = hdist(pos, this.goal);
        if (d < this.goalArrive) this.moveStatus = 'arrived';
        else {
          desiredYaw = yawTo(this.goal.x - pos.x, this.goal.z - pos.z);
          targetSpeed = this._speedFor(this.goalMode);
        }
      }
    }

    if (desiredYaw === null && this._facing && this.moveStatus !== 'moving') {
      const dx = this._faceTarget.x - pos.x;
      const dz = this._faceTarget.z - pos.z;
      if (dx * dx + dz * dz > 0.04) {
        desiredYaw = yawTo(dx, dz);
        const diffYaw = wrapAngle(desiredYaw - this.yaw);
        if (Math.abs(diffYaw) > 55 * DEG && this.speed < 0.3 && this._state !== 'CAPTURE' && this._startTurn(diffYaw)) return;
        turnRate = 1.6;
      }
    }
    this._facing = false;

    // ---- turning
    if (desiredYaw !== null) {
      const diffYaw = wrapAngle(desiredYaw - this.yaw);
      const maxStep = turnRate * dt;
      this.yaw = wrapAngle(this.yaw + clamp(diffYaw, -maxStep, maxStep));
    }
    this.object.rotation.y = this.yaw;

    // ---- speed & collision-aware motion
    const accel = targetSpeed > this.speed ? (this.goalMode === 'run' ? 7 : 2.6) : 6;
    this.speed += clamp(targetSpeed - this.speed, -accel * dt, accel * dt);
    if (this.speed > 0.01 && world?.moveCircle) {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      _v1.set(fx * this.speed * dt, 0, fz * this.speed * dt);
      const np = this._squeeze && this._vault
        ? _vMove.set(pos.x + _v1.x, 0, pos.z + _v1.z)
        : world.moveCircle(pos, _v1, this._squeeze ? 0.18 : ENEMY.radius, _vMove);
      const moved = Math.hypot(np.x - pos.x, np.z - pos.z);
      pos.x = np.x;
      pos.z = np.z;
      pos.y = 0;
      this._actualSpeed = lerp(this._actualSpeed, moved / Math.max(dt, 1e-4), clamp(dt * 10, 0, 1));
    } else {
      this._actualSpeed = lerp(this._actualSpeed, 0, clamp(dt * 10, 0, 1));
      if (this.speed <= 0.01) this.speed = 0;
    }

    // ---- stuck detection & recovery
    if (this.moveStatus === 'moving' && targetSpeed > 0.3 && !this._doorWait) {
      this._stuckTimer += dt;
      if (this._stuckTimer > 1.2) {
        const prog = hdist(pos, this._stuckAnchor);
        if (prog < 0.25) {
          this._stuckCount++;
          this.stuckEvents++;
          if (this._stuckCount === 1) this._needPath = true;
          else if (this._stuckCount === 2) {
            this._sidestep = 0.7;
            this._sidestepDir = Math.random() < 0.5 ? -1 : 1;
            this._needPath = true;
          } else {
            this.moveStatus = 'failed';
            this._stuckCount = 0;
          }
        } else this._stuckCount = 0;
        this._stuckTimer = 0;
        this._stuckAnchor.copy(pos);
      }
    } else {
      this._stuckTimer = 0;
      this._stuckAnchor.copy(pos);
    }
  }

  _startTurn(diffYaw) {
    if (!this.anim) return false;
    const name = diffYaw > 0 ? 'turn_left' : 'turn_right';
    if (!this.anim.has(name)) return false;
    const dur = this.anim.duration(name) * 0.85;
    this._turn = { left: diffYaw, rate: diffYaw / dur, time: dur, name };
    this.anim.play(name, { fade: 0.15, restart: true, timeScale: Math.abs(diffYaw) > 150 * DEG ? 0.85 : 1 });
    this._wantAnim = name;
    return true;
  }

  /** Look ahead along the path for a closed door; handles the pause/open sequence. */
  _checkDoorAhead(world, dirX, dirZ) {
    if (!this.nav.nav || !world.doors) return false;
    const pos = this.object.position;
    for (let k = 1; k <= 3; k++) {
      const L = 0.3 * k + 0.25;
      const di = this.nav.doorAt(pos.x + dirX * L, pos.z + dirZ * L);
      if (di <= 0) continue;
      const door = world.doors[di - 1];
      if (!door || door.isOpen || door.active === false) return false;
      if (door.isLocked) {
        this.nav.blockDoor(di - 1);
        this._needPath = true;
        return true;
      }
      const chasing = this._state === 'CHASE';
      this._doorWait = { door, index: di - 1, phase: 'pause', t: chasing ? 0.2 : 0.55 + Math.random() * 0.5 };
      if (!chasing) this._say('hum', 0.15);
      this.speed = Math.min(this.speed, 0.4);
      return true;
    }
    return false;
  }

  // =============================================================================== animation
  _animate(dt, world) {
    if (!this.anim || this._captureSeq) return;
    let want = this._wantAnim;
    if (this._turn) want = this._turn.name;
    else if (this._state === 'CAPTURE') want = this._remoteCap ? 'capture' : 'idle';
    else if (this._actualSpeed > 0.2 || (this.moveStatus === 'moving' && this.speed > 0.15)) {
      want = this.goalMode === 'run' && this.speed > 2 ? 'run' : 'walk';
    } else {
      switch (this._state) {
        case 'PATROL':
          if (this.stalk) want = this.stalk.phase === 'stare' ? 'stare' : 'idle';
          else want = this.sub === 'pause' ? this._pauseAnim : 'idle';
          break;
        case 'SUSPICIOUS':
          want = 'investigate';
          break;
        case 'INVESTIGATE':
          want = this.sub === 'look' ? 'search' : this.sub === 'checkStand' ? 'investigate' : 'idle';
          break;
        case 'SEARCH':
          want = this.sub === 'spotStand' ? 'stare' : this.sub === 'look' ? 'search' : 'idle';
          break;
        case 'CHASE':
          want = 'investigate';
          break;
        default:
          want = 'idle';
      }
      if (this._doorWait) want = 'idle';
    }
    if (want !== this._wantAnim || (this.anim.requested !== want && !this._turn)) {
      const fade = want === 'run' || this._wantAnim === 'run' ? 0.22 : 0.4;
      this.anim.play(want, { fade });
      this._wantAnim = want;
    }
    if (want === 'walk' || want === 'run') this.anim.syncToSpeed(Math.max(this._actualSpeed, this.speed * 0.8));
    this._mixerUpdate(dt);
    this._applyProcedural(dt, world);
  }

  _setupProcedural() {
    const names = ['hips', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'neck_02', 'head', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R', 'keys'];
    if (!this.model) return;
    this.object.updateMatrixWorld(true);
    const modelInv = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const n of names) {
      const b = this.bones[n];
      if (!b) continue;
      const qRest = modelInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()));
      const inv = qRest.clone().invert();
      const entry = {
        x: new THREE.Vector3(1, 0, 0).applyQuaternion(inv),
        y: new THREE.Vector3(0, 1, 0).applyQuaternion(inv),
        down: null,
      };
      if (n === 'hips' && b.parent) {
        const pq = modelInv.clone().multiply(b.parent.getWorldQuaternion(new THREE.Quaternion()));
        const ps = b.parent.getWorldScale(new THREE.Vector3());
        entry.down = new THREE.Vector3(0, -1, 0).applyQuaternion(pq.invert()).divideScalar(ps.x || 1);
      }
      this._procAxes[n] = entry;
      this._procSnap = this._procSnap || [];
      this._procSnap.push({ bone: b, q: b.quaternion.clone(), p: n === 'hips' ? b.position.clone() : null });
    }
    const head = this.bones.head;
    this._faceOffset = new THREE.Vector3(0, 0.15, 0.06); // from head bone origin to the face (bone-local, approx.)
    if (head) {
      // express "up 0.15 m, forward 0.08 m" in the head bone's local frame
      const qRest = modelInv.clone().multiply(head.getWorldQuaternion(new THREE.Quaternion()));
      const s = head.getWorldScale(new THREE.Vector3()).x || 1;
      this._faceOffset.set(0, 0.15, 0.09).applyQuaternion(qRest.invert()).divideScalar(s);
    }
  }

  /**
   * Mixer update that is safe with additive procedural offsets: THREE's PropertyMixer only writes a
   * bone when the sampled value changes, so offsets would accumulate during holds. Restore the last
   * mixer pose first, update, then snapshot the fresh mixer pose.
   */
  _mixerUpdate(dt) {
    const snap = this._procSnap;
    if (snap) {
      for (let i = 0; i < snap.length; i++) {
        const e = snap[i];
        e.bone.quaternion.copy(e.q);
        if (e.p) e.bone.position.copy(e.p);
      }
    }
    this.anim.update(dt);
    if (snap) {
      for (let i = 0; i < snap.length; i++) {
        const e = snap[i];
        e.q.copy(e.bone.quaternion);
        if (e.p) e.p.copy(e.bone.position);
      }
    }
  }

  _rot(name, axis, angle) {
    const b = this.bones[name];
    const ax = this._procAxes[name];
    if (!b || !ax || Math.abs(angle) < 1e-5) return;
    _q1.setFromAxisAngle(ax[axis], angle);
    b.quaternion.multiply(_q1);
  }

  _applyProcedural(dt, world) {
    const pos = this.object.position;
    // ---- doorway stoop: a 2.6 m man folding himself under a 2.2 m door frame
    this._doorScanT -= dt;
    if (this._doorScanT <= 0) {
      this._doorScanT = 0.1;
      this._nearDoor = Infinity;
      const doors = world?.doors;
      if (doors) {
        for (let i = 0; i < doors.length; i++) {
          const d = doors[i];
          if (!d.position || d.active === false) continue;
          const dd = hdist(d.position, pos);
          if (dd < this._nearDoor) this._nearDoor = dd;
        }
      }
    }
    // (never during the capture: he straightens up to loom over you)
    const capturing = !!this._captureSeq || this._state === 'CAPTURE';
    const needStoop = !capturing && DOOR_HEIGHT < ENEMY.height ? clamp((1.75 - this._nearDoor) / 0.85, 0, 1) : 0;
    this._stoop += clamp(needStoop - this._stoop, -dt * (capturing ? 6 : 2.2), dt * 3.2);
    const s = smooth01(this._stoop);

    // ---- head tracking (follows what he is interested in)
    let wantYaw = 0;
    let wantPitch = 0;
    if (this._hasLook || this._state === 'CAPTURE') {
      const t = this._lookTarget;
      this.object.updateMatrixWorld(false);
      const ex = this._eye.x;
      const ez = this._eye.z;
      const dx = t.x - ex;
      const dz = t.z - ez;
      const target = yawTo(dx, dz);
      wantYaw = clamp(wrapAngle(target - this.yaw), -75 * DEG, 75 * DEG);
      const hd = Math.hypot(dx, dz);
      wantPitch = clamp(Math.atan2(this._eye.y - t.y, Math.max(hd, 0.3)) * 0.85, -30 * DEG, 28 * DEG);
    }
    const k = clamp(dt * (this._state === 'CHASE' ? 6 : 3.2), 0, 1);
    this._lookYaw += (wantYaw - this._lookYaw) * k;
    this._lookPitch += (wantPitch - this._lookPitch) * k;
    const lw = this._state === 'CAPTURE' ? 0 : 1; // the capture clip aims the face itself
    const yawA = this._lookYaw * lw;
    const pitA = this._lookPitch * lw;

    if (s > 0.001) {
      this._rot('spine_01', 'x', 16 * DEG * s);
      this._rot('spine_02', 'x', 16 * DEG * s);
      this._rot('spine_03', 'x', 12 * DEG * s);
      this._rot('neck_01', 'x', 8 * DEG * s);
      this._rot('head', 'x', -22 * DEG * s);
      this._rot('thigh_L', 'x', -20 * DEG * s);
      this._rot('thigh_R', 'x', -20 * DEG * s);
      this._rot('shin_L', 'x', 34 * DEG * s);
      this._rot('shin_R', 'x', 34 * DEG * s);
      const hips = this.bones.hips;
      const ax = this._procAxes.hips;
      if (hips && ax?.down) hips.position.addScaledVector(ax.down, 0.14 * s);
    }
    // the key ring on his belt swings and jangles with his gait
    const sp = this._actualSpeed;
    this._keysPh = (this._keysPh || 0) + dt * (2.2 + sp * 2.6);
    const kAmp = 0.06 + 0.3 * clamp(sp / 3, 0, 1);
    this._rot('keys', 'x', Math.sin(this._keysPh) * kAmp);
    this._rot('keys', 'y', Math.sin(this._keysPh * 0.5 + 1.3) * kAmp * 0.5);

    if (Math.abs(yawA) > 1e-4 || Math.abs(pitA) > 1e-4) {
      this._rot('neck_01', 'y', yawA * 0.2);
      this._rot('neck_02', 'y', yawA * 0.3);
      this._rot('head', 'y', yawA * 0.5);
      this._rot('neck_02', 'x', pitA * 0.4);
      this._rot('head', 'x', pitA * 0.6);
    }

    this.object.updateMatrixWorld(true);
    const head = this.bones.head;
    if (head) {
      this.headPosition.copy(this._faceOffset).applyMatrix4(head.matrixWorld);
      this._eye.copy(this.headPosition);
    } else {
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      this.headPosition.set(pos.x + fx * 0.3, 2.4 - 0.4 * s, pos.z + fz * 0.3);
      this._eye.copy(this.headPosition);
    }
  }

  // =============================================================================== threat
  _updateThreat(dt, player, focused = true) {
    let target = 0;
    if (player) {
      const d = hdist(this.object.position, player.position);
      const prox = clamp(1 - d / 30, 0, 1);
      let aw;
      switch (this._state) {
        case 'CHASE':
        case 'CAPTURE':
          aw = 1;
          break;
        case 'SEARCH':
          aw = 0.6;
          break;
        case 'INVESTIGATE':
          aw = 0.5;
          break;
        case 'SUSPICIOUS':
          aw = 0.45 + this.meter * 0.3;
          break;
        default:
          aw = this.stalk && this.stalk.phase === 'stare' ? 0.55 : 0.15 + this.meter * 0.4;
      }
      if (!focused) aw = Math.min(aw, 0.45); // co-op: he is after somebody else
      target = aw * (0.35 + 0.65 * prox);
      if (this._los && focused) target += 0.1 * prox;
      if (this._state === 'CHASE' && focused) target = Math.max(target, 0.7);
    }
    target = clamp(target, 0, 1);
    this._threat += (target - this._threat) * clamp(dt * (target > this._threat ? 3 : 0.8), 0, 1);
  }

  // =============================================================================== capture cinematic
  _captureTick(dt) {
    const seq = this._captureSeq;
    if (!seq || seq.done) return;
    seq.t += dt;
    const cam = seq.camera;
    if (seq.slideTo) {
      const k = smooth01(seq.t / 0.4);
      _v2.lerpVectors(seq.slideFrom, seq.slideTo, k);
      const pos = this.object.position;
      const world = this.game.world;
      _v3.set(_v2.x - pos.x, 0, _v2.z - pos.z);
      if (world?.moveCircle) {
        const np = world.moveCircle(pos, _v3, ENEMY.radius * 0.75, _vMove);
        pos.set(np.x, 0, np.z);
      } else pos.add(_v3);
      if (k >= 1) seq.slideTo = null;
    }
    // keep the camera as the look target for the head
    cam.getWorldPosition(this._lookTarget);
    this._hasLook = true;
    if (this.anim) {
      this._mixerUpdate(dt);
      this._applyProcedural(dt, this.game.world);
    } else {
      this.object.updateMatrixWorld(true);
    }
    // camera stumbles back a little and turns up to the face
    const tt = clamp(seq.t / seq.dur, 0, 1);
    const back = 0.18 * smooth01(tt * 1.6);
    cam.position.set(seq.p0.x + seq.back.x * back, seq.p0.y - 0.08 * smooth01(tt * 1.4), seq.p0.z + seq.back.z * back);
    cam.updateMatrixWorld(true);
    cam.getWorldPosition(_v1);
    _v2.copy(this.headPosition);
    _m1.lookAt(_v1, _v2, _UP);
    seq.qTarget.setFromRotationMatrix(_m1);
    // roll the view as the hands close in
    _q2.setFromAxisAngle(_v3.set(0, 0, 1), -8 * DEG * smooth01((seq.t - 1.0) / 1.4));
    seq.qTarget.multiply(_q2);
    if (seq.shake) {
      const amp = 0.9 * DEG * smooth01((seq.t - 0.35) / 0.4) * (1 - 0.5 * tt);
      _q2.setFromAxisAngle(_v3.set(Math.random() - 0.5, Math.random() - 0.5, 0).normalize(), amp * (Math.random() * 2 - 1));
      seq.qTarget.multiply(_q2);
    }
    const k = smooth01(seq.t / 0.85);
    _q1.slerpQuaternions(seq.q0, seq.qTarget, k);
    if (cam.parent && !cam.parent.isScene) {
      cam.parent.getWorldQuaternion(_q2).invert();
      _q1.premultiply(_q2);
    }
    cam.quaternion.copy(_q1);
    if (seq.t >= seq.dur + 0.15 && !seq.done) {
      seq.done = true;
      seq.resolve(true);
    }
  }

  /** Face position (object-local) at the end of a clip, or null. Stops all actions. */
  _sampleClipHead(name) {
    const a = this.anim;
    const head = this.bones.head;
    if (!a || !head) return null;
    const n = a.resolve(name);
    if (!n) return null;
    const action = a.actions.get(n);
    a.stopAll();
    action.reset();
    action.setEffectiveWeight(1);
    action.play();
    action.time = Math.max(0, action.getClip().duration - 1e-3);
    a.mixer.update(0);
    this.object.updateMatrixWorld(true);
    const out = new THREE.Vector3().copy(this._faceOffset).applyMatrix4(head.matrixWorld);
    this.object.worldToLocal(out);
    a.stopAll();
    return out;
  }

  // =============================================================================== fallback model
  _buildPlaceholder() {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x14161c });
    const pale = new THREE.MeshLambertMaterial({ color: 0xb0ad9c });
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.34, 0.75, 0.22), dark, 0, 1.6, 0.05);
    add(new THREE.BoxGeometry(0.12, 1.25, 0.14), dark, 0.11, 0.63, 0);
    add(new THREE.BoxGeometry(0.12, 1.25, 0.14), dark, -0.11, 0.63, 0);
    add(new THREE.BoxGeometry(0.09, 1.3, 0.1), dark, 0.25, 1.35, 0.05);
    add(new THREE.BoxGeometry(0.09, 1.3, 0.1), dark, -0.25, 1.35, 0.05);
    add(new THREE.CylinderGeometry(0.04, 0.05, 0.3, 6), pale, 0, 2.1, 0.18);
    add(new THREE.BoxGeometry(0.17, 0.3, 0.2), pale, 0, 2.38, 0.3);
    return g;
  }
}
