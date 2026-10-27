// LAST BELL — The Halloween Shift: posters, chalkboards and clocks the school changes behind your back.
//
// Posters: every poster the dressing hung (world.static owners, node 'poster_0') keeps its normal look in
// the merged geometry; a corrupted version is a thin overlay quad 3 mm in front of it, drawn from the REAL
// design (the election atlas canvas) plus marks that fit that design. States, per poster, only ever go up:
//   0 NORMAL   (no overlay)
//   1 UNSETTLING  small wrongness: a scratched eye, a pencilled word, a fingerprint, a tilt in a portrait
//   2 CORRUPTED   blood, handprints, torn paper, changed rules / slogans, missing faces
//   3 HAUNTED     the design is taken over: blanked faces, The Watcher drawn in, written warnings
// Changes happen when the poster is out of sight (posters.canChange). A rare witnessed change fades in over
// a few seconds instead of popping. The write-in posters (real photos of the player's friend) are never
// corrupted, only printed / school designs.
//
// Chalkboards: world room data boards → world.redrawBoard(board, text). Clocks: an overlay face on the kit
// wall clocks whose hands the director can stop at the wrong time or run backwards.

import * as THREE from '../lib/three/three.module.js';
import { POSTER_DESIGNS } from '../world-election.js';

const Q = 256;
const MARKER = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive";
const FONT = "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const BLOOD = ['#4a0709', '#5e0a0d', '#741014', '#3a0507'];
export const STATE_NAMES = ['NORMAL', 'UNSETTLING', 'CORRUPTED', 'HAUNTED'];

// board writings (chalk): the director picks by novelty; never names a real person
export const BOARD_LINES = [
  'DO NOT ANSWER THE BELL',
  'WHY DID YOU TURN AROUND',
  'IT ONLY MOVES WHEN YOU DONT LOOK',
  'ATTENDANCE: EVERYONE',
  'ROOM 000\nPRESENT',
  'STAY IN THE LIGHT',
  'IT WAS BEHIND YOU',
  'HOMEWORK: COUNT THE DOORS\nTHEN COUNT AGAIN',
  'SIT DOWN',
  'WE SAW YOU',
];

function rngFrom(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
}

// --------------------------------------------------------------------------------- drawing helpers
function drip(ctx, x, top, len, w, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.lineTo(x + w * 0.3, top + len);
  ctx.arc(x, top + len, w * 0.45, 0, Math.PI);
  ctx.closePath();
  ctx.fill();
}

function bloodTop(ctx, rnd, n = 7, maxLen = 90) {
  ctx.fillStyle = BLOOD[1];
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let x = 0; x <= Q; x += 16) ctx.lineTo(x, 6 + rnd() * 10);
  ctx.lineTo(Q, 0);
  ctx.fill();
  for (let i = 0; i < n; i++) drip(ctx, 10 + rnd() * (Q - 20), 8, 20 + rnd() * maxLen, 4 + rnd() * 7, BLOOD[(rnd() * 3) | 0]);
}

function handprint(ctx, x, y, s, rot, alpha = 0.85, col = BLOOD[2]) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(0, 10, 15, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  const fingers = [[-13, -12, 5, 15, -0.35], [-5, -20, 4.6, 18, -0.1], [4, -21, 4.6, 19, 0.06], [12, -15, 4.2, 15, 0.3], [19, 8, 4.4, 12, 1.0]];
  for (const [fx, fy, rw, rh, a] of fingers) {
    ctx.save();
    ctx.translate(fx, fy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // a smear dragging down
  ctx.globalAlpha = alpha * 0.45;
  ctx.fillRect(-12, 20, 22, 26);
  ctx.restore();
}

function scratches(ctx, rnd, n, x0 = 0, y0 = 0, w = Q, h = Q) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w, y = y0 + rnd() * h;
    const a = -0.9 + rnd() * 0.5, L = 18 + rnd() * 50;
    ctx.strokeStyle = 'rgba(20,14,12,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(235,228,210,0.7)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.restore();
}

function torn(ctx, rnd, corner) {
  ctx.save();
  ctx.fillStyle = '#4f574a'; // the wall behind
  const [cx, cy, sx, sy] = [[0, 0, 1, 1], [Q, 0, -1, 1], [0, Q, 1, -1], [Q, Q, -1, -1]][corner];
  const s = 50 + rnd() * 40;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + sx * s, cy);
  for (let k = 1; k < 7; k++) ctx.lineTo(cx + sx * s * (1 - k / 7) + rnd() * 6, cy + sy * s * (k / 7) + rnd() * 6);
  ctx.lineTo(cx, cy + sy * s);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d8cfb6'; // the torn paper edge
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function marker(ctx, text, x, y, size, col = '#7a0b10', rot = -0.05, align = 'center') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `700 ${size}px ${MARKER}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  const lines = String(text).split('\n');
  lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.05));
  ctx.restore();
}

function stamp(ctx, text, x, y, size, col, rot = -0.18) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `700 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + 14;
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = col;
  ctx.lineWidth = 3;
  ctx.strokeRect(-w / 2, -size * 0.62, w, size * 1.24);
  ctx.fillStyle = col;
  ctx.fillText(text, 0, 2);
  ctx.restore();
}

/** The Watcher, drawn in charcoal like a child would: tall, thin, too-long arms. */
function figure(ctx, x, y, h, col = '#111', alpha = 0.9) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col;
  ctx.fillStyle = col;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, h * 0.03);
  const head = h * 0.07;
  ctx.beginPath();
  ctx.ellipse(x, y + head, head * 0.8, head, 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y + head * 2);
  ctx.lineTo(x, y + h * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - h * 0.08, y + h * 0.3);
  ctx.lineTo(x + h * 0.08, y + h * 0.3);
  ctx.lineTo(x + h * 0.12, y + h * 0.95);
  ctx.lineTo(x - h * 0.12, y + h * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - h * 0.08, y + h * 0.31);
  ctx.lineTo(x - h * 0.11, y + h * 0.72);
  ctx.moveTo(x + h * 0.08, y + h * 0.31);
  ctx.lineTo(x + h * 0.11, y + h * 0.72);
  ctx.stroke();
  ctx.restore();
}

function blankFace(ctx, px, py, pw, ph) {
  // the portrait's face is smoothed away: skin, no features, two faint hollows
  ctx.save();
  ctx.fillStyle = '#cdbfae';
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph * 0.42, pw * 0.27, ph * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(30,20,20,0.35)';
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.39, py + ph * 0.38, 6, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(px + pw * 0.61, py + ph * 0.38, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function eyesOut(ctx, px, py, pw, ph, col = '#050505', size = 1) {
  ctx.save();
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.39, py + ph * 0.38, 9 * size, 6 * size, 0, 0, Math.PI * 2);
  ctx.ellipse(px + pw * 0.61, py + ph * 0.38, 9 * size, 6 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draw `design` in `state` onto a Q×Q canvas. base: the election atlas canvas (the real poster). */
function drawState(ctx, base, d, state, seed) {
  const rnd = rngFrom(seed);
  ctx.clearRect(0, 0, Q, Q);
  if (base) ctx.drawImage(base, d.x, d.y, Q, Q, 0, 0, Q, Q);
  else {
    ctx.fillStyle = '#d6cfb8';
    ctx.fillRect(0, 0, Q, Q);
  }
  // age everything a little
  ctx.fillStyle = `rgba(60,45,20,${0.06 + state * 0.05})`;
  ctx.fillRect(0, 0, Q, Q);
  const id = d.kind === 'printed' ? 'candidate' : d.id;
  const PX = 14, PY = 92, PW = 104, PH = 118; // world-election.js portrait box
  switch (id) {
    case 'be-quiet':
      if (state === 1) { marker(ctx, 'it hears', Q * 0.5, Q * 0.82, 26, '#3a3530', -0.08); handprint(ctx, Q * 0.86, Q * 0.18, 0.4, 0.4, 0.45); }
      if (state === 2) { bloodTop(ctx, rnd, 6); marker(ctx, 'OR IT HEARS YOU', Q * 0.5, Q * 0.84, 30, BLOOD[2], -0.06); handprint(ctx, Q * 0.25, Q * 0.55, 1.2, -0.4, 0.8); torn(ctx, rnd, 3); }
      if (state === 3) { ctx.fillStyle = 'rgba(8,4,4,0.82)'; ctx.fillRect(0, 0, Q, Q); figure(ctx, Q * 0.5, Q * 0.12, Q * 0.62, '#bdb8ad', 0.9); marker(ctx, 'shhhhhhhhhhhh', Q * 0.5, Q * 0.88, 30, BLOOD[2], 0.02); }
      break;
    case 'dont-run':
      if (state === 1) { scratches(ctx, rnd, 6); marker(ctx, '?', Q * 0.86, Q * 0.2, 46, '#2a2a2a', 0.2); }
      if (state === 2) { bloodTop(ctx, rnd, 8, 70); handprint(ctx, Q * 0.7, Q * 0.62, 1.1, 0.5, 0.85); handprint(ctx, Q * 0.3, Q * 0.7, 0.9, -0.3, 0.6); marker(ctx, 'IT LIKES IT\nWHEN YOU RUN', Q * 0.5, Q * 0.86, 22, '#f2ead6', -0.04); }
      if (state === 3) { ctx.fillStyle = '#e8e0cb'; ctx.fillRect(0, 0, Q, Q); marker(ctx, "DON'T\nTURN\nAROUND", Q * 0.5, Q * 0.48, 54, BLOOD[1], -0.03); for (let i = 0; i < 4; i++) drip(ctx, 30 + rnd() * 200, Q * 0.62, 30 + rnd() * 60, 5, BLOOD[1]); }
      break;
    case 'you-are-here':
      if (state === 1) { ctx.fillStyle = '#7a0b10'; ctx.beginPath(); ctx.arc(Q * 0.62, Q * 0.58, 7, 0, Math.PI * 2); ctx.fill(); marker(ctx, 'it is here', Q * 0.66, Q * 0.67, 17, '#7a0b10', 0, 'left'); }
      if (state === 2) { for (let i = 0; i < 9; i++) { ctx.fillStyle = BLOOD[(i % 3)]; ctx.beginPath(); ctx.arc(30 + rnd() * 196, 40 + rnd() * 170, 5, 0, Math.PI * 2); ctx.fill(); } marker(ctx, 'IT IS HERE\nIT IS HERE\nIT IS HERE', Q * 0.5, Q * 0.8, 20, BLOOD[2], -0.05); torn(ctx, rnd, 0); }
      if (state === 3) { ctx.fillStyle = 'rgba(10,6,6,0.6)'; ctx.fillRect(0, 0, Q, Q); for (let i = 0; i < 60; i++) { ctx.strokeStyle = 'rgba(230,220,200,0.8)'; ctx.lineWidth = 2; const x = 14 + (i % 10) * 24, y = 20 + Math.floor(i / 10) * 36; ctx.beginPath(); for (let k = 0; k < 4; k++) { ctx.moveTo(x + k * 4, y); ctx.lineTo(x + k * 4, y + 22); } ctx.moveTo(x - 2, y + 18); ctx.lineTo(x + 16, y + 4); ctx.stroke(); } }
      break;
    case 'elements':
      if (state === 1) { scratches(ctx, rnd, 3); marker(ctx, 'Rn', Q * 0.8, Q * 0.86, 22, '#333', 0.1); }
      if (state === 2) { bloodTop(ctx, rnd, 5, 60); marker(ctx, 'W  H  O\nI S\nH E R E', Q * 0.5, Q * 0.55, 34, BLOOD[2], -0.08); handprint(ctx, Q * 0.18, Q * 0.86, 0.8, 0.9, 0.7); }
      if (state === 3) { ctx.fillStyle = 'rgba(60,5,8,0.75)'; ctx.fillRect(0, 0, Q, Q); marker(ctx, 'ATOMIC NUMBER 000', Q * 0.5, Q * 0.5, 24, '#e9dfc8', -0.04); }
      break;
    case 'candidate':
      if (state === 1) { scratches(ctx, rnd, 2, PX, PY, PW, PH * 0.5); eyesOut(ctx, PX, PY, PW, PH, 'rgba(10,10,10,0.55)', 0.6); }
      if (state === 2) { eyesOut(ctx, PX, PY, PW, PH); handprint(ctx, PX + PW * 0.5, PY + PH * 0.75, 0.9, 0.2, 0.8); bloodTop(ctx, rnd, 5, 50); stamp(ctx, 'MISSING', Q * 0.72, Q * 0.62, 30, '#d8cfb6', -0.22); }
      if (state === 3) { blankFace(ctx, PX, PY, PW, PH); ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(PX + PW + 6, PY, Q - PX - PW - 20, PH); figure(ctx, PX + PW + 6 + (Q - PX - PW - 20) / 2, PY + 6, PH - 10, '#cfd2cc', 0.95); marker(ctx, 'PRESENT', Q * 0.5, Q - 18, 26, BLOOD[2], -0.02); }
      break;
    default:
      if (state >= 2) bloodTop(ctx, rnd, 5);
  }
  if (state >= 2 && rnd() < 0.5) scratches(ctx, rnd, 3);
}

// ===================================================================================== the system
export class Posters {
  constructor(game) {
    this.game = game;
    this.list = []; // { id, design, pos, normal, state, mesh, room, owner }
    this.clocks = [];
    this.boards = [];
    this.group = new THREE.Group();
    this.group.name = 'hw-posters';
    this._tex = new Map(); // `${slot}:${state}` → texture
    this._fades = [];
    this.enabled = true;
    this.mild = false; // scare intensity 'mild': CORRUPTED at most, no gore-heavy HAUNTED
  }

  build() {
    this.clear();
    const w = this.game.world;
    if (!this.group.parent) this.game.scene.add(this.group);
    const owners = w.static?.owners;
    if (!owners) return this;
    let n = 0;
    for (const [owner, pls] of owners) {
      for (const pl of pls) {
        if (pl.node === 'poster_0') {
          const d = POSTER_DESIGNS.find((x) => x.uvTo === pl.uvTo) || null;
          if (!d || d.kind === 'handmade') continue; // the write-in posters are real photos: never corrupted
          const m = pl.m;
          const pos = new THREE.Vector3(0, 0.3, 0.008).applyMatrix4(m);
          const normal = new THREE.Vector3(0, 0, 1).transformDirection(m);
          const room = w.getRoomAt(pos.x + normal.x * 0.4, pos.z + normal.z * 0.4);
          this.list.push({ id: 'p' + n++, design: d, m: m.clone(), pos, normal, state: 0, mesh: null, room: room?.id ?? -1, owner });
        } else if (pl.node === 'wall_clock') {
          const pos = new THREE.Vector3(0, 0.17, 0.058).applyMatrix4(pl.m);
          const normal = new THREE.Vector3(0, 0, 1).transformDirection(pl.m);
          this.clocks.push({ id: 'c' + this.clocks.length, m: pl.m.clone(), pos, normal, mode: 'normal', mesh: null, owner, t: 0 });
        }
      }
    }
    // chalkboards in rooms
    for (const [roomId, data] of w._roomData || []) for (const b of data.boards || []) this.boards.push({ id: 'b' + this.boards.length, board: b, roomId, orig: b.text, changed: false, pos: new THREE.Vector3().setFromMatrixPosition(b.mesh.matrix) });
    return this;
  }

  _texture(d, state) {
    const key = d.slot + ':' + state;
    let t = this._tex.get(key);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = Q;
    const ctx = c.getContext('2d');
    drawState(ctx, this.game.world.election?.canvas || null, d, state, d.slot * 977 + state * 131 + 7);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    this._tex.set(key, t);
    return t;
  }

  _mesh(p) {
    if (p.mesh) return p.mesh;
    const geo = new THREE.PlaneGeometry(0.6, 0.6);
    geo.translate(0, 0.3, 0.007);
    const mat = new THREE.MeshLambertMaterial({ map: null, transparent: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(p.m);
    mesh.name = 'hw-poster';
    this.group.add(mesh);
    p.mesh = mesh;
    return mesh;
  }

  /** Set a poster's state (never lower). witnessed: fade in over `fade` seconds instead of swapping. */
  setState(p, state, { witnessed = false, fade = 4 } = {}) {
    if (!this.enabled) return false;
    if (this.mild) state = Math.min(state, 2);
    if (state <= p.state) return false;
    const mesh = this._mesh(p);
    const old = mesh.material.map;
    mesh.material.map = this._texture(p.design, state);
    mesh.material.needsUpdate = true;
    if (witnessed) {
      // only from NORMAL: the poster itself stays visible underneath while the overlay fades in
      if (p.state === 0 && !old) {
        mesh.material.transparent = true;
        mesh.material.opacity = 0;
        this._fades.push({ mesh, t: 0, dur: fade });
      }
    }
    p.state = state;
    return true;
  }

  /** Posters the player can't see right now (≥ 4 m away or outside the view / behind a wall). */
  canChange(p, gaze) {
    const t = gaze.test(p.pos, { heights: [0], margin: 0.1 });
    return !t.los || !t.inFrustum;
  }

  boardWrite(b, text) {
    if (!b?.board) return false;
    this.game.world.redrawBoard?.(b.board, text);
    b.changed = true;
    b.text = text;
    return true;
  }

  // ----------------------------------------------------------------------------- clocks
  _clockMesh(c) {
    if (c.mesh) return c.mesh;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const geo = new THREE.CircleGeometry(0.15, 16);
    const mat = new THREE.MeshLambertMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(c.m).multiply(new THREE.Matrix4().makeTranslation(0, 0.17, 0.058));
    this.group.add(mesh);
    c.mesh = mesh;
    c.canvas = cv;
    c.tex = tex;
    return mesh;
  }

  _drawClock(c, minutes) {
    const x = c.canvas.getContext('2d');
    x.fillStyle = '#d9d3bf';
    x.fillRect(0, 0, 64, 64);
    x.strokeStyle = '#2a2a2a';
    x.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      x.beginPath();
      x.moveTo(32 + Math.sin(a) * 25, 32 - Math.cos(a) * 25);
      x.lineTo(32 + Math.sin(a) * 29, 32 - Math.cos(a) * 29);
      x.stroke();
    }
    const h = ((minutes / 60) % 12) / 12 * Math.PI * 2, m = (minutes % 60) / 60 * Math.PI * 2;
    x.lineWidth = 3;
    x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.sin(h) * 14, 32 - Math.cos(h) * 14); x.stroke();
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(32, 32); x.lineTo(32 + Math.sin(m) * 22, 32 - Math.cos(m) * 22); x.stroke();
    c.tex.needsUpdate = true;
  }

  /** mode: 'stopped' (00:00 / 3:33), 'backwards' (the minute hand creeps the wrong way). */
  setClock(c, mode) {
    this._clockMesh(c);
    c.mode = mode;
    c.t = mode === 'stopped' ? (Math.random() < 0.5 ? 0 : 213) : 22 * 60 + 47;
    this._drawClock(c, c.t);
  }

  update(dt) {
    for (let i = this._fades.length - 1; i >= 0; i--) {
      const f = this._fades[i];
      f.t += dt;
      f.mesh.material.opacity = Math.min(1, f.t / f.dur);
      if (f.t >= f.dur) {
        f.mesh.material.transparent = false;
        f.mesh.material.opacity = 1;
        f.mesh.material.needsUpdate = true;
        this._fades.splice(i, 1);
      }
    }
    for (const c of this.clocks) {
      if (c.mode !== 'backwards') continue;
      c._acc = (c._acc || 0) + dt;
      if (c._acc >= 1) {
        c._acc = 0;
        c.t -= 1;
        this._drawClock(c, (c.t + 720 * 60) % 720);
      }
    }
  }

  /** After a building change: keep the states of posters still hanging (same matrix), drop the rest. */
  rebuild() {
    const old = this.list;
    const oldClocks = this.clocks;
    const keep = new Map();
    for (const p of old) keep.set(p.m.elements.map((v) => v.toFixed(3)).join(','), p);
    for (const p of old) if (p.mesh) this.group.remove(p.mesh);
    for (const c of oldClocks) if (c.mesh) this.group.remove(c.mesh);
    const prevBoards = new Map(this.boards.map((b) => [b.board, b]));
    this.list = [];
    this.clocks = [];
    this.boards = [];
    this._fades = [];
    this.build();
    for (const p of this.list) {
      const o = keep.get(p.m.elements.map((v) => v.toFixed(3)).join(','));
      if (o && o.state > 0) {
        const s = o.state;
        p.state = 0;
        this.setState(p, s);
      }
    }
    for (const b of this.boards) {
      const o = prevBoards.get(b.board);
      if (o?.changed) Object.assign(b, { changed: true, text: o.text, orig: o.orig });
    }
  }

  counts() {
    const c = [0, 0, 0, 0];
    for (const p of this.list) c[p.state]++;
    return c;
  }

  clear() {
    for (const p of this.list) if (p.mesh) { this.group.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    for (const c of this.clocks) if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh.material.dispose(); c.tex?.dispose(); }
    this.list = [];
    this.clocks = [];
    this.boards = [];
    this._fades = [];
  }

  dispose() {
    this.clear();
    for (const t of this._tex.values()) t.dispose();
    this._tex.clear();
    this.group.parent?.remove(this.group);
  }
}
