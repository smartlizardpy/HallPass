// LAST BELL — first-person player controller (S3). Implements CONTRACTS.md §8.
//
//   const player = new Player(game);  // adds game.camera to game.scene if needed, builds the torch
//   player.spawn(world.playerSpawn.position, world.playerSpawn.yaw);
//   player.enabled = true;            // only while game.state === 'playing'
//   player.lockPointer();             // ONLY from a user gesture (ui:start / ui:resume handlers)
//   player.update(dt, game);          // every frame (writes the camera only while enabled && alive)
//
// Readable state (contract): position (feet; y = the walking surface: 0 downstairs, 3.6 upstairs, a ramp on the stairs), eyePosition, velocity, yaw, pitch,
//   isCrouching, isSprinting, isMoving, isHidden, hidingSpot, stamina 0..1, noiseLevel 0..1,
//   flashlightOn, alive, inventory, focused, enabled.
// Extensions:
//   exhausted (bool)        stamina hit 0; slower, no sprint, heavy breathing until 30 %
//   holdingBreath (bool)    hidden + holding Space / right mouse; breath 0..1 is the capacity left
//   isLocked (bool)         pointer lock state
//   surface (string)        floor under the player: 'lino'|'tile'|'wood'|'concrete'|'carpet'
//   flashlight (SpotLight), viewmodel (Group)  — the torch (castShadow only on quality 'high')
//   setFlashlight(on), setViewmodelVisible(bool), reset() (= spawn state + empty inventory)
//   allowUnlockedLook, addLook(dx, dy), setKey(code, down)   — test hooks (pointer lock is
//                                                             unavailable in headless browsers)
//   seated (bool)           co-op: locked in Room 000 — look around, no moving, no using things
// Events emitted: player:footstep {position, surface, speed}, noise {position, radius, source},
//   player:stamina-empty {}, hide:enter {spot}, hide:exit {spot}, inventory:changed {items},
//   ui:pause {} (pointer lock lost while playing), player:flashlight {on}*, player:breath {holding}*,
//   player:lock {locked}*, player:lock-failed {}*
// Events consumed: settings:change, lights:flicker, game:state (beforeunload guard only)
//
// Notes for integration
// * Collision only through world.moveCircle(pos, delta, PLAYER.radius).
// * The torch viewmodel is a child of the camera rendered LAST (transparent pass, renderOrder
//   1000) and clears the depth buffer right before it draws, so it never clips into walls.
//   Its materials are compiled without spot lights (so the beam doesn't flood it); the SpotLight
//   sits ~0.13 m from the eye, inside PLAYER.radius, so it can never end up behind a wall.
// * Torch: flashlightBaseIntensity (16) is tuned for postfx exposure 1.25; castShadow only on 'high'.
//   Never toggles light.visible (that recompiles every shader) — intensity goes to 0 instead.
// * The torch/viewmodel hide themselves on game:state menu/loading/won/lost.
// * Player owns camera.fov (settings.fov + a small sprint kick) — game.js should not set fov.
// * Hide interactables (world) should call game.player.enterHide(spot) from interact().

import * as THREE from './lib/three/three.module.js';
import { PLAYER, QUALITY } from './config.js';
import { loadGLB, cloneGLB, ps1ify, addVertexSnap } from './assets.js';

const SURFACE_BY_ROOM = {
  corridor: 'tile',
  classroom: 'lino',
  science_lab: 'tile',
  library: 'carpet',
  toilets: 'tile',
  stairwell: 'concrete',
  reception: 'carpet',
  storage: 'concrete',
  room000: 'wood',
};
const NOISE_RADIUS = { crouch: 2, walk: 6, sprint: 14 };
const SURFACE_NOISE = { tile: 1.1, lino: 1, wood: 1.1, concrete: 1.05, carpet: 0.7 };
const STEP_LENGTH = { crouch: 0.62, walk: 0.8, sprint: 1.12 };
const BOB_AMP = { crouch: 0.016, walk: 0.03, sprint: 0.052 };

const SPRINT_SECONDS = 6.5;      // full bar of sprinting
const ADRENALINE_DRAIN = 0.7;    // while the caretaker is chasing you, sprint drains slower (~9 s bar)
const REGEN_DELAY = 1.1;         // s after sprinting stops
const EXHAUST_RECOVER = 0.3;     // exhausted until stamina ≥ 30 %
const BREATH_SECONDS = 8;        // max breath hold
const SPACE_HOLD = 0.22;         // s: tap = leave hiding place, hold = hold breath
const HIDE_ENTER_TIME = 0.55;
const HIDE_EXIT_TIME = 0.45;
const HIDE_YAW_LIMIT = 0.6;      // rad around spot.yaw
const HIDE_PITCH_LIMIT = 0.32;
const MOUSE_BASE = 0.0022;       // rad per pixel at sensitivity 1
const PITCH_LIMIT = 1.45;

const VIEW_OFFSET = new THREE.Vector3(0.12, -0.13, -0.2);

// The torch beam starts behind the viewmodel, so the viewmodel's materials are compiled without the
// spot-light block (three.js has no per-object light masks). World point/hemi/ambient lights still apply.
const LIGHTS_NO_SPOT = THREE.ShaderChunk.lights_fragment_begin.replace(
  '#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )',
  '#if 0 /* viewmodel ignores spot lights */',
);
function ignoreSpotLights(mat) {
  if (LIGHTS_NO_SPOT === THREE.ShaderChunk.lights_fragment_begin) return; // chunk changed upstream: skip
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer) {
    prev?.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', LIGHTS_NO_SPOT);
  };
  mat.customProgramCacheKey = function () {
    return `${prevKey ? prevKey.call(this) : ''}|nospot`;
  };
  mat.needsUpdate = true;
}

/** Material.clone() drops onBeforeCompile but keeps userData, so re-apply the PS1 vertex snap. */
// Beta feedback: the yellow plastic torch looked like a toy. Its body is recoloured to dark gunmetal:
// the texture is converted to greyscale (keeping the grip detail) and tinted.
const TORCH_BODY = /torch_plastic/i;
const TORCH_BODY_TINT = 0x4a4e55;
const _greyMaps = new Map();
function greyscaleMap(tex) {
  if (!tex?.image) return tex;
  if (_greyMaps.has(tex)) return _greyMaps.get(tex);
  let out = tex;
  try {
    const img = tex.image;
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height);
    const a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      const y = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
      a[i] = a[i + 1] = a[i + 2] = y;
    }
    ctx.putImageData(d, 0, 0);
    out = new THREE.CanvasTexture(cv);
    out.flipY = tex.flipY;
    out.colorSpace = tex.colorSpace;
    out.wrapS = tex.wrapS;
    out.wrapT = tex.wrapT;
    out.magFilter = tex.magFilter;
    out.minFilter = tex.minFilter;
    out.channel = tex.channel;
    out.offset.copy(tex.offset);
    out.repeat.copy(tex.repeat);
  } catch { /* keep the original map */ }
  _greyMaps.set(tex, out);
  return out;
}

function clonePS1(m) {
  const c = m.clone();
  if (m.userData?.__ps1snap) {
    delete c.userData.__ps1snap;
    addVertexSnap(c);
  }
  return c;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Inventory {
  constructor(events) {
    this.items = [];
    this._events = events;
  }
  has(id) {
    return this.items.includes(id);
  }
  add(id) {
    if (!id || this.has(id)) return false;
    this.items.push(id);
    this._emit();
    return true;
  }
  remove(id) {
    const i = this.items.indexOf(id);
    if (i < 0) return false;
    this.items.splice(i, 1);
    this._emit();
    return true;
  }
  clear() {
    if (!this.items.length) return;
    this.items.length = 0;
    this._emit();
  }
  get count() {
    return this.items.length;
  }
  _emit() {
    this._events?.emit('inventory:changed', { items: [...this.items] });
  }
}

export class Player {
  constructor(game) {
    this.game = game;
    this.camera = game.camera;
    this.events = game.events;
    this.settings = game.settings || {};
    this.dom = game.renderer?.domElement || document.body;

    // ---- readable state
    this.position = new THREE.Vector3();
    this.eyePosition = new THREE.Vector3(0, PLAYER.eyeHeight, 0);
    this.floorAware = true; // feet follow world.groundAt: stairs and Floor 2 work (world.floor2Enabled)
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.isCrouching = false;
    this.isSprinting = false;
    this.isMoving = false;
    this.isHidden = false;
    this.hidingSpot = null;
    this.stamina = 1;
    this.exhausted = false;
    this.breath = 1;
    this.holdingBreath = false;
    this.noiseLevel = 0;
    this.flashlightOn = true;
    this.alive = true;
    this.enabled = false;
    this.isLocked = false;
    this.surface = 'lino';
    this.focused = null;
    this.inventory = new Inventory(this.events);
    // game.inventory may be a getter onto game.player (not assigned yet) — never let that throw
    try {
      const own = Object.getOwnPropertyDescriptor(game, 'inventory');
      const proto = Object.getPrototypeOf(game);
      const accessor = proto && Object.getOwnPropertyDescriptor(proto, 'inventory');
      if (!own && !accessor) game.inventory = this.inventory;
    } catch {
      /* read-only on this game object */
    }

    // ---- test hooks
    this.allowUnlockedLook = false;
    // tablets (touch.js): analog move + run from the virtual stick, breath from a held button
    this.touchMode = false;
    this._touchMove = { x: 0, y: 0, run: false };

    // ---- internals
    this._keys = new Set();
    this._lookDX = 0;
    this._lookDY = 0;
    this._crouchToggle = false;
    this._eyeH = PLAYER.eyeHeight;
    this._stepDist = 0;
    this._bobPhase = 0;
    this._bobAmp = 0;
    this._sinceSprint = 10;
    this._frame = 0;
    this._time = 0;
    this._hideAnim = null;
    this._spaceDownAt = -1;
    this._spaceUsedForBreath = false;
    this._rmb = false;
    this._breathNoiseT = 2;
    this._pantNoiseT = 0;
    this._fov = this.settings.fov || 72;
    this._wasLocked = false;
    this._intentionalUnlock = false;
    this._flashWasOn = true;
    this._swayYaw = 0;
    this._swayPitch = 0;
    this._lastYaw = 0;
    this._lastPitch = 0;
    this._flicker = { next: 25 + Math.random() * 30, t: 0, dur: 0, depth: 1 };
    this._vmClearFrame = -1;

    // scratch vectors (no allocations in update)
    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._delta = new THREE.Vector3();

    this.camera.rotation.order = 'YXZ';
    if (!this.camera.parent && game.scene) game.scene.add(this.camera);

    this._buildTorch();
    this._bindInput();
    this._subs = [
      this.events?.on('settings:change', ({ settings } = {}) => {
        if (settings) this.settings = settings;
        this._applyQuality();
      }),
      this.events?.on('torch:upgrade', () => this.setTorchLevel(2)),
      this.events?.on('lights:flicker', ({ intensity = 0.5 } = {}) => {
        if (Math.random() < 0.35 + intensity * 0.5) this._startFlicker(0.25 + intensity * 0.6, 0.5 + intensity * 0.5);
      }),
      // no torch in the menu attract camera / loading; back on when a run starts
      this.events?.on('game:state', ({ state } = {}) => {
        if (state === 'menu' || state === 'loading' || state === 'boot' || state === 'won' || state === 'lost') {
          this.viewmodel.visible = false;
          this.flashlight.intensity = 0;
          this._hideLens();
        } else if (state === 'playing') {
          this.viewmodel.visible = true;
        }
      }),
    ].filter(Boolean);
    this._applyQuality();
    this.ready = this._loadViewmodel();
  }

  // ================================================================ torch ==
  _buildTorch() {
    // camera ─ sway (lags behind the view) ─┬─ viewmodel (torch model)
    //                                        ├─ spot light (at the lens)
    //                                        └─ spot target (converges on screen centre)
    this.sway = new THREE.Group();
    this.sway.name = 'player_sway';
    this.camera.add(this.sway);

    this.viewmodel = new THREE.Group();
    this.viewmodel.name = 'player_viewmodel';
    this.viewmodel.position.copy(VIEW_OFFSET);
    this.sway.add(this.viewmodel);

    this.flashlight = new THREE.SpotLight(0xfff0da, 0, 24, 0.5, 0.62, 1.5);
    this.flashlight.name = 'player_flashlight';
    // The beam starts close to the eye on purpose: it must stay inside the player's collision
    // circle (PLAYER.radius 0.3 m), otherwise near a wall the light would sit beyond it and leak
    // into the next room (no shadows below 'high').
    this.flashlight.position.set(0.1, -0.09, -0.08);
    this.flashlight.shadow.mapSize.set(512, 512);
    this.flashlight.shadow.camera.near = 0.15;
    this.flashlight.shadow.camera.far = 24;
    this.flashlight.shadow.bias = -0.0006;
    this.flashlight.shadow.normalBias = 0.02;
    this.sway.add(this.flashlight);
    this.flashlight.target.position.set(0.0, -0.08, -7);
    this.sway.add(this.flashlight.target);
    // candela-ish (physically based lights). Raised from 16 when postfx exposure went 1.25 -> 1.0.
    this.torchLevel = 1;
    this._torchBase = 20;
    this.flashlightBaseIntensity = this._torchBase;

    this._setViewmodelObject(this._fallbackTorch());
  }

  _fallbackTorch() {
    const g = new THREE.Group();
    g.name = 'flashlight_fallback';
    const body = new THREE.MeshLambertMaterial({ color: 0x2b2b2a, emissive: 0x0b0b0b });
    const lensMat = new THREE.MeshLambertMaterial({ color: 0xfff2cc, emissive: 0xfff0c0, emissiveIntensity: 1 });
    lensMat.userData.isLens = true;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 8), body);
    grip.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.018, 0.05, 10), body);
    head.rotation.x = Math.PI / 2;
    head.position.z = -0.085;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), lensMat);
    lens.position.z = -0.111;
    lens.name = 'flashlight_lens';
    g.add(grip, head, lens);
    return g;
  }

  async _loadViewmodel() {
    try {
      const gltf = await loadGLB('assets/items/flashlight.glb');
      const root = cloneGLB(gltf.scene);
      ps1ify(root);
      this._setViewmodelObject(root, true);
      return true;
    } catch (err) {
      console.info('[player] torch model unavailable, using fallback', err?.message || err);
      return false;
    }
  }

  _setViewmodelObject(obj, fromGLB = false) {
    if (this._vmObject) this.viewmodel.remove(this._vmObject);
    this._vmObject = obj;
    if (fromGLB) {
      // torch is ~0.21 m long with the origin at the grip; a hand + sleeve trail back/right
      obj.scale.setScalar(0.7);
      obj.rotation.set(0.04, 0.1, 0);
    }
    const self = this;
    const clearOnce = function (renderer) {
      const f = renderer.info.render.frame;
      if (self._vmClearFrame !== f) {
        self._vmClearFrame = f;
        renderer.clearDepth();
      }
    };
    this._lensMaterials = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.renderOrder = 1000;
      o.frustumCulled = false;
      o.castShadow = false;
      o.receiveShadow = false;
      o.onBeforeRender = clearOnce;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        const c = clonePS1(m);
        ignoreSpotLights(c);
        if (TORCH_BODY.test(m.name || '')) {
          if (c.map) c.map = greyscaleMap(c.map);
          c.color?.setHex(TORCH_BODY_TINT);
        }
        c.transparent = true;
        c.depthWrite = true;
        c.depthTest = true;
        c.fog = false;
        const isLens = m.userData?.isLens || /lens|glow|bulb/i.test(m.name || '') || /lens/i.test(o.name);
        if (isLens) {
          c.userData.isLens = true;
          this._lensMaterials.push(c);
        } else if (c.emissive) {
          // just enough self-light to read the shape in the dark (linear values: 0.016 ≈ 13 % sRGB)
          if (c.map && !c.emissiveMap) c.emissiveMap = c.map;
          if (c.map) c.emissive.setRGB(0.03, 0.028, 0.026);
          else c.emissive.copy(c.color).multiplyScalar(0.03);
          c.emissiveIntensity = 1;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });
    this.viewmodel.add(obj);

    // (the light is not moved to the model's flashlight_lens node: see _buildTorch)
  }

  _hideLens() {
    for (const m of this._lensMaterials || []) if (m.emissive) m.emissiveIntensity = 0.1;
  }

  /** 1 = standard, 2 = fresh batteries: brighter, reaches further, a little wider. */
  setTorchLevel(level) {
    this.torchLevel = level >= 2 ? 2 : 1;
    const up = this.torchLevel === 2;
    this.flashlightBaseIntensity = this._torchBase * (up ? 1.45 : 1);
    this.flashlight.distance = up ? 32 : 24;
    this.flashlight.angle = up ? 0.56 : 0.5;
  }

  setViewmodelVisible(v) {
    this.viewmodel.visible = !!v;
  }

  setFlashlight(on, { silent = false } = {}) {
    on = !!on;
    if (on === this.flashlightOn) return;
    this.flashlightOn = on;
    if (!silent) this.events?.emit('player:flashlight', { on });
  }

  _applyQuality() {
    const q = QUALITY[this.settings.quality] || QUALITY.medium;
    const want = !!q.shadows && this.settings.quality === 'high';
    if (this.flashlight.castShadow !== want) this.flashlight.castShadow = want;
  }

  _startFlicker(dur, depth) {
    const f = this._flicker;
    if (f.t > 0) return;
    // Photosensitivity: one to three slow dips, each held >= 0.18 s (at most ~3 changes a second),
    // never below 20 %. Reduced effects: a single soft dim.
    const segs = [];
    if (this.settings.reducedEffects) {
      segs.push({ d: 0.5, k: 1 - Math.min(depth, 0.3) });
    } else {
      const n = 1 + Math.floor(Math.random() * Math.min(3, 1 + dur * 3));
      for (let i = 0; i < n; i++) {
        segs.push({ d: 0.18 + Math.random() * 0.14, k: Math.max(0.2, 1 - depth * (0.55 + Math.random() * 0.4)) });
        if (i < n - 1) segs.push({ d: 0.2 + Math.random() * 0.2, k: 1 });
      }
    }
    f.segs = segs;
    f.i = 0;
    f.segT = segs[0].d;
    f.t = f.dur = segs.reduce((a, s) => a + s.d, 0);
    f.depth = depth;
  }

  _updateTorch(dt, game) {
    // sway: the torch lags behind fast look changes, plus idle drift and step bob
    const dYaw = wrapAngle(this.yaw - this._lastYaw);
    const dPitch = this.pitch - this._lastPitch;
    this._lastYaw = this.yaw;
    this._lastPitch = this.pitch;
    const reduced = !!this.settings.reducedEffects;
    const swayK = reduced ? 0.5 : 1;
    this._swayYaw = clamp(this._swayYaw + dYaw * 0.55 * swayK, -0.14, 0.14);
    this._swayPitch = clamp(this._swayPitch + dPitch * 0.55 * swayK, -0.12, 0.12);
    const back = damp(7, dt);
    this._swayYaw -= this._swayYaw * back;
    this._swayPitch -= this._swayPitch * back;
    const t = this._time;
    const idle = reduced ? 0.3 : 1;
    const ex = this.exhausted ? 2.4 : 1;
    this.sway.rotation.set(
      -this._swayPitch + Math.sin(t * 1.3) * 0.004 * idle * ex,
      -this._swayYaw + Math.sin(t * 0.7) * 0.006 * idle,
      0,
    );
    const bob = this._bobAmp;
    this.viewmodel.position.set(
      VIEW_OFFSET.x + Math.sin(this._bobPhase) * bob * 0.35,
      VIEW_OFFSET.y - Math.abs(Math.sin(this._bobPhase)) * bob * 0.45 + Math.sin(t * 1.9) * 0.0018 * ex,
      VIEW_OFFSET.z + (this.isSprinting ? 0.02 : 0),
    );
    // hidden: torch lowered out of view
    const lower = this.isHidden || this._hideAnim ? 1 : 0;
    this._vmLower = (this._vmLower || 0) + (lower - (this._vmLower || 0)) * damp(8, dt);
    this.viewmodel.position.y -= this._vmLower * 0.25;

    // flicker
    const f = this._flicker;
    let k = 1;
    if (f.t > 0) {
      f.t -= dt;
      f.segT -= dt;
      while (f.segT <= 0 && f.i < f.segs.length - 1) {
        f.i++;
        f.segT += f.segs[f.i].d;
      }
      k = f.segs[f.i]?.k ?? 1;
      if (f.t <= 0) {
        f.t = 0;
        k = 1;
      }
    } else {
      f.next -= dt;
      const threat = game?.enemy?.getThreat?.() || 0;
      if (threat > 0.6) f.next -= dt * 2; // flickers more when he's close
      if (f.next <= 0) {
        f.next = 30 + Math.random() * 45;
        this._startFlicker(0.2 + Math.random() * 0.7, 0.55 + Math.random() * 0.45);
      }
    }
    const on = this.flashlightOn && !this.isHidden;
    const target = on ? this.flashlightBaseIntensity * clamp(k, 0, 1) : 0;
    // quick ramp so toggling doesn't pop (and never toggles .visible: that recompiles shaders)
    this.flashlight.intensity += (target - this.flashlight.intensity) * damp(on ? 30 : 40, dt);
    const glow = this.flashlight.intensity / this.flashlightBaseIntensity;
    for (const m of this._lensMaterials) {
      if (m.emissive) m.emissiveIntensity = 0.1 + glow * 1.4;
    }
  }

  // ================================================================ input ==
  _bindInput() {
    const doc = document;
    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      const c = e.code;
      if (e.ctrlKey && c !== 'ControlLeft' && c !== 'ControlRight') e.preventDefault(); // Ctrl+S/D/A while crouching
      if (c === 'Space' || c.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this._keys.add(c);
      this._keyPressed(c);
    };
    this._onKeyUp = (e) => {
      const c = e.code;
      this._keys.delete(c);
      if (c === 'Space') this._spaceReleased();
      // C held down long enough = hold-to-crouch: stand up on release
      if (c === 'KeyC' && this._crouchToggle && this._crouchDownAt >= 0 && this._time - this._crouchDownAt > 0.35) this._crouchToggle = false;
    };
    this._onMouseMove = (e) => {
      if (!this.enabled || (!this.isLocked && !this.allowUnlockedLook)) return;
      if (this.touchMode) return; // touch drags arrive through addLook (and taps fire stray mouse moves)
      // filter the occasional huge spike some browsers report right after locking
      const dx = clamp(e.movementX || 0, -260, 260);
      const dy = clamp(e.movementY || 0, -260, 260);
      this._lookDX += dx;
      this._lookDY += dy;
    };
    this._onMouseDown = (e) => {
      if (e.button === 2) this._rmb = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 2) this._rmb = false;
    };
    this._onContext = (e) => {
      if (this.enabled) e.preventDefault();
    };
    this._onBlur = () => {
      this._keys.clear();
      this._rmb = false;
      this._spaceDownAt = -1;
    };
    this._onLockChange = () => {
      const locked = doc.pointerLockElement === this.dom;
      const was = this.isLocked;
      this.isLocked = locked;
      if (locked !== was) this.events?.emit('player:lock', { locked });
      if (!locked && was) {
        this._keys.clear();
        this._rmb = false;
        if (!this._intentionalUnlock && this.enabled && this.game.state === 'playing') this.events?.emit('ui:pause', {});
      }
      this._intentionalUnlock = false;
    };
    this._onLockError = () => {
      this.isLocked = false;
      this.events?.emit('player:lock-failed', {});
    };
    this._onBeforeUnload = (e) => {
      if (this.enabled && this.game.state === 'playing') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    doc.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('blur', this._onBlur);
    this.dom.addEventListener('contextmenu', this._onContext);
    doc.addEventListener('pointerlockchange', this._onLockChange);
    doc.addEventListener('pointerlockerror', this._onLockError);
    window.addEventListener('beforeunload', this._onBeforeUnload);
  }

  _keyPressed(c) {
    switch (c) {
      case 'KeyC':
        // tap = toggle; hold (> 0.35 s) = crouch until released (see _onKeyUp). Ctrl is NOT a crouch
        // key: Ctrl+W (crouch-walking) is the browser's close-tab shortcut, which a page can't block.
        if (!this.isHidden) {
          this._crouchToggle = !this._crouchToggle;
          this._crouchDownAt = this._crouchToggle ? this._time : -1;
        }
        break;
      case 'KeyE':
        this.interact();
        break;
      case 'KeyF':
        if (!this.isHidden && !this._hideAnim) this.setFlashlight(!this.flashlightOn);
        break;
      case 'KeyG':
        // a carried gadget (Kaan's PlayStation): computers.js puts it down and switches it on
        if (!this.isHidden && !this._hideAnim) this.events?.emit('player:gadget', {});
        break;
      case 'Space':
        this._spaceDownAt = this._time;
        this._spaceUsedForBreath = false;
        break;
      default:
        break;
    }
  }

  _spaceReleased() {
    const held = this._spaceDownAt >= 0 ? this._time - this._spaceDownAt : 0;
    const usedForBreath = this._spaceUsedForBreath;
    this._spaceDownAt = -1;
    this._spaceUsedForBreath = false;
    if (!this.enabled) return;
    if (this.isHidden && !this._hideAnim && held < SPACE_HOLD && !usedForBreath) this.exitHide();
  }

  /** Test hook: simulate a key press/release by KeyboardEvent.code. */
  setKey(code, down) {
    if (down) {
      if (this._keys.has(code)) return;
      this._keys.add(code);
      if (this.enabled) this._keyPressed(code);
    } else {
      this._keys.delete(code);
      if (code === 'Space') this._spaceReleased();
    }
  }

  /** Touch mode (touch.js): no pointer lock, look comes from addLook(). */
  setTouchMode(on) {
    this.touchMode = !!on;
    this.allowUnlockedLook = !!on;
  }

  /** Virtual stick: x = right, y = forward, both -1..1; run = pushed to the rim. */
  setTouchMove(x, y, run = false) {
    this._touchMove.x = x || 0;
    this._touchMove.y = y || 0;
    this._touchMove.run = !!run;
  }

  setTouchBreath(held) {
    this._rmb = !!held;
  }

  /** Test hook / gamepad bridge: add mouse-pixel look deltas. */
  addLook(dx, dy) {
    this._lookDX += dx;
    this._lookDY += dy;
  }

  /** Full stamina (the vending machine can). */
  refillStamina() {
    this.stamina = 1;
    this.exhausted = false;
  }

  /** Full stamina and `seconds` of sprinting that doesn't drain it (the döner). */
  boost(seconds = 20) {
    this.refillStamina();
    this._boostT = Math.max(this._boostT || 0, seconds);
  }

  get boostLeft() {
    return this._boostT || 0;
  }

  lockPointer() {
    if (this.touchMode) return Promise.resolve(true); // tablets: no pointer lock at all
    const el = this.dom;
    if (this.isLocked || document.pointerLockElement === el) return Promise.resolve(true);
    if (!el.requestPointerLock) {
      this.events?.emit('player:lock-failed', {});
      return Promise.resolve(false);
    }
    try {
      const r = el.requestPointerLock();
      if (r && typeof r.then === 'function') {
        return r.then(
          () => true,
          () => {
            this.events?.emit('player:lock-failed', {});
            return false;
          },
        );
      }
      return Promise.resolve(true); // legacy: result arrives via pointerlockchange/pointerlockerror
    } catch {
      this.events?.emit('player:lock-failed', {});
      return Promise.resolve(false);
    }
  }

  unlockPointer() {
    this._keys.clear();
    if (document.pointerLockElement) {
      this._intentionalUnlock = true;
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
  }

  _down(...codes) {
    for (const c of codes) if (this._keys.has(c)) return true;
    return false;
  }

  // ================================================================ floors ==
  /** Which floor a position is on (0 ground, 1 upstairs). */
  _floorOf(pos) {
    const w = this.game?.world;
    try { return w?.floorOf ? w.floorOf(pos) : 0; } catch { return 0; }
  }

  /** Walking-surface height at (x, z) on floor f: 0 or 3.6, or the ramp height on the stairs. */
  _groundY(x, z, f) {
    const w = this.game?.world;
    try { return w?.groundAt ? w.groundAt(x, z, f) : 0; } catch { return 0; }
  }

  // ================================================================ spawn ==
  spawn(position, yaw = 0) {
    if (this.hidingSpot) this.hidingSpot.occupied = false;
    const sx = position?.x || 0, sz = position?.z || 0;
    this.position.set(sx, this._groundY(sx, sz, this._floorOf(position)), sz);
    this.yaw = yaw;
    this.pitch = 0;
    this._lastYaw = yaw;
    this._lastPitch = 0;
    this.velocity.set(0, 0, 0);
    this.stamina = 1;
    this.exhausted = false;
    this._boostT = 0;
    this.breath = 1;
    this.holdingBreath = false;
    this.isCrouching = false;
    this._crouchToggle = false;
    this.isSprinting = false;
    this.isMoving = false;
    this.isHidden = false;
    this.hidingSpot = null;
    this._hideAnim = null;
    this.noiseLevel = 0;
    this.focused = null;
    this.alive = true;
    this.seated = false;
    this._eyeH = PLAYER.eyeHeight;
    this._stepDist = STEP_LENGTH.walk * 0.5;
    this._bobAmp = 0;
    this._lookDX = this._lookDY = 0;
    this._keys.clear();
    this.flashlightOn = true;
    this.viewmodel.visible = true;
    this.surface = this._surfaceAt(this.position.x, this.position.z);
    this._placeCamera(0);
  }

  reset() {
    this.spawn(this.position, this.yaw);
    this.inventory.clear();
    this.setTorchLevel(1);
  }

  // ================================================================ update ==
  update(dt, game = this.game) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    this._time += dt;
    this._frame++;
    if (game) this.game = game;

    if (!this.enabled || !this.alive) {
      this._lookDX = this._lookDY = 0;
      this.isMoving = false;
      this.isSprinting = false;
      this.noiseLevel += (0 - this.noiseLevel) * damp(4, dt);
      this._updateTorch(dt, game);
      return;
    }

    this._applyLook();

    if (this.seated) {
      // co-op: sitting on the floor of Room 000 (or the Art room's circle upstairs), waiting for a friend
      this.isMoving = false;
      this.isSprinting = false;
      this.isCrouching = false;
      this._crouchToggle = false;
      this.velocity.set(0, 0, 0);
      this.noiseLevel += (0 - this.noiseLevel) * damp(4, dt);
      this.focused = null;
      this._eyeH = 0.95;
      this.eyePosition.set(this.position.x, this.position.y + 0.95, this.position.z);
      this.camera.position.copy(this.eyePosition);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      this._updateTorch(dt, game);
      return;
    }

    if (this._hideAnim) {
      this._updateHideAnim(dt);
      this._updateTorch(dt, game);
      return;
    }

    if (this.isHidden) this._updateHidden(dt);
    else this._updateMove(dt, game);

    this._placeCamera(dt);
    this._updateTorch(dt, game);
    if (!this.isHidden && (this._frame % 3 === 0 || this.focused === null)) this._updateFocus(game);
  }

  _applyLook() {
    const sens = MOUSE_BASE * (this.settings.sensitivity || 1);
    const inv = this.settings.invertY ? -1 : 1;
    this.yaw = wrapAngle(this.yaw - this._lookDX * sens);
    this.pitch = clamp(this.pitch - this._lookDY * sens * inv, -PITCH_LIMIT, PITCH_LIMIT);
    this._lookDX = this._lookDY = 0;
    if (this.isHidden && this.hidingSpot && !this._hideAnim) {
      const base = this.hidingSpot.yaw || 0;
      const d = clamp(wrapAngle(this.yaw - base), -HIDE_YAW_LIMIT, HIDE_YAW_LIMIT);
      this.yaw = wrapAngle(base + d);
      this.pitch = clamp(this.pitch, -HIDE_PITCH_LIMIT, HIDE_PITCH_LIMIT);
    }
  }

  _updateMove(dt, game) {
    let fwdIn = (this._down('KeyW', 'ArrowUp') ? 1 : 0) - (this._down('KeyS', 'ArrowDown') ? 1 : 0);
    let sideIn = (this._down('KeyD', 'ArrowRight') ? 1 : 0) - (this._down('KeyA', 'ArrowLeft') ? 1 : 0);
    // virtual stick (tablets): analog direction, speed follows how far it is pushed
    let analog = 1;
    const tm = this._touchMove;
    const touchMoving = this.touchMode && (tm.x !== 0 || tm.y !== 0);
    if (touchMoving) {
      fwdIn = tm.y;
      sideIn = tm.x;
      analog = Math.min(1, Math.hypot(tm.x, tm.y) / 0.8);
    }
    const runHeld = this._down('ShiftLeft', 'ShiftRight') || (touchMoving && tm.run);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    let wx = -sy * fwdIn + cy * sideIn;
    let wz = -cy * fwdIn - sy * sideIn;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }

    this.isCrouching = this._crouchToggle;
    if (this.isCrouching && runHeld && fwdIn > 0 && !this.exhausted) {
      // pressing sprint stands you up
      this._crouchToggle = false;
      this.isCrouching = false;
    }
    const wantSprint = runHeld && fwdIn > 0 && !this.isCrouching && !this.exhausted && this.stamina > 0;

    let speed = this.isCrouching ? PLAYER.crouchSpeed : wantSprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (this.exhausted && !this.isCrouching) speed *= 0.72;
    if (fwdIn < 0) speed *= 0.82; // backing up is slower
    speed *= analog;

    const tx = wx * speed;
    const tz = wz * speed;
    const k = damp(wl > 0 ? (wantSprint ? 6 : 9) : 11, dt);
    this.velocity.x += (tx - this.velocity.x) * k;
    this.velocity.z += (tz - this.velocity.z) * k;
    this.velocity.y = 0;

    const world = game?.world;
    const prevX = this.position.x;
    const prevZ = this.position.z;
    if (this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z > 1e-6) {
      this._delta.set(this.velocity.x * dt, 0, this.velocity.z * dt);
      const fl = this._floorOf(this.position);
      let next = null;
      try {
        next = world?.moveCircle ? world.moveCircle(this.position, this._delta, PLAYER.radius, undefined, fl) : null;
      } catch (err) {
        next = null;
      }
      if (next) this.position.set(next.x, this._groundY(next.x, next.z, fl), next.z);
      else this.position.add(this._delta);
    }
    const mx = this.position.x - prevX;
    const mz = this.position.z - prevZ;
    const moved = Math.hypot(mx, mz);
    if (dt > 0) {
      // blocked: keep only the part of the velocity that actually happened (the wall eats the
      // into-wall component, the tangential slide survives)
      const actual = moved / dt;
      const want = Math.hypot(this.velocity.x, this.velocity.z);
      if (want > actual + 0.05) {
        this.velocity.x = mx / dt;
        this.velocity.z = mz / dt;
      }
    }
    const hSpeed = dt > 0 ? moved / dt : 0;
    this.isMoving = hSpeed > 0.25;
    this.isSprinting = wantSprint && hSpeed > PLAYER.walkSpeed * 0.9;

    // ---- stamina
    if (this._boostT > 0) this._boostT = Math.max(0, this._boostT - dt);
    if (this.isSprinting && this._boostT > 0) {
      this._sinceSprint = 0; // the döner: unlimited sprint while it lasts
    } else if (this.isSprinting) {
      const chased = this.game?.enemy?.state === 'CHASE';
      this.stamina -= (dt / SPRINT_SECONDS) * (chased ? ADRENALINE_DRAIN : 1);
      this._sinceSprint = 0;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        this.events?.emit('player:stamina-empty', {});
      }
    } else {
      this._sinceSprint += dt;
      if (this._sinceSprint > REGEN_DELAY) {
        let rate = this.isMoving ? 1 / 10 : 1 / 5.5;
        if (this.isCrouching) rate *= 1.15;
        if (this.exhausted) rate *= 0.85;
        this.stamina = Math.min(1, this.stamina + rate * dt);
      }
    }
    if (this.exhausted && this.stamina >= EXHAUST_RECOVER) this.exhausted = false;

    // panting is audible
    if (this.exhausted) {
      this._pantNoiseT -= dt;
      if (this._pantNoiseT <= 0) {
        this._pantNoiseT = 1.6;
        this._emitNoise(3.5, 'breath');
      }
    } else this._pantNoiseT = 0;

    // breath refills when not hidden
    this.breath = Math.min(1, this.breath + dt / 4);
    this.holdingBreath = false;

    // ---- footsteps + bob phase
    const mode = this.isCrouching ? 'crouch' : this.isSprinting ? 'sprint' : 'walk';
    const stepLen = STEP_LENGTH[mode];
    if (this.isMoving) {
      this._stepDist += moved;
      this._bobPhase += (moved / stepLen) * Math.PI;
      if (this._stepDist >= stepLen) {
        this._stepDist -= stepLen;
        if (this._stepDist > stepLen) this._stepDist = 0;
        this._footstep(mode);
      }
    } else {
      this._stepDist = Math.max(this._stepDist, stepLen * 0.55);
      // settle the bob back to neutral
      const r = this._bobPhase % Math.PI;
      if (r > 0.01) this._bobPhase += Math.min(Math.PI - r, dt * 4);
    }
    const bobTarget = this.isMoving ? BOB_AMP[mode] * clamp(hSpeed / PLAYER.walkSpeed, 0.4, 1.4) : 0;
    this._bobAmp += (bobTarget - this._bobAmp) * damp(6, dt);

    // ---- noise level 0..1
    let nl = 0;
    if (this.isMoving) nl = mode === 'crouch' ? 0.14 : mode === 'sprint' ? 1 : 0.43;
    if (this.exhausted) nl = Math.min(1, nl + 0.2);
    this.noiseLevel += (nl - this.noiseLevel) * damp(6, dt);
  }

  _footstep(mode) {
    const surface = this._surfaceAt(this.position.x, this.position.z);
    this.surface = surface;
    const pos = this.position.clone();
    this.events?.emit('player:footstep', { position: pos, surface, speed: mode });
    const r = NOISE_RADIUS[mode] * (SURFACE_NOISE[surface] || 1);
    this.events?.emit('noise', { position: pos, radius: r, source: 'footstep' });
  }

  _emitNoise(radius, source) {
    this.events?.emit('noise', { position: this.position.clone(), radius, source });
  }

  _surfaceAt(x, z) {
    let room = null;
    try {
      room = this.game?.world?.getRoomAt?.(x, z) || null;
    } catch {
      room = null;
    }
    if (!room) return 'lino';
    return room.surface || room.floor || SURFACE_BY_ROOM[room.type] || 'lino';
  }

  _placeCamera(dt) {
    const target = this.isHidden ? (this.hidingSpot?.position ? this.hidingSpot.position.y - this.position.y : PLAYER.eyeHeight) : this.isCrouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
    this._eyeH += (target - this._eyeH) * (dt > 0 ? damp(10, dt) : 1);
    const bobOn = this.settings.headBob !== false && !this.isHidden;
    const amp = bobOn ? this._bobAmp * (this.settings.reducedEffects ? 0.5 : 1) : 0;
    const by = Math.sin(this._bobPhase * 2) * amp;
    const bx = Math.sin(this._bobPhase) * amp * 0.6;
    const roll = Math.sin(this._bobPhase) * amp * 0.12;
    let heave = 0;
    if (this.exhausted && !this.settings.reducedEffects) heave = Math.sin(this._time * 2.3) * 0.008;

    this.eyePosition.set(this.position.x, this.position.y + this._eyeH, this.position.z);
    if (this.isHidden && this.hidingSpot?.position) this.eyePosition.copy(this.hidingSpot.position);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    this.camera.position.set(this.eyePosition.x + cy * bx, this.eyePosition.y + by, this.eyePosition.z - sy * bx);
    this.camera.rotation.set(this.pitch + heave, this.yaw, roll);

    // field of view (settings + sprint kick)
    let fov = this.settings.fov || 72;
    if (this.isSprinting && !this.settings.reducedEffects) fov += 5;
    this._fov += (fov - this._fov) * (dt > 0 ? damp(6, dt) : 1);
    if (Math.abs(this.camera.fov - this._fov) > 0.01) {
      this.camera.fov = this._fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ========================================================= interaction ==
  _collectInteractables(game) {
    try {
      if (typeof game?.getInteractables === 'function') return game.getInteractables() || [];
      const a = game?.world?.getInteractables?.() || [];
      const b = game?.items?.getInteractables?.() || [];
      return a.concat(b);
    } catch {
      return [];
    }
  }

  _updateFocus(game) {
    const list = this._collectInteractables(game);
    const eye = this.eyePosition;
    const cp = Math.cos(this.pitch);
    const fwd = this._fwd.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const tanP = Math.tan(this.pitch);
    const world = game?.world;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const p = it?.position;
      if (!p) continue;
      const range = it.range ?? PLAYER.interactRange;
      const hx = p.x - eye.x;
      const hz = p.z - eye.z;
      const hd = Math.hypot(hx, hz);
      if (hd > range + 0.4) continue;
      // tall things (doors, lockers, the exit) are a vertical band; aim anywhere on them
      const tall = it.kind === 'door' || it.kind === 'hide' || it.kind === 'exit';
      let ty = p.y;
      if (tall) ty = clamp(eye.y + tanP * hd, Math.min(p.y, 0.25), Math.max(p.y, 2.1));
      const t = this._v1.set(hx, ty - eye.y, hz);
      const dist = t.length();
      if (dist > range + (tall ? 0.4 : 0)) continue;
      if (dist < 1e-4) continue;
      const cos = t.dot(fwd) / dist;
      const angle = Math.acos(clamp(cos, -1, 1));
      const allowed = clamp(Math.atan2(tall ? 0.55 : 0.42, dist) + 0.12, 0.2, 0.8);
      if (angle > allowed) continue;
      const score = angle * 2 + dist * 0.3;
      if (score >= bestScore) continue;
      let prompt = null;
      try {
        prompt = it.getPrompt ? it.getPrompt(game) : it.kind;
      } catch {
        prompt = null;
      }
      if (!prompt) continue;
      // line of sight; pull the target toward us so the door/locker itself doesn't block it
      if (world?.lineOfSight && hd > 0.5) {
        const pull = tall ? 0.45 : 0.08;
        const s = Math.max(0, (hd - pull) / hd);
        const b = this._v2.set(eye.x + hx * s, ty, eye.z + hz * s);
        let los = true;
        try {
          los = world.lineOfSight(eye, b);
        } catch {
          los = true;
        }
        if (!los) continue;
      }
      best = it;
      bestScore = score;
    }
    this.focused = best;
  }

  interact() {
    if (!this.enabled || !this.alive || this._hideAnim) return false;
    if (this.isHidden) return this.exitHide();
    this._updateFocus(this.game);
    const f = this.focused;
    if (!f || typeof f.interact !== 'function') return false;
    try {
      f.interact(this.game);
    } catch (err) {
      console.error('[player] interact failed', err);
      return false;
    }
    this._frame = 0; // refresh focus next frame (door state / item gone)
    this.focused = null;
    return true;
  }

  // =============================================================== hiding ==
  enterHide(spot) {
    if (!spot || !spot.position || this.isHidden || this._hideAnim || spot.occupied) return false;
    spot.occupied = true;
    this.isHidden = true;
    this.hidingSpot = spot;
    this.isCrouching = false;
    this._crouchToggle = false;
    this.isSprinting = false;
    this.isMoving = false;
    this.velocity.set(0, 0, 0);
    this.focused = null;
    this._flashWasOn = this.flashlightOn;
    if (this.flashlightOn) this.setFlashlight(false);
    this._hideAnim = {
      t: 0,
      dur: HIDE_ENTER_TIME,
      from: this.camera.position.clone(),
      to: spot.position.clone(),
      fromYaw: this.yaw,
      toYaw: spot.yaw ?? this.yaw,
      fromPitch: this.pitch,
      toPitch: 0,
    };
    const hf = this._floorOf(this.position);
    this.position.set(spot.position.x, this._groundY(spot.position.x, spot.position.z, hf), spot.position.z);
    this.events?.emit('hide:enter', { spot });
    return true;
  }

  exitHide() {
    if (!this.isHidden || this._hideAnim) return false;
    const spot = this.hidingSpot;
    const exit = spot?.exitPosition || spot?.position || this.position;
    const exitY = this._groundY(exit.x, exit.z, this._floorOf(this.position));
    this.isHidden = false;
    this.hidingSpot = null;
    this.holdingBreath = false;
    if (spot) spot.occupied = false;
    this._hideAnim = {
      t: 0,
      dur: HIDE_EXIT_TIME,
      from: this.camera.position.clone(),
      to: new THREE.Vector3(exit.x, exitY + PLAYER.eyeHeight, exit.z),
      fromYaw: this.yaw,
      toYaw: this.yaw,
      fromPitch: this.pitch,
      toPitch: this.pitch * 0.5,
      exiting: true,
    };
    this.position.set(exit.x, exitY, exit.z);
    this._eyeH = PLAYER.eyeHeight;
    if (this._flashWasOn) this.setFlashlight(true);
    this.events?.emit('hide:exit', { spot });
    return true;
  }

  _updateHideAnim(dt) {
    const a = this._hideAnim;
    a.t += dt;
    const k = easeInOut(clamp(a.t / a.dur, 0, 1));
    this.camera.position.lerpVectors(a.from, a.to, k);
    this.yaw = wrapAngle(a.fromYaw + wrapAngle(a.toYaw - a.fromYaw) * k);
    this.pitch = a.fromPitch + (a.toPitch - a.fromPitch) * k;
    // a little duck through the door frame
    this.camera.position.y -= Math.sin(Math.PI * k) * 0.12;
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.eyePosition.copy(this.camera.position);
    if (a.t >= a.dur) {
      this._hideAnim = null;
      this._lastYaw = this.yaw;
      this._lastPitch = this.pitch;
      if (a.exiting) {
        this.eyePosition.set(this.position.x, this.position.y + PLAYER.eyeHeight, this.position.z);
      }
    }
  }

  _updateHidden(dt) {
    this.isMoving = false;
    this.isSprinting = false;
    this.velocity.set(0, 0, 0);
    this._bobAmp = 0;
    // stamina keeps recovering in hiding
    this._sinceSprint += dt;
    if (this._sinceSprint > REGEN_DELAY) this.stamina = Math.min(1, this.stamina + dt / 5.5);
    if (this.exhausted && this.stamina >= EXHAUST_RECOVER) this.exhausted = false;

    // hold breath: hold Space (longer than a tap) or the right mouse button
    const spaceHeld = this._spaceDownAt >= 0 && this._time - this._spaceDownAt >= SPACE_HOLD;
    if (spaceHeld) this._spaceUsedForBreath = true;
    const wants = (spaceHeld || this._rmb) && this.breath > 0;
    const was = this.holdingBreath;
    if (wants) {
      this.breath = Math.max(0, this.breath - dt / BREATH_SECONDS);
      this.holdingBreath = this.breath > 0;
      if (!this.holdingBreath) {
        // ran out: gasp
        this._emitNoise(3.2, 'gasp');
      }
    } else {
      this.holdingBreath = false;
      this.breath = Math.min(1, this.breath + dt / 5);
    }
    if (was !== this.holdingBreath) this.events?.emit('player:breath', { holding: this.holdingBreath });

    // quiet breathing can be heard right next to the hiding place
    if (!this.holdingBreath) {
      this._breathNoiseT -= dt;
      if (this._breathNoiseT <= 0) {
        this._breathNoiseT = 3;
        this._emitNoise(this.exhausted ? 3 : 1.6, 'breath');
      }
    }
    const nl = this.holdingBreath ? 0 : this.exhausted ? 0.25 : 0.05;
    this.noiseLevel += (nl - this.noiseLevel) * damp(5, dt);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('blur', this._onBlur);
    this.dom.removeEventListener('contextmenu', this._onContext);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
    window.removeEventListener('beforeunload', this._onBeforeUnload);
    for (const off of this._subs) off();
    this.camera.remove(this.sway);
  }
}
