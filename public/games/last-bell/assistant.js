// LAST BELL — The Assistant: the upstairs enemy (Second Floor update). Owned by the AI workstream.
// Design: docs/last-bell-update/enemy-ai.md §4–6. Contract: CONTRACTS.md §13.5.
//
// The school's lunch monitor: an ordinary, far-too-friendly woman in a pink tabard and hairnet. She wants to
// be WITH you. Signature behaviour: FOLLOW — she trails you and only comes closer while you aren't looking;
// look at her and she stops, smiles and waves.
//
//   new Assistant(game); await assistant.load(onProgress)
//   assistant.reset()                 new run: placed at world.floor2.anchor('assistant-spawn') (parked if no Floor 2)
//   assistant.enabled                 game.js turns her on after the intro (start upstairs only)
//   assistant.update(dt, game)        every frame while playing (host / solo: the AI; guest: puppet)
//   assistant.updateCapture(dt)       while she runs her capture cinematic (solo)
//   await assistant.runCaptureSequence(camera)
//   assistant.getThreat()             0..1 for the local player (0 when they're on another floor)
//   who = 'assistant', floor = 1, position (feet, with y), state
//   netSnapshot(slotOf) / applySnapshot(arr, sentAt)   co-op (format in docs/last-bell-update/status/AI.md)
//   remoteCapture(pos) / releaseCapture(grace) / endCapture()   co-op capture hooks (coop.js)
//   setPossessed / applyInput / tryAttack: Director Mode (multiplayer.md §5.4; NET), mirroring the Caretaker's.
//
// States: PATROL, INVESTIGATE, FOLLOW, CHASE, ATTACK, SEARCH, RETURN, STAIRS (top of a staircase her
// target went down), CATCH. Movement only through the shared Mover (enemy-perception.js): her radius, her
// floor's nav (stair flights blocked), world.moveCircle with { floor: 1, enemy: true }. No teleports.
// Every sight / hearing / attack check uses strict LOS (doors block until fully open).
// Decisions use a seeded RNG (game.seed ^ 0xA55). The founder Easter egg changes nothing about her play.
//
// Model: assets/characters/assistant.glb (CHAR) once it exists — flip GLB_READY. Until then a procedural
// placeholder figure with the same face atlas layout (4 columns: smile, grin, blank, happy).
// Clips used (when present): idle walk run wave attack search investigate stare return open_door look_around capture.
// Events: enemy:voice/state/spotted/lost/sighting/footstep/capture with who: 'assistant';
// enemy:attack { who, phase: 'lunge' | 'hit' | 'miss', position }.

import * as THREE from './lib/three/three.module.js';
import { ASSISTANT, DIFFICULTY } from './config.js';
import { loadGLB, cloneGLB, ps1ify } from './assets.js';
import { AnimationController, CLIP_INFO } from './animations.js';
import { NavPathfinder } from './enemy-nav.js';
import {
  DEG, clamp, lerp, wrapAngle, yawTo, hdist, makeRng, los, pickTarget, candidateTargets, targetId,
  noiseFloorGain, floorBaseY, floorList, floorOfPos, inStairwell, propQuery, Mover, Puppet, Possession,
} from './enemy-perception.js';

const WHO = 'assistant';
const FLOOR = 1;
const GLB_URL = 'assets/characters/assistant.glb';
const GLB_READY = true; // CHAR: assistant.glb is in assets/characters
// Her clips (anim_assistant.py): walk / return authored at 1.35 m/s and run at 4.0 m/s (feet planted, no root
// motion; syncToSpeed matches them to the real ground speed). attack / open_door / capture are one-shots.
const ASSISTANT_CLIPS = {
  ...CLIP_INFO,
  run: { ...CLIP_INFO.run, speed: 4.0 },
  return: { loop: true, speed: 1.35, steps: [0.02, 0.52], fallback: 'walk' },
  wave: { loop: true, fallback: 'idle' },
  look_around: { loop: true, fallback: 'idle' },
  attack: { loop: false, fallback: 'idle' },
  open_door: { loop: false, fallback: 'idle' },
};

const STATES = ['PATROL', 'INVESTIGATE', 'FOLLOW', 'CHASE', 'ATTACK', 'SEARCH', 'RETURN', 'STAIRS', 'CATCH', 'IDLE'];
const ANIMS = ['idle', 'walk', 'run', 'wave', 'attack', 'search', 'investigate', 'stare', 'return', 'open_door', 'look_around', 'capture'];
const FACES = ['smile', 'grin', 'blank', 'happy'];

const A = {
  radius: ASSISTANT?.radius ?? 0.32,
  height: ASSISTANT?.height ?? 1.62,
  walk: ASSISTANT?.walkSpeed ?? 1.35,
  follow: 1.6,
  run: ASSISTANT?.runSpeed ?? 4.0,
  corner: 3.2, // m/s in tight turns
  attackCooldown: ASSISTANT?.attackCooldown ?? 1.2,
  sight: 16,
  cone: 55 * DEG,
  sense: 1.4,
  eye: 1.45,
  watchCone: Math.cos(30 * DEG),
  followMin: 6,
  followMax: 11,
  chaseAt: 4,
  attackAt: 1.1,
  hitRange: 1.2,
  hitCone: 60 * DEG,
  hitAt: 0.35,
  attackDur: 0.7,
  lostFollow: 4,
  lostChase: 3,
  stairWait: 15,
  panel: 1.6,
};

// voice: per-line cooldowns (s) and rough lengths (s) for when audio can't say
const LINE_CD = {
  there_you_are: 1e9, founder: 1e9, hi: 9, giggle: 8, come_back: 9, dont_leave: 12, why_running: 14, no_running: 16,
  what_was_that: 10, fixing: 14, where_are_you: 14, hide_seek: 22, breathing: 18, pout: 20, i_found_you: 3,
  downstairs: 25, forever: 3, found_you: 6, hum: 12, attack: 1.2,
  stairs_closed: 45, staff_card: 60, security_office: 45, step_away: 25,
};
const LINE_LEN = {
  there_you_are: 1.6, found_you: 1.2, hi: 1.0, why_running: 3.2, come_back: 1.4, dont_leave: 1.4, forever: 2.8,
  i_found_you: 1.4, downstairs: 2.8, where_are_you: 1.8, hide_seek: 2.6, breathing: 2.2, what_was_that: 1.6,
  fixing: 2.6, no_running: 2.8, pout: 0.8, founder: 2.4, giggle: 1.2, hum: 7, attack: 5.5,
  stairs_closed: 5.6, staff_card: 6.1, security_office: 6.2, step_away: 6.6,
};
const VOICE_GAP = 0.8; // s of silence between two lines

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();

export class Assistant {
  constructor(game) {
    this.game = game;
    this.events = game.events;
    this.who = WHO;
    this.floor = FLOOR;
    this.radius = A.radius;
    this.enabled = false;
    this.remote = false;
    this.rng = makeRng(0xa55);
    this.object = new THREE.Group();
    this.object.name = 'assistant';
    this.object.position.set(0, -100, 0);
    this.object.visible = false;
    this.headPosition = new THREE.Vector3(0, -98, 0);
    this._eye = new THREE.Vector3(0, -98, 0);
    this.yaw = 0;
    this.speed = 0;
    this._actualSpeed = 0;
    this.meter = 0;
    this._state = 'IDLE';
    this._stateTime = 0;
    this._time = 0;
    this._ready = false;
    this._threat = 0;
    this._face = 'smile';
    this._faceHold = 0;
    this._faceOverride = null;
    // movement (fields the shared Mover reads)
    this.nav = new NavPathfinder();
    this.path = new Float32Array(512);
    this.pathCount = 0;
    this.pathIndex = 0;
    this.goal = new THREE.Vector3();
    this.goalMode = 'walk';
    this.goalArrive = 0.5;
    this.moveStatus = 'idle';
    this.pathTarget = new THREE.Vector3();
    this.pathEnd = new THREE.Vector3();
    this._needPath = false;
    this._lastPathTime = -99;
    this._stuckTimer = 0;
    this._stuckCount = 0;
    this.stuckEvents = 0;
    this._stuckAnchor = new THREE.Vector3();
    this._sidestep = 0;
    this._sidestepDir = 1;
    this._doorWait = null;
    this._turn = null;
    this._facing = false;
    this._faceTarget = new THREE.Vector3();
    this._vMove = new THREE.Vector3();
    this.pathRequests = 0;
    this.anim = null;
    this._wantAnim = 'idle';
    this.stickyStates = ['CHASE', 'ATTACK', 'CATCH'];
    this.mover = new Mover(this, {
      radius: A.radius,
      floor: FLOOR,
      speedFor: (m) => this._speedFor(m),
      turnClips: false,
      turn: { walk: 3.2, run: 4.2, face: 2.6, pivot: 3 },
      accel: { walk: 3, run: 6, brake: 7 },
      doorPause: () => 0.8, // she stops to open doors (open_door)
      doorOpenHold: 0,
      onDoorPause: () => (this._doorAnimT = 0.8),
      isChasing: () => this._state === 'CHASE',
      isCapturing: () => this._state === 'CATCH',
      cornerCap: (absDiff, mode) => (mode === 'run' && absDiff > 35 * DEG ? A.corner * this._diff().enemySpeed : Infinity),
    });
    this.puppet = new Puppet(this, { radius: A.radius, floor: FLOOR, decode: (d) => Assistant._decode(d) });
    // perception / memory
    this._target = null;
    this._visible = false;
    this._los = false;
    this._losTimer = 0;
    this._watched = false;
    this._watchLos = false;
    this._watchT = 0;
    this.lkp = new THREE.Vector3();
    this._hasLkp = false;
    this.stimulus = new THREE.Vector3();
    this._lastSeenTime = -99;
    this._lookTarget = new THREE.Vector3();
    this._hasLook = false;
    this._footPos = new THREE.Vector3();
    this._stepAcc = 0;
    this._lastPos = new THREE.Vector3();
    this._voiceT = {};
    this._voiceBusyUntil = -1;
    this._voiceQueue = null;
    this._checked = new Map();
    this._unsubs = [];
    if (this.events?.on) {
      this._unsubs.push(this.events.on('noise', (n) => this.hearNoise(n)));
      this._unsubs.push(this.events.on('hide:enter', (e) => this._onHideEnter(e)));
    }
    game.scene?.add(this.object);
    this._reset();
  }

  get position() {
    return this.object.position;
  }
  get state() {
    return this._state;
  }
  get face() {
    return this._face;
  }
  get stairGuardHits() {
    return this.mover.stairGuardHits;
  }

  static NET_STATES = STATES;
  static NET_ANIMS = ANIMS;
  static NET_FACES = FACES;

  // ============================================================================= model
  async load(onProgress) {
    let gltf = null;
    if (GLB_READY) {
      try {
        gltf = await loadGLB(GLB_URL);
      } catch (err) {
        console.warn('[assistant] GLB failed, using placeholder:', err?.message || err);
      }
    }
    if (gltf) {
      const model = cloneGLB(gltf.scene);
      ps1ify(model);
      model.rotation.y = Math.PI; // glTF front is +Z; our yaw faces -Z
      // Cel shading (anime look): ps1ify's Lambert materials become MeshToonMaterial with a hard 3-step ramp
      // (the face gets a lighter 2-step one); the inverted-hull 'assistant_outline' becomes unlit black,
      // single-sided. ps1ify's vertex snap is carried over (its onBeforeCompile runs first, cache key kept).
      const ramp = (vals) => {
        const t = new THREE.DataTexture(new Uint8Array(vals), vals.length, 1, THREE.RedFormat);
        t.minFilter = t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.needsUpdate = true;
        return t;
      };
      // The school's lights are calibrated for dark props, so the torch + ceiling lights would burn her painted face
      // out to white: the lit result is clamped to the painted colour (flat anime colour in bright light, the ramp's
      // darker steps still show as cel shadows; dim corridors are unaffected).
      const RAMP = ramp([60, 120, 200]);
      const RAMP_FACE = ramp([150, 210]);
      const CEL_CLAMP = 'outgoingLight = min( outgoingLight, diffuseColor.rgb + totalEmissiveRadiance );\n';
      const toon = new Map();
      const toToon = (m) => {
        if (!m) return m;
        if (toon.has(m)) return toon.get(m);
        let out;
        if (/assistant_outline/i.test(m.name || '')) {
          out = new THREE.MeshBasicMaterial({ name: m.name, color: 0x000000, side: THREE.FrontSide, fog: true });
        } else {
          const face = /assistant_face/i.test(m.name || '') || /assistant_face/i.test(m.map?.name || '');
          out = new THREE.MeshToonMaterial({
            name: m.name,
            color: m.color,
            map: m.map,
            gradientMap: face ? RAMP_FACE : RAMP,
            emissive: m.emissive,
            emissiveMap: face ? m.map : m.emissiveMap, // the faint glow follows the expression offset too
            emissiveIntensity: m.emissiveIntensity ?? 1,
            side: m.side,
            transparent: m.transparent,
            opacity: m.opacity,
            alphaTest: m.alphaTest,
            fog: true,
          });
        }
        const snap = m.userData?.__ps1snap;
        const prevCompile = snap ? m.onBeforeCompile : null;
        const prevKey = snap ? m.customProgramCacheKey : null;
        if (snap) out.userData.__ps1snap = true;
        if (out.isMeshToonMaterial) {
          out.onBeforeCompile = function (shader, renderer) {
            if (prevCompile) prevCompile.call(this, shader, renderer);
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', CEL_CLAMP + '#include <opaque_fragment>');
          };
          out.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|celclamp'; };
        } else if (snap) {
          out.onBeforeCompile = prevCompile;
          out.customProgramCacheKey = prevKey;
        }
        toon.set(m, out);
        return out;
      };
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.frustumCulled = false;
        o.material = Array.isArray(o.material) ? o.material.map(toToon) : toToon(o.material);
        o.castShadow = !/assistant_outline/i.test(o.material?.name || o.name || '');
        const m = o.material;
        if (m?.map && (/assistant_face/i.test(m.map.name || '') || /assistant_face/i.test(m.name || ''))) {
          this._faceTex = m.map;
          if (m.emissiveMap && m.emissiveMap !== m.map) {
            m.emissiveMap = m.map; // the faint glow follows the expression offset too
            m.needsUpdate = true;
          }
        }
      });
      this.model = model;
      this.anim = new AnimationController(model, gltf.animations, ASSISTANT_CLIPS);
    } else {
      this.model = this._buildPlaceholder();
      this.anim = new AnimationController(this.model, []);
    }
    this.object.add(this.model);
    this._setFaceTex('smile');
    this._ready = true;
    onProgress?.(1);
  }

  /** A simple stand-in figure: pink tabard, hairnet, ladle; face plane on the same 4-column atlas layout. */
  _buildPlaceholder() {
    const g = new THREE.Group();
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
    const skin = mat(0xe8c4a8);
    const add = (geo, m, x, y, z, parent = g) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      parent.add(o);
      return o;
    };
    add(new THREE.CylinderGeometry(0.17, 0.22, 0.62, 10), mat(0x2f3340), 0, 0.62, 0); // skirt / trousers
    add(new THREE.CylinderGeometry(0.19, 0.18, 0.6, 10), mat(0xe58aa9), 0, 1.12, 0); // pink tabard
    add(new THREE.BoxGeometry(0.3, 0.42, 0.02), mat(0xf6f0ea), 0, 1.08, -0.185); // apron front
    const legs = [];
    for (const sx of [-0.08, 0.08]) {
      const pv = new THREE.Group();
      pv.position.set(sx, 0.36, 0);
      g.add(pv);
      add(new THREE.CylinderGeometry(0.045, 0.04, 0.34, 6), skin, 0, -0.17, 0, pv);
      add(new THREE.BoxGeometry(0.09, 0.06, 0.18), mat(0x1a1a1a), 0, -0.33, -0.03, pv); // loafers
      legs.push(pv);
    }
    const arms = [];
    for (const sx of [-0.23, 0.23]) {
      const pv = new THREE.Group();
      pv.position.set(sx, 1.38, 0);
      g.add(pv);
      add(new THREE.CylinderGeometry(0.045, 0.04, 0.56, 6), mat(0xe58aa9), 0, -0.28, 0, pv);
      add(new THREE.SphereGeometry(0.045, 6, 4), skin, 0, -0.58, 0, pv);
      arms.push(pv);
    }
    // ladle in the right hand
    const ladle = new THREE.Group();
    ladle.name = 'assistant_ladle';
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 5), mat(0xb8bcc2), 0, 0.18, 0, ladle);
    add(new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xb8bcc2), 0, 0.0, 0, ladle);
    ladle.position.set(0, -0.6, -0.02);
    arms[1].add(ladle);
    const head = new THREE.Group();
    head.position.set(0, 1.5, 0);
    g.add(head);
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 6), skin, 0, -0.08, 0, head); // neck
    add(new THREE.SphereGeometry(0.12, 12, 8), skin, 0, 0.02, 0, head);
    add(new THREE.SphereGeometry(0.128, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.36), mat(0x6b4a33), 0, 0.03, 0.01, head); // hair (crown only)
    add(new THREE.SphereGeometry(0.126, 10, 6, 0, Math.PI, 0, Math.PI * 0.62), mat(0x6b4a33), 0, 0.02, 0.012, head); // back of the hair
    const net = add(
      new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.38),
      new THREE.MeshBasicMaterial({ color: 0xf0f0f0, wireframe: true, transparent: true, opacity: 0.55 }),
      0, 0.04, 0.01, head,
    ); // hairnet
    net.name = 'hairnet';
    // face: 4 expressions in one canvas atlas (offset.x 0 / .25 / .5 / .75), like the CHAR texture
    const tex = this._faceAtlas();
    const face = add(new THREE.PlaneGeometry(0.17, 0.13), new THREE.MeshBasicMaterial({ map: tex, transparent: true }), 0, -0.01, -0.124, head);
    face.rotation.y = Math.PI; // plane faces +Z; her front is -Z
    this._faceTex = tex;
    this._ph = { legs, arms, head, phase: 0 };
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    return g;
  }

  _faceAtlas() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const x = c.getContext('2d');
    const eyes = (cx, open, happy) => {
      x.strokeStyle = '#1b1b1b';
      x.fillStyle = '#1b1b1b';
      x.lineWidth = 3;
      for (const ex of [cx - 12, cx + 12]) {
        x.beginPath();
        if (happy) x.arc(ex, 26, 5, Math.PI, 0); // ^ ^
        else if (open) x.arc(ex, 24, open, 0, Math.PI * 2);
        if (happy) x.stroke();
        else x.fill();
      }
    };
    const mouth = (cx, kind) => {
      x.strokeStyle = '#8a2b3a';
      x.lineWidth = 3;
      x.beginPath();
      if (kind === 'smile') x.arc(cx, 36, 10, 0.15 * Math.PI, 0.85 * Math.PI);
      else if (kind === 'grin') {
        x.fillStyle = '#f4f4f4';
        x.fillRect(cx - 14, 38, 28, 8);
        x.strokeRect(cx - 14, 38, 28, 8);
        x.moveTo(cx - 14, 42);
        x.lineTo(cx + 14, 42);
      } else if (kind === 'blank') {
        x.moveTo(cx - 8, 44);
        x.lineTo(cx + 8, 44);
      } else x.arc(cx, 36, 12, 0.1 * Math.PI, 0.9 * Math.PI);
      x.stroke();
    };
    const cols = [
      [32, 'smile', 3, false],
      [96, 'grin', 4, false],
      [160, 'blank', 2.2, false],
      [224, 'happy', 0, true],
    ];
    for (const [cx, kind, open, happy] of cols) {
      eyes(cx, open, happy);
      mouth(cx, kind);
    }
    const t = new THREE.CanvasTexture(c);
    t.name = 'assistant_face';
    t.magFilter = THREE.NearestFilter;
    t.repeat.set(0.25, 1);
    return t;
  }

  _setFaceTex(name) {
    this._face = name;
    const i = Math.max(0, FACES.indexOf(name));
    if (this._faceTex) this._faceTex.offset.x = i * 0.25;
  }

  // ============================================================================= lifecycle
  /** New run: placed at the assistant-spawn anchor, or parked (invisible, y = -100) when there's no Floor 2. */
  reset() {
    this._reset();
    const a = this.game.world?.floor2?.anchor?.('assistant-spawn');
    if (a?.position) this.spawn(a.position, a.yaw || 0);
  }

  spawn(position, yaw = 0) {
    this._reset();
    this.object.position.set(position.x, floorBaseY(FLOOR), position.z);
    this.object.visible = true;
    this.yaw = yaw;
    this.object.rotation.y = yaw;
    this._lastPos.copy(this.object.position);
    this.mover._lastValid.ok = false;
    this._setState('PATROL');
    this._updateEye();
  }

  _reset() {
    this.rng = makeRng((((this.game.seed ?? 1) >>> 0) ^ 0xa55) >>> 0);
    this.object.position.set(0, -100, 0);
    this.object.visible = false;
    this._state = 'IDLE';
    this._stateTime = 0;
    this.meter = 0;
    this.speed = 0;
    this._actualSpeed = 0;
    this._target = null;
    this._visible = false;
    this._los = false;
    this._watched = false;
    this._hasLkp = false;
    this._lastSeenTime = -99;
    this._greeted = false;
    this._founderDone = false;
    this._founderSeq = null;
    this._seenHide = null;
    this._checked.clear();
    this._voiceT = {};
    this._voiceBusyUntil = -1;
    this._voiceQueue = null;
    this._humT = 8;
    this._graceT = 0;
    this._returnBoostT = 0;
    this._lastAttackT = -99;
    this._attack = null;
    this._search = null;
    this._stairs = null;
    this._captureSeq = null;
    this._captureEmitted = false;
    this.capturedFromHide = null;
    this._remoteCap = false;
    this._doorAnimT = 0;
    this._standoffT = 0;
    this._faceOverride = null;
    this._faceHold = 0;
    this._setFaceTex('smile');
    this.puppet?.clear();
    this.mover?.stop();
    this.nav.clearBlocks?.();
  }

  getThreat() {
    return this._threat;
  }

  _diff() {
    return this.game.difficulty || DIFFICULTY[this.game.settings?.difficulty] || DIFFICULTY.normal;
  }

  _speedFor(mode) {
    const k = this._diff().enemySpeed ?? 1;
    switch (mode) {
      case 'run':
        return A.run * k;
      case 'fast':
      case 'follow':
        return A.follow * k;
      case 'slow':
        return 1.0 * k;
      default:
        return A.walk * k;
    }
  }

  _setState(s) {
    const prev = this._state;
    if (prev === s) return;
    this._state = s;
    this._stateTime = 0;
    this._standoffT = 0;
    if (s !== 'ATTACK') this._attack = null;
    if (s !== 'SEARCH') this._search = null;
    if (s !== 'STAIRS') this._stairs = null;
    switch (s) {
      case 'PATROL':
        this._patrolSub = 'pick';
        this._stopMove();
        break;
      case 'FOLLOW':
        this._followT = 0;
        this._followLimit = 25 + this.rng() * 15;
        this._lostT = 0;
        break;
      case 'CHASE':
        this._lostT = 0;
        this._broke = false;
        if (prev !== 'ATTACK') this.events?.emit('enemy:spotted', { who: WHO, position: this.object.position.clone() });
        break;
      case 'SEARCH':
        this._planSearch();
        this._say(this.rng() < 0.6 ? 'where_are_you' : 'hide_seek');
        break;
      case 'RETURN':
        this._returnBoostT = 8; // a breather: her sight meter rises ×0.7 for 8 s
        this.meter = Math.min(this.meter, 0.2);
        this._goTo(this._nearestPatrol() || this.object.position, 'walk', 0.8);
        break;
      default:
        break;
    }
    this.events?.emit('enemy:state', { who: WHO, state: s, prev });
  }

  forceState(state, target) {
    if (!STATES.includes(state)) return;
    if (target) {
      this.stimulus.set(target.x, floorBaseY(FLOOR), target.z);
      this.lkp.copy(this.stimulus);
      this._hasLkp = true;
    }
    if (state === 'CHASE') this.meter = 1;
    this._setState(state);
  }

  // ============================================================================= per frame
  update(dt, game = this.game) {
    if (!this._ready || !this.object.visible) return;
    dt = Math.min(dt, 0.1);
    if (this.remote) return this._updatePuppet(dt, game);
    if (!this.enabled) {
      this._threat = Math.max(0, this._threat - dt);
      this._animate(dt);
      return;
    }
    this._time += dt;
    this._stateTime += dt;
    const world = game.world;
    if (!world) return;
    this._syncNav(world);
    this._graceT = Math.max(0, this._graceT - dt);
    this._returnBoostT = Math.max(0, this._returnBoostT - dt);
    this._doorAnimT = Math.max(0, this._doorAnimT - dt);
    // Director Mode: a possessing Director drives her (never mid-catch); 3 s without input → back to her AI
    if (this._possession?.active && this._state !== 'CATCH' && !this._captureSeq) {
      if (this._possession.timedOut(this._time)) this.setPossessed(null, 'timeout');
      else return this._updatePossessed(dt, game, world);
    }

    if (this._state === 'CATCH') {
      this._locomoteSafe(dt, world);
    } else {
      const prev = this._target;
      const p = this._graceT > 0 ? null : pickTarget(this, dt, game, world);
      if (p) this._target = p;
      if (this._checkStairs(prev, p, world)) {
        // handled: her target went down a staircase
      } else {
        this._perceive(dt, world, p);
        this._think(dt, world, p);
      }
      this._locomoteSafe(dt, world);
    }
    this._footsteps();
    this._voiceTick();
    this._updateFace(dt);
    this._animate(dt);
    this._updateThreat(dt, game);
  }

  _locomoteSafe(dt, world) {
    if (this._founderSeq || this._attack || this._captureSeq) {
      // standing still (founder stare, a lunge drives its own steps, the cinematic slides itself)
      this.speed = 0;
      this._actualSpeed = lerp(this._actualSpeed, 0, clamp(dt * 10, 0, 1));
      if (this._facing) {
        const d = wrapAngle(yawTo(this._faceTarget.x - this.object.position.x, this._faceTarget.z - this.object.position.z) - this.yaw);
        this.yaw = wrapAngle(this.yaw + clamp(d, -3 * dt, 3 * dt));
        this.object.rotation.y = this.yaw;
        this._facing = false;
      }
    } else this.mover.locomote(dt, world);
    this._updateEye();
  }

  _syncNav(world) {
    const ref = this._navRef;
    const ver = this._navVersion;
    this.mover.syncNav(world);
    if (this._navRef !== ref || this._navVersion !== ver) this._propQ = propQuery(world, FLOOR);
  }

  _goTo(target, mode = 'walk', arrive = 0.5) {
    this.mover.goTo(target, mode, arrive);
  }
  _stopMove() {
    this.mover.stop();
  }
  _setFace(t) {
    this._faceTarget.set(t.x, floorBaseY(FLOOR), t.z);
    this._facing = true;
  }
  _setLook(t) {
    this._lookTarget.copy(t);
    this._hasLook = true;
  }

  _updateEye() {
    const p = this.object.position;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    this._eye.set(p.x + fx * 0.1, p.y + A.eye, p.z + fz * 0.1);
    this.headPosition.set(p.x + fx * 0.08, p.y + 1.52, p.z + fz * 0.08);
  }

  // ============================================================================= senses
  _perceive(dt, world, p) {
    this._visible = false;
    this._watched = false;
    const pos = this.object.position;
    if (!p || p.isHidden || p.alive === false) {
      this._los = false;
      if (this._state === 'PATROL' || this._state === 'RETURN') this.meter = Math.max(0, this.meter - dt * 0.12);
      return;
    }
    const diff = this._diff();
    const d = hdist(pos, p.position);
    let range = A.sight * (diff.sight ?? 1);
    if (!p.flashlightOn) range *= 0.8;
    if (p.isCrouching) range *= 0.8;
    const pe = p.eyePosition || p.position;
    const ang = Math.abs(wrapAngle(yawTo(p.position.x - pos.x, p.position.z - pos.z) - this.yaw));
    const hunting = this._state === 'CHASE' || this._state === 'FOLLOW' || this._state === 'ATTACK';
    const inCone = ang <= A.cone && d <= range;
    const sense = d <= A.sense;
    const keep = hunting && d <= Math.max(range, 14); // a target she's on stays in mind all round
    this._losTimer -= dt;
    if (inCone || sense || keep) {
      if (this._losTimer <= 0) {
        this._losTimer = 0.1;
        this._los = los(world, this._eye, pe);
      }
    } else this._los = false;
    this._visible = this._los;
    if (this._visible) {
      let rate = (0.5 + 1.6 * clamp(1 - d / range, 0, 1)) * (p.flashlightOn ? 1.2 : 1) * (p.isCrouching ? 0.7 : 1) * (p.isMoving ? 1.15 : 0.85);
      if (sense) rate = Math.max(rate, 3);
      if (this._returnBoostT > 0) rate *= 0.7;
      this.meter = Math.min(1, this.meter + rate * dt);
      this._lastSeenTime = this._time;
      this.lkp.set(p.position.x, floorBaseY(FLOOR), p.position.z);
      this._hasLkp = true;
      this._setLook(pe);
      this._seenVel = p.velocity;
      // the founder's first sighting this run: a beat of recognition (nothing else changes)
      if (!this._founderDone && this._state !== 'CATCH') {
        const id = targetId(this.game, p);
        if (id != null && this.game.isFounder?.(id)) this._startFounder(p);
      }
    } else if (this._state === 'PATROL' || this._state === 'RETURN') this.meter = Math.max(0, this.meter - dt * 0.12);
    // watched: she's within ±30° of the player's view centre, strict LOS both ways
    if (d < 25) {
      const cp = Math.cos(p.pitch || 0);
      const fx = -Math.sin(p.yaw || 0) * cp;
      const fy = Math.sin(p.pitch || 0);
      const fz = -Math.cos(p.yaw || 0) * cp;
      _v1.subVectors(this.headPosition, pe);
      const L = _v1.length();
      const facing = L > 1e-3 && (fx * _v1.x + fy * _v1.y + fz * _v1.z) / L >= A.watchCone;
      if (facing) {
        this._watchT -= dt;
        if (this._watchT <= 0) {
          this._watchT = 0.1;
          this._watchLos = los(world, pe, this.headPosition);
        }
        this._watched = this._watchLos;
      }
    }
  }

  _startFounder(p) {
    this._founderDone = true;
    this._greeted = true; // "I've been waiting for you, Senpai." replaces "Senpai~! There you are!"
    this._founderSeq = { t: 0, p };
    this._faceOverride = 'blank';
    this._faceHold = 1.0;
  }

  _tickFounder(dt) {
    const f = this._founderSeq;
    f.t += dt;
    this._setFace(f.p.position);
    if (f.t >= 1.0 && this._faceOverride === 'blank') {
      this._faceOverride = 'happy';
      this._faceHold = 1.6;
    }
    if (f.t >= 1.2 && !f.said) {
      f.said = true;
      this._say('founder', { force: true });
    }
    if (f.t >= 2.4) this._founderSeq = null;
  }

  /** Called directly or through the 'noise' event. Puzzle-panel noises count ×1.6 (she likes to help). */
  hearNoise(n = {}) {
    const { position, radius = 6, source } = n;
    if (!this.enabled || !this._ready || this.remote || !position || !this.object.visible) return;
    if (source === 'enemy' || this._state === 'CATCH' || this._state === 'ATTACK' || this._graceT > 0) return;
    const world = this.game.world;
    const gain = noiseFloorGain(world, FLOOR, n);
    if (gain <= 0) return;
    const panel = source === 'panel';
    let R = radius * gain * (this._diff().hearing ?? 1) * (panel ? A.panel : 1);
    let d = hdist(this.object.position, position);
    if (gain < 1) d = Math.hypot(d, (position.y || 0) - this.object.position.y);
    if (d > R) return;
    if (world.lineOfSight) {
      const base = floorBaseY(FLOOR);
      const ny = position.y || 0;
      _v1.set(position.x, ny - base < 0.3 ? base + 1.0 : ny, position.z);
      if (!los(world, this._eye, _v1)) R *= 0.7;
      if (d > R) return;
    }
    this._onHeard(position, 1 - d / R, n);
  }

  _onHeard(position, intensity, n) {
    const s = this._state;
    const base = floorBaseY(FLOOR);
    const sprint = (n.source === 'footstep' || n.source === 'player') && (n.radius ?? 0) >= 12;
    if (s === 'CHASE') {
      if (!this._visible && intensity > 0.3) this._chaseHeard(position);
      return;
    }
    if (s === 'FOLLOW' || s === 'STAIRS') return;
    if (s === 'SEARCH') {
      if (intensity > 0.3) {
        this.lkp.set(position.x, base, position.z);
        this._planSearch();
      }
      return;
    }
    // PATROL / RETURN / INVESTIGATE: go and see
    this.stimulus.set(position.x, base, position.z);
    this._invPanel = n.source === 'panel';
    if (s !== 'INVESTIGATE') {
      this._setState('INVESTIGATE');
      this._invSub = 'go';
      if (this._invPanel) this._say(this.rng() < 0.5 ? 'step_away' : 'fixing', { force: true }) || this._say('fixing', { force: true });
      else if (sprint) this._say('no_running');
      else this._say('what_was_that', { chance: 0.75 });
    } else if (this._invSub !== 'go') this._invSub = 'go';
  }

  /** Chasing, unseen: a noise through a wall only moves her target to that room's doorway (or centre). */
  _chaseHeard(position) {
    const world = this.game.world;
    const base = floorBaseY(FLOOR);
    const pos = this.object.position;
    _v1.set(position.x, base + 1.0, position.z);
    if (los(world, this._eye, _v1)) return this.lkp.set(position.x, base, position.z);
    const room = world.getRoomAt?.(position.x, position.z, FLOOR);
    const mine = world.getRoomAt?.(pos.x, pos.z, FLOOR);
    if (!room || room === mine) return this.lkp.set(position.x, base, position.z);
    let best = null;
    let bestS = Infinity;
    for (const d of world.doors || []) {
      if (!d.position || d.active === false || d.isLocked || (d.floor ?? 0) !== FLOOR) continue;
      if (d.roomA !== room && d.roomB !== room) continue;
      const sc = hdist(pos, d.position) + hdist(d.position, position);
      if (sc < bestS) {
        bestS = sc;
        best = d;
      }
    }
    if (!best) {
      const c = room.center || position;
      return this.lkp.set(c.x, base, c.z);
    }
    const nn = best.n || { x: 0, z: 0 };
    let sx = best.position.x + nn.x * 0.9;
    let sz = best.position.z + nn.z * 0.9;
    if (world.getRoomAt(sx, sz, FLOOR) !== room) {
      sx = best.position.x - nn.x * 0.9;
      sz = best.position.z - nn.z * 0.9;
    }
    this.lkp.set(sx, base, sz);
  }

  _onHideEnter({ spot } = {}) {
    if (!spot || this.remote || !this.enabled) return;
    const sp = spot.exitPosition || spot.position;
    if (!sp || floorOfPos(this.game.world, sp) !== FLOOR) return;
    // the saw-you-hide rule (the Caretaker's): hiding within 1.5 s of being seen → straight to that spot
    if (this._time - this._lastSeenTime <= 1.5 && (this._state === 'FOLLOW' || this._state === 'CHASE' || this._state === 'INVESTIGATE')) {
      this._seenHide = spot;
    }
  }

  // ============================================================================= brain
  _think(dt, world, p) {
    if (this._founderSeq) return this._tickFounder(dt);
    switch (this._state) {
      case 'IDLE':
        return this._setState('PATROL');
      case 'PATROL':
        return this._thinkPatrol(dt, world, p);
      case 'INVESTIGATE':
        return this._thinkInvestigate(dt, world, p);
      case 'FOLLOW':
        return this._thinkFollow(dt, world, p);
      case 'CHASE':
        return this._thinkChase(dt, world, p);
      case 'ATTACK':
        return this._thinkAttack(dt, world, p);
      case 'SEARCH':
        return this._thinkSearch(dt, world, p);
      case 'RETURN':
        return this._thinkReturn(dt, world, p);
      case 'STAIRS':
        return this._thinkStairs(dt, world, p);
      default:
        return undefined;
    }
  }

  /** Seen enough to start following (first time this run: "Senpai~! There you are!"). */
  _spot(p) {
    const d = hdist(this.object.position, p.position);
    if (!this._greeted) {
      this._greeted = true;
      this._say('there_you_are', { force: true });
    }
    this.events?.emit('enemy:sighting', { who: WHO, position: this.object.position.clone() });
    this._setState(d <= A.followMin && this._state === 'INVESTIGATE' ? 'CHASE' : 'FOLLOW');
  }

  _thinkPatrol(dt, world, p) {
    if (p && this._visible && this.meter >= 0.35) return this._spot(p);
    this._humT -= dt;
    if (this._humT <= 0) {
      this._humT = 12 + this.rng() * 13;
      this._say('hum');
    }
    if (this._patrolSub === 'pick') {
      const pt = this._pickPatrol(world);
      if (!pt) {
        this._patrolSub = 'pause';
        this._pauseT = 3;
        return;
      }
      this._goTo(pt, 'walk', 0.6);
      this._patrolSub = 'walk';
    } else if (this._patrolSub === 'walk') {
      if (this.moveStatus === 'arrived' || this.moveStatus === 'failed' || this.moveStatus === 'idle') {
        this._patrolSub = 'pause';
        this._pauseT = 2 + this.rng() * 2.5;
        this._pauseAnim = this.rng() < 0.45 ? 'look_around' : 'idle';
        this._stopMove();
      }
    } else if (this._patrolSub === 'pause') {
      this._pauseT -= dt;
      if (this._pauseT <= 0) this._patrolSub = 'pick';
    }
  }

  _patrolPts(world) {
    const c = this._ppCache;
    const src = world.floors?.[FLOOR]?.patrolPoints;
    if (c && c.src === src && c.len === (src?.length ?? 0)) return c.out;
    const out = floorList(world, FLOOR, 'patrolPoints');
    this._ppCache = { src, len: src?.length ?? 0, out };
    return out;
  }

  _pickPatrol(world) {
    const pts = this._patrolPts(world);
    if (!pts.length) return null;
    // now and then she visits the Art room (her "friends")
    if (this.rng() < 0.15) {
      const art = world.floor2?.anchor?.('art-circle');
      if (art?.position && hdist(art.position, this.object.position) > 6) return art.position;
    }
    const pos = this.object.position;
    for (let k = 0; k < 12; k++) {
      const q = pts[(this.rng() * pts.length) | 0];
      if (hdist(q, pos) >= 8 && this.nav.passableXZ(q.x, q.z)) return q;
    }
    return pts[(this.rng() * pts.length) | 0];
  }

  _nearestPatrol() {
    const pts = this.game.world ? this._patrolPts(this.game.world) : [];
    let best = null;
    let bd = Infinity;
    for (const q of pts) {
      const d = hdist(q, this.object.position);
      if (d < bd && d > 1) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  _thinkInvestigate(dt, world, p) {
    if (p && this._visible && this.meter >= 0.3) return this._spot(p);
    if (this._invSub === 'go') {
      this._goTo(this.stimulus, 'fast', 0.9);
      if (this.moveStatus === 'arrived' || this.moveStatus === 'failed' || hdist(this.object.position, this.stimulus) < 1.2 || this._stateTime > 30) {
        this._stopMove();
        this._invSub = 'look';
        this._lookT = 3 + this.rng() * 2;
      }
    } else {
      this._lookT -= dt;
      if (this._lookT <= 0) this._setState(this._nearestPatrol() && hdist(this._nearestPatrol(), this.object.position) > 4 ? 'RETURN' : 'PATROL');
    }
  }

  _thinkFollow(dt, world, p) {
    if (!p) return this._setState('SEARCH');
    const pos = this.object.position;
    this._followT += dt;
    if (p.isHidden) return this._lostToHide();
    if (this._visible) this._lostT = 0;
    else {
      this._lostT += dt;
      if (this._lostT > A.lostFollow) {
        this.events?.emit('enemy:lost', { who: WHO });
        return this._setState('SEARCH');
      }
    }
    const d = hdist(pos, p.position);
    // closing in, a sprint away while she sees you, or she's had enough of following → CHASE
    const away = this._visible && p.isSprinting && p.velocity && (p.velocity.x * (p.position.x - pos.x) + p.velocity.z * (p.position.z - pos.z)) > 0;
    if (d <= A.chaseAt || away || this._followT > this._followLimit) {
      if (away) this._say('why_running', { force: true });
      return this._setState('CHASE');
    }
    const goal = this._visible ? p.position : this.lkp;
    if (this._watched && d <= A.followMax) {
      // you're looking at her: she stops, smiles and waves
      this._stopMove();
      this._setFace(p.position);
      this._waving = true;
      this.meter = Math.min(1, this.meter + dt * 0.2);
      // a goal line where it fits (where you are, what you still lack), otherwise a wave and "Hiii~"
      const gl = this._goalLine(p);
      if (!(gl && this._say(gl, { chance: 0.6 }))) this._say('hi');
    } else {
      this._waving = false;
      // you aren't: she comes closer (keeps up at walking pace if you're far and watching)
      this._goTo(goal, this._watched ? 'walk' : 'follow', 0.8);
      if (!this._watched && this.rng() < dt * 0.12) this._say('giggle');
    }
  }

  _lostToHide() {
    // you hid. Whether she saw it is the saw-you-hide rule; otherwise she searches around where you were.
    this.events?.emit('enemy:lost', { who: WHO });
    this._setState('SEARCH');
  }

  _thinkChase(dt, world, p) {
    if (!p) return this._setState('SEARCH');
    const pos = this.object.position;
    this._waving = false;
    if (p.isHidden) return this._lostToHide();
    const d = hdist(pos, p.position);
    if (this._visible) {
      this._lostT = 0;
      this._broke = false;
      // lead prediction like the Caretaker's (only to a cell she can stand on)
      const v = p.velocity;
      const lead = clamp(d / 8, 0, 0.6);
      _v1.set(p.position.x + (v ? v.x * lead : 0), floorBaseY(FLOOR), p.position.z + (v ? v.z * lead : 0));
      if (d < 3 || !this.nav.passableXZ(_v1.x, _v1.z)) _v1.set(p.position.x, floorBaseY(FLOOR), p.position.z);
      this.lkp.copy(_v1);
      if (d > 6 && v && v.x * (p.position.x - pos.x) + v.z * (p.position.z - pos.z) > 0) this._say('come_back');
      // in reach with a clear line between the two bodies → the lunge
      if (d <= A.attackAt && this._time - this._lastAttackT >= A.attackCooldown && this._bodyLos(world, p)) return this._startAttack(p);
    } else {
      this._lostT += dt;
      if (!this._broke) {
        this._broke = true;
        this._say('dont_leave');
      }
      if (this._lostT > A.lostChase) {
        this.events?.emit('enemy:lost', { who: WHO });
        return this._setState('SEARCH');
      }
    }
    this._goTo(this.lkp, 'run', 0.3);
    // can't get to you (a gap she can't fit, behind a counter): come as close as she can, then give up
    const there = this.moveStatus === 'arrived' || this.moveStatus === 'failed' || (this.pathCount && hdist(pos, this.pathEnd) < 0.6);
    if (this._pathPartial && this._pathGap > 0.6 && there) {
      this._standoffT += dt;
      this._setFace(p.position);
      if (this._standoffT > 3) {
        this.events?.emit('enemy:lost', { who: WHO });
        return this._setState('SEARCH');
      }
    } else this._standoffT = 0;
  }

  _bodyLos(world, p) {
    const pos = this.object.position;
    _v1.set(pos.x, pos.y + 1.0, pos.z);
    _v2.set(p.position.x, (p.position.y || 0) + 1.0, p.position.z);
    return los(world, _v1, _v2);
  }

  _startAttack(p) {
    this._setState('ATTACK');
    this._stopMove();
    this._lastAttackT = this._time;
    this._attack = { t: 0, p, checked: false };
    this._setFace(p.position);
    this.yaw = yawTo(p.position.x - this.object.position.x, p.position.z - this.object.position.z);
    this.object.rotation.y = this.yaw;
    this.anim?.playOnce?.('attack', { fade: 0.08, fallbackDuration: A.attackDur });
    this._say('attack', { force: true });
    this.events?.emit('enemy:attack', { who: WHO, phase: 'lunge', position: this.object.position });
  }

  _thinkAttack(dt, world) {
    const a = this._attack;
    if (!a) return this._setState('CHASE');
    a.t += dt;
    const p = a.p;
    const pos = this.object.position;
    // the lunge: a short burst forward with collision (never through anything), stopping short of you
    if (a.t < A.hitAt) {
      const d = hdist(pos, p.position);
      if (d > 0.45) {
        const fx = -Math.sin(this.yaw);
        const fz = -Math.cos(this.yaw);
        const step = Math.min(3.2 * dt, d - 0.45);
        const moved = this.mover.step(world, fx * step, fz * step);
        this._actualSpeed = moved / Math.max(dt, 1e-4);
      }
    } else if (!a.checked) {
      a.checked = true;
      // the hit check: still within 1.2 m, ±60° in front of her, on her floor, strict LOS, not hidden
      const d = hdist(pos, p.position);
      const ang = Math.abs(wrapAngle(yawTo(p.position.x - pos.x, p.position.z - pos.z) - this.yaw));
      const ok = p.alive !== false && !p.isHidden && d <= A.hitRange && ang <= A.hitCone && floorOfPos(world, p.position) === FLOOR && this._bodyLos(world, p);
      if (ok) {
        this.events?.emit('enemy:attack', { who: WHO, phase: 'hit', position: pos });
        return this._catch(p, null);
      }
      a.missed = true;
      this.events?.emit('enemy:attack', { who: WHO, phase: 'miss', position: pos });
      // the sting fades on a miss (audio.js; see Requests) — free the voice for the giggle
      this._voiceBusyUntil = Math.min(this._voiceBusyUntil, this._time + 0.5);
      this._say('giggle', { force: true });
    }
    if (a.t >= A.attackDur) this._setState('CHASE');
  }

  _catch(p, spot) {
    if (this._captureEmitted) return;
    this._target = p;
    this._setState('CATCH');
    this._stopMove();
    this._captureEmitted = true;
    this.capturedFromHide = spot;
    this._faceOverride = 'blank';
    this._faceHold = 99;
    this.events?.emit('enemy:capture', { who: WHO, target: p, targetId: targetId(this.game, p) });
  }

  // ---------------------------------------------------------------- search
  _floorSpots(world) {
    const c = this._hsCache;
    const src = world.floors?.[FLOOR]?.hidingSpots;
    if (c && c.src === src && c.len === (src?.length ?? 0)) return c.out;
    const out = floorList(world, FLOOR, 'hidingSpots');
    this._hsCache = { src, len: src?.length ?? 0, out };
    return out;
  }

  /** Up to 3 hiding spots near where she lost you, by distance and how recently she checked them — never by
   *  whether anyone is inside (she doesn't know). A spot she saw you get into goes first. */
  _planSearch() {
    const world = this.game.world;
    const c = this._hasLkp ? this.lkp : this.object.position;
    const scored = [];
    for (const s of world ? this._floorSpots(world) : []) {
      const e = s.exitPosition || s.position;
      const d = hdist(e, c);
      if (d > 12) continue;
      const last = this._checked.get(s) ?? -1e9;
      scored.push({ s, score: d + (this._time - last < 60 ? 6 : 0) + this.rng() * 2 });
    }
    scored.sort((a, b) => a.score - b.score);
    const plan = scored.slice(0, 3).map((x) => ({ spot: x.s }));
    if (this._seenHide) {
      const sh = this._seenHide;
      for (let i = plan.length - 1; i >= 0; i--) if (plan[i].spot === sh) plan.splice(i, 1);
      plan.unshift({ spot: sh });
      this._seenHide = null;
    }
    if (plan.length < 2) {
      for (let k = 0; k < 2; k++) {
        const pt = new THREE.Vector3();
        if (this.nav.nav && this.nav.randomPointNear(c.x, c.z, 4 + k * 3, pt, this.rng)) plan.push({ point: pt.setY(floorBaseY(FLOOR)) });
      }
    }
    this._search = { plan, i: 0, phase: 'go', t: 0, end: this._time + 15 + this.rng() * 7 };
  }

  _thinkSearch(dt, world, p) {
    if (p && this._visible && this.meter >= 0.3) {
      this._say('found_you', { chance: 0.5 });
      return this._setState('CHASE');
    }
    const s = this._search;
    if (!s || this._time > s.end || s.i >= s.plan.length) {
      this._say('pout', { force: true });
      return this._setState('RETURN');
    }
    const step = s.plan[s.i];
    const next = () => {
      s.i++;
      s.phase = 'go';
      s.t = 0;
    };
    if (step.point) {
      if (s.phase === 'go') {
        this._goTo(step.point, 'walk', 0.6);
        if (this.moveStatus === 'arrived' || this.moveStatus === 'failed') {
          s.phase = 'look';
          s.t = 2 + this.rng();
          this._stopMove();
        }
      } else if ((s.t -= dt) <= 0) next();
      return;
    }
    const spot = step.spot;
    const ex = spot.exitPosition || spot.position;
    if (s.phase === 'go') {
      this._goTo(ex, 'fast', 0.4);
      const d = hdist(this.object.position, ex);
      if (d < 0.6 || ((this.moveStatus === 'arrived' || this.moveStatus === 'failed') && d < 1.0)) {
        this._stopMove();
        s.phase = 'stand';
        s.t = 0.5 + this.rng() * 0.6;
        // a bark she uses at any spot, empty or not
        this._say('breathing', { chance: 0.3 });
      } else if (this.moveStatus === 'failed' || this._stateTime > 60) next();
    } else if (s.phase === 'stand') {
      this._setFace(spot.front || spot.position);
      if ((s.t -= dt) <= 0 && !(spot.anim >= 0)) {
        spot.playDoor?.();
        s.phase = 'open';
        s.t = 0.4;
        this._searchAnimT = 1.0;
      }
    } else if (s.phase === 'open') {
      this._setFace(spot.front || spot.position);
      if ((s.t -= dt) <= 0) {
        this._checked.set(spot, this._time);
        // only now does she find out whether anyone is in there
        const list = candidateTargets(this.game, FLOOR, world, this._srchCands || (this._srchCands = []));
        const inside = list.find((q) => q.isHidden && q.hidingSpot === spot);
        if (inside) {
          s.phase = 'found';
          s.t = 0.9;
          s.who = inside;
          this._faceOverride = 'blank';
          this._faceHold = 2;
          this._say('i_found_you', { force: true });
        } else next();
      }
    } else if (s.phase === 'found') {
      if ((s.t -= dt) <= 0) this._catch(s.who, spot);
    }
  }

  _thinkReturn(dt, world, p) {
    if (p && this._visible && this.meter >= 0.35) return this._spot(p);
    this._humT -= dt;
    if (this._humT <= 0) {
      this._humT = 12 + this.rng() * 13;
      this._say('hum');
    }
    if (this.moveStatus === 'arrived' || this.moveStatus === 'failed' || this.moveStatus === 'idle' || this._stateTime > 40) this._setState('PATROL');
  }

  // ---------------------------------------------------------------- top of the stairs
  /** Her target (FOLLOW / CHASE / ATTACK) went down a staircase: she stops at the top and never follows. */
  _checkStairs(prev, p, world) {
    if (this._state === 'STAIRS') return false;
    const hunting = this._state === 'FOLLOW' || this._state === 'CHASE' || this._state === 'ATTACK';
    const t = prev || p;
    if (!hunting || !t || t.alive === false) return false;
    const sw = inStairwell(t.position.x, t.position.z);
    if (!sw) return false;
    const below = floorOfPos(world, t.position) !== FLOOR || t.position.y < floorBaseY(FLOOR) - 0.25;
    const ci = this.nav.index(t.position.x, t.position.z);
    const onFlight = ci >= 0 && this.nav.nav?.zone?.[ci] === 1;
    if (!below && !onFlight) return false;
    this._setState('STAIRS');
    this._stairs = { id: sw, t: 0, at: new THREE.Vector3(t.position.x, floorBaseY(FLOOR), t.position.z), said: false, target: t };
    this._goTo(this._stairs.at, 'fast', 0.6); // the mover stops at the nearest cell she can stand on
    return true;
  }

  _thinkStairs(dt, world, p) {
    const st = this._stairs;
    if (!st) return this._setState('SEARCH');
    st.t += dt;
    const t = st.target;
    // back up the stairs and in view → after them again
    if (t && t.alive !== false && floorOfPos(world, t.position) === FLOOR && !inStairwell(t.position.x, t.position.z) && p === t && this._visible) return this._setState('CHASE');
    const there = this.moveStatus === 'arrived' || this.moveStatus === 'failed' || this.moveStatus === 'idle';
    if (there) {
      this._stopMove();
      this._setFace(st.at);
      if (!st.said) {
        st.said = true;
        this._say('downstairs', { force: true });
      }
    }
    if (st.t > A.stairWait) {
      const others = candidateTargets(this.game, FLOOR, world, this._srchCands || (this._srchCands = [])).length > 0;
      this._setState(others ? 'SEARCH' : 'RETURN');
    }
  }

  // ============================================================================= voice
  /** One line at a time: per-line cooldowns, a minimum gap, never two lines overlapping. force = queue it
   *  (for a moment) behind the line that's playing instead of dropping it. */
  /** The goal-pointing line for where this player is: a shut stairwell, the Security Office, or no staff card yet. */
  _goalLine(p) {
    try {
      const g = this.game;
      const f2 = g.world?.floor2;
      const st = g.floor2?.state;
      if (!f2 || !st || !p?.position) return null;
      const near = (id, r) => {
        const a = f2.anchor?.(id)?.position;
        return !!a && Math.hypot(a.x - p.position.x, a.z - p.position.z) < r;
      };
      if ((!st.stairA && near('stair-a-door', 10)) || (!st.stairB && near('stair-b-gate', 10))) return 'stairs_closed';
      if (near('security-pc', 9)) return 'security_office';
      if (!st.card?.found) return 'staff_card';
    } catch {}
    return null;
  }

  _say(line, { chance = 1, force = false } = {}) {
    if (this.remote) return false;
    if (chance < 1 && this.rng() > chance) return false;
    const t = this._time;
    if (t - (this._voiceT[line] ?? -1e9) < (LINE_CD[line] ?? 10)) return false;
    if (line === 'hum' && !this.game.audio?.hasFile?.('assistant_hum')) return false; // no recording yet: silent
    if (t < this._voiceBusyUntil) {
      if (force) this._voiceQueue = { line, until: t + 2.5 };
      return false;
    }
    this._emitLine(line);
    return true;
  }

  _emitLine(line) {
    const t = this._time;
    this._voiceT[line] = t;
    const dur = Number(this.game.audio?.speechDuration?.('assistant_' + line));
    this._voiceBusyUntil = t + (Number.isFinite(dur) && dur > 0 ? dur : LINE_LEN[line] ?? 2) + VOICE_GAP;
    if (line === 'giggle' || line === 'hi') {
      this._faceOverride = 'happy';
      this._faceHold = 1.4;
    }
    this.events?.emit('enemy:voice', { who: WHO, line, position: this.headPosition });
  }

  _voiceTick() {
    const q = this._voiceQueue;
    if (!q) return;
    if (this._time > q.until) this._voiceQueue = null;
    else if (this._time >= this._voiceBusyUntil) {
      this._voiceQueue = null;
      if (this._time - (this._voiceT[q.line] ?? -1e9) >= (LINE_CD[q.line] ?? 10)) this._emitLine(q.line);
    }
  }

  // ============================================================================= look & feel
  _updateFace(dt) {
    let want;
    if (this._faceOverride && this._faceHold > 0) {
      this._faceHold -= dt;
      want = this._faceOverride;
      if (this._faceHold <= 0) this._faceOverride = null;
    } else if (this._state === 'CATCH') want = 'blank';
    else if (this._state === 'CHASE' || this._state === 'ATTACK') want = 'grin';
    else if (this._state === 'STAIRS') want = 'blank';
    else if (this._waving && this._state === 'FOLLOW') want = 'happy';
    else want = 'smile';
    if (want !== this._face) this._setFaceTex(want);
  }

  _footsteps() {
    const pos = this.object.position;
    const moved = hdist(pos, this._lastPos);
    this._lastPos.copy(pos);
    if (moved > 1) return; // (a respawn, not a step)
    this._stepAcc += moved;
    const running = this._actualSpeed > 2.4;
    const stride = running ? 1.15 : 0.62;
    if (this._stepAcc >= stride) {
      this._stepAcc = 0;
      this._footPos.copy(pos);
      this.events?.emit('enemy:footstep', { who: WHO, position: this._footPos, running });
    }
  }

  _animName() {
    if (this._state === 'CATCH' || this._remoteCap) return 'capture';
    if (this._attack) return 'attack';
    if (this._founderSeq || this._state === 'STAIRS') return 'stare';
    if (this._doorAnimT > 0 && this._doorWait) return 'open_door';
    if (this._actualSpeed > 0.2 || (this.moveStatus === 'moving' && this.speed > 0.15)) {
      if (this.goalMode === 'run' && this.speed > 2.2) return 'run';
      return this._state === 'RETURN' ? 'return' : 'walk';
    }
    if (this._waving) return 'wave';
    if ((this._searchAnimT = (this._searchAnimT || 0) - 1 / 60) > 0) return 'search';
    if (this._state === 'INVESTIGATE' && this._invSub === 'look') return 'investigate';
    if (this._state === 'PATROL' && this._patrolSub === 'pause') return this._pauseAnim || 'idle';
    return 'idle';
  }

  _animate(dt) {
    const want = this._remoteAnim || this._animName();
    if (this.anim && this.anim.has?.(want)) {
      if (want !== this._wantAnim || this.anim.requested !== want) this.anim.play(want, { fade: want === 'run' || this._wantAnim === 'run' ? 0.2 : 0.35 });
      if (want === 'walk' || want === 'run' || want === 'return') this.anim.syncToSpeed?.(Math.max(this._actualSpeed, this.speed * 0.8));
      this.anim.update?.(dt);
    }
    this._wantAnim = want;
    if (this._ph) this._animatePlaceholder(dt, want);
  }

  /** The placeholder's procedural poses for the planned clips. */
  _animatePlaceholder(dt, want) {
    const ph = this._ph;
    const sp = Math.max(this._actualSpeed, 0);
    ph.phase += dt * (want === 'run' ? 9 : 6.5) * clamp(sp / 1.4, 0.3, 1.6);
    const s = Math.sin(ph.phase);
    const walking = want === 'walk' || want === 'run' || want === 'return';
    const amp = want === 'run' ? 0.9 : walking ? 0.45 : 0;
    ph.legs[0].rotation.x = s * amp;
    ph.legs[1].rotation.x = -s * amp;
    const L = ph.arms[0];
    const R = ph.arms[1];
    let lx = -s * amp * 0.8;
    let rx = s * amp * 0.8;
    let lz = 0.08;
    let rz = -0.08;
    if (want === 'wave') {
      rx = -0.2;
      rz = -2.6 + Math.sin(this._time * 9) * 0.35;
    } else if (want === 'attack' || want === 'capture') {
      lx = rx = -1.45;
      lz = 0.25;
      rz = -0.25;
    } else if (want === 'return') {
      lx = rx = 0.55; // hands clasped behind her back
      lz = -0.2;
      rz = 0.2;
    } else if (want === 'search' || want === 'open_door') {
      rx = -1.2;
    }
    const k = clamp(dt * 12, 0, 1);
    L.rotation.x = lerp(L.rotation.x, lx, k);
    R.rotation.x = lerp(R.rotation.x, rx, k);
    L.rotation.z = lerp(L.rotation.z, lz, k);
    R.rotation.z = lerp(R.rotation.z, rz, k);
    // a lean into the lunge, a tilt of the head while she stares
    const lean = want === 'attack' ? 0.35 : want === 'run' ? 0.15 : 0;
    this.model.rotation.x = lerp(this.model.rotation.x, -lean, k);
    ph.head.rotation.z = lerp(ph.head.rotation.z, want === 'stare' || want === 'wave' ? 0.22 : 0, clamp(dt * 4, 0, 1));
    // head turns toward what she's looking at
    if (this._hasLook) {
      const ly = clamp(wrapAngle(yawTo(this._lookTarget.x - this.object.position.x, this._lookTarget.z - this.object.position.z) - this.yaw), -1.1, 1.1);
      ph.head.rotation.y = lerp(ph.head.rotation.y, ly, clamp(dt * 5, 0, 1));
    }
  }

  _updateThreat(dt, game) {
    let target = 0;
    const pl = game.player;
    const alive = game.coop?.active ? game.coop.status === 'alive' : true;
    if (pl && alive && this.enabled && floorOfPos(game.world, pl.position) === FLOOR) {
      const d = hdist(this.object.position, pl.position);
      const mine = !game.coop?.active || this._target === pl;
      switch (this._state) {
        case 'CHASE':
        case 'ATTACK':
          target = mine && d < 25 ? 1 : 0.4;
          break;
        case 'FOLLOW':
          target = mine ? lerp(0.65, 0.3, clamp(d / 16, 0, 1)) : 0.2;
          break;
        case 'SEARCH':
        case 'STAIRS':
          target = d < 12 ? 0.35 : 0.1;
          break;
        case 'INVESTIGATE':
          target = d < 10 ? 0.25 : 0;
          break;
        default:
          target = d < 6 && this._visible ? 0.2 : 0;
      }
    }
    this._threat += clamp(target - this._threat, -dt * 0.8, dt * 2);
  }

  // ============================================================================= capture
  /** Solo: her face close, the blank expression, "Let's stay together… forever." (~2.8 s). */
  runCaptureSequence(camera) {
    if (this._captureSeq) return this._captureSeq.promise;
    if (this._state !== 'CATCH') this._catch(this._target || this.game.player, null);
    const pl = this.game.player;
    if (pl?.isHidden && typeof pl.exitHide === 'function') {
      try {
        pl.exitHide();
      } catch (err) {
        console.warn('[assistant] exitHide failed', err);
      }
    }
    const seq = { camera, t: 0, dur: 2.8, q0: camera.quaternion.clone(), said: false, done: false, resolve: null };
    seq.promise = new Promise((r) => (seq.resolve = r));
    this._captureSeq = seq;
    camera.getWorldPosition(_v1);
    const pos = this.object.position;
    this.yaw = yawTo(_v1.x - pos.x, _v1.z - pos.z);
    this.object.rotation.y = this.yaw;
    this._faceOverride = 'blank';
    this._faceHold = 99;
    this._setFaceTex('blank');
    this._lastUpdateMs = 0;
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

  updateCapture(dt) {
    if (!this._captureSeq) return;
    this._lastUpdateMs = performance.now();
    this._captureTick(Math.min(dt, 0.1));
  }

  _captureTick(dt) {
    const seq = this._captureSeq;
    if (!seq || seq.done) return;
    seq.t += dt;
    const cam = seq.camera;
    const world = this.game.world;
    const pos = this.object.position;
    cam.getWorldPosition(_v1);
    // she steps in close (with collision: never through a desk or a door)
    const dx = _v1.x - pos.x;
    const dz = _v1.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.62 && world) {
      const step = Math.min(d - 0.62, 2.2 * dt);
      this.mover.step(world, (dx / d) * step, (dz / d) * step);
    }
    this.yaw = yawTo(dx, dz);
    this.object.rotation.y = this.yaw;
    this._updateEye();
    if (!seq.said && seq.t > 0.5) {
      seq.said = true;
      this._voiceBusyUntil = -1;
      this._voiceT.forever = -1e9;
      this._emitLine('forever');
    }
    // the camera turns to her face
    _m1.lookAt(_v1, this.headPosition, cam.up);
    _q1.setFromRotationMatrix(_m1);
    cam.quaternion.copy(seq.q0).slerp(_q1, clamp(seq.t / 0.9, 0, 1));
    this._animate(dt);
    if (seq.t >= seq.dur) {
      seq.done = true;
      seq.resolve?.();
    }
  }

  /** Co-op host: she caught someone else (their screen runs the close-up). */
  remoteCapture(position) {
    if (position) this._setFace(position);
    this._remoteCap = true;
    if (this._state !== 'CATCH') this._setState('CATCH');
  }

  /** Co-op host: done with a capture; back toward her rounds, ignoring everyone for `grace` seconds. */
  releaseCapture(grace = 6) {
    this._captureSeq = null;
    this._captureEmitted = false;
    this.capturedFromHide = null;
    this._remoteCap = false;
    this._faceOverride = null;
    this._faceHold = 0;
    this.meter = 0;
    this._hasLkp = false;
    this._seenHide = null;
    this._visible = false;
    this._target = null;
    this._graceT = grace;
    if (this._state === 'CATCH') this._setState('RETURN');
  }

  /** Co-op guest: the local close-up is over; the puppet follows the host again. */
  endCapture() {
    this._captureSeq = null;
    this._captureEmitted = false;
    this.capturedFromHide = null;
  }

  // ============================================================================= co-op
  /** The host's Assistant in 16 numbers. Flags: 1 lunging, 2 waving, 4 LOS, 16 founder stare. [15] = face. */
  netSnapshot(slotOf) {
    if (!this.enabled && !this.object.visible) return null;
    const p = this.object.position;
    const r2 = (n) => Math.round(n * 100) / 100;
    const si = STATES.indexOf(this._state);
    const ai = ANIMS.indexOf(this._wantAnim);
    const t = this._lookTarget;
    const flags = (this._attack ? 1 : 0) | (this._waving ? 2 : 0) | (this._los ? 4 : 0) | (this._founderSeq ? 16 : 0);
    const slot = slotOf ? slotOf(this._target) : -1;
    return [
      r2(p.x), r2(p.z), Math.round(this.yaw * 1000) / 1000, si < 0 ? 0 : si, ai < 0 ? 0 : ai,
      r2(this._actualSpeed || 0), this.goalMode === 'run' ? 1 : 0,
      r2(t.x), r2(t.y), r2(t.z), this._hasLook ? 1 : 0, r2(this.meter || 0), flags,
      Number.isFinite(slot) ? slot : -1, r2(p.y), Math.max(0, FACES.indexOf(this._face)),
    ];
  }

  static _decode(d) {
    return {
      x: d[0], z: d[1], yaw: d[2], state: STATES[d[3]] || 'PATROL', anim: ANIMS[d[4]] || 'idle', spd: d[5], run: d[6] === 1,
      lx: d[7], ly: d[8], lz: d[9], hasLook: d[10] === 1, meter: d[11], flags: d[12] | 0, tgt: d[13],
      y: d[14], face: FACES[d[15] | 0] || 'smile',
    };
  }

  /** Co-op guest: one 'es' snapshot from the host (sentAt = host clock ms). → true if accepted. */
  applySnapshot(arr, sentAt) {
    if (arr == null) return false;
    const ok = this.puppet.push(arr, sentAt);
    if (ok && !this.object.visible) {
      this.object.visible = true;
      this.object.position.set(arr[0], arr[14], arr[1]);
      this._lastPos.copy(this.object.position);
    }
    return ok;
  }

  _updatePuppet(dt, game) {
    this._time += dt;
    const n = game.net?.now?.() ?? game.coop?.room?.now?.();
    const s = this.puppet.size ? this.puppet.sample(Number.isFinite(n) ? n : performance.now()) : null;
    if (s) {
      this.puppet.follow(game.world, s, dt);
      this.yaw = s.yaw;
      this.object.rotation.y = s.yaw;
      this._state = s.state;
      this._actualSpeed = s.spd;
      this.speed = s.spd;
      this.goalMode = s.run ? 'run' : 'walk';
      this._remoteAnim = s.anim;
      this._waving = !!(s.flags & 2);
      if (s.hasLook) this._setLook(_v2.set(s.lx, s.ly, s.lz));
      if (s.face !== this._face) this._setFaceTex(s.face);
    }
    this._updateEye();
    this._footsteps();
    this._animate(dt);
    // threat on this screen from the puppet's state
    this._updateThreat(dt, game);
  }

  // ============================================================================= possession (NET)
  // Director Mode (multiplayer.md §5.4), host only, like the Caretaker's: her own mover (collision, her
  // floor, the stair guard: she can't go down), her own lunge and hit check, her attack cooldown.
  get possessedBy() {
    return this._possession?.by ?? null;
  }

  /** id → a Director drives her; null → back to her AI from where she stands (SEARCH). */
  setPossessed(id, reason) {
    if (this.remote) return false;
    const P = (this._possession ||= new Possession());
    const by = id == null || id === '' ? null : String(id);
    if (by === P.by) return true;
    if (by && (this._state === 'CATCH' || this._captureSeq)) return false;
    P.set(by, this._time);
    if (by) {
      this._stopMove();
      this._attack = null;
    } else {
      const pos = this.object.position;
      this.lkp.set(pos.x, floorBaseY(FLOOR), pos.z);
      this._attack = null;
      this._waving = false;
      if (this._state !== 'CATCH') this._setState('SEARCH');
    }
    this.events?.emit('enemy:possessed', { who: WHO, by, ...(reason ? { reason } : {}) });
    return true;
  }

  /** { mx, mz, yaw, pitch, run, action } from the possessing Director (by). */
  applyInput(input, by) {
    if (this.remote || !this._possession) return false;
    return this._possession.apply(input, by, this._time, this.yaw);
  }

  /** Her lunge on the nearest visible player in reach (her rules: range, strict body LOS, her floor,
   *  cooldown, not hidden). ok = the lunge started; the hit check ~0.35 s later can still miss. */
  tryAttack(by) {
    const P = this._possession;
    if (!P?.active || (by != null && by !== P.by)) return { ok: false, reason: 'not-possessed' };
    if (this._attack || this._state === 'CATCH' || this._captureSeq) return { ok: false, reason: 'cooldown' };
    if (this._time - this._lastAttackT < A.attackCooldown) return { ok: false, reason: 'cooldown' };
    const world = this.game.world;
    const list = candidateTargets(this.game, FLOOR, world, this._possCands || (this._possCands = [])).filter((p) => !p.isHidden);
    if (!list.length) return { ok: false, reason: this.game.player && floorOfPos(world, this.game.player.position) !== FLOOR ? 'floor' : 'no-target' };
    let best = null;
    let bd = Infinity;
    for (const p of list) {
      const d = hdist(this.object.position, p.position);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (bd > A.attackAt) return { ok: false, reason: 'range' };
    if (!this._bodyLos(world, best)) return { ok: false, reason: 'los' };
    this._startAttack(best);
    return { ok: true, lunge: true, targetId: targetId(this.game, best) };
  }

  /** The door in front of her (≤ 1.6 m, her floor, not locked): open it, or close it if open. */
  _possDoor(world) {
    const pos = this.object.position;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let best = null;
    let bd = 1.6;
    for (const d of world?.doors || []) {
      if (!d.position || d.active === false || d.isLocked || (d.floor ?? 0) !== FLOOR) continue;
      const dx = d.position.x - pos.x;
      const dz = d.position.z - pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd < bd && (fx * dx + fz * dz) / Math.max(dd, 1e-3) > 0.3) {
        bd = dd;
        best = d;
      }
    }
    if (!best) return false;
    return best.isOpen ? best.close?.('enemy') : best.open?.('enemy');
  }

  _updatePossessed(dt, game, world) {
    const P = this._possession;
    const inp = P.input;
    const act = inp.action;
    inp.action = null;
    if (this._attack) this._thinkAttack(dt, world);
    else if (act === 'attack') this.tryAttack(P.by);
    else if (act === 'open-door') this._possDoor(world);
    else if (act === 'look') this._searchAnimT = 1.2;
    else if (act === 'wave') this._waveUntil = this._time + 1.6;
    this._waving = this._time < (this._waveUntil || 0) && !this._attack;
    if (this._state !== 'CATCH' && !this._attack) this.mover.drive(dt, world, inp, this._speedFor('walk'), this._speedFor('run'), 4);
    else this._locomoteSafe(dt, world);
    this._updateEye();
    this._footsteps();
    this._updateFace(dt);
    this._animate(dt);
    this._updateThreat(dt, game);
  }

  dispose() {
    for (const u of this._unsubs) u?.();
    this._unsubs.length = 0;
    this.object.parent?.remove(this.object);
  }
}
