// LAST BELL — co-op: the other players, drawn as the student avatar (assets/characters/student.glb).
//
//   const avatars = new RemoteAvatars(game);  await avatars.load();
//   avatars.create({ id, name, look });       // one per remote player, at run start (before precompile:
//                                             // each torch is a SpotLight and lights change the shaders)
//   avatars.push(id, t, snapshot);            // network state, t = host clock (room.now())
//   avatars.update(dt, renderTime);           // interpolate, animate, torch, name tag, footsteps
//   avatars.get(id) / remove(id) / clear()
//
// A snapshot is { x, z, yaw, pitch, flags, spd } (flags: see F in coop.js). The look (blazer / skin /
// hair colour, hairstyle) tints the four materials of a per-player clone of the model.

import * as THREE from './lib/three/three.module.js';
import { loadGLB, cloneGLB, ps1ify } from './assets.js';
import { AnimationController } from './animations.js';
import { PLAYER, QUALITY } from './config.js';

export const STUDENT_URL = 'assets/characters/student.glb';

// The student's clips (anim_student.py). speed = ground speed (m/s) at timeScale 1.
const STUDENT_CLIPS = {
  idle: { loop: true, fallback: null },
  walk: { loop: true, speed: 1.5, steps: [0.02, 0.52], fallback: 'idle' },
  run: { loop: true, speed: 4.2, steps: [0.02, 0.52], fallback: 'walk' },
  crouch_idle: { loop: true, fallback: 'idle' },
  crouch_walk: { loop: true, speed: 1.1, steps: [0.02, 0.52], fallback: 'crouch_idle' },
  wave: { loop: false, fallback: 'idle' },
  cower: { loop: true, fallback: 'crouch_idle' },
  sit_trapped: { loop: true, fallback: 'crouch_idle' },
  stand_up: { loop: false, fallback: 'idle' },
};

// Flags in a player snapshot (coop.js sends them).
export const F = { crouch: 1, sprint: 2, moving: 4, torch: 8, hidden: 16, seated: 32, out: 64, caught: 128 };

const SURFACE_BY_ROOM = {
  corridor: 'tile', classroom: 'lino', science_lab: 'tile', library: 'carpet', toilets: 'tile',
  stairwell: 'concrete', reception: 'carpet', storage: 'concrete', room000: 'wood',
};

const TAU = Math.PI * 2;
const wrap = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
const lerpAngle = (a, b, t) => a + wrap(b - a) * t;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);

/** Small interpolation buffer of timestamped snapshots (host clock). */
export class SnapBuffer {
  constructor() {
    this.list = [];
  }
  push(t, s) {
    const L = this.list;
    if (L.length && t <= L[L.length - 1].t) return; // stale / reordered (unreliable channel)
    L.push({ t, s });
    if (L.length > 24) L.shift();
  }
  get latest() {
    return this.list.length ? this.list[this.list.length - 1].s : null;
  }
  /** Interpolated { x, z, yaw, pitch } at time t (holds the last one, extrapolates at most 150 ms). */
  sample(t, out) {
    const L = this.list;
    if (!L.length) return null;
    if (t <= L[0].t) return Object.assign(out, L[0].s);
    for (let i = L.length - 1; i > 0; i--) {
      const a = L[i - 1];
      const b = L[i];
      if (t >= a.t) {
        if (t <= b.t) {
          const k = (t - a.t) / Math.max(1, b.t - a.t);
          Object.assign(out, b.s);
          out.x = a.s.x + (b.s.x - a.s.x) * k;
          out.z = a.s.z + (b.s.z - a.s.z) * k;
          out.yaw = lerpAngle(a.s.yaw, b.s.yaw, k);
          out.pitch = a.s.pitch + (b.s.pitch - a.s.pitch) * k;
          return out;
        }
        break;
      }
    }
    // newer than everything: extrapolate a little from the last two
    const b = L[L.length - 1];
    Object.assign(out, b.s);
    if (L.length > 1) {
      const a = L[L.length - 2];
      const k = Math.min(t - b.t, 150) / Math.max(1, b.t - a.t);
      if (k > 0 && b.s.flags === a.s.flags) {
        out.x = b.s.x + (b.s.x - a.s.x) * k;
        out.z = b.s.z + (b.s.z - a.s.z) * k;
      }
    }
    return out;
  }
}

function nameTexture(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  // a long name shrinks to fit the plate (never squashed sideways); past a readable size it is cut with "…"
  const MAXW = 232;
  let px = 30;
  const font = () => `600 ${px}px ui-monospace, Menlo, monospace`;
  ctx.font = font();
  while (px > 17 && ctx.measureText(name).width > MAXW) {
    px -= 1;
    ctx.font = font();
  }
  let text = name;
  while (text.length > 1 && ctx.measureText(text).width > MAXW) text = `${text.slice(0, -2).trimEnd()}…`;
  const w = Math.min(248, ctx.measureText(text).width + 24);
  ctx.fillStyle = 'rgba(8,8,10,0.62)';
  ctx.fillRect((256 - w) / 2, 10, w, 44);
  ctx.fillStyle = '#e9e3cf';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// a small speaker over a friend's name tag while they talk on voice chat (one texture for everyone)
let talkTex = null;
function talkTexture() {
  if (talkTex) return talkTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(8,8,10,0.62)';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#b8e3a8';
  ctx.beginPath(); // the speaker
  ctx.moveTo(13, 26);
  ctx.lineTo(21, 26);
  ctx.lineTo(31, 17);
  ctx.lineTo(31, 47);
  ctx.lineTo(21, 38);
  ctx.lineTo(13, 38);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#b8e3a8';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  for (const r of [8, 15]) { // the sound
    ctx.beginPath();
    ctx.arc(32, 32, r, -0.75, 0.75);
    ctx.stroke();
  }
  talkTex = new THREE.CanvasTexture(c);
  talkTex.colorSpace = THREE.SRGBColorSpace;
  return talkTex;
}

export class RemoteAvatars {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'coop-avatars';
    game.scene.add(this.group);
    this.map = new Map();
    this._gltf = null;
    this._loading = null;
    this._snap = {};
  }

  load() {
    if (!this._loading) {
      this._loading = loadGLB(STUDENT_URL).then((g) => (this._gltf = g));
    }
    return this._loading;
  }

  get ready() {
    return !!this._gltf;
  }

  get(id) {
    return this.map.get(id) || null;
  }

  /** look = { blazer: 0xRRGGBB, skin: 0xRRGGBB, hair: 0xRRGGBB, style: 'short'|'long' } */
  create({ id, name, look }, { torchLight = true } = {}) {
    if (!this._gltf || this.map.has(id)) return this.map.get(id) || null;
    const model = cloneGLB(this._gltf.scene);
    // per-player copies of the tinted materials BEFORE ps1ify (it converts once per source material)
    const tintOf = { student_tint: look.blazer, student_skin: look.skin, student_hair: look.hair };
    const own = new Map();
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const m = o.material;
      if (m && tintOf[m.name] !== undefined) {
        if (!own.has(m)) {
          const c = m.clone();
          c.color.setHex(tintOf[m.name]);
          own.set(m, c);
        }
        o.material = own.get(m);
      }
    });
    ps1ify(model);
    let hairShort = null;
    let hairLong = null;
    model.traverse((o) => {
      if (o.name === 'student_hair_short') hairShort = o;
      if (o.name === 'student_hair_long') hairLong = o;
    });
    if (hairShort) hairShort.visible = look.style !== 'long';
    if (hairLong) hairLong.visible = look.style === 'long';
    model.rotation.y = Math.PI; // glTF front is +Z; our yaw convention faces -Z

    const root = new THREE.Group();
    root.name = 'avatar:' + id;
    root.add(model);
    this.group.add(root);

    const anim = new AnimationController(model, this._gltf.animations, STUDENT_CLIPS);
    anim.play('idle', { fade: 0 });
    let head = null;
    model.traverse((o) => {
      if (o.isBone && o.name === 'head') head = o;
    });

    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name), transparent: true, depthWrite: false, fog: true }));
    tag.scale.set(0.72, 0.18, 1);
    tag.position.set(0, 2.02, 0);
    tag.renderOrder = 5;
    root.add(tag);
    const talk = new THREE.Sprite(new THREE.SpriteMaterial({ map: talkTexture(), transparent: true, depthWrite: false, fog: true }));
    talk.scale.set(0.15, 0.15, 1);
    talk.renderOrder = 5;
    talk.visible = false;
    root.add(talk);

    let light = null;
    if (torchLight) {
      const src = this.game.player?.flashlight;
      light = new THREE.SpotLight(src?.color || 0xfff1d6, 0, src?.distance || 18, src?.angle || 0.5, src?.penumbra ?? 0.5, src?.decay ?? 1.6);
      light.castShadow = false;
      this.group.add(light);
      this.group.add(light.target);
    }

    const av = {
      id,
      name,
      look,
      root,
      model,
      anim,
      head,
      headBase: new THREE.Quaternion(),
      tag,
      talk,
      talking: false,
      light,
      buf: new SnapBuffer(),
      cur: { x: 0, z: 0, yaw: 0, pitch: 0, flags: 0, spd: 0 },
      prevX: 0,
      prevZ: 0,
      speed: 0,
      want: 'idle',
      oneShot: null,
      visibleT: 0,
      headPos: new THREE.Vector3(0, 1.6, 0),
      placed: false,
    };
    anim.onFootstep = (clip) => this._footstep(av, clip);
    this.map.set(id, av);
    return av;
  }

  remove(id) {
    const av = this.map.get(id);
    if (!av) return;
    this.group.remove(av.root);
    if (av.light) {
      av.light.intensity = 0; // keep the light in the scene until clear(): removing it recompiles shaders
      av.light.userData.dead = true;
    }
    av.tag.material.map?.dispose();
    av.tag.material.dispose();
    av.talk.material.dispose(); // (the speaker texture is shared)
    this.map.delete(id);
  }

  /** Voice chat (coop.js): show the speaker over this friend's head while they talk. */
  setTalking(id, on) {
    const av = this.map.get(id);
    if (av) av.talking = !!on;
  }

  clear() {
    for (const id of [...this.map.keys()]) this.remove(id);
    for (const o of [...this.group.children]) this.group.remove(o); // leftover lights + targets
  }

  push(id, t, s) {
    this.map.get(id)?.buf.push(t, s);
  }

  /** One-shot clip (wave, stand_up). */
  playOnce(id, clip) {
    const av = this.map.get(id);
    if (!av) return;
    av.oneShot = clip;
    av.anim.playOnce(clip, { fade: 0.2 }).then(() => {
      if (av.oneShot === clip) av.oneShot = null;
    });
  }

  update(dt, renderTime) {
    const cam = this.game.camera;
    for (const av of this.map.values()) {
      const s = av.buf.sample(renderTime, this._snap);
      if (!s) {
        av.root.visible = false;
        if (av.light) av.light.intensity = 0;
        continue;
      }
      const c = av.cur;
      c.x = s.x;
      c.z = s.z;
      c.yaw = s.yaw;
      c.pitch = s.pitch;
      c.flags = s.flags;
      const hidden = !!(s.flags & F.hidden);
      const out = !!(s.flags & F.out);
      av.root.visible = !hidden && !out;
      av.root.position.set(s.x, 0, s.z);
      av.root.rotation.y = s.yaw;
      // ground speed from the interpolated motion (smoothed)
      if (av.placed && dt > 0) {
        const sp = Math.hypot(s.x - av.prevX, s.z - av.prevZ) / dt;
        av.speed += (Math.min(sp, 7) - av.speed) * Math.min(1, dt * 8);
      }
      av.prevX = s.x;
      av.prevZ = s.z;
      av.placed = true;

      // clip
      let want;
      if (s.flags & F.seated) want = 'sit_trapped';
      else if (s.flags & F.caught) want = 'cower';
      else if (s.flags & F.crouch) want = av.speed > 0.25 ? 'crouch_walk' : 'crouch_idle';
      else if (av.speed > 3.0 || (s.flags & F.sprint && av.speed > 1)) want = 'run';
      else if (av.speed > 0.25) want = 'walk';
      else want = 'idle';
      if (av.oneShot && (want === 'idle' || av.oneShot === 'stand_up')) {
        // let the one-shot finish
      } else {
        if (av.oneShot && want !== 'idle') av.oneShot = null;
        if (want !== av.want || av.anim.requested !== want) {
          av.anim.play(want, { fade: want === 'run' || av.want === 'run' ? 0.2 : 0.3 });
          av.want = want;
        }
        if (want === 'walk' || want === 'run' || want === 'crouch_walk') av.anim.syncToSpeed(Math.max(av.speed, 0.3));
      }
      // restore the head before the mixer runs, then nod it by the look pitch (additive)
      if (av.head && av.headSet) av.head.quaternion.copy(av.headBase);
      av.anim.update(dt);
      if (av.head) {
        av.headBase.copy(av.head.quaternion);
        av.headSet = true;
        const p = THREE.MathUtils.clamp(s.pitch, -0.9, 0.9) * 0.6;
        if (!(s.flags & (F.seated | F.caught))) av.head.quaternion.multiply(_q.setFromAxisAngle(_X, -p));
      }
      av.headPos.set(s.x, s.flags & F.seated ? 0.95 : s.flags & F.crouch ? 1.1 : 1.6, s.z);

      // name tag: only close by (and fades out), never while hidden
      if (cam) {
        const d = Math.hypot(cam.position.x - s.x, cam.position.z - s.z);
        const a = THREE.MathUtils.clamp((12 - d) / 4, 0, 1);
        av.tag.material.opacity = a * 0.9;
        av.tag.visible = a > 0.02;
        av.tag.position.y = s.flags & F.seated ? 1.25 : s.flags & F.crouch ? 1.45 : 2.02;
        // talking: a speaker over the name tag, visible from further away than the tag (pulses gently)
        const ta = av.talking ? THREE.MathUtils.clamp((24 - d) / 4, 0, 1) : 0;
        av.talk.visible = ta > 0.02;
        if (av.talk.visible) {
          av.talk.material.opacity = ta;
          av.talk.position.y = av.tag.position.y + 0.17;
          const k = 0.15 * (1 + 0.12 * Math.sin(performance.now() / 90));
          av.talk.scale.set(k, k, 1);
        }
      }

      // torch: a spot light from the right hand along where they look
      if (av.light && !av.light.userData.dead) {
        const on = !!(s.flags & F.torch) && !hidden && !out && !(s.flags & (F.seated | F.caught));
        const base = this.game.player?.flashlightBaseIntensity ?? 16;
        av.light.intensity += ((on ? base * 0.8 : 0) - av.light.intensity) * Math.min(1, dt * 12);
        const fx = -Math.sin(s.yaw);
        const fz = -Math.cos(s.yaw);
        const rx = Math.cos(s.yaw);
        const rz = -Math.sin(s.yaw);
        const y = s.flags & F.crouch ? 0.95 : 1.35;
        av.light.position.set(s.x + rx * 0.22 + fx * 0.25, y, s.z + rz * 0.22 + fz * 0.25);
        const cp = Math.cos(s.pitch);
        av.light.target.position.set(av.light.position.x + fx * cp * 6, y + Math.sin(s.pitch) * 6, av.light.position.z + fz * cp * 6);
        av.light.target.updateMatrixWorld();
      }
    }
  }

  _footstep(av, clip) {
    if (!av.root.visible) return;
    const s = av.cur;
    const room = this.game.world?.getRoomAt?.(s.x, s.z);
    const surface = SURFACE_BY_ROOM[room?.type] || 'lino';
    const speed = clip === 'run' ? 'sprint' : clip === 'crouch_walk' ? 'crouch' : 'walk';
    _v.set(s.x, 0.05, s.z);
    this.game.audio?.play?.('footstep', { surface, speed, position: _v });
  }

  /** Whether quality allows one extra spot light per remote player. */
  static torchLightsAllowed(quality) {
    return quality !== 'low' && !!QUALITY[quality];
  }
}

export { PLAYER };
