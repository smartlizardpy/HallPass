// LAST BELL - The Assistant's Art room while she holds someone (ENV, Second Floor update).
//
// The co-op captive circle (coop.js _artSeat: 1.1 m round the 'art-circle' anchor) is dressed in
// world-floor2-dress.js with her papier-mache "friends" on five of the chairs, a lunch party, a chalk ring
// and STAY. This module owns the parts that move or change:
//   - the dolls' heads (kit doll_head_*): they turn to the nearest captive (no captive: the centre), but
//     only while the local camera can't see them; a free player nearing the door snaps them to it
//   - while anyone is held there: the room's panels go dark and the bare bulb over the circle (the
//     'artLamp' fixture, normally 'broken') becomes a dim warm flicker; a music box plays from the circle;
//     every 20-40 s "Let's stay together... forever." from the doorway (never over her real lines); the
//     door is pulled shut, and the first free player within 6 m of it makes it swing open with a creak
//   - the easel shows a crayon drawing of her holding hands with you, your name under you: MY NEW FRIEND
// Everything here is local to each client (cosmetic): nothing is sent over the network.
//
//   new ArtRoom(game)   after world.generate() (floor2.reset())
//   update(dt)          every frame (floor2.update, after world.update so the light pool is final)
//   dispose()
//   testCaptives        [{ id, name, position }] overrides the roster (dev tests)

import * as THREE from './lib/three/three.module.js';
import { FLOOR_Y } from './config.js';
import { addVertexSnap } from './assets.js';

const TURN = 2.4; // rad/s an unwatched head turns
const TILT = 0.32; // rad: the curious head tilt towards a captive
const SNAP_T = 3.0; // s the heads stare at the door when a rescuer comes
const NEAR_DOOR = 6.0; // m
const VOICE_MIN = 20, VOICE_MAX = 40, VOICE_QUIET = 6, VOICE_LEN = 3.2;
const CLOSE_DELAY = 4.0; // s after the hold starts before the door is pulled shut (she's left by then)
const LAMP_COLOR = new THREE.Color(0xffa458);
const LAMP_GAIN = 0.42; // x the pool's bulb intensity (14): dim
const MUSIC_GAIN = 0.5;
const CW = 160, CH = 192; // drawing canvas (the easel sheet is 0.66 x 0.80 m)

const _m = new THREE.Matrix4();
const _sphere = new THREE.Sphere(new THREE.Vector3(), 0.3);
const _v = new THREE.Vector3();

/** A player's name as it goes on the drawing: no control / format characters, capitals, at most 12. */
export function drawingName(s) {
  const t = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  const cps = [...t].slice(0, 12).join('').trim();
  return cps || 'FRIEND';
}

const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class ArtRoom {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.heads = [];
    this.active = false; // someone is held here right now
    this.testCaptives = null;
    this.ok = false;
    this._objs = [];
    this._subs = [];
    this._clock = 0;
    this._lastHer = -1e9; // when she last said anything (any client: her lines arrive as enemy:voice)
    this._voiceT = 0;
    this._snapT = 0;
    this._drawKey = '';
    this._saved = null;
    this._music = null;
    this._musicLvl = -1;
    this._losT = 0;
    this.frustum = new THREE.Frustum();
    try {
      this._build();
    } catch (err) {
      console.warn('[art-room] not built:', err);
    }
  }

  _build() {
    const w = this.world, f2 = w?.floor2;
    const circle = f2?.anchorMap?.get('art-circle');
    if (!circle) return;
    this.centre = circle.position.clone();
    this.room = circle.room || null;
    const group = w.floorGroup(1);
    this.group = group;
    // heads on their neck pivots (one mesh each: the atlas is one material)
    for (const a of f2.anchors) {
      if (a.kind !== 'art-doll' || !a.name || !w.kit.has(a.name)) continue;
      const obj = w.kit.makeObject(a.name);
      obj.rotation.order = 'YXZ';
      obj.position.copy(a.position);
      const rest = Math.atan2(this.centre.x - a.position.x, this.centre.z - a.position.z);
      obj.rotation.y = rest;
      group.add(obj);
      this._objs.push(obj);
      this.heads.push({ obj, rest, yaw: rest, tilt: 0, watched: false, los: false });
    }
    // the easel drawing: same material setup as the kit (lambert + map + vertex colours + PS1 snap), so it
    // shares the kit's shader; hidden until someone is held
    const easel = f2.anchorMap.get('art-easel');
    if (easel) {
      const cv = document.createElement('canvas');
      cv.width = CW;
      cv.height = CH;
      this.canvas = cv;
      this.ctx2d = cv.getContext('2d');
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      this.tex = tex;
      const geo = new THREE.PlaneGeometry(0.66, 0.8);
      const ref = w.kit.get('easel').parts[0]?.geometry?.getAttribute('color');
      const n = ref?.itemSize || 3;
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * n).fill(1), n));
      const mat = addVertexSnap(new THREE.MeshLambertMaterial({ name: 'm_art_drawing', map: tex, vertexColors: true, fog: true }));
      const mesh = new THREE.Mesh(geo, mat);
      // on the easel's sheet (kit easel: centre (0, 1.176, 0.073), tilted back 8 deg), 4 mm proud of it
      mesh.position.set(0, 1.1766, 0.077);
      mesh.rotation.x = -0.1396;
      const holder = new THREE.Group();
      holder.position.copy(easel.position);
      holder.rotation.y = easel.yaw || 0;
      holder.add(mesh);
      holder.visible = false;
      group.add(holder);
      this._objs.push(holder);
      this.drawing = holder;
    }
    // the lit bulb: a warm unlit shell round the kit's cold bulb_warm glass
    const lampFx = (w.lights?.fixtures || []).find((f) => f.artLamp && (f.floor || 0) === 1);
    this.lamp = lampFx || null;
    if (lampFx) {
      const gm = addVertexSnap(new THREE.MeshBasicMaterial({ name: 'm_art_bulb', color: LAMP_COLOR.clone(), fog: true }));
      const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 1), gm);
      glow.position.set(lampFx.x, lampFx.y + 0.03, lampFx.z); // the fixture is 1.0 m down; the glass 0.91-1.05 m
      glow.scale.set(1, 1.25, 1);
      glow.visible = false;
      group.add(glow);
      this._objs.push(glow);
      this.glow = glow;
    }
    // the door (S wall), by its room
    const name = this.room?.name || 'Art Room';
    this.door = (f2.doors || []).find((d) => d.leafNode === 'door_leaf_art') ||
      (f2.doors || []).find((d) => d.roomB?.name === name || d.roomA?.name === name) || null;
    // compile the two new materials now rather than at the creepy moment
    try {
      const g = this.game;
      if (g.renderer?.compile && g.scene && g.camera) {
        for (const o of [this.drawing, this.glow]) if (o) o.visible = true;
        g.renderer.compile(group, g.camera, g.scene);
      }
    } catch { /* not fatal: they compile on first sight */ }
    for (const o of [this.drawing, this.glow]) if (o) o.visible = false;
    const ev = this.game.events;
    if (ev) this._subs.push(ev.on('enemy:voice', (e) => { if (e?.who === 'assistant' && !e.artRoom) this._lastHer = this._clock; }));
    this.ok = true;
  }

  // ----------------------------------------------------------------------------------------------- who
  /** Players held in the Art room: [{ id, name, position, self }]. */
  captives() {
    if (Array.isArray(this.testCaptives)) return this.testCaptives;
    const g = this.game, c = g.coop;
    const out = [];
    if (!c?.active) return out;
    for (const id of g.playerIds?.() || []) {
      const r = c.roster?.get(id);
      const self = id === c.selfId;
      const status = self ? c.status : r?.status;
      const at = self ? c._trapAt || r?.at : r?.at;
      if (status !== 'trapped' || at !== 'art') continue;
      const info = g.playerInfo?.(id);
      out.push({ id, name: info?.name ?? r?.name, position: info?.position || null, self });
    }
    return out;
  }

  /** The first free player on floor 2 within NEAR_DOOR of the door, if any. */
  _rescuerNear(range = NEAR_DOOR) {
    const g = this.game, d = this.door;
    if (!d) return null;
    for (const id of g.playerIds?.() || []) {
      const info = g.playerInfo?.(id);
      if (!info?.position || info.status !== 'alive' || info.floor !== 1) continue;
      if (Math.hypot(info.position.x - d.position.x, info.position.z - d.position.z) < range) return info;
    }
    return null;
  }

  // -------------------------------------------------------------------------------------------- update
  update(dt) {
    if (!this.ok) return;
    this._clock += dt;
    const caps = this.captives();
    const held = caps.length > 0;
    if (held && !this.active) this._begin();
    else if (!held && this.active) this._end();
    if (this.active) {
      this._lampFrame();
      this._musicFrame();
      this._voiceFrame(dt);
      this._doorFrame(dt);
      this._drawFrame(caps);
    }
    this._headsFrame(dt, caps);
  }

  _begin() {
    this.active = true;
    const L = this.world.lights;
    // the room's panels off (remember each one), the bulb on
    if (L && this.room) {
      this._saved = [];
      for (const f of L.fixtures) {
        if (f === this.lamp || f.roomId !== this.room.id || (f.floor || 0) !== 1) continue;
        this._saved.push([f, f.enabled]);
        f.enabled = false;
      }
      L._dirty = true;
    }
    if (this.lamp) {
      this.lamp.state = 'flicker';
      this.lamp.enabled = true;
      this.lamp.cur = 0.3;
    }
    if (this.glow) this.glow.visible = true;
    this._voiceT = VOICE_MIN + Math.random() * (VOICE_MAX - VOICE_MIN);
    this._closeT = CLOSE_DELAY;
    this._closeTries = 0;
    this._doorDone = false;
    this._drawKey = '';
  }

  _end() {
    this.active = false;
    const L = this.world.lights;
    for (const [f, on] of this._saved || []) f.enabled = on;
    this._saved = null;
    if (L) L._dirty = true;
    if (this.lamp) {
      this.lamp.state = 'broken';
      this.lamp.cur = 0;
    }
    if (this.glow) this.glow.visible = false;
    if (this.drawing) this.drawing.visible = false;
    this._music?.stop?.(1.5);
    this._music = null;
    this._musicLvl = -1;
    this._snapT = 0;
  }

  /** The pool's bulb light (red, steady) re-tinted: warm, dim, following the fixture's flicker level. */
  _lampFrame() {
    const lamp = this.lamp, L = this.world.lights;
    if (!lamp || !L) return;
    const k = 0.25 + 0.75 * Math.max(0, Math.min(1, lamp.cur));
    for (const s of L.pool) {
      if (s.fx !== lamp.index) continue;
      s.light.color.copy(LAMP_COLOR);
      s.light.intensity *= LAMP_GAIN * k;
      s.light.distance = 7;
    }
    if (this.glow) this.glow.material.color.copy(LAMP_COLOR).multiplyScalar(0.35 + 0.65 * k);
  }

  _camFloor() {
    const cam = this.game.camera;
    return cam ? this.world.floorOf?.(cam.position) ?? 0 : 0;
  }

  _musicFrame() {
    const a = this.game.audio;
    if (!a) return;
    if (!this._music) {
      if ((this._musicRetry = (this._musicRetry || 0) - 1) > 0) return;
      this._musicRetry = 60; // the audio context may not be up yet: try about once a second
      const c = this.centre;
      this._music = a.playLoopAt?.('music_box', { x: c.x, y: c.y + 0.9, z: c.z }, MUSIC_GAIN) || null;
      this._musicLvl = MUSIC_GAIN;
      if (!this._music) return;
    }
    // only on this floor: no slab in the panner model
    const want = this._camFloor() === 1 ? MUSIC_GAIN : 0;
    if (want !== this._musicLvl && this._music.g && a.ctx) {
      this._music.g.gain.setTargetAtTime(want, a.ctx.currentTime, 0.4);
      this._musicLvl = want;
    }
  }

  /** Is she talking (host: her busy flag), or did she say anything in the last VOICE_QUIET s? */
  voiceBlocked() {
    const a = this.game.assistant;
    if (a && typeof a._time === 'number' && typeof a._voiceBusyUntil === 'number' && a._time < a._voiceBusyUntil) return true;
    return this._clock - this._lastHer < VOICE_QUIET;
  }

  _voiceFrame(dt) {
    this._voiceT -= dt;
    if (this._voiceT > 0) return;
    if (this.voiceBlocked() || this._camFloor() !== 1) {
      this._voiceT = 3; // try again shortly
      return;
    }
    this._voiceT = VOICE_MIN + Math.random() * (VOICE_MAX - VOICE_MIN);
    const d = this.door;
    const pos = d ? new THREE.Vector3(d.position.x, d.position.y + 1.5, d.position.z) : this.centre.clone().setY(this.centre.y + 1.5);
    // net: true - every client plays its own (the host must not relay it from her head)
    this.game.events?.emit('enemy:voice', { who: 'assistant', line: 'forever', position: pos, net: true, artRoom: true });
    this.lastVoiceAt = this._clock;
    // and keep her own lines off it while it plays (host: her voice gate)
    const a = this.game.assistant;
    if (a && typeof a._time === 'number' && typeof a._voiceBusyUntil === 'number') a._voiceBusyUntil = Math.max(a._voiceBusyUntil, a._time + VOICE_LEN);
  }

  _doorFrame(dt) {
    const d = this.door;
    if (!d) return;
    // shut it behind her, unless someone is already coming
    if (this._closeT > 0 && !this._doorDone) {
      this._closeT -= dt;
      if (this._closeT <= 0 && this._closeTries < 10) {
        this._closeTries++;
        if (!d.isOpen || this._rescuerNear(NEAR_DOOR + 1.5)) this._closeT = 0;
        else if (!d.close('world')) this._closeT = 1; // blocked (she's in the doorway): retry
      }
    }
    if (this._doorDone) return;
    const r = this._rescuerNear();
    if (!r) return;
    this._doorDone = true;
    this._closeT = 0;
    d.open('world');
    this.game.audio?.play?.('door_creak', { position: d.position, rate: 0.8, delay: 0.08 });
    this._snapT = SNAP_T;
    for (const h of this.heads) {
      h.yaw = Math.atan2(d.position.x - h.obj.position.x, d.position.z - h.obj.position.z);
      h.tilt = 0;
      this._pose(h);
    }
  }

  // --------------------------------------------------------------------------------------------- heads
  _pose(h) {
    h.obj.rotation.y = h.yaw;
    h.obj.rotation.z = h.tilt;
  }

  _headsFrame(dt, caps) {
    if (!this.heads.length) return;
    const g = this.game, cam = g.camera;
    const camFloor = this._camFloor();
    if (cam) {
      cam.updateMatrixWorld();
      _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(_m);
    }
    this._losT -= dt;
    const doLos = this._losT <= 0;
    if (doLos) this._losT = 0.1;
    if (this._snapT > 0) {
      this._snapT -= dt;
      for (const h of this.heads) h.watched = this._isWatched(h, cam, camFloor, doLos);
      return; // staring at the door
    }
    for (const h of this.heads) {
      h.watched = this._isWatched(h, cam, camFloor, doLos);
      if (h.watched) continue;
      let ty = h.rest, tt = 0;
      let best = Infinity;
      for (const c of caps) {
        const p = c.position;
        if (!p) continue;
        const dx = p.x - h.obj.position.x, dz = p.z - h.obj.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) {
          best = d2;
          ty = Math.atan2(dx, dz);
          tt = TILT * (h.rest > 0 ? 1 : -1);
        }
      }
      const dy = wrapPi(ty - h.yaw);
      const step = TURN * dt;
      h.yaw = wrapPi(h.yaw + Math.max(-step, Math.min(step, dy)));
      h.tilt += Math.max(-step * 0.5, Math.min(step * 0.5, tt - h.tilt));
      this._pose(h);
    }
  }

  /** On screen (sphere in the camera frustum) with a clear line of sight: someone is looking at it. */
  _isWatched(h, cam, camFloor, doLos) {
    if (!cam || camFloor !== 1) return false;
    _sphere.center.copy(h.obj.position);
    _sphere.center.y += 0.13;
    if (!this.frustum.intersectsSphere(_sphere)) return false;
    if (cam.position.distanceToSquared(_sphere.center) > 30 * 30) return false;
    if (doLos) h.los = this.world.lineOfSight ? this.world.lineOfSight(cam.position, _sphere.center) !== false : true;
    return h.los;
  }

  // ------------------------------------------------------------------------------------------- drawing
  _drawFrame(caps) {
    if (!this.drawing) return;
    const names = caps.slice(0, 4).map((c) => drawingName(c.name));
    const key = names.join('\u0001');
    this.drawing.visible = names.length > 0;
    if (key === this._drawKey) return;
    this._drawKey = key;
    this.drawnNames = names;
    drawFriends(this.ctx2d, names);
    this.tex.needsUpdate = true;
  }

  dispose() {
    if (this.active) this._end();
    for (const off of this._subs) off?.();
    this._subs = [];
    for (const o of this._objs) {
      o.parent?.remove(o);
      o.traverse?.((m) => {
        if (m.isMesh && (m.material?.name === 'm_art_drawing' || m.material?.name === 'm_art_bulb')) {
          m.geometry.dispose();
          m.material.dispose();
        }
      });
    }
    this._objs = [];
    this.heads = [];
    this.tex?.dispose();
    this.ok = false;
  }
}

// ----------------------------------------------------------------------------------------------- crayon
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A waxy crayon line through pts (drawn twice, offset, so it reads as crayon at 160 px). */
function crayon(ctx, pts, col, w, r, close = false) {
  for (let pass = 0; pass < 2; pass++) {
    ctx.globalAlpha = pass ? 0.45 : 0.9;
    ctx.strokeStyle = col;
    ctx.lineWidth = pass ? w * 0.6 : w;
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const jx = x + (r() - 0.5) * 1.2 + (pass ? 0.7 : 0), jy = y + (r() - 0.5) * 1.2 + (pass ? 0.5 : 0);
      if (i) ctx.lineTo(jx, jy);
      else ctx.moveTo(jx, jy);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function circlePts(cx, cy, rx, ry, n = 14, a0 = 0, a1 = Math.PI * 2) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

function scrawl(ctx, text, cx, y, maxW, size, col, r) {
  let fs = size;
  ctx.font = `bold ${fs}px monospace`;
  while (fs > 7 && ctx.measureText(text).width > maxW) ctx.font = `bold ${--fs}px monospace`;
  const chars = [...text];
  const cw = ctx.measureText(text).width / Math.max(1, chars.length);
  let x = cx - (cw * chars.length) / 2;
  ctx.textBaseline = 'middle';
  for (const ch of chars) {
    ctx.save();
    ctx.translate(x + cw / 2, y + (r() - 0.5) * 2.5);
    ctx.rotate((r() - 0.5) * 0.3);
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.9;
    ctx.fillText(ch, -cw / 2, 0);
    ctx.globalAlpha = 0.4;
    ctx.fillText(ch, -cw / 2 + 0.7, 0.6);
    ctx.restore();
    x += cw;
  }
  ctx.globalAlpha = 1;
}

/** Her (tall, hairnet, lashes, the lunch tabard) holding hands with each of you, your names underneath. */
export function drawFriends(ctx, names) {
  const r = rng(hashStr(names.join('|')) || 7);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = '#e8e1cd';
  ctx.fillRect(0, 0, CW, CH);
  for (let i = 0; i < 260; i++) { // paper tooth
    ctx.fillStyle = r() < 0.5 ? 'rgba(120,100,70,0.08)' : 'rgba(255,255,255,0.18)';
    ctx.fillRect((r() * CW) | 0, (r() * CH) | 0, 1, 1);
  }
  const n = Math.max(1, names.length);
  scrawl(ctx, n > 1 ? 'MY NEW FRIENDS' : 'MY NEW FRIEND', CW / 2, 16, CW - 12, 15, '#b8241c', r);
  // her: left, a head taller than everyone
  const hx = 34, hy = 62, hr = 13;
  crayon(ctx, circlePts(hx, hy, hr, hr + 1, 16), '#5a3a2a', 2.2, r, true);
  // hair down past her shoulders, the hairnet over the top (a hatched dome)
  for (const s of [-1, 1]) crayon(ctx, [[hx + s * (hr - 1), hy - 4], [hx + s * (hr + 3), hy + 12], [hx + s * (hr + 1), hy + 26]], '#1c1612', 2.4, r);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(hx, hy - 3, hr + 3, hr + 1, 0, Math.PI, 0);
  ctx.clip();
  for (let k = -20; k <= 20; k += 5) {
    crayon(ctx, [[hx + k - 10, hy - 18], [hx + k + 10, hy + 2]], '#8a8494', 1, r);
    crayon(ctx, [[hx + k + 10, hy - 18], [hx + k - 10, hy + 2]], '#8a8494', 1, r);
  }
  ctx.restore();
  crayon(ctx, circlePts(hx, hy - 3, hr + 3, hr + 1, 12, Math.PI, Math.PI * 2), '#6a6474', 1.6, r);
  // eyes with lashes, pink cheeks, the smile
  for (const s of [-1, 1]) {
    ctx.fillStyle = '#141010';
    ctx.fillRect(hx + s * 5 - 1, hy, 3, 3);
    for (let l = 0; l < 3; l++) crayon(ctx, [[hx + s * 5 + (l - 1) * 2, hy], [hx + s * 5 + (l - 1) * 3, hy - 3]], '#141010', 0.9, r);
    ctx.fillStyle = 'rgba(220,110,130,0.55)';
    ctx.fillRect(hx + s * 8 - 2, hy + 5, 4, 3);
  }
  crayon(ctx, circlePts(hx, hy + 3, 8, 6, 10, 0.15, Math.PI - 0.15), '#c0281e', 1.8, r);
  // the tabard (lunch monitor), arms, legs
  crayon(ctx, [[hx, hy + hr], [hx - 15, hy + 66], [hx + 15, hy + 66], [hx, hy + hr]], '#2e7a86', 2.2, r, true);
  for (let k = 0; k < 5; k++) crayon(ctx, [[hx - 10 + k * 5, hy + 30 + (k % 2) * 6], [hx - 13 + k * 6, hy + 62]], '#2e7a86', 1.2, r);
  crayon(ctx, [[hx - 6, hy + 66], [hx - 8, hy + 96]], '#5a3a2a', 2, r);
  crayon(ctx, [[hx + 6, hy + 66], [hx + 8, hy + 96]], '#5a3a2a', 2, r);
  crayon(ctx, [[hx - 3, hy + 24], [hx - 18, hy + 44]], '#5a3a2a', 2, r);
  // you: a row of smaller figures, each holding the next one's hand
  const x0 = 72, span = CW - 8 - x0;
  let hand = [hx + 3, hy + 24];
  const fy = 104; // friends' head centre
  names.forEach((name, i) => {
    const fx = x0 + (span * (i + 0.5)) / n;
    const fr = n > 2 ? 7 : 9;
    crayon(ctx, circlePts(fx, fy, fr, fr, 12), '#3a3a3a', 1.8, r, true);
    ctx.fillStyle = '#141010';
    ctx.fillRect(fx - 4, fy - 2, 2, 2);
    ctx.fillRect(fx + 2, fy - 2, 2, 2);
    crayon(ctx, [[fx - 3, fy + 4], [fx + 3, fy + 4]], '#141010', 1, r); // not smiling
    ctx.fillStyle = 'rgba(70,120,210,0.85)'; // a tear
    ctx.fillRect(fx + 3, fy + 1, 1, 3);
    crayon(ctx, [[fx, fy + fr], [fx, fy + fr + 30]], '#3a3a3a', 1.8, r);
    crayon(ctx, [[fx, fy + fr + 30], [fx - 6, fy + fr + 48]], '#3a3a3a', 1.8, r);
    crayon(ctx, [[fx, fy + fr + 30], [fx + 6, fy + fr + 48]], '#3a3a3a', 1.8, r);
    const lh = [fx - 10, fy + fr + 16];
    crayon(ctx, [[fx, fy + fr + 8], lh], '#3a3a3a', 1.8, r);
    crayon(ctx, [hand, [(hand[0] + lh[0]) / 2, Math.max(hand[1], lh[1]) + 4], lh], i ? '#3a3a3a' : '#5a3a2a', 1.8, r); // holding hands
    hand = [fx + 9, fy + fr + 16];
    crayon(ctx, [[fx, fy + fr + 8], hand], '#3a3a3a', 1.8, r);
    // the label, with an arrow up to you
    const ly = n > 2 ? 182 - (i % 2) * 11 : 180;
    scrawl(ctx, name, fx, ly, n > 2 ? 46 : span / n + 6, n > 1 ? 10 : 13, '#2a3e9a', r);
    crayon(ctx, [[fx, ly - 7], [fx, fy + fr + 50]], '#2a3e9a', 1, r);
  });
  // a heart over the two of you
  const hxx = (hx + x0 + span / (2 * n)) / 2, hyy = 44;
  ctx.fillStyle = '#d0302a';
  ctx.beginPath();
  ctx.moveTo(hxx, hyy + 7);
  ctx.bezierCurveTo(hxx - 11, hyy - 1, hxx - 5, hyy - 8, hxx, hyy - 2);
  ctx.bezierCurveTo(hxx + 5, hyy - 8, hxx + 11, hyy - 1, hxx, hyy + 7);
  ctx.fill();
  ctx.restore();
}
